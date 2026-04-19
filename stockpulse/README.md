# ⚡ StockPulse — Production-Grade Real-Time Stock Dashboard

A full-stack SDE-portfolio project demonstrating:
- Real-time WebSocket streaming with pub-sub architecture
- FastAPI modular backend with async I/O
- React + Zustand frontend with live candlestick charts
- SQLite persistence, in-memory caching, rate limiting
- Technical indicators (SMA, RSI)
- Price alert system with WebSocket push notifications
- Docker + Nginx deployment

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
                     │  │  stock.py  analytics.py          │  │
                     │  │  alerts.py  cache.py (TTL)       │  │
                     │  └──────────────┬───────────────────┘  │
                     │                 │                       │
                     │  ┌──────────────▼───────────────────┐  │
                     │  │    Data Layer (aiosqlite)        │  │
                     │  │    candles + alerts tables       │  │
                     │  └──────────────────────────────────┘  │
                     └────────────────────────────────────────┘
                                       │
                              yfinance (Yahoo Finance)
```

### Key SDE Concepts Demonstrated

| Concept | Implementation |
|---|---|
| **Pub-Sub** | WS manager rooms — 1 stream task per ticker, N clients |
| **Async I/O** | All I/O non-blocking; yfinance runs in executor thread |
| **Caching** | TTL in-memory cache; DB fallback on API failure |
| **Rate Limiting** | Sliding-window middleware (60 req/min per IP) |
| **Retry/Backoff** | Exponential backoff on yfinance failures |
| **DB Layer** | Async SQLite with UPSERT, indexed queries |
| **Type Safety** | Full Pydantic v2 models on all API boundaries |
| **State Management** | Zustand (persist + hydration) on frontend |
| **WS Reconnect** | Exponential backoff reconnect in useStockSocket hook |

---

## Project Structure

```
stockpulse/
├── backend/
│   ├── main.py                 # App factory + lifespan
│   ├── api/
│   │   └── routes.py           # REST endpoints
│   ├── websocket/
│   │   └── manager.py          # Pub-sub WS hub
│   ├── services/
│   │   ├── stock.py            # yfinance + cache + retry
│   │   ├── analytics.py        # SMA, RSI calculations
│   │   ├── alerts.py           # Alert evaluator (background task)
│   │   └── cache.py            # Async TTL cache
│   ├── models/
│   │   └── schemas.py          # Pydantic models
│   ├── db/
│   │   └── database.py         # aiosqlite CRUD
│   ├── middleware/
│   │   ├── rate_limiter.py     # Sliding-window rate limit
│   │   └── logging.py          # Structured logging setup
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   └── Dashboard.jsx   # Main layout + orchestration
│   │   ├── components/
│   │   │   ├── CandlestickChart.jsx  # OHLC + volume + SMA
│   │   │   ├── PriceTicker.jsx       # Animated price header
│   │   │   ├── PortfolioPanel.jsx    # Watchlist sidebar
│   │   │   ├── AlertsPanel.jsx       # Create/view alerts
│   │   │   ├── RSIChart.jsx          # RSI-14 panel
│   │   │   ├── NotificationToast.jsx # Alert toasts
│   │   │   └── ConnectionStatus.jsx  # WS state badge
│   │   ├── hooks/
│   │   │   └── useStockSocket.js     # WS + reconnect hook
│   │   ├── store/
│   │   │   └── index.js              # Zustand stores
│   │   └── index.css
│   ├── package.json
│   ├── vite.config.js
│   ├── nginx.conf
│   └── Dockerfile
│
└── docker-compose.yml
```

---

## Quick Start

### Local Development

**Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev          # runs on http://localhost:5173
```

### Docker (Production)
```bash
# Build and start everything
docker-compose up --build

# Visit http://localhost
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/stock/{ticker}` | Latest price + 100 candles |
| `GET` | `/api/v1/stock/{ticker}/history?period=5d&interval=5m` | Historical OHLC |
| `GET` | `/api/v1/stock/{ticker}/analytics` | SMA-20, SMA-50, RSI-14 |
| `GET` | `/api/v1/portfolio?tickers=AAPL,TSLA` | Batch prices |
| `POST` | `/api/v1/alerts` | Create price alert |
| `GET` | `/api/v1/alerts` | List active alerts |
| `WS` | `/ws/{ticker}` | Live OHLC stream |

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

## Environment Variables

```bash
# backend/.env
DEBUG=false

# frontend/.env
VITE_API_URL=http://localhost:8000/api/v1
VITE_WS_URL=ws://localhost:8000
```

---

## Deployment (Railway / Render)

1. Push to GitHub
2. Connect repo to Railway/Render
3. Set `backend/` as root for backend service
4. Set `frontend/` as root for frontend service (static site)
5. Add env vars via dashboard
6. Done — both services auto-deploy on push

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend Framework | FastAPI + uvicorn |
| Data | yfinance (Yahoo Finance) |
| Database | SQLite via aiosqlite |
| Caching | In-memory TTL cache (Redis-swappable) |
| Frontend | React 18 + Vite |
| State | Zustand (persist) |
| Charts | Chart.js + chartjs-chart-financial |
| Dates | Luxon + chartjs-adapter-luxon |
| Containerization | Docker + nginx |
