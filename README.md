# ⚡ StockPulse — Production-Grade Real-Time Stock Dashboard

A full-stack portfolio project demonstrating real-time data streaming, WebSocket pub-sub architecture, and interactive financial charting.

---

## What's Changed from v1

| Area | Old | New |
|------|-----|-----|
| **Data source** | yfinance (broken) | **Finnhub** (live quotes) + **Alpha Vantage** (OHLC history) |
| **Chart library** | chartjs-chart-financial | **Pure Canvas2D** (avoids toString bug in v0.1.1) |
| **Drawing tools** | None | Trendline, H-Line, Rectangle, Fibonacci, Text, Eraser |
| **WS connection** | Via Vite proxy | **Direct to backend** `ws://localhost:8000` |
| **History seeding** | Not implemented | WS sends 1D/5m OHLC on connect |
| **Candle colors** | All red (flat data bug) | Green (up) / Red (down) / Gray (flat) |

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                        Browser                            │
│   React (Vite)  ←── WebSocket ──┐  ←── REST /api/v1 ──┐  │
└───────────────────────────────────────────────────────────┘
                                  │                       │
                     ┌────────────▼───────────────────────▼──┐
                     │         FastAPI (uvicorn)              │
                     │  ┌──────────────┐  ┌───────────────┐  │
                     │  │  WS Manager  │  │  REST Routes  │  │
                     │  │  (pub-sub)   │  │  /stock/:t    │  │
                     │  │  per-ticker  │  │  /analytics   │  │
                     │  │  room model  │  │  /alerts      │  │
                     │  └──────┬───────┘  └──────┬────────┘  │
                     │         │                 │            │
                     │  ┌──────▼─────────────────▼────────┐  │
                     │  │         Services Layer           │  │
                     │  │  stock.py     analytics.py       │  │
                     │  │  alerts.py    (Finnhub + AV)     │  │
                     │  └──────────────┬───────────────────┘  │
                     │                 │                       │
                     │  ┌──────────────▼───────────────────┐  │
                     │  │    Data Layer (aiosqlite)        │  │
                     │  │    candles + alerts tables       │  │
                     │  └──────────────────────────────────┘  │
                     └────────────────────────────────────────┘
                                       │
                          Finnhub API (live quotes, 60/min free)
                          Alpha Vantage API (OHLC history, 25/day free)
```

### Key SDE Concepts Demonstrated

| Concept | Implementation |
|---|---|
| **Pub-Sub** | WS manager rooms — 1 stream task per ticker, N clients |
| **Async I/O** | All I/O non-blocking via FastAPI async handlers |
| **Rate Limiting** | Sliding-window middleware (60 req/min per IP) |
| **DB Layer** | Async SQLite with UPSERT, indexed queries |
| **Type Safety** | Full Pydantic v2 models on all API boundaries |
| **State Management** | Zustand on frontend |
| **WS Reconnect** | Exponential backoff reconnect in `useStockSocket` hook |
| **Canvas2D Charts** | Custom OHLC renderer — no broken third-party lib |
| **Drawing Tools** | Overlay canvas for non-destructive annotations |

---

## Project Structure

```
stockpulse/
├── backend/
│   ├── main.py                 # App factory + lifespan
│   ├── api/
│   │   └── routes.py           # REST endpoints
│   ├── websocket/
│   │   └── manager.py          # Pub-sub WS hub + history seeding
│   ├── services/
│   │   ├── stock.py            # Finnhub quotes + Alpha Vantage OHLC
│   │   ├── analytics.py        # SMA-20, SMA-50, RSI-14
│   │   └── alerts.py           # Alert evaluator (background task)
│   ├── models/
│   │   └── schemas.py          # Pydantic v2 models
│   ├── db/
│   │   └── database.py         # aiosqlite CRUD
│   ├── middleware/
│   │   ├── rate_limiter.py     # Sliding-window rate limit
│   │   └── logging.py          # Structured logging setup
│   ├── .env                    # API keys (never committed)
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   └── Dashboard.jsx         # Main layout + orchestration
│   │   ├── components/
│   │   │   ├── CandlestickChart.jsx  # Canvas2D OHLC + drawing tools
│   │   │   ├── PriceTicker.jsx       # Animated price header
│   │   │   ├── PortfolioPanel.jsx    # Watchlist sidebar
│   │   │   ├── AlertsPanel.jsx       # Create/view alerts
│   │   │   ├── RSIChart.jsx          # RSI-14 panel
│   │   │   ├── NotificationToast.jsx # Alert toasts
│   │   │   └── ConnectionStatus.jsx  # WS state badge
│   │   ├── hooks/
│   │   │   └── useStockSocket.js     # WS + exponential backoff reconnect
│   │   └── store/
│   │       └── index.js              # Zustand stores
│   ├── .env.development        # Local env (gitignored)
│   ├── .env.production         # Production URLs (committed)
│   ├── package.json
│   ├── vite.config.js
│   └── nginx.conf
│
└── docker-compose.yml
```

---

## Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+
- Free API keys from [Finnhub](https://finnhub.io/register) and [Alpha Vantage](https://www.alphavantage.co/support/#api-key)

### Backend

```bash
cd backend

# Create virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac/Linux

pip install -r requirements.txt

# Create .env file
echo FINNHUB_API_KEY=your_key > .env
echo ALPHA_VANTAGE_API_KEY=your_key >> .env

uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install

# Create .env.development
echo VITE_API_URL=http://localhost:8000/api/v1 > .env.development
echo VITE_WS_URL=ws://localhost:8000 >> .env.development

npm run dev          # http://localhost:5173
```

### Docker (Production)

```bash
docker-compose up --build
# Visit http://localhost
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/stock/{ticker}` | Latest price snapshot |
| `GET` | `/api/v1/stock/{ticker}/history?period=5d&interval=5m` | Historical OHLC candles |
| `GET` | `/api/v1/stock/{ticker}/analytics` | SMA-20, SMA-50, RSI-14 |
| `GET` | `/api/v1/portfolio?tickers=AAPL,TSLA` | Batch live prices |
| `POST` | `/api/v1/alerts` | Create price alert |
| `GET` | `/api/v1/alerts` | List active alerts |
| `WS` | `/ws/{ticker}` | Live OHLC stream |

**Supported intervals:** `1m` `5m` `15m` `1h` `1d`
**Supported periods:** `1d` `5d` `1mo` `3mo` `6mo` `1y`

### WebSocket Message Types

```json
// Server → Client
{ "type": "history", "ticker": "AAPL", "data": { "candles": [...] } }
{ "type": "candle",  "ticker": "AAPL", "data": { "ts":"...", "open":..., "high":..., "low":..., "close":..., "volume":... } }
{ "type": "alert",   "ticker": "AAPL", "data": { "message": "...", "price": 201.5, "threshold": 200 } }
{ "type": "error",   "ticker": "AAPL", "data": { "message": "..." } }

// Client → Server
"ping"
```

---

## Drawing Tools

The chart includes a full annotation toolbar:

| Tool | How to use |
|------|-----------|
| ✛ Crosshair | Default — hover to inspect price |
| ╱ Trend Line | Click & drag between two points |
| — Horizontal | Click to pin a price level |
| ▭ Rectangle | Click & drag to mark a zone |
| Φ Fibonacci | Drag to draw 0–100% retracement levels |
| T Text | Click to place a text annotation |
| ⌫ Eraser | Click near a drawing to remove it |

Color picker and **Clear All** button included. Drawings persist during the session.

---

## Environment Variables

```bash
# backend/.env  (never commit this file)
FINNHUB_API_KEY=your_finnhub_key
ALPHA_VANTAGE_API_KEY=your_av_key
DEBUG=false

# frontend/.env.development  (never commit this file)
VITE_API_URL=http://localhost:8000/api/v1
VITE_WS_URL=ws://localhost:8000

# frontend/.env.production  (safe to commit — only contains your own backend URL)
VITE_API_URL=https://your-backend.railway.app/api/v1
VITE_WS_URL=wss://your-backend.railway.app
```

### .gitignore (critical)

```
# Backend
backend/.env
backend/*.db
backend/__pycache__/
backend/venv/

# Frontend
frontend/.env.development
frontend/.env.local
```

---

## Deployment (Zero key changes after setup)

API keys live **only on the server** — never in the browser or git history.

```
Browser → your backend (Railway/Render) → Finnhub / Alpha Vantage
```

### Railway (recommended)

```bash
# Install CLI
npm install -g @railway/cli

# Deploy backend
cd backend
railway login
railway init
railway up

# Set keys in Railway dashboard → Variables:
# FINNHUB_API_KEY, ALPHA_VANTAGE_API_KEY, DEBUG=false

# Copy the Railway URL → frontend/.env.production
# Deploy frontend to Vercel
cd ../frontend
vercel --prod
```

### Render

1. Push to GitHub
2. New Web Service → connect repo → set root to `backend/`
3. Build: `pip install -r requirements.txt`
4. Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add env vars in the **Environment** tab

---

## API Rate Limits

| Service | Free Tier | Used for |
|---------|-----------|---------|
| Finnhub | 60 req/min | Live price quotes (WebSocket stream) |
| Alpha Vantage | 25 req/day | OHLC history + analytics |

Alpha Vantage's 25/day limit is the main constraint. To avoid hitting it: avoid refreshing frequently or switching tickers rapidly in development. For production, upgrade to a paid Alpha Vantage plan (75+ req/min).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend Framework | FastAPI + uvicorn |
| Live Quotes | Finnhub API |
| OHLC History | Alpha Vantage API |
| Database | SQLite via aiosqlite |
| Frontend | React 18 + Vite |
| State | Zustand |
| Charts | Pure Canvas2D (custom renderer) |
| Dates | Luxon |
| Containerization | Docker + nginx |