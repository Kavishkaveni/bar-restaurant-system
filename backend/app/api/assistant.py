"""AI assistant: settings for the owner, and questions from staff allowed to use it."""

import time
from collections import defaultdict, deque
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.api.deps import DB, require
from app.api.settings import load_settings
from app.core.timeutil import business_tz
from app.models import Setting, User
from app.services import assistant, audit

router = APIRouter(prefix="/ai", tags=["ai"])

Owner = Annotated[User, Depends(require("settings.manage"))]
Asker = Annotated[User, Depends(require("ai.use"))]

# A few questions a minute per person keeps a free plan from running out.
PER_MINUTE = 8
_recent: dict[int, deque[float]] = defaultdict(deque)


class ProviderOut(BaseModel):
    key: str
    label: str
    model: str
    base_url: str
    key_url: str


class ConfigOut(BaseModel):
    provider: str
    model: str
    base_url: str
    key_set: bool
    key_hint: str
    providers: list[ProviderOut]


class ConfigIn(BaseModel):
    provider: Literal["gemini", "groq", "openai", "custom"]
    model: str = Field(default="", max_length=100)
    base_url: str = Field(default="", max_length=300)
    api_key: str | None = Field(default=None, max_length=300)  # None keeps the saved key


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    history: list[Message] = Field(default=[], max_length=20)


class AskOut(BaseModel):
    answer: str
    used: list[str]


class StatusOut(BaseModel):
    ready: bool
    provider: str


async def _config_out(db: DB) -> ConfigOut:
    cfg = await assistant.load_config(db)
    return ConfigOut(
        provider=cfg.provider, model=cfg.model, base_url=cfg.base_url, key_set=bool(cfg.api_key),
        key_hint=f"…{cfg.api_key[-4:]}" if len(cfg.api_key) >= 8 else "",
        providers=[ProviderOut(key=k, **v) for k, v in assistant.PROVIDERS.items()],
    )


@router.get("/config", response_model=ConfigOut)
async def get_config(_: Owner, db: DB):
    return await _config_out(db)


@router.put("/config", response_model=ConfigOut)
async def save_config(body: ConfigIn, actor: Owner, db: DB, request: Request):
    preset = assistant.PROVIDERS[body.provider]
    if body.provider == "custom" and not body.base_url.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter the service address")
    values = {
        "ai_provider": body.provider,
        # Empty means "use the provider's default", so a later default change applies.
        "ai_model": body.model.strip() if body.model.strip() != preset["model"] else "",
        "ai_base_url": body.base_url.strip() if body.provider == "custom" else "",
    }
    if body.api_key is not None:
        values["ai_api_key"] = body.api_key.strip()
    for key, value in values.items():
        row = await db.get(Setting, key)
        if row:
            row.value = value
        else:
            db.add(Setting(key=key, value=value))
    audit.record(db, user=actor, action="update", entity="settings",
                 after={"ai_provider": body.provider, "ai_model": body.model or preset["model"],
                        "ai_key": "changed" if body.api_key is not None else "unchanged"}, request=request)
    await db.commit()
    return await _config_out(db)


@router.post("/test")
async def test_config(_: Owner, db: DB):
    try:
        reply = await assistant.ping(await assistant.load_config(db))
    except assistant.AssistantError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    return {"ok": True, "reply": reply}


@router.get("/status", response_model=StatusOut)
async def ai_status(_: Asker, db: DB):
    cfg = await assistant.load_config(db)
    return StatusOut(ready=cfg.ready, provider=assistant.PROVIDERS.get(cfg.provider, {}).get("label", cfg.provider))


@router.post("/ask", response_model=AskOut)
async def ask(body: AskIn, actor: Asker, db: DB):
    now = time.monotonic()
    recent = _recent[actor.id]
    while recent and now - recent[0] > 60:
        recent.popleft()
    if len(recent) >= PER_MINUTE:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "That's a lot of questions. Wait a minute and try again.")
    recent.append(now)

    s = await load_settings(db)
    today = datetime.now(business_tz(s["timezone"])).date()
    try:
        answer, used = await assistant.ask(
            db, actor, body.question.strip(), [m.model_dump() for m in body.history], today, s["timezone"],
            s["business_name"], s["currency"])
    except assistant.AssistantError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    return AskOut(answer=answer, used=used)
