"""Aggregates every endpoint router under /api (unversioned: the frontend calls /api/* directly)."""

from fastapi import APIRouter

from app.api.endpoints import assistant, health, intake, stt, translate, tts

api_router = APIRouter(prefix="/api")
api_router.include_router(intake.router, prefix="/intake")
api_router.include_router(assistant.router)
api_router.include_router(health.router)
api_router.include_router(stt.router)
api_router.include_router(tts.router)
api_router.include_router(translate.router)
