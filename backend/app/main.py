import asyncio
import logging
from contextlib import asynccontextmanager

import jwt
from fastapi import APIRouter, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import (
    audit_log,
    auth,
    bookings,
    bottles,
    catalogue,
    dashboard,
    kitchen,
    money,
    orders,
    pos,
    purchases,
    recipes,
    reports,
    roles,
    rooms,
    settings,
    stock,
    suppliers,
    users,
)
from app.core.config import get_settings
from app.core.security import decode_token
from app.services import live

_cfg = get_settings()
if _cfg.app_env == "production" and len(_cfg.jwt_secret) < 32:
    raise RuntimeError("Set JWT_SECRET to a random value of at least 32 characters in production")

@asynccontextmanager
async def lifespan(_: FastAPI):
    if get_settings().live_updates:
        await live.hub.start()
    yield
    await live.hub.stop()


app = FastAPI(title="Bar & Restaurant System API", version="0.1.0", lifespan=lifespan)
log = logging.getLogger("app")


# Registered before CORS so it sits inside it: an unexpected error still goes
# back with CORS headers, and the website shows "something went wrong on the
# server" instead of "cannot reach the server". The full error is logged.
@app.middleware("http")
async def catch_errors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception:
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={"detail": "Something went wrong on the server. The details are in the backend window."},
        )


# Tell open screens (dashboard, POS, kitchen, rooms) that something changed.
@app.middleware("http")
async def announce_changes(request: Request, call_next):
    response = await call_next(request)
    if (
        request.method in ("POST", "PUT", "PATCH", "DELETE")
        and response.status_code < 400
        and get_settings().live_updates
        and (topic := live.topic_for(request.url.path))
    ):
        await live.hub.publish(topic)
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")
api.include_router(auth.router)
api.include_router(users.router)
api.include_router(roles.router)
api.include_router(settings.router)
api.include_router(audit_log.router)
api.include_router(catalogue.router)
api.include_router(stock.router)
api.include_router(suppliers.router)
api.include_router(purchases.router)
api.include_router(pos.router)
api.include_router(orders.router)
api.include_router(recipes.router)
api.include_router(bottles.router)
api.include_router(kitchen.router)
api.include_router(rooms.router)
api.include_router(bookings.router)
api.include_router(money.router)
api.include_router(reports.router)
api.include_router(dashboard.router)


@api.websocket("/live")
async def live_updates(websocket: WebSocket, token: str = ""):
    """Browsers connect here with their access token and get {"topic": ...}
    messages when something changes."""
    try:
        payload = decode_token(token, "access")
        int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        await websocket.close(code=4401)
        return
    await websocket.accept()
    queue = live.hub.subscribe()
    try:
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=25)
            except TimeoutError:
                message = '{"topic": "ping"}'  # keeps proxies from closing an idle line
            await websocket.send_text(message)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        live.hub.unsubscribe(queue)


@api.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}


app.include_router(api)
