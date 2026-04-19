"""
WebSocket manager — pub-sub connection hub.

FIXES:
  1. History seed now tries multiple periods (5d, 1mo) so it always finds
     data even on weekends/holidays when intraday data is unavailable.
  2. CandleAggregator properly builds 1-min OHLC from live ticks.
  3. WS responds to ping with pong to keep connection alive.
"""

import asyncio
import logging
import os
import requests
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from math import floor

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.stock import fetch_ohlc
from services.alerts import register_broadcast, check_alerts_loop

logger = logging.getLogger(__name__)
router = APIRouter()

_rooms: dict[str, set[WebSocket]] = defaultdict(set)
_tasks: dict[str, asyncio.Task] = {}

STREAM_INTERVAL = 5
FINNHUB_KEY     = os.getenv("FINNHUB_API_KEY")


# ── Candle aggregator ─────────────────────────────────────────────────────────

class CandleAggregator:
    """Buckets real-time price ticks into 1-minute OHLC candles."""

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


# ── History seed — tries multiple periods until data is found ─────────────────

SEED_ATTEMPTS = [
    ("5d",  "5m"),    # most recent: 5 days of 5-min bars
    ("1mo", "30m"),   # fallback: 1 month of 30-min bars
    ("3mo", "1d"),    # last resort: 3 months of daily bars
]


async def _seed_history(websocket: WebSocket, ticker: str):
    for period, interval in SEED_ATTEMPTS:
        try:
            candles = await fetch_ohlc(ticker, period=period, interval=interval)
            if candles and len(candles) > 0:
                await websocket.send_json({
                    "type": "history",
                    "ticker": ticker,
                    "data": {"candles": [c.model_dump() for c in candles]},
                })
                logger.info(
                    "Seeded %d candles (%s/%s) to %s",
                    len(candles), period, interval, ticker
                )
                return
        except Exception as e:
            logger.warning("Seed attempt %s/%s failed for %s: %s", period, interval, ticker, e)

    logger.warning("All seed attempts failed for %s — client will rely on live ticks", ticker)


# ── Streaming ─────────────────────────────────────────────────────────────────

async def _stream_ticker(ticker: str):
    logger.info("Streaming task started for %s", ticker)
    if ticker not in _aggregators:
        _aggregators[ticker] = CandleAggregator(minutes=1)
    agg = _aggregators[ticker]

    while _rooms.get(ticker):
        try:
            res = requests.get(
                "https://finnhub.io/api/v1/quote",
                params={"symbol": ticker, "token": FINNHUB_KEY},
                timeout=5,
            )
            data    = res.json()
            price   = float(data.get("c", 0))
            change  = float(data.get("d",  0))
            chg_pct = float(data.get("dp", 0))

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
                logger.warning("No price for %s — check FINNHUB_API_KEY", ticker)

        except Exception as e:
            logger.error("Stream error for %s: %s", ticker, e)

        await asyncio.sleep(STREAM_INTERVAL)


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@router.websocket("/ws/{ticker}")
async def websocket_endpoint(websocket: WebSocket, ticker: str):
    print(f"WS: incoming for {ticker}")
    try:
        await websocket.accept()
        ticker = ticker.upper()
        _rooms[ticker].add(websocket)

        await _seed_history(websocket, ticker)

        if ticker not in _tasks or _tasks[ticker].done():
            _tasks[ticker] = asyncio.create_task(_stream_ticker(ticker))

        while True:
            try:
                msg = await websocket.receive_text()
                if msg == "ping":
                    await websocket.send_text("pong")
            except Exception as e:
                print(f"WS receive closed for {ticker}: {e}")
                break
    except Exception as e:
        print(f"WS FATAL: {e}")
        import traceback; traceback.print_exc()
    finally:
        _rooms.get(ticker, set()).discard(websocket)
        print(f"WS: disconnected {ticker}")


async def start_background_tasks():
    asyncio.create_task(check_alerts_loop())
    logger.info("Alert checker started")