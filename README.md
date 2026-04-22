# ⚡ StockPulse — Real-Time Stock Trading Dashboard

Full-stack paper trading simulator with live WebSocket price streaming, candlestick charting, and built-in overtrading protection.

**Stack:** FastAPI · React 18 · Vite · yfinance · Finnhub · Canvas2D · aiosqlite

---

## Features

- **Live candlestick chart** — real OHLC data, updates every 5 seconds via WebSocket
- **Paper trading** — virtual $10,000 balance, BUY/SELL at live market price, open position P&L
- **Overtrading protection** — Beginner mode enforces daily limits, cooldowns, and loss halts
- **Analytics overlay** — SMA-20, SMA-50, RSI-14 computed server-side
- **Drawing tools** — trend lines, rectangles, horizontal price levels on overlay canvas
- **Price alerts** — set above/below thresholds, triggered via WebSocket push
- **Works 24/7** — yfinance fallback serves last close price when markets are closed

---

## The Overtrading Problem I Solved

Overtrading is the #1 mistake new traders make — entering too many trades out of boredom, revenge, or FOMO, compounding losses instead of cutting them. I implemented a **Beginner mode** that enforces three hard guardrails:

### 1. Daily Trade Limit (max 3/day)
With only 3 trades per day, every entry requires conviction. Forces you to wait for high-confidence setups rather than trading noise.

### 2. Cooldown Timer (5 minutes between trades)
After closing a position, trading is locked for 5 minutes. Directly prevents **revenge trading** — the impulse to immediately re-enter after a loss to "win it back", which statistically makes losses worse.

### 3. Consecutive Loss Halt (2 losses → halted for the day)
Two losses in a row signals the market isn't moving in your favour today. The system halts all trading until tomorrow, preventing a bad session from turning into a catastrophic one.

All three rules reset at midnight. **Pro mode** removes all limits for experienced users.

| Rule | Beginner | Pro |
|---|---|---|
| Trades per day | 3 | Unlimited |
| Cooldown between trades | 5 minutes | None |
| Consecutive loss halt | 2 losses | None |
| Warning threshold | 2nd trade | 10th trade |

---

## Architecture

```
Browser (React + Vite)
    ↕ WebSocket /ws/{ticker}     ← live candle ticks every 5s
    ↕ REST      /api/v1/...      ← history, analytics, alerts

FastAPI (uvicorn)
    WS Manager   → pub-sub rooms, CandleAggregator, history seed
    REST Routes  → stock, history, analytics, portfolio, alerts
    Services     → stock.py (Finnhub + yfinance), analytics.py, alerts.py
    DB           → aiosqlite (alerts table)

External APIs
    Finnhub       → live quotes (free, 60 req/min)
    yfinance      → OHLC history + after-hours fallback (free, no key)
    Alpha Vantage → snapshots (free, 25 req/day)
```

**Why yfinance?** Finnhub's historical candle endpoint requires a paid plan. yfinance wraps Yahoo Finance — same data, completely free, no API key. Finnhub is kept only for the live quote stream where lower latency matters during market hours.

---

## Quick Start

**Prerequisites:** Python 3.10+, Node 18+, free [Finnhub key](https://finnhub.io/register)

```bash
# Backend
cd backend
python -m venv venv && venv\Scripts\activate   # Windows
pip install -r requirements.txt
echo FINNHUB_API_KEY=your_key > .env
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm install && npm run dev     # → http://localhost:5173
```

Vite proxies `/api` and `/ws` to `localhost:8000` automatically.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/stock/{ticker}` | Live price snapshot |
| `GET` | `/api/v1/stock/{ticker}/history?period=5d&interval=5m` | OHLC candles |
| `GET` | `/api/v1/stock/{ticker}/analytics` | SMA-20, SMA-50, RSI-14 |
| `GET` | `/api/v1/portfolio?tickers=AAPL,TSLA` | Batch prices |
| `POST` | `/api/v1/alerts` | Create price alert |
| `WS` | `/ws/{ticker}` | Live candle stream |

**WebSocket messages:**
```json
{ "type": "history", "data": { "candles": [...] } }
{ "type": "candle",  "data": { "ts":"...", "open":..., "high":..., "low":..., "close":..., "change":..., "change_pct":... } }
{ "type": "alert",   "data": { "message":"AAPL crossed $200" } }
```

---

## Connection Status Badge

| State | Colour | Meaning |
|---|---|---|
| `connecting` | 🟡 Amber | Handshake in progress |
| `connected` | 🔵 Blue | Socket open, awaiting first tick |
| `live` | 🟢 Green | Price ticks actively arriving |
| `disconnected` | 🔴 Red | Reconnecting with exponential backoff |

---

## Environment Variables

```bash
# backend/.env — never commit this
FINNHUB_API_KEY=your_key
ALPHA_VANTAGE_API_KEY=your_key   # optional, yfinance is the fallback
```

---

## .gitignore

```
backend/.env
backend/*.db
backend/venv/
backend/__pycache__/
frontend/node_modules/
frontend/dist/
```