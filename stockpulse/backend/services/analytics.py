"""
Analytics service — pure-Python technical indicators.
No pandas dependency for these calculations (keeps it lightweight).
"""

from typing import Optional
from models.schemas import Candle


def _sma(prices: list[float], window: int) -> list[Optional[float]]:
    """Simple Moving Average."""
    result: list[Optional[float]] = []
    for i in range(len(prices)):
        if i < window - 1:
            result.append(None)
        else:
            result.append(round(sum(prices[i - window + 1:i + 1]) / window, 4))
    return result


def _rsi(prices: list[float], period: int = 14) -> list[Optional[float]]:
    """
    Relative Strength Index (Wilder smoothing).
    Returns None for first `period` values.
    """
    if len(prices) < period + 1:
        return [None] * len(prices)

    result: list[Optional[float]] = [None] * period
    gains, losses = [], []

    for i in range(1, period + 1):
        diff = prices[i] - prices[i - 1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))

    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period

    for i in range(period, len(prices)):
        diff = prices[i] - prices[i - 1]
        gain = max(diff, 0)
        loss = max(-diff, 0)

        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period

        if avg_loss == 0:
            result.append(100.0)
        else:
            rs = avg_gain / avg_loss
            result.append(round(100 - (100 / (1 + rs)), 4))

    return result


def compute_analytics(candles: list[Candle]) -> dict:
    """
    Compute SMA-20, SMA-50, RSI-14 for a list of candles.
    Returns dict ready for AnalyticsResponse.
    """
    closes = [c.close for c in candles]
    timestamps = [c.ts for c in candles]

    return {
        "sma_20": _sma(closes, 20),
        "sma_50": _sma(closes, 50),
        "rsi_14": _rsi(closes, 14),
        "timestamps": timestamps,
    }
