"""
StockPulse - Production-grade real-time stock dashboard
Entry point for FastAPI application
"""
from dotenv import load_dotenv
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router as api_router
from websocket.manager import router as ws_router
from db.database import init_db
from middleware.rate_limiter import RateLimitMiddleware
from middleware.logging import setup_logging

# ── Structured logging setup ────────────────────────────────────────────────
setup_logging()
logger = logging.getLogger(__name__)


# ── Lifespan: startup / shutdown ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 StockPulse starting up...")
    await init_db()
    logger.info("✅ Database initialized")
    yield
    logger.info("🛑 StockPulse shutting down...")


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="StockPulse API",
    description="Real-time stock data streaming with analytics",
    version="2.0.0",
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────────────────────
# Replace your existing CORSMiddleware with this:
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(api_router, prefix="/api/v1")
app.include_router(ws_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}
