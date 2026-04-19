import os, requests, logging
from models.schemas import Candle
from datetime import datetime, timezone

logger = logging.getLogger(__name__)
API_KEY = os.getenv("FINNHUB_API_KEY")

async def get_latest_price(ticker: str) -> float | None:
    try:
        res = requests.get("https://finnhub.io/api/v1/quote", 
            params={"symbol": ticker, "token": API_KEY})
        data = res.json()
        return float(data["c"]) if data.get("c") else None
    except Exception as e:
        logger.warning("get_latest_price failed for %s: %s", ticker, e)
        return None

async def fetch_ohlc(ticker: str, period: str = "5d", interval: str = "5m") -> list[Candle]:
    try:
        import time
        now = int(time.time())
        period_seconds = {"1d": 86400, "5d": 432000, "1mo": 2592000, "3mo": 7776000}
        from_ts = now - period_seconds.get(period, 432000)
        
        res = requests.get("https://finnhub.io/api/v1/stock/candle", params={
            "symbol": ticker,
            "resolution": {"1m":"1","5m":"5","15m":"15","1h":"60","1d":"D"}.get(interval,"5"),
            "from": from_ts,
            "to": now,
            "token": API_KEY
        })
        data = res.json()
        
        if data.get("s") != "ok":
            logger.warning("Empty data for ticker=%s", ticker)
            return []
        
        candles = []
        for i in range(len(data["t"])):
            candles.append(Candle(
                ts=datetime.fromtimestamp(data["t"][i], tz=timezone.utc).isoformat(),
                open=data["o"][i], high=data["h"][i],
                low=data["l"][i], close=data["c"][i],
                volume=data["v"][i]
            ))
        return candles
    except Exception as e:
        logger.warning("fetch_ohlc failed for %s: %s", ticker, e)
        return []