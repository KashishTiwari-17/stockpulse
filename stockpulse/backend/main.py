"""
StockPulse — Entry point

CRITICAL FIX: load_dotenv() MUST run before any other local import,
because modules like routes.py and stock.py call os.getenv() at import
time. Moving load_dotenv() to the very top of the file fixes API_KEY=None.
"""
# ── Load .env FIRST — before any local imports ────────────────────────────────
from dotenv import load_dotenv
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

# Confirm keys are loaded (shows in startup log — remove after confirming)
import logging
_pre = logging.getLogger("startup")
_finnhub  = os.getenv("FINNHUB_API_KEY",      "")
_alphav   = os.getenv("ALPHA_VANTAGE_API_KEY", "")
print(f"[startup] FINNHUB_API_KEY  : {'SET ✓' if _finnhub  else 'MISSING ✗'}")
print(f"[startup] ALPHA_VANTAGE_KEY: {'SET ✓' if _alphav   else 'MISSING ✗'}")

# ── Now safe to import local modules ─────────────────────────────────────────
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router as api_router
from websocket.manager import router as ws_router
from db.database import init_db
from middleware.rate_limiter import RateLimitMiddleware
from middleware.logging import setup_logging

setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 StockPulse starting up...")
    await init_db()
    logger.info("✅ Database initialized")
    yield
    logger.info("🛑 StockPulse shutting down...")


app = FastAPI(
    title="StockPulse API",
    description="Real-time stock data streaming with analytics",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")
app.include_router(ws_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}