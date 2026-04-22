"""
services/stock.py

DATA SOURCES:
  • Live quote  → Finnhub  /quote          (free tier ✓)
  • OHLC history → yfinance (Yahoo Finance) (completely free, no key needed ✓)

WHY THE CHANGE:
  Finnhub's /stock/candle endpoint requires a paid subscription.
  yfinance wraps Yahoo Finance and is the standard free alternative.

INSTALL (once):
  pip install yfinance --break-system-packages
"""

import os
import asyncio
import logging
import requests
import yfinance as yf
from datetime import datetime, timezone
from models.schemas import Candle

logger = logging.getLogger(__name__)

# yfinance period/interval mappings
# yfinance valid combos: https://pypi.org/project/yfinance/
YF_INTERVAL_MAP = {
    "1m":  "1m",
    "5m":  "5m",
    "15m": "15m",
    "30m": "30m",
    "1h":  "60m",   # yfinance uses "60m" not "1h"
    "1d":  "1d",
}

# Fallback chain when primary period/interval returns no data
# yfinance only allows intraday (<= 60d back) for sub-day intervals
FALLBACK_CHAIN = [
    ("5d",  "5m"),
    ("5d",  "15m"),
    ("1mo", "30m"),
    ("3mo", "1d"),
]


def _finnhub_key() -> str:
    k = os.getenv("FINNHUB_API_KEY", "")
    if not k:
        logger.error("FINNHUB_API_KEY not set — live quotes will not work")
    return k


# ── Live quote (Finnhub free tier) ────────────────────────────────────────────

async def get_latest_price(ticker: str) -> float | None:
    def _fetch():
        k = _finnhub_key()
        if not k:
            return None
        try:
            res = requests.get(
                "https://finnhub.io/api/v1/quote",
                params={"symbol": ticker, "token": k},
                timeout=5,
            )
            data = res.json()
            if "error" in data:
                logger.warning("Finnhub quote error [%s]: %s", ticker, data["error"])
                return None
            c = data.get("c")
            return float(c) if c else None
        except Exception as e:
            logger.warning("get_latest_price failed for %s: %s", ticker, e)
            return None

    return await asyncio.to_thread(_fetch)


# ── Historical OHLC (yfinance / Yahoo Finance — free) ─────────────────────────

async def fetch_ohlc(ticker: str, period: str = "5d", interval: str = "5m") -> list[Candle]:
    """
    Fetch OHLC candles via yfinance (Yahoo Finance).
    Falls back through coarser period/interval pairs if primary returns nothing.
    No API key required.
    """
    primary = (period, interval)
    attempts = [primary] + [fb for fb in FALLBACK_CHAIN if fb != primary]

    def _fetch_one(p: str, iv: str) -> list[Candle] | None:
        yf_interval = YF_INTERVAL_MAP.get(iv, iv)
        try:
            tkr = yf.Ticker(ticker)
            df = tkr.history(period=p, interval=yf_interval)

            if df is None or df.empty:
                logger.warning("yfinance: no data for %s (%s/%s)", ticker, p, iv)
                return None

            candles = []
            for ts, row in df.iterrows():
                # ts is a pandas Timestamp; convert to UTC ISO string
                if hasattr(ts, "to_pydatetime"):
                    dt = ts.to_pydatetime()
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                else:
                    dt = datetime.fromtimestamp(float(ts), tz=timezone.utc)

                candles.append(Candle(
                    ts=dt.isoformat(),
                    open=round(float(row["Open"]),   4),
                    high=round(float(row["High"]),   4),
                    low=round(float(row["Low"]),     4),
                    close=round(float(row["Close"]), 4),
                    volume=int(row.get("Volume", 0)),
                ))

            logger.info("yfinance: %d candles for %s (%s/%s)", len(candles), ticker, p, iv)
            return candles

        except Exception as e:
            logger.warning("yfinance exception for %s (%s/%s): %s", ticker, p, iv, e)
            return None

    for p, iv in attempts:
        result = await asyncio.to_thread(_fetch_one, p, iv)
        if result:
            return result

    logger.error("fetch_ohlc: all attempts failed for %s", ticker)
    return []