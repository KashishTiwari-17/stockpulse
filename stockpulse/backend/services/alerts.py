"""
Alert service — evaluates active alerts against live prices
and fires WebSocket notifications when thresholds are crossed.
"""

import asyncio
import logging
from db.database import get_active_alerts, mark_alert_triggered
from services.stock import get_latest_price

logger = logging.getLogger(__name__)

# Injected by websocket manager at startup
_broadcast_fn = None


def register_broadcast(fn):
    """Register the WS broadcast function so alerts can push to clients."""
    global _broadcast_fn
    _broadcast_fn = fn


async def check_alerts_loop():
    """Background task: check every 15 seconds."""
    while True:
        try:
            await _check_all_alerts()
        except Exception as exc:
            logger.error("Alert check error: %s", exc)
        await asyncio.sleep(15)


async def _check_all_alerts():
    alerts = await get_active_alerts()
    if not alerts:
        return

    # Batch: fetch unique tickers once
    tickers = {a["ticker"] for a in alerts}
    prices: dict[str, float | None] = {}
    for t in tickers:
        prices[t] = await get_latest_price(t)

    for alert in alerts:
        ticker = alert["ticker"]
        price = prices.get(ticker)
        if price is None:
            continue

        triggered = (
            (alert["direction"] == "above" and price > alert["threshold"]) or
            (alert["direction"] == "below" and price < alert["threshold"])
        )

        if triggered:
            logger.info("🚨 Alert %d triggered: %s %s %.2f (price=%.2f)",
                        alert["id"], ticker, alert["direction"], alert["threshold"], price)
            await mark_alert_triggered(alert["id"])

            if _broadcast_fn:
                await _broadcast_fn(ticker, {
                    "type": "alert",
                    "ticker": ticker,
                    "data": {
                        "alert_id": alert["id"],
                        "direction": alert["direction"],
                        "threshold": alert["threshold"],
                        "price": price,
                        "message": f"{ticker} is {alert['direction']} ${alert['threshold']:.2f} — now ${price:.2f}",
                    }
                })
