"""
REST API routes — all under /api/v1

FIXES:
  1. /stock/{ticker} now falls back to yfinance when ALPHA_VANTAGE_API_KEY
     is missing/invalid, so the app works with just a Finnhub key.
  2. /history returns 200 with empty list instead of 404.
  3. Blocking HTTP calls use asyncio.to_thread.
"""

import asyncio
import logging
import os
import requests
import yfinance as yf
from fastapi import APIRouter, HTTPException, Query
from datetime import datetime, timezone
from services.stock import fetch_ohlc, get_latest_price
from services.analytics import compute_analytics
from db.database import create_alert, get_active_alerts
from models.schemas import (
    StockSnapshot, AnalyticsResponse, AlertCreate, AlertResponse
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _av_key() -> str:
    return os.getenv("ALPHA_VANTAGE_API_KEY", "")


async def _snapshot_via_alphavantage(ticker: str) -> StockSnapshot | None:
    """Try Alpha Vantage first (real-time quote)."""
    key = _av_key()
    if not key:
        return None

    def _fetch():
        return requests.get(
            "https://www.alphavantage.co/query",
            params={"function": "GLOBAL_QUOTE", "symbol": ticker, "apikey": key},
            timeout=8,
        ).json()

    try:
        data = await asyncio.to_thread(_fetch)
        quote = data.get("Global Quote", {})
        if not quote:
            logger.warning("Alpha Vantage returned empty quote for %s", ticker)
            return None

        def sf(v):
            try: return float(v)
            except: return 0.0

        def si(v):
            try: return int(v)
            except: return 0

        price      = sf(quote.get("05. price"))
        change     = sf(quote.get("09. change"))
        change_pct = sf(str(quote.get("10. change percent", "0")).replace("%", ""))
        volume     = si(quote.get("06. volume"))

        return StockSnapshot(
            ticker=ticker, price=price, change=change,
            change_pct=change_pct, volume=volume,
            candles=[{
                "open": price, "high": price, "low": price,
                "close": price, "volume": volume,
                "ts": datetime.utcnow().isoformat(),
            }],
        )
    except Exception as e:
        logger.warning("Alpha Vantage snapshot failed for %s: %s", ticker, e)
        return None


async def _snapshot_via_yfinance(ticker: str) -> StockSnapshot | None:
    """Fallback: use yfinance (Yahoo Finance, no key needed)."""
    def _fetch():
        tkr = yf.Ticker(ticker)
        info = tkr.fast_info          # lightweight, no full info scrape
        price  = float(getattr(info, "last_price",  0) or 0)
        prev   = float(getattr(info, "previous_close", price) or price)
        change     = round(price - prev, 4)
        change_pct = round((change / prev * 100) if prev else 0, 4)
        volume     = int(getattr(info, "three_month_average_volume", 0) or 0)
        return price, change, change_pct, volume

    try:
        price, change, change_pct, volume = await asyncio.to_thread(_fetch)
        if not price:
            return None
        return StockSnapshot(
            ticker=ticker, price=price, change=change,
            change_pct=change_pct, volume=volume,
            candles=[{
                "open": price, "high": price, "low": price,
                "close": price, "volume": volume,
                "ts": datetime.utcnow().isoformat(),
            }],
        )
    except Exception as e:
        logger.warning("yfinance snapshot failed for %s: %s", ticker, e)
        return None


# ── Stock snapshot ────────────────────────────────────────────────────────────

@router.get("/stock/{ticker}", response_model=StockSnapshot)
async def get_stock(ticker: str, interval: str = Query("5m", regex="^(1m|5m|15m|1h)$")):
    ticker = ticker.upper()
    snapshot = await _snapshot_via_alphavantage(ticker) or await _snapshot_via_yfinance(ticker)
    if not snapshot:
        raise HTTPException(status_code=404, detail=f"No data for {ticker}")
    return snapshot


# ── Historical candles ────────────────────────────────────────────────────────

@router.get("/stock/{ticker}/history")
async def get_history(
    ticker: str,
    period: str = Query("5d", regex="^(1d|5d|1mo|3mo|6mo|1y)$"),
    interval: str = Query("5m", regex="^(1m|5m|15m|1h|1d)$"),
):
    ticker = ticker.upper()
    candles = await fetch_ohlc(ticker, period=period, interval=interval)
    # Return 200 with empty list instead of 404 — chart shows no history gracefully
    return {"ticker": ticker, "period": period, "interval": interval,
            "candles": [c.model_dump() for c in candles]}


# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/stock/{ticker}/analytics", response_model=AnalyticsResponse)
async def get_analytics(ticker: str):
    ticker = ticker.upper()
    try:
        candles = await fetch_ohlc(ticker, period="3mo", interval="1d")
        if not candles or len(candles) < 20:
            return AnalyticsResponse(ticker=ticker, sma20=[], sma50=[], rsi14=[])
        analytics = compute_analytics(candles)
        return AnalyticsResponse(
            ticker=ticker,
            sma20=analytics.get("sma20", []),
            sma50=analytics.get("sma50", []),
            rsi14=analytics.get("rsi14", []),
        )
    except Exception as e:
        logger.error("Analytics error for %s: %s", ticker, e)
        return AnalyticsResponse(ticker=ticker, sma20=[], sma50=[], rsi14=[])


# ── Portfolio ─────────────────────────────────────────────────────────────────

@router.get("/portfolio")
async def get_portfolio(tickers: str = Query(...)):
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        raise HTTPException(status_code=400, detail="No tickers provided")
    if len(ticker_list) > 20:
        raise HTTPException(status_code=400, detail="Max 20 tickers per request")
    results = []
    for ticker in ticker_list:
        price = await get_latest_price(ticker)
        results.append({"ticker": ticker, "price": price, "error": price is None})
    return {"portfolio": results}


# ── Alerts ────────────────────────────────────────────────────────────────────

@router.post("/alerts", response_model=AlertResponse, status_code=201)
async def create_price_alert(body: AlertCreate):
    alert_id = await create_alert(body.ticker.upper(), body.threshold, body.direction)
    return AlertResponse(id=alert_id, ticker=body.ticker.upper(),
                         threshold=body.threshold, direction=body.direction, triggered=False)


@router.get("/alerts", response_model=list[AlertResponse])
async def list_alerts():
    rows = await get_active_alerts()
    return [AlertResponse(id=r["id"], ticker=r["ticker"], threshold=r["threshold"],
                          direction=r["direction"], triggered=bool(r["triggered"]))
            for r in rows]