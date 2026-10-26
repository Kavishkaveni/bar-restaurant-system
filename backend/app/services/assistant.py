"""The AI assistant: answers questions about the business in plain words.

The AI never sees the database. It gets a small set of tools that return
the same figures as the Reports and Dashboard pages, asks for what it needs,
and writes the answer. Guest names, phones and ID numbers are never sent.

Any provider with an OpenAI-style chat API works: Google Gemini (free tier),
Groq (free plan), OpenAI, or a model running on your own computer (Ollama).
"""

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import business_tz
from app.models import Booking, Item, Room, Setting, User
from app.services import stock
from app.services.pins import has_permission

log = logging.getLogger("app.ai")

PROVIDERS: dict[str, dict[str, str]] = {
    "gemini": {"base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "gemini-3.8-flash",
               "label": "Google Gemini (free tier)", "key_url": "https://aistudio.google.com/apikey"},
    "groq": {"base_url": "https://api.groq.com/openai/v1", "model": "openai/gpt-oss-20b",
             "label": "Groq (free plan)", "key_url": "https://console.groq.com/keys"},
    "openai": {"base_url": "https://api.openai.com/v1", "model": "gpt-4.1-mini", "label": "OpenAI (paid)",
               "key_url": "https://platform.openai.com/api-keys"},
    "custom": {"base_url": "", "model": "", "label": "Other (OpenAI-compatible)", "key_url": ""},
}
MAX_ROUNDS = 6


class AssistantError(Exception):
    """Something the owner can fix or wait out; the message is shown as is."""


@dataclass
class AIConfig:
    provider: str
    base_url: str
    model: str
    api_key: str

    @property
    def ready(self) -> bool:
        return bool(self.base_url and self.model and (self.api_key or self.provider == "custom"))


async def load_config(db: AsyncSession) -> AIConfig:
    rows = {r.key: r.value for r in await db.scalars(select(Setting).where(Setting.key.like("ai_%")))}
    provider = rows.get("ai_provider") or "gemini"
    preset = PROVIDERS.get(provider, PROVIDERS["custom"])
    return AIConfig(
        provider=provider,
        base_url=(rows.get("ai_base_url") or preset["base_url"]).rstrip("/"),
        model=rows.get("ai_model") or preset["model"],
        api_key=rows.get("ai_api_key") or "",
    )


# ---- Tools the AI can call -------------------------------------------------------------

DATE_RANGE = {
    "type": "object",
    "properties": {
        "start": {"type": "string", "description": "First day, YYYY-MM-DD"},
        "end": {"type": "string", "description": "Last day, YYYY-MM-DD (inclusive)"},
    },
    "required": ["start", "end"],
}

TOOLS = [
    {"type": "function", "function": {
        "name": "sales_summary",
        "description": "Totals for a date range: bill sales by section (bar, kitchen, sundries), discounts, "
                       "service charge, tax, room income, money in by payment method, expenses by category, "
                       "voids, and (if allowed) cost of sales, wastage and profit.",
        "parameters": DATE_RANGE}},
    {"type": "function", "function": {
        "name": "daily_figures",
        "description": "Day-by-day sales, room income, expenses and (if allowed) cost and profit for a range.",
        "parameters": DATE_RANGE}},
    {"type": "function", "function": {
        "name": "best_sellers",
        "description": "Items sold most in a date range, by amount, with quantities.",
        "parameters": DATE_RANGE}},
    {"type": "function", "function": {
        "name": "stock_levels",
        "description": "Current stock. With 'search', items whose name matches; with low_only=true, items "
                       "below their reorder level.",
        "parameters": {"type": "object", "properties": {
            "search": {"type": "string", "description": "Part of an item name, e.g. 'arrack'"},
            "low_only": {"type": "boolean"}}}}},
    {"type": "function", "function": {
        "name": "stock_movement",
        "description": "For a date range, each stocked item's opening, received, sold, wasted, count "
                       "differences and closing quantity.",
        "parameters": DATE_RANGE}},
    {"type": "function", "function": {
        "name": "rooms_now",
        "description": "Rooms right now: total, occupied, arriving today, leaving today, to clean, "
                       "maintenance, and upcoming bookings count for the next 7 days. No guest details.",
        "parameters": {"type": "object", "properties": {}}}},
]


def _day(s: str, today: date) -> date:
    try:
        return date.fromisoformat(s)
    except (TypeError, ValueError):
        return today


def _plain(v: Any) -> Any:
    """Decimals to numbers, dates to text, so results go to the AI as JSON."""
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items() if x is not None}
    if isinstance(v, list):
        return [_plain(x) for x in v]
    return v


async def run_tool(name: str, args: dict, db: AsyncSession, user: User, today: date, tz_name: str) -> dict:
    from app.api.reports import stock_report, summary  # here to avoid a circular import

    can_profit = has_permission(user, "dashboard.profit")
    if name in ("sales_summary", "daily_figures", "best_sellers", "stock_movement"):
        start, end = _day(args.get("start"), today), _day(args.get("end"), today)
        if end < start:
            start, end = end, start
        if (end - start).days > 366:
            start = end - timedelta(days=366)
        if name == "stock_movement":
            rows = await stock_report(user, db, start, end)
            return {"start": start, "end": end, "items": [
                {k: getattr(r, k) for k in ("name", "category", "opening", "received", "sold", "wasted", "adjusted",
                                            "closing")} | ({"closing_value": r.closing_value} if can_profit else {})
                for r in rows]}
        s = await summary(user, db, start, end)
        if name == "daily_figures":
            return {"days": [d.model_dump() for d in s.daily]}
        if name == "best_sellers":
            return {"start": start, "end": end, "items": [t.model_dump() for t in s.top_items]}
        data = s.model_dump(exclude={"daily", "top_items"})
        if not can_profit:
            data["note"] = "This user may not see cost or profit figures."
        return data
    if name == "stock_levels":
        q = select(Item).where(Item.is_active.is_(True), Item.track_stock.is_(True), Item.kind != "build_assembly")
        search = (args.get("search") or "").strip()
        if search:
            q = q.where(or_(*[Item.name.ilike(f"%{w}%") for w in search.split()]))
        items = list(await db.scalars(q.order_by(Item.name).limit(60)))
        qty = await stock.on_hand(db, [i.id for i in items])
        out = []
        for i in items:
            low = bool(i.reorder_level) and qty[i.id] < i.reorder_level * i.unit_size
            if args.get("low_only") and not low:
                continue
            out.append({"name": i.name, "in_stock": stock.format_qty(i, qty[i.id]), "low": low,
                        "reorder_level": stock.format_qty(i, i.reorder_level * i.unit_size) if i.reorder_level else None})
        return {"items": out}
    if name == "rooms_now":
        tz = business_tz(tz_name)
        day_end = datetime.combine(today + timedelta(days=1), time.min, tz)
        week_end = day_end + timedelta(days=7)
        rooms = list(await db.scalars(select(Room).where(Room.is_active.is_(True))))
        live = list(await db.scalars(select(Booking).where(Booking.status.in_(["booked", "checked_in"]))))
        return {
            "total_rooms": len(rooms),
            "occupied": sum(b.status == "checked_in" for b in live),
            "arriving_today": sum(b.status == "booked" and b.arrival < day_end for b in live),
            "leaving_today": sum(b.status == "checked_in" and b.departure < day_end for b in live),
            "upcoming_bookings_next_7_days": sum(b.status == "booked" and b.arrival < week_end for b in live),
            "rooms_to_clean": sum(r.housekeeping == "dirty" for r in rooms),
            "rooms_in_maintenance": sum(r.housekeeping == "maintenance" for r in rooms),
        }
    return {"error": f"Unknown tool {name}"}


# ---- Talking to the AI ---------------------------------------------------------------------

def system_prompt(business: str, today: date, currency: str, can_profit: bool) -> str:
    return (
        f"You are the assistant inside the management system of {business}, a bar, restaurant and rooms "
        f"business in Sri Lanka. Today is {today:%A %d %B %Y} ({today.isoformat()}). Money is in {currency}.\n"
        "Answer the owner's or manager's question using the tools: never guess or invent figures. "
        "Work out date ranges yourself (yesterday, this week starting Monday, last month...). "
        "Reply in short, plain, friendly language, like a helpful manager would: lead with the answer, "
        "then a few key numbers. Use simple bullet points for lists. Format money like 'Rs. 12,500'. "
        "If the data is empty, say so plainly. If asked for something the tools can't give (for example "
        "guest personal details, or changing data), say you can only read reports.\n"
        + ("" if can_profit else "This user is not allowed to see cost or profit; don't estimate them.\n")
        + "Reply in the language the question was asked in (English, Sinhala or Tamil)."
    )


BUSY = (500, 502, 503, 504)


async def _post(client: httpx.AsyncClient, cfg: AIConfig, payload: dict) -> httpx.Response:
    """Send one request. When the service is busy (free models often are), wait and try
    again a couple of times before giving up."""
    headers = {"Authorization": f"Bearer {cfg.api_key}"} if cfg.api_key else {}
    for attempt in range(3):
        try:
            r = await client.post(f"{cfg.base_url}/chat/completions", headers=headers,
                                  json={"model": cfg.model, **payload})
        except httpx.HTTPError as e:
            log.warning("AI request failed: %s", e)
            raise AssistantError("Couldn't reach the AI service. Check the internet connection.") from None
        if r.status_code not in BUSY or attempt == 2:
            return r
        await asyncio.sleep(2 * (attempt + 1))
    return r


def _check(r: httpx.Response) -> None:
    """Turn the AI service's errors into plain messages."""
    code = r.status_code
    if code < 400:
        return
    log.warning("AI error %s: %s", code, r.text[:500])
    if code in (401, 403):
        raise AssistantError("The AI service didn't accept the key. Check it in Settings → AI assistant.")
    if code == 402:
        raise AssistantError("This key belongs to a paid project with no credit left. For the free tier, make a "
                             "new key in a new project (with no billing), then paste it in Settings → AI assistant.")
    if code == 404:
        raise AssistantError("The AI service doesn't know that model. Check the model name in Settings → AI assistant.")
    if code == 429:
        raise AssistantError("The free AI limit is used up for now. Try again in a minute.")
    if code in BUSY:
        raise AssistantError("The AI model is busy right now. Try again in a minute, or choose a lighter model in "
                             "Settings → AI assistant.")
    raise AssistantError(f"The AI service returned an error ({code}). Check the settings in Settings → AI assistant.")


async def ask(db: AsyncSession, user: User, question: str, history: list[dict], today: date, tz_name: str,
              business: str, currency: str, cfg: AIConfig | None = None) -> tuple[str, list[str]]:
    cfg = cfg or await load_config(db)
    if not cfg.ready:
        raise AssistantError("The AI assistant isn't set up yet. The owner can add a free key in "
                             "Settings → AI assistant.")
    messages: list[dict] = [
        {"role": "system", "content": system_prompt(business, today, currency, has_permission(user, "dashboard.profit"))},
        *[{"role": m["role"], "content": m["content"]} for m in history[-8:] if m.get("role") in ("user", "assistant")],
        {"role": "user", "content": question},
    ]
    used: list[str] = []
    async with httpx.AsyncClient(timeout=60) as client:
        for _ in range(MAX_ROUNDS):
            r = await _post(client, cfg, {"messages": messages, "tools": TOOLS, "tool_choice": "auto",
                                          "temperature": 0.2})
            _check(r)
            msg = r.json()["choices"][0]["message"]
            calls = msg.get("tool_calls") or []
            if not calls:
                return (msg.get("content") or "").strip() or "I couldn't find an answer to that.", used
            messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
            for call in calls:
                fn = call.get("function", {})
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                used.append(fn.get("name", "?"))
                result = await run_tool(fn.get("name", ""), args, db, user, today, tz_name)
                messages.append({"role": "tool", "tool_call_id": call.get("id", ""),
                                 "content": json.dumps(_plain(result))[:20000]})
    return "That question needed too many steps. Try asking it in a simpler way.", used


async def ping(cfg: AIConfig) -> str:
    """A tiny request to check the key and model work."""
    if not cfg.ready:
        raise AssistantError("Choose a service and paste the key first.")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await _post(client, cfg, {"messages": [{"role": "user", "content": "Reply with just: OK"}]})
    _check(r)
    return (r.json()["choices"][0]["message"].get("content") or "").strip()
