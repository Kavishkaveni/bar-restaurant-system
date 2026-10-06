import logging

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import audit_log, auth, catalogue, orders, pos, purchases, roles, settings, stock, suppliers, users
from app.core.config import get_settings

_cfg = get_settings()
if _cfg.app_env == "production" and len(_cfg.jwt_secret) < 32:
    raise RuntimeError("Set JWT_SECRET to a random value of at least 32 characters in production")

app = FastAPI(title="Bar & Restaurant System API", version="0.1.0")
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


@api.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}


app.include_router(api)
