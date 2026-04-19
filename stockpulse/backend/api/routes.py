"""
REST API routes — all under /api/v1
"""

import logging
import os
import requests
from fastapi import APIRouter, HTTPException, Query
from datetime import datetime
from services.stock import fetch_ohlc, get_latest_price
from services.analytics import compute_analytics
from db.database import create_alert, get_active_alerts
from models.schemas import (
    StockSnapshot, AnalyticsResponse, AlertCreate, AlertResponse
)

logger = logging.getLogger(__name__)
router = APIRouter()

API_KEY = os.getenv("ALPHA_VANTAGE_API_KEY")
print("API KEY:", API_KEY)


# ── Stock snapshot (FIXED) ────────────────────────────────────────────────────

@router.get("/stock/{ticker}", response_model=StockSnapshot)
async def get_stock(ticker: str, interval: str = Query("5m", regex="^(1m|5m|15m|1h)$")):
    """Latest price using Alpha Vantage (real data)."""
    ticker = ticker.upper()

    url = "https://www.alphavantage.co/query"
    params = {
        "function": "GLOBAL_QUOTE",
        "symbol": ticker,
        "apikey": API_KEY
    }

    res = requests.get(url, params=params)
    data = res.json()

    print("API RESPONSE:", data)  # debug

    quote = data.get("Global Quote", {})

    if not quote:
        raise HTTPException(status_code=404, detail=f"No data for {ticker}")

    def safe_float(val):
        try:
            return float(val)
        except:
            return 0.0

    def safe_int(val):
        try:
            return int(val)
        except:
            return 0

    price = safe_float(quote.get("05. price"))
    change = safe_float(quote.get("09. change"))
    change_pct = safe_float(str(quote.get("10. change percent", "0")).replace("%", ""))
    volume = safe_int(quote.get("06. volume"))
    # Minimal candle (to satisfy schema)
    candles = [{
        "open": price,
        "high": price,
        "low": price,
        "close": price,
        "volume": volume,
        "ts": datetime.utcnow().isoformat()
    }]

    return StockSnapshot(
        ticker=ticker,
        price=price,
        change=change,
        change_pct=change_pct,
        volume=volume,
        candles=candles
    )


# ── Historical candles (UNCHANGED) ────────────────────────────────────────────

@router.get("/stock/{ticker}/history")
async def get_history(
    ticker: str,
    period: str = Query("5d", regex="^(1d|5d|1mo|3mo|6mo|1y)$"),
    interval: str = Query("5m", regex="^(1m|5m|15m|1h|1d)$"),
):
    ticker = ticker.upper()
    candles = await fetch_ohlc(ticker, period=period, interval=interval)
    if not candles:
        raise HTTPException(status_code=404, detail=f"No history for '{ticker}'")
    return {
        "ticker": ticker,
        "period": period,
        "interval": interval,
        "candles": [c.model_dump() for c in candles]
    }


# ── Analytics (UNCHANGED) ─────────────────────────────────────────────────────

@router.get("/stock/{ticker}/analytics", response_model=AnalyticsResponse)
async def get_analytics(ticker: str):
    ticker = ticker.upper()

    try:
        candles = await fetch_ohlc(ticker, period="3mo", interval="1d")

        if not candles or len(candles) < 20:
            return AnalyticsResponse(
                ticker=ticker,
                sma20=[],
                sma50=[],
                rsi14=[]
            )

        analytics = compute_analytics(candles)

        return AnalyticsResponse(
            ticker=ticker,
            sma20=analytics.get("sma20", []),
            sma50=analytics.get("sma50", []),
            rsi14=analytics.get("rsi14", [])
        )

    except Exception as e:
        print("ANALYTICS ERROR:", e)
        return AnalyticsResponse(
            ticker=ticker,
            sma20=[],
            sma50=[],
            rsi14=[]
        )


# ── Portfolio (UNCHANGED) ─────────────────────────────────────────────────────

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


# ── Alerts (UNCHANGED) ────────────────────────────────────────────────────────

@router.post("/alerts", response_model=AlertResponse, status_code=201)
async def create_price_alert(body: AlertCreate):
    alert_id = await create_alert(body.ticker.upper(), body.threshold, body.direction)
    return AlertResponse(
        id=alert_id,
        ticker=body.ticker.upper(),
        threshold=body.threshold,
        direction=body.direction,
        triggered=False,
    )


@router.get("/alerts", response_model=list[AlertResponse])
async def list_alerts():
    rows = await get_active_alerts()
    return [
        AlertResponse(
            id=r["id"],
            ticker=r["ticker"],
            threshold=r["threshold"],
            direction=r["direction"],
            triggered=bool(r["triggered"])
        )
        for r in rows
    ]