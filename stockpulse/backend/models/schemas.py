"""
Pydantic models — request/response schemas with full type safety.
"""

from pydantic import BaseModel, Field
from typing import Optional


class Candle(BaseModel):
    ts: str
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


class StockSnapshot(BaseModel):
    ticker: str
    price: float
    change: float
    change_pct: float
    volume: float
    candles: list[Candle]


class AnalyticsResponse(BaseModel):
    ticker: str
    sma20: list[Optional[float]] = []
    sma50: list[Optional[float]] = []
    rsi14: list[Optional[float]] = []


class AlertCreate(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=10)
    threshold: float = Field(..., gt=0)
    direction: str = Field(..., pattern="^(above|below)$")


class AlertResponse(BaseModel):
    id: int
    ticker: str
    threshold: float
    direction: str
    triggered: bool


class WSMessage(BaseModel):
    type: str           # "candle" | "alert" | "error" | "ping"
    ticker: str
    data: dict
