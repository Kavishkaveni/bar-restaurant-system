from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import audit_log, auth, roles, settings, users
from app.core.config import get_settings

_cfg = get_settings()
if _cfg.app_env == "production" and len(_cfg.jwt_secret) < 32:
    raise RuntimeError("Set JWT_SECRET to a random value of at least 32 characters in production")

app = FastAPI(title="Bar & Restaurant System API", version="0.1.0")

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


@api.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}


app.include_router(api)
