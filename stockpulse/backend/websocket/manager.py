"""
websocket/manager.py

FIX: When Finnhub returns price=0 (market closed / free tier limitation),
     fall back to yfinance which always returns the last known price.
     This keeps the chart and live price updating even outside market hours.
"""

import asyncio
import logging
import os
import requests
from collections import defaultdict
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from services.stock import fetch_ohlc
from services.alerts import register_broadcast, check_alerts_loop

logger = logging.getLogger(__name__)
router = APIRouter()

_rooms: dict[str, set[WebSocket]] = defaultdict(set)
_tasks: dict[str, asyncio.Task] = {}
_seed_tasks: dict[int, asyncio.Task] = {}

STREAM_INTERVAL = 5


def _finnhub_key() -> str:
    return os.getenv("FINNHUB_API_KEY", "")


# ── Candle aggregator ─────────────────────────────────────────────────────────

class CandleAggregator:
    def __init__(self, minutes: int = 1):
        self.minutes   = minutes
        self.bucket_ts = None
        self.open = self.high = self.low = self.close = None
        self.volume = 0

    def _bucket_start(self, now: datetime) -> datetime:
        epoch   = datetime(1970, 1, 1, tzinfo=timezone.utc)
        secs    = int((now - epoch).total_seconds())
        floored = (secs // (self.minutes * 60)) * (self.minutes * 60)
        return epoch + timedelta(seconds=floored)

    def push(self, price: float, volume: int = 0):
        now    = datetime.now(timezone.utc)
        bucket = self._bucket_start(now)
        completed = None

        if self.bucket_ts is None:
            self.bucket_ts = bucket
            self.open = self.high = self.low = self.close = price
            self.volume = volume
        elif bucket > self.bucket_ts:
            completed      = self._snap(self.bucket_ts)
            self.bucket_ts = bucket
            self.open = self.high = self.low = self.close = price
            self.volume = volume
        else:
            self.high   = max(self.high, price)
            self.low    = min(self.low,  price)
            self.close  = price
            self.volume += volume

        return completed, self._snap(self.bucket_ts)

    def _snap(self, ts):
        return {
            "ts":     ts.isoformat(),
            "open":   round(self.open,  4),
            "high":   round(self.high,  4),
            "low":    round(self.low,   4),
            "close":  round(self.close, 4),
            "volume": self.volume,
        }


_aggregators: dict[str, CandleAggregator] = {}


# ── Broadcast ─────────────────────────────────────────────────────────────────

async def broadcast(ticker: str, message: dict):
    dead = []
    for ws in list(_rooms.get(ticker, set())):
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _rooms[ticker].discard(ws)


register_broadcast(broadcast)


# ── Price fetcher with yfinance fallback ──────────────────────────────────────

def _fetch_price(ticker: str) -> tuple[float, float, float]:
    """
    Returns (price, change, change_pct).
    Tries Finnhub first; if price == 0 (market closed / free-tier gap),
    falls back to yfinance fast_info which always has the last close.
    """
    # 1. Try Finnhub
    key = _finnhub_key()
    if key:
        try:
            res  = requests.get(
                "https://finnhub.io/api/v1/quote",
                params={"symbol": ticker, "token": key},
                timeout=5,
            )
            data = res.json()
            if "error" in data:
                logger.warning("Finnhub quote error [%s]: %s", ticker, data["error"])
            else:
                price = float(data.get("c", 0))
                if price > 0:
                    return price, float(data.get("d", 0)), float(data.get("dp", 0))
        except Exception as e:
            logger.warning("Finnhub fetch failed for %s: %s", ticker, e)

    # 2. Fallback: yfinance (works 24/7, always returns last close)
    try:
        import yfinance as yf
        info  = yf.Ticker(ticker).fast_info
        price = float(getattr(info, "last_price", 0) or 0)
        prev  = float(getattr(info, "previous_close", price) or price)
        if price > 0:
            change     = round(price - prev, 4)
            change_pct = round((change / prev * 100) if prev else 0, 4)
            logger.debug("yfinance price for %s: %.4f", ticker, price)
            return price, change, change_pct
    except Exception as e:
        logger.warning("yfinance price fallback failed for %s: %s", ticker, e)

    return 0.0, 0.0, 0.0


# ── Streaming ─────────────────────────────────────────────────────────────────

async def _stream_ticker(ticker: str):
    logger.info("Streaming task started for %s", ticker)
    if ticker not in _aggregators:
        _aggregators[ticker] = CandleAggregator(minutes=1)
    agg = _aggregators[ticker]

    while _rooms.get(ticker):
        try:
            price, change, chg_pct = await asyncio.to_thread(_fetch_price, ticker)

            if price > 0:
                completed, current = agg.push(price)
                if completed:
                    await broadcast(ticker, {
                        "type": "candle", "ticker": ticker,
                        "data": {**completed, "change": change, "change_pct": chg_pct},
                    })
                await broadcast(ticker, {
                    "type": "candle", "ticker": ticker,
                    "data": {**current, "change": change, "change_pct": chg_pct},
                })
            else:
                logger.warning("No price available for %s", ticker)

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("Stream error for %s: %s", ticker, e)

        await asyncio.sleep(STREAM_INTERVAL)

    logger.info("Stream task exiting for %s", ticker)


# ── History seed ──────────────────────────────────────────────────────────────

SEED_ATTEMPTS = [("5d", "5m"), ("1mo", "30m"), ("3mo", "1d")]


def _ws_alive(ws: WebSocket) -> bool:
    return ws.client_state == WebSocketState.CONNECTED


async def _seed_history(websocket: WebSocket, ticker: str):
    for period, interval in SEED_ATTEMPTS:
        if not _ws_alive(websocket):
            return
        try:
            candles = await fetch_ohlc(ticker, period=period, interval=interval)
            if not candles:
                continue
            if not _ws_alive(websocket):
                return
            await websocket.send_json({
                "type": "history", "ticker": ticker,
                "data": {"candles": [c.model_dump() for c in candles]},
            })
            logger.info("Seeded %d candles (%s/%s) for %s", len(candles), period, interval, ticker)
            return
        except Exception as e:
            logger.warning("Seed %s/%s failed for %s: %s", period, interval, ticker, e)

    logger.warning("All seed attempts failed for %s", ticker)


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@router.websocket("/ws/{ticker}")
async def websocket_endpoint(websocket: WebSocket, ticker: str):
    await websocket.accept()
    ticker = ticker.upper()
    logger.info("WS connected: %s", ticker)

    _rooms[ticker].add(websocket)

    existing = _tasks.get(ticker)
    if not existing or existing.done():
        if existing:
            existing.cancel()
        _tasks[ticker] = asyncio.create_task(_stream_ticker(ticker))

    seed_task = asyncio.create_task(_seed_history(websocket, ticker))
    _seed_tasks[id(websocket)] = seed_task

    try:
        while True:
            msg = await websocket.receive_text()
            if msg == "ping" and _ws_alive(websocket):
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        logger.info("WS disconnected: %s", ticker)
    except Exception as e:
        logger.warning("WS closed for %s: %s", ticker, e)
    finally:
        st = _seed_tasks.pop(id(websocket), None)
        if st and not st.done():
            st.cancel()
        _rooms[ticker].discard(websocket)
        if not _rooms[ticker]:
            task = _tasks.pop(ticker, None)
            if task:
                task.cancel()
            logger.info("Stream task stopped for %s (no subscribers)", ticker)


async def start_background_tasks():
    asyncio.create_task(check_alerts_loop())
    logger.info("Alert checker started")