/**
 * StockPulse.jsx — Real-Time Trading Dashboard
 *
 * DATA SOURCES (all real, no simulation):
 * ─────────────────────────────────────────────────────────────────────────────
 * • Candle history  →  GET  /api/v1/stock/{ticker}/history?period=…&interval=…
 * • Live price tick →  WS   /ws/{ticker}   (via useStockSocket, Vite proxy)
 * • Analytics       →  GET  /api/v1/stock/{ticker}/analytics  (SMA20/50, RSI14)
 * • Alerts CRUD     →  POST /api/v1/alerts  |  GET /api/v1/alerts
 *
 * CANDLE FORMAT from backend:
 *   { ts: ISO-string, open, high, low, close, volume }
 *
 * WS message format:
 *   { type: "candle"|"history"|"alert"|"error", ticker, data: { … } }
 *   candle data: { ts, open, high, low, close, volume, change, change_pct }
 *   history data: { candles: Candle[] }
 */

import { useState, useEffect, useRef, useCallback } from "react"
import { useStockSocket } from "../hooks/useStockSocket"

// ─── API base ─────────────────────────────────────────────────────────────────
const API = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "") || "/api/v1"

// ─── Constants ────────────────────────────────────────────────────────────────
const INTERVAL_MS = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000 }

// Fallback chain: if primary period returns no data, try next
const FALLBACK_CHAIN = {
  "1m":  [{ period: "1d",  interval: "1m"  }, { period: "5d",  interval: "5m"  }],
  "5m":  [{ period: "5d",  interval: "5m"  }, { period: "1mo", interval: "15m" }],
  "15m": [{ period: "5d",  interval: "15m" }, { period: "1mo", interval: "1h"  }],
  "1h":  [{ period: "1mo", interval: "1h"  }, { period: "3mo", interval: "1d"  }],
}

const MAX_CANDLES = 300

const MODES = {
  beginner: {
    label: "Beginner",
    maxTradesPerDay: 3,
    cooldownSeconds: 300,
    maxConsecutiveLosses: 2,
    warnAtTrades: 2,
  },
  pro: {
    label: "Pro",
    maxTradesPerDay: Infinity,
    cooldownSeconds: 0,
    maxConsecutiveLosses: Infinity,
    warnAtTrades: 10,
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt   = (n, d = 2) => Number(n).toFixed(d)
const fmtD  = (n) => (n >= 0 ? "+" : "") + fmt(n)
const fmtC  = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtT  = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
const today = () => new Date().toISOString().slice(0, 10)

function isValidCandle(c) {
  const t = new Date(c.ts).getTime()
  return !isNaN(t) && t > 946_684_800_000 && Number(c.close) > 0
}

// Normalise a raw candle from the backend into a consistent shape
function normalise(c) {
  return {
    ts:     new Date(c.ts).getTime(),
    open:   +fmt(Number(c.open)),
    high:   +fmt(Number(c.high)),
    low:    +fmt(Number(c.low)),
    close:  +fmt(Number(c.close)),
    volume: Number(c.volume || c.vol || 0),
  }
}

// Merge a live candle tick into the existing array (bucket by interval)
function mergeCandle(prev, incoming, bucketMs) {
  const c      = normalise(incoming)
  const bucket = Math.floor(c.ts / bucketMs) * bucketMs

  if (prev.length > 0) {
    const last       = prev[prev.length - 1]
    const lastBucket = Math.floor(last.ts / bucketMs) * bucketMs
    if (lastBucket === bucket) {
      return [...prev.slice(0, -1), {
        ...last,
        high:   Math.max(last.high, c.high),
        low:    Math.min(last.low,  c.low),
        close:  c.close,
        volume: last.volume + c.volume,
      }]
    }
  }
  return [...prev, { ...c, ts: bucket }].slice(-MAX_CANDLES)
}

// ─── Fetch history with fallback chain ───────────────────────────────────────
async function fetchHistory(ticker, interval) {
  const chain = FALLBACK_CHAIN[interval] ?? FALLBACK_CHAIN["5m"]
  for (const { period, interval: iv } of chain) {
    try {
      const url = `${API}/stock/${ticker}/history?period=${period}&interval=${iv}`
      const res = await fetch(url)
      if (!res.ok) continue
      const data    = await res.json()
      const candles = (data.candles ?? []).filter(isValidCandle).map(normalise)
      if (candles.length > 0) return candles.slice(-MAX_CANDLES)
    } catch (_) {}
  }
  return []
}

// ─── Fetch analytics (SMA20, SMA50, RSI14) ───────────────────────────────────
async function fetchAnalytics(ticker) {
  try {
    const res  = await fetch(`${API}/stock/${ticker}/analytics`)
    if (!res.ok) return null
    const data = await res.json()
    return {
      sma20:      data.sma20 ?? data.sma_20 ?? [],
      sma50:      data.sma50 ?? data.sma_50 ?? [],
      rsi14:      data.rsi14 ?? [],
      timestamps: data.timestamps ?? [],
    }
  } catch (_) { return null }
}

// ─── Chart Renderer ───────────────────────────────────────────────────────────
// cssW / cssH are LOGICAL (CSS) pixels — ctx already pre-scaled by DPR
function renderChart(canvas, cssW, cssH, candles, livePrice, prevClose, trades, activeInd, analytics, drawings) {
  if (!canvas || cssW < 10 || cssH < 10 || candles.length === 0) return
  const ctx = canvas.getContext("2d")

  const PL = 8, PR = 72, PT = 14, PB = 32
  const cW = cssW - PL - PR
  const cH = cssH - PT - PB

  ctx.clearRect(0, 0, cssW, cssH)
  ctx.fillStyle = "#060c18"
  ctx.fillRect(0, 0, cssW, cssH)

  // Price axis panel
  ctx.fillStyle = "#070d1c"
  ctx.fillRect(PL + cW, 0, PR + 2, cssH)
  ctx.strokeStyle = "#1a2f4a"
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(PL + cW + 0.5, PT); ctx.lineTo(PL + cW + 0.5, PT + cH); ctx.stroke()

  const MAX_VIS   = Math.max(20, Math.floor(cW / 8))
  const vis       = candles.slice(-MAX_VIS)
  const count     = vis.length
  if (count === 0) return

  let yMin = Math.min(...vis.map(c => c.low))
  let yMax = Math.max(...vis.map(c => c.high))
  const mg = (yMax - yMin) * 0.1 || yMax * 0.01
  yMin -= mg; yMax += mg

  const toX = (i) => PL + (i / Math.max(count - 1, 1)) * cW
  const toY = (p) => PT + cH - ((p - yMin) / Math.max(yMax - yMin, 0.0001)) * cH

  // Grid + price labels
  const GRID = 7
  for (let g = 0; g <= GRID; g++) {
    const y     = PT + (g / GRID) * cH
    const price = yMax - (g / GRID) * (yMax - yMin)
    ctx.strokeStyle = "#0d1b30"; ctx.lineWidth = 0.6
    ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + cW, y); ctx.stroke()
    ctx.strokeStyle = "#1a2f4a"; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(PL + cW, y); ctx.lineTo(PL + cW + 5, y); ctx.stroke()
    ctx.fillStyle = "#8bafd4"; ctx.font = "11px 'Courier New', monospace"
    ctx.textAlign = "left"; ctx.textBaseline = "middle"
    ctx.fillText("$" + fmt(price), PL + cW + 8, y)
  }
  ctx.textBaseline = "alphabetic"

  // Time axis
  const tStep = Math.max(1, Math.floor(count / 7))
  ctx.fillStyle = "#2d4a6a"; ctx.font = "10px 'Courier New', monospace"
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"
  vis.forEach((c, i) => {
    if (i % tStep !== 0) return
    const x = toX(i)
    ctx.strokeStyle = "#0a1526"; ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + cH); ctx.stroke()
    ctx.fillText(fmtT(c.ts), x, PT + cH + 20)
  })

  // Candles
  const candleW = Math.max(2, Math.min(14, (cW / count) * 0.72))
  vis.forEach((c, i) => {
    const x    = toX(i)
    const bull = c.close >= c.open
    const col  = bull ? "#3b82f6" : "#ef4444"

    ctx.strokeStyle = col; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, toY(c.high)); ctx.lineTo(x, toY(c.low)); ctx.stroke()

    const bTop = toY(Math.max(c.open, c.close))
    const bH   = Math.max(1.5, Math.abs(toY(c.open) - toY(c.close)))
    ctx.fillStyle   = bull ? "#1d4ed8aa" : "#991b1baa"
    ctx.strokeStyle = col; ctx.lineWidth = 1
    ctx.fillRect  (x - candleW / 2, bTop, candleW, bH)
    ctx.strokeRect(x - candleW / 2, bTop, candleW, bH)
  })

  // SMA overlays — uses real analytics timestamps mapped to visible candles
  const SMA_DEFS = [
    { id: "sma20", color: "#f59e0b", values: analytics?.sma20 ?? [] },
    { id: "sma50", color: "#a78bfa", values: analytics?.sma50 ?? [] },
  ]
  SMA_DEFS.forEach(({ id, color, values }) => {
    if (!activeInd.includes(id) || values.length === 0) return
    const timestamps = analytics?.timestamps ?? []

    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([])
    ctx.beginPath()
    let started = false

    vis.forEach((c, i) => {
      // Find closest analytics timestamp to this candle
      let val = null
      if (timestamps.length > 0) {
        const idx = timestamps.findIndex(ts => new Date(ts).getTime() >= c.ts)
        const j   = idx >= 0 ? idx : timestamps.length - 1
        val = values[j] ?? null
      } else {
        // Fallback: compute SMA locally from closes
        const n = id === "sma20" ? 20 : 50
        if (i >= n - 1) val = vis.slice(i - n + 1, i + 1).reduce((s, x) => s + x.close, 0) / n
      }
      if (val == null) return
      const x = toX(i), y = toY(val)
      if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
    })
    ctx.stroke()
  })
  ctx.setLineDash([])

  // RSI indicator (small sub-chart below if active)
  if (activeInd.includes("rsi14") && analytics?.rsi14?.length > 0) {
    const rsiH   = 40
    const rsiTop = PT + cH + 2
    ctx.fillStyle = "#050d1a"
    ctx.fillRect(PL, rsiTop, cW, rsiH)
    ctx.strokeStyle = "#0d1b30"; ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(PL, rsiTop); ctx.lineTo(PL + cW, rsiTop); ctx.stroke()

    // 70 / 30 lines
    ;[70, 30].forEach(level => {
      const y = rsiTop + rsiH - (level / 100) * rsiH
      ctx.strokeStyle = level === 70 ? "#ef444430" : "#22c55e30"
      ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + cW, y); ctx.stroke()
      ctx.fillStyle = level === 70 ? "#ef4444" : "#22c55e"
      ctx.font = "8px monospace"; ctx.textAlign = "left"
      ctx.fillText(level, PL + 2, y - 1)
    })

    const rsiVals = analytics.rsi14.filter(v => v != null)
    const rsiSlice = rsiVals.slice(-MAX_VIS)
    ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = 1
    ctx.beginPath()
    let rsiStarted = false
    rsiSlice.forEach((val, i) => {
      const x = PL + (i / Math.max(rsiSlice.length - 1, 1)) * cW
      const y = rsiTop + rsiH - (val / 100) * rsiH
      if (!rsiStarted) { ctx.moveTo(x, y); rsiStarted = true } else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.fillStyle = "#4a6a9a"; ctx.font = "8px monospace"; ctx.textAlign = "right"
    ctx.fillText("RSI14", PL + cW - 2, rsiTop + 10)
  }

  // User drawings
  drawings.forEach(d => {
    ctx.setLineDash([])
    if (d.type === "line" && d.points.length === 2) {
      const [p1, p2] = d.points
      ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke()
      ;[p1, p2].forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill() })
    } else if (d.type === "rect" && d.points.length === 2) {
      const [p1, p2] = d.points
      ctx.setLineDash([3, 3])
      ctx.fillStyle = "#a78bfa18"; ctx.strokeStyle = "#a78bfa"; ctx.lineWidth = 1.5
      ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y)
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y)
      ctx.setLineDash([])
    } else if (d.type === "hline" && d.points.length >= 1) {
      const y = d.points[0].y
      const price = yMin + (1 - (y - PT) / cH) * (yMax - yMin)
      ctx.setLineDash([4, 4]); ctx.strokeStyle = "#22c55e"; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + cW, y); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = "#22c55e"; ctx.font = "10px monospace"; ctx.textAlign = "left"
      ctx.fillText("$" + fmt(price), PL + cW + 8, y + 4)
    }
  })

  // Trade markers
  trades.slice(-30).forEach(t => {
    const idx = vis.findIndex(c => c.ts >= t.ts)
    if (idx < 0) return
    const x = toX(idx), y = toY(t.price)
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2)
    ctx.fillStyle   = t.side === "buy" ? "#2563eb" : "#dc2626"
    ctx.fill()
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke()
    ctx.fillStyle = "#fff"; ctx.font = "bold 7px monospace"; ctx.textAlign = "center"
    ctx.fillText(t.side === "buy" ? "B" : "S", x, y + 2.5)
  })

  // Live price line + badge
  if (livePrice) {
    const py   = toY(livePrice)
    const bull = livePrice >= (prevClose ?? livePrice)
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = bull ? "#f59e0b" : "#f87171"; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(PL, py); ctx.lineTo(PL + cW, py); ctx.stroke()
    ctx.setLineDash([])
    const BW = PR - 4, BH = 18, BX = PL + cW + 2
    ctx.fillStyle = bull ? "#b45309" : "#b91c1c"
    ctx.beginPath(); ctx.roundRect(BX, py - BH / 2, BW, BH, 3); ctx.fill()
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 11px 'Courier New', monospace"
    ctx.textAlign = "center"; ctx.textBaseline = "middle"
    ctx.fillText("$" + fmt(livePrice), BX + BW / 2, py)
    ctx.textBaseline = "alphabetic"
  }
}

// ─── Cooldown Hook ────────────────────────────────────────────────────────────
function useCooldown(seconds) {
  const [rem, setRem] = useState(0)
  const ref = useRef(null)
  const start  = useCallback(() => {
    if (!seconds) return
    setRem(seconds)
    clearInterval(ref.current)
    ref.current = setInterval(() => setRem(r => { if (r <= 1) { clearInterval(ref.current); return 0 } return r - 1 }), 1000)
  }, [seconds])
  const reset  = useCallback(() => { clearInterval(ref.current); setRem(0) }, [])
  useEffect(() => () => clearInterval(ref.current), [])
  return { remaining: rem, start, reset }
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function StockPulse() {
  const TICKERS = ["AAPL", "TSLA", "NVDA", "MSFT", "GOOG"]

  // ── Chart state ─────────────────────────────────────────────────────────
  const [ticker,     setTicker]     = useState("AAPL")
  const [interval,   setIntervalTF] = useState("5m")
  const [candles,    setCandles]    = useState([])
  const [liveData,   setLiveData]   = useState({ price: null, change: 0, changePct: 0 })
  const [prevClose,  setPrevClose]  = useState(null)
  const [wsStatus,   setWsStatus]   = useState("connecting")
  const [histLoading, setHistLoading] = useState(false)

  // ── Analytics ────────────────────────────────────────────────────────────
  const [analytics,  setAnalytics]  = useState(null)
  const [activeInd,  setActiveInd]  = useState([])
  const [showInd,    setShowInd]    = useState(false)

  // ── Alerts ───────────────────────────────────────────────────────────────
  const [showAlerts, setShowAlerts] = useState(false)
  const [alertList,  setAlertList]  = useState([])  // from backend
  const [alertVal,   setAlertVal]   = useState("")
  const [alertDir,   setAlertDir]   = useState("above")

  // ── Drawing tools ────────────────────────────────────────────────────────
  const [drawTool,   setDrawTool]   = useState(null)
  const [drawings,   setDrawings]   = useState([])
  const [pending,    setPending]    = useState(null)

  // ── Paper trading ────────────────────────────────────────────────────────
  const [side,       setSide]       = useState("buy")
  const [volume,     setVolume]     = useState(1)
  const [lotSize,    setLotSize]    = useState(1)
  const [riskPct,    setRiskPct]    = useState(1)
  const [balance,    setBalance]    = useState(10_000)
  const [positions,  setPositions]  = useState([])
  const [tradeLog,   setTradeLog]   = useState([])

  // ── Overtrading ──────────────────────────────────────────────────────────
  const [mode,       setMode]       = useState("beginner")
  const [dailyCount, setDailyCount] = useState({ date: today(), count: 0 })
  const [consLosses, setConsLosses] = useState(0)
  const [dayBlocked, setDayBlocked] = useState(false)
  const [warning,    setWarning]    = useState("")

  const cooldown    = useCooldown(MODES[mode].cooldownSeconds)
  const canvasRef   = useRef(null)
  const cssSize     = useRef({ w: 0, h: 0 })
  const intervalRef = useRef("5m")
  const stateRef    = useRef({})
  // Cache: key = "TICKER:interval" → candle array
  // Prevents re-fetching when switching back to a previously loaded timeframe
  const histCache   = useRef({})
  const tickerRef   = useRef("AAPL")  // always holds latest ticker for use inside callbacks

  // Keep stateRef fresh for draw()
  stateRef.current = { candles, liveData, prevClose, tradeLog, activeInd, analytics, drawings }

  useEffect(() => { intervalRef.current = interval }, [interval])

  // ── Canvas setup (DPR-correct) ───────────────────────────────────────────
  function setupCanvas() {
    const c = canvasRef.current
    if (!c) return false
    const rect = c.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return false
    const dpr = window.devicePixelRatio || 1
    const pw  = Math.round(rect.width  * dpr)
    const ph  = Math.round(rect.height * dpr)
    if (c.width !== pw || c.height !== ph) {
      c.width  = pw; c.height = ph
      c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    cssSize.current = { w: rect.width, h: rect.height }
    return true
  }

  function draw() {
    const { candles: ca, liveData: ld, prevClose: pc, tradeLog: tl, activeInd: ai, analytics: an, drawings: dr } = stateRef.current
    const { w, h } = cssSize.current
    if (w && h) renderChart(canvasRef.current, w, h, ca, ld.price, pc, tl, ai, an, dr)
  }

  useEffect(() => {
    setupCanvas()
    const ro = new ResizeObserver(() => { if (setupCanvas()) draw() })
    if (canvasRef.current) ro.observe(canvasRef.current)
    return () => ro.disconnect()
  }, []) // eslint-disable-line

  useEffect(() => { setupCanvas(); draw() }, [candles, liveData, activeInd, analytics, drawings]) // eslint-disable-line

  // ── Load history — cache per ticker+interval so switching back never re-fetches ──
  const loadHistory = useCallback(async (t, iv) => {
    const key = `${t}:${iv}`

    // Already cached — restore instantly, no flicker, no re-fetch
    if (histCache.current[key]) {
      const cached = histCache.current[key]
      setCandles(cached)
      const last = cached[cached.length - 1]
      const prev = cached[cached.length - 2]
      setPrevClose(prev?.close ?? last.close)
      return
    }

    // First load of this ticker+interval — fetch from backend
    setCandles([])
    setHistLoading(true)
    const loaded = await fetchHistory(t, iv)
    if (loaded.length > 0) {
      histCache.current[key] = loaded   // store in cache
      setCandles(loaded)
      const last = loaded[loaded.length - 1]
      const prev = loaded[loaded.length - 2]
      setLiveData({ price: last.close, change: 0, changePct: 0 })
      setPrevClose(prev?.close ?? last.close)
    }
    setHistLoading(false)
  }, [])

  // Clear cache when ticker changes so old ticker data is never shown for new one
  useEffect(() => { histCache.current = {}; tickerRef.current = ticker }, [ticker])

  useEffect(() => { loadHistory(ticker, interval) }, [ticker, interval, loadHistory])

  // ── Load real analytics ──────────────────────────────────────────────────
  useEffect(() => {
    setAnalytics(null)
    fetchAnalytics(ticker).then(setAnalytics)
  }, [ticker])

  // ── Load real alerts from backend ────────────────────────────────────────
  const loadAlerts = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/alerts`)
      if (!res.ok) return
      const data = await res.json()
      setAlertList(data)
    } catch (_) {}
  }, [])

  useEffect(() => { loadAlertsRef.current = loadAlerts; loadAlerts() }, [loadAlerts])

  // ── WebSocket handlers ───────────────────────────────────────────────────
  const onOpen = useCallback(() => {
    setWsStatus("connected")
  }, [])

  const onHistory = useCallback((historicCandles) => {
    setCandles(prev => {
      if (prev.length > 0) return prev
      return (historicCandles ?? []).filter(isValidCandle).map(normalise).slice(-MAX_CANDLES)
    })
  }, [])

  const onCandle = useCallback((data) => {
    setWsStatus("live")
    if (!data?.close || data.close <= 0) return
    const iv       = intervalRef.current
    const bucketMs = INTERVAL_MS[iv] ?? 300_000
    setCandles(prev => {
      const updated = mergeCandle(prev, data, bucketMs)
      const key = `${data.ticker ?? tickerRef.current}:${iv}`
      histCache.current[key] = updated
      return updated
    })
    setLiveData(prev => {
      setPrevClose(prev.price ?? data.close)
      return { price: data.close, change: data.change ?? 0, changePct: data.change_pct ?? 0 }
    })
  }, [])

  const loadAlertsRef = useRef(null)
  const onAlert = useCallback((data) => {
    setWarning("Alert triggered: " + data.message)
    loadAlertsRef.current?.()
  }, [])

  const onError = useCallback((msg) => {
    setWsStatus("disconnected")
    console.warn("WS error:", msg)
  }, [])

  useStockSocket({ ticker, onOpen, onCandle, onHistory, onAlert, onError })

  // ── Ticker change ────────────────────────────────────────────────────────
  const handleTickerChange = (t) => {
    setTicker(t)
    setCandles([])
    setLiveData({ price: null, change: 0, changePct: 0 })
    setPrevClose(null)
    setWsStatus("connecting")
    setWarning("")
  }

  // ── Add alert via real backend ───────────────────────────────────────────
  async function addAlert() {
    const price = parseFloat(alertVal)
    if (!price || price <= 0) { setWarning("⚠️ Enter a valid price for the alert."); return }
    try {
      const res = await fetch(`${API}/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, threshold: price, direction: alertDir }),
      })
      if (!res.ok) throw new Error(await res.text())
      setAlertVal("")
      loadAlerts()
    } catch (e) {
      setWarning("⚠️ Failed to save alert: " + e.message)
    }
  }

  // ── Drawing tool ─────────────────────────────────────────────────────────
  function handleCanvasClick(e) {
    if (!drawTool) return
    const rect = canvasRef.current.getBoundingClientRect()
    const pt   = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    if (drawTool === "hline") { setDrawings(d => [...d, { type: "hline", points: [pt] }]); return }
    if (!pending) { setPending(pt) }
    else { setDrawings(d => [...d, { type: drawTool, points: [pending, pt] }]); setPending(null) }
  }

  // ── Trade execution ──────────────────────────────────────────────────────
  function executeTrade() {
    setWarning("")
    const cfg      = MODES[mode]
    const todayStr = today()
    const cnt      = dailyCount.date === todayStr ? dailyCount.count : 0
    const price    = liveData.price

    if (!price)                                               { setWarning("⚠️ No live price — waiting for data."); return }
    if (dayBlocked && mode === "beginner")                    { setWarning("⛔ Trading disabled for today."); return }
    if (cooldown.remaining > 0)                               { setWarning(`⏳ Cooldown — wait ${cooldown.remaining}s.`); return }
    if (mode === "beginner" && consLosses >= cfg.maxConsecutiveLosses) { setDayBlocked(true); setWarning("⛔ 2 consecutive losses — halted for today."); return }
    if (mode === "beginner" && cnt >= cfg.maxTradesPerDay)    { setDayBlocked(true); setWarning(`⛔ Daily limit of ${cfg.maxTradesPerDay} trades reached.`); return }

    const qty  = volume * lotSize
    const cost = qty * price
    if (side === "buy" && cost > balance) { setWarning(`⚠️ Need $${fmt(cost)} but balance is $${fmt(balance)}. Reduce size.`); return }

    const id    = Date.now()
    const trade = { id, date: todayStr, ts: id, ticker, side, price: +fmt(price), qty, cost: +fmt(cost), riskAmt: +fmt((riskPct / 100) * balance), pnl: 0, exitPrice: null }

    if (side === "buy") {
      setBalance(b => +(b - cost).toFixed(2))
      setPositions(p => [...p, { ...trade, status: "open" }])
    } else {
      const longs = positions.filter(p => p.ticker === ticker && p.side === "buy" && p.status === "open")
      if (longs.length > 0) {
        const pos = longs[longs.length - 1]
        const pnl = +fmt((price - pos.price) * pos.qty)
        setPositions(p => p.map(x => x.id === pos.id ? { ...x, status: "closed", exitPrice: price, pnl } : x))
        setBalance(b => +(b + pos.cost + pnl).toFixed(2))
        trade.pnl       = pnl
        trade.exitPrice = price
        if (pnl < 0) {
          const nl = consLosses + 1
          setConsLosses(nl)
          if (mode === "beginner" && nl >= cfg.maxConsecutiveLosses) { setDayBlocked(true); setWarning("⛔ 2 losses in a row — trading halted.") }
        } else setConsLosses(0)
      } else {
        setWarning("⚠️ No open BUY position to close for " + ticker + ".")
        return
      }
    }

    setTradeLog(l => [...l, trade])
    setDailyCount({ date: todayStr, count: cnt + 1 })
    if (mode === "beginner") cooldown.start()

    const left = cfg.maxTradesPerDay - (cnt + 1)
    if (mode === "beginner" && left === 1)     setWarning(`⚠️ Last trade remaining today (${cnt+1}/${cfg.maxTradesPerDay})`)
    else if (mode === "beginner" && left <= 0) setWarning(`⚠️ Daily limit reached (${cnt+1}/${cfg.maxTradesPerDay})`)
    else if (mode === "pro" && cnt + 1 >= cfg.warnAtTrades) setWarning(`⚠️ ${cnt+1} trades today — monitor risk.`)
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const openPos   = positions.filter(p => p.status === "open")
  const price     = liveData.price
  const priceChg  = liveData.change
  const pricePct  = liveData.changePct
  const bull      = priceChg >= 0
  const cfg       = MODES[mode]
  const todayCnt  = dailyCount.date === today() ? dailyCount.count : 0
  const isBlocked = (dayBlocked && mode === "beginner") || cooldown.remaining > 0
  const lastC     = candles[candles.length - 1]
  const tdTrades  = tradeLog.filter(t => t.date === today())
  const tdPnl     = tdTrades.reduce((s, t) => s + (t.pnl || 0), 0)
  const closed    = tradeLog.filter(t => t.exitPrice)
  const wins      = closed.filter(t => t.pnl > 0).length
  const winRate   = closed.length ? Math.round((wins / closed.length) * 100) : 0
  const totalPnl  = tradeLog.reduce((s, t) => s + (t.pnl || 0), 0)

  function switchMode(m) {
    setMode(m); setWarning(""); setDayBlocked(false); setConsLosses(0); cooldown.reset()
  }

  // ── Style helpers ────────────────────────────────────────────────────────
  const S = {
    root:   { display: "flex", height: "100vh", background: "#060c18", color: "#c8dff5", fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace", overflow: "hidden", fontSize: 12 },
    side:   { width: 172, flexShrink: 0, borderRight: "1px solid #0d1b30", display: "flex", flexDirection: "column" },
    main:   { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" },
    right:  { width: 260, flexShrink: 0, borderLeft: "1px solid #0d1b30", display: "flex", flexDirection: "column", overflowY: "auto" },
    hdr:    { background: "#05090f", borderBottom: "1px solid #0d1b30", padding: "8px 14px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 },
    sec:    { padding: "10px 12px", borderBottom: "1px solid #0d1b30" },
    lbl:    { fontSize: 9, color: "#1e3a5f", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 },
    stat:   { background: "#08111e", borderRadius: 4, padding: "6px 8px", flex: 1 },
    trow:   (i) => ({ background: i % 2 === 0 ? "#05090f" : "#070d1a", borderBottom: "1px solid #0a1525" }),
    pill:   (on) => ({ padding: "3px 9px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, background: on ? "#1d4ed8" : "transparent", color: on ? "#fff" : "#2d4a6a", fontFamily: "monospace" }),
    tag:    (c) => ({ display: "inline-block", padding: "1px 5px", borderRadius: 3, fontSize: 10, background: c + "20", color: c, border: `1px solid ${c}40` }),
    inp:    { background: "#08111e", border: "1px solid #0f2040", borderRadius: 4, padding: "5px 7px", color: "#c8dff5", fontFamily: "monospace", fontSize: 11, width: "100%", outline: "none", boxSizing: "border-box" },
    btn:    (bg, bd) => ({ width: "100%", padding: 9, borderRadius: 5, border: `1px solid ${bd}`, background: bg, color: "#fff", cursor: "pointer", fontFamily: "monospace", fontSize: 12, fontWeight: 700 }),
    toolBtn:(on) => ({ padding: "4px 8px", borderRadius: 4, border: `1px solid ${on ? "#2563eb" : "#0f2040"}`, cursor: "pointer", fontSize: 10, background: on ? "#1d4ed820" : "transparent", color: on ? "#60a5fa" : "#2d4a6a", fontFamily: "monospace", display: "flex", alignItems: "center", gap: 3 }),
  }

  const wsDot = { live: "#22c55e", connected: "#3b82f6", connecting: "#f59e0b", disconnected: "#ef4444" }[wsStatus] ?? "#f59e0b"

  return (
    <div style={S.root}>

      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <aside style={S.side}>
        <div style={{ padding: "11px 10px 7px", borderBottom: "1px solid #0a1525" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 22, height: 22, background: "linear-gradient(135deg,#1d4ed8,#7c3aed)", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>⚡</div>
            <span style={{ fontFamily: "monospace", fontSize: 12, letterSpacing: "0.12em" }}>
              STOCK<span style={{ color: "#3b82f6", fontWeight: 700 }}>PULSE</span>
            </span>
          </div>
          <div style={{ fontSize: 8, color: "#0f2040", marginTop: 3, letterSpacing: "0.1em" }}>PAPER TRADING · LIVE DATA</div>
        </div>

        {/* Ticker search */}
        <div style={{ padding: "6px 10px", borderBottom: "1px solid #0a1525" }}>
          <input
            placeholder="Search ticker…"
            style={{ ...S.inp, fontSize: 10, padding: "4px 7px" }}
            onKeyDown={e => { if (e.key === "Enter") handleTickerChange(e.target.value.toUpperCase().trim()) }}
          />
        </div>

        <div style={{ padding: "5px 10px 3px" }}><div style={S.lbl}>Watchlist</div></div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {TICKERS.map(t => (
            <div key={t} onClick={() => handleTickerChange(t)}
              style={{ padding: "7px 12px", cursor: "pointer", borderLeft: `2px solid ${ticker === t ? "#3b82f6" : "transparent"}`, background: ticker === t ? "#08111e" : "transparent" }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: ticker === t ? "#3b82f6" : "#4a6a9a" }}>{t}</div>
              <div style={{ fontSize: 10, color: bull ? "#3b82f6" : "#ef4444", marginTop: 1 }}>
                {t === ticker && price ? "$" + fmt(price) : "—"}
              </div>
            </div>
          ))}
        </div>

        {/* Mode selector */}
        <div style={{ ...S.sec, borderTop: "1px solid #0a1525", borderBottom: "none" }}>
          <div style={S.lbl}>Trading Mode</div>
          <div style={{ display: "flex", gap: 4 }}>
            {Object.keys(MODES).map(m => (
              <button key={m} onClick={() => switchMode(m)} style={{ ...S.pill(mode === m), flex: 1, padding: "5px 2px" }}>{MODES[m].label}</button>
            ))}
          </div>
          <div style={{ marginTop: 6, fontSize: 9, color: "#1e3a5f", lineHeight: 1.8 }}>
            {mode === "beginner"
              ? <> Max 3 trades/day<br />5-min cooldown<br />Stop on 2 losses </>
              : <> Unlimited trades<br />No cooldown<br />Warn at 10/day </>}
          </div>
        </div>
      </aside>

      {/* ── Main area ─────────────────────────────────────────────────────── */}
      <main style={S.main}>

        {/* Header */}
        <header style={S.hdr}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{ticker}</span>
            {price
              ? <span style={{ fontSize: 18, fontWeight: 700, color: bull ? "#3b82f6" : "#ef4444" }}>${fmt(price)}</span>
              : <span style={{ fontSize: 14, color: "#1e3a5f" }}>Loading…</span>}
            {price && <span style={{ fontSize: 11, color: bull ? "#3b82f6" : "#ef4444" }}>{fmtD(priceChg)} ({fmtD(pricePct)}%)</span>}
          </div>

          {/* Timeframe */}
          <div style={{ marginLeft: "auto", display: "flex", gap: 2, background: "#05090f", border: "1px solid #0d1b30", borderRadius: 5, padding: 2 }}>
            {["1m","5m","15m","1h"].map(iv => (
              <button key={iv} onClick={() => setIntervalTF(iv)} style={S.pill(interval === iv)}>{iv}</button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {/* WS status */}
            <span style={{ fontSize: 9, color: wsDot }}>● {wsStatus}</span>
            {mode === "beginner" && (
              <span style={S.tag(dayBlocked ? "#ef4444" : todayCnt >= cfg.maxTradesPerDay - 1 ? "#f59e0b" : "#22c55e")}>
                {dayBlocked ? "BLOCKED" : `${todayCnt}/${cfg.maxTradesPerDay}`}
              </span>
            )}
            {cooldown.remaining > 0 && <span style={S.tag("#f59e0b")}>⏳ {cooldown.remaining}s</span>}
          </div>
        </header>

        {/* OHLCV strip */}
        <div style={{ display: "flex", gap: 14, padding: "5px 14px", background: "#04080e", borderBottom: "1px solid #0a1525", flexShrink: 0 }}>
          {[["O", lastC?.open], ["H", lastC?.high], ["L", lastC?.low], ["C", lastC?.close], ["Vol", lastC ? (lastC.volume/1000).toFixed(0)+"K" : "—"]].map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 3, alignItems: "baseline" }}>
              <span style={{ fontSize: 9, color: "#1e3a5f" }}>{k}</span>
              <span style={{ fontSize: 11, color: "#2d4a6a" }}>{typeof v === "number" ? fmt(v) : v ?? "—"}</span>
            </div>
          ))}
          {histLoading && <span style={{ fontSize: 9, color: "#f59e0b", marginLeft: "auto" }}>Loading history…</span>}
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", gap: 4, padding: "4px 10px", background: "#04080e", borderBottom: "1px solid #0a1525", flexShrink: 0, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => { setShowInd(v => !v); setShowAlerts(false) }} style={S.toolBtn(showInd)}>
            📈 Indicators
            {activeInd.length > 0 && <span style={{ background: "#1d4ed8", borderRadius: 10, padding: "1px 5px", fontSize: 9, color: "#fff" }}>{activeInd.length}</span>}
          </button>
          <div style={{ borderLeft: "1px solid #0a1525", paddingLeft: 5, display: "flex", gap: 3 }}>
            {[["line","╱","Trend"],["rect","▭","Rect"],["hline","━","H-Line"]].map(([id,icon,lbl]) => (
              <button key={id} title={lbl} onClick={() => { setDrawTool(t => t === id ? null : id); setPending(null) }} style={S.toolBtn(drawTool === id)}>{icon} {lbl}</button>
            ))}
            {drawings.length > 0 && (
              <button onClick={() => { setDrawings([]); setDrawTool(null); setPending(null) }} style={{ ...S.toolBtn(false), color: "#ef4444", borderColor: "#4a1010" }}>🗑 Clear</button>
            )}
          </div>
          <button onClick={() => { setShowAlerts(v => !v); setShowInd(false) }} style={{ ...S.toolBtn(showAlerts), marginLeft: "auto" }}>
            🔔 Alerts {alertList.filter(a => !a.triggered).length > 0 && <span style={{ background: "#ef4444", borderRadius: 10, padding: "1px 5px", fontSize: 9, color: "#fff" }}>{alertList.filter(a => !a.triggered).length}</span>}
          </button>
          {drawTool && <span style={{ fontSize: 9, color: "#f59e0b" }}>{pending ? "Click 2nd point…" : "Click to place"}</span>}
        </div>

        {/* Canvas area */}
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>

          {/* Indicators dropdown */}
          {showInd && (
            <div style={{ position: "absolute", top: 4, left: 8, zIndex: 200, background: "#0b1829", border: "1px solid #1a2f4a", borderRadius: 6, padding: 12, width: 190, boxShadow: "0 8px 32px #000c" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 10, color: "#4a6a9a", fontWeight: 700, letterSpacing: "0.1em" }}>INDICATORS</span>
                <button onClick={() => setShowInd(false)} style={{ background: "none", border: "none", color: "#3d5a80", cursor: "pointer", fontSize: 16 }}>×</button>
              </div>
              {[{id:"sma20",label:"SMA 20",color:"#f59e0b"},{id:"sma50",label:"SMA 50",color:"#a78bfa"},{id:"rsi14",label:"RSI 14",color:"#22c55e"}].map(ind => (
                <div key={ind.id} onClick={() => setActiveInd(p => p.includes(ind.id) ? p.filter(x => x !== ind.id) : [...p, ind.id])}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 7px", borderRadius: 4, cursor: "pointer", marginBottom: 2, background: activeInd.includes(ind.id) ? "#0f2040" : "transparent", border: `1px solid ${activeInd.includes(ind.id) ? "#1a2f4a" : "transparent"}` }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: ind.color }} />
                  <span style={{ fontSize: 11, color: activeInd.includes(ind.id) ? "#c8dff5" : "#4a6a9a" }}>{ind.label}</span>
                  {activeInd.includes(ind.id) && <span style={{ marginLeft: "auto", color: "#22c55e" }}>✓</span>}
                </div>
              ))}
            </div>
          )}

          {/* Alerts dropdown */}
          {showAlerts && (
            <div style={{ position: "absolute", top: 4, right: 4, zIndex: 200, background: "#0b1829", border: "1px solid #1a2f4a", borderRadius: 6, padding: 12, width: 210, boxShadow: "0 8px 32px #000c" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: "#4a6a9a", fontWeight: 700, letterSpacing: "0.1em" }}>PRICE ALERTS</span>
                <button onClick={() => setShowAlerts(false)} style={{ background: "none", border: "none", color: "#3d5a80", cursor: "pointer", fontSize: 16 }}>×</button>
              </div>
              {price && <div style={{ fontSize: 9, color: "#2d4060", marginBottom: 5 }}>Current: ${fmt(price)}</div>}
              <div style={{ display: "flex", gap: 3, marginBottom: 5 }}>
                {["above","below"].map(d => (
                  <button key={d} onClick={() => setAlertDir(d)} style={{ flex:1, padding:"3px 0", borderRadius:3, border:"none", cursor:"pointer", background: alertDir===d ? "#1d4ed8":"#0f2040", color: alertDir===d ? "#fff":"#4a6a9a", fontSize:10, fontFamily:"monospace" }}>{d}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 3, marginBottom: 7 }}>
                <input value={alertVal} onChange={e => setAlertVal(e.target.value)} placeholder="Price…"
                  style={{ flex: 1, background: "#0a1628", border: "1px solid #1a2f4a", borderRadius: 3, padding: "4px 6px", color: "#c8dff5", fontFamily: "monospace", fontSize: 11, outline: "none" }} />
                <button onClick={addAlert} style={{ padding: "4px 9px", background: "#1d4ed8", border: "none", borderRadius: 3, color: "#fff", cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>+</button>
              </div>
              {alertList.length === 0
                ? <div style={{ color: "#1a2f4a", fontSize: 10, textAlign: "center", padding: 6 }}>No alerts set</div>
                : alertList.map(a => (
                  <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 6px", background: "#0a1628", borderRadius: 3, marginBottom: 3, border: `1px solid ${a.triggered ? "#22c55e40" : "#1a2f4a"}`, fontSize: 10 }}>
                    <span style={{ color: "#4a6a9a" }}>{a.direction === "above" ? "↑" : "↓"} {a.ticker} ${fmt(a.threshold)}</span>
                    {a.triggered && <span style={{ color: "#22c55e", fontSize: 9 }}>✓</span>}
                  </div>
                ))
              }
            </div>
          )}

          {/* THE CHART */}
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            style={{ width: "100%", height: "100%", display: "block", cursor: drawTool ? "crosshair" : "default" }}
          />

          {/* Empty state */}
          {candles.length === 0 && !histLoading && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "#1e3a5f", pointerEvents: "none" }}>
              <div style={{ fontSize: 24 }}>📡</div>
              <div style={{ fontFamily: "monospace", fontSize: 11 }}>Awaiting data for {ticker}…</div>
            </div>
          )}
        </div>

        {/* Warning banner */}
        {warning && (
          <div style={{ padding: "6px 14px", flexShrink: 0, background: warning.startsWith("⛔") ? "#180606" : "#110e00", borderTop: `1px solid ${warning.startsWith("⛔") ? "#7f1d1d" : "#78350f"}`, color: warning.startsWith("⛔") ? "#fca5a5" : "#fcd34d", fontSize: 11, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {warning}
            <button onClick={() => setWarning("")} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 15 }}>×</button>
          </div>
        )}

        {/* Trade history table */}
        <div style={{ height: 144, flexShrink: 0, borderTop: "1px solid #0a1525", overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <thead>
              <tr style={{ background: "#05090f", position: "sticky", top: 0, zIndex: 1 }}>
                {["Time","Ticker","Side","Qty","Entry","Exit","P&L"].map(h => (
                  <th key={h} style={{ padding: "4px 8px", color: "#1e3a5f", fontWeight: 500, textAlign: "left", borderBottom: "1px solid #0a1525", letterSpacing: "0.06em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...tradeLog].reverse().slice(0, 30).map((t, i) => (
                <tr key={t.id} style={S.trow(i)}>
                  <td style={{ padding: "3px 8px", color: "#1e3a5f" }}>{fmtT(t.ts)}</td>
                  <td style={{ padding: "3px 8px", color: "#4a6a9a" }}>{t.ticker}</td>
                  <td style={{ padding: "3px 8px" }}><span style={S.tag(t.side === "buy" ? "#3b82f6" : "#ef4444")}>{t.side.toUpperCase()}</span></td>
                  <td style={{ padding: "3px 8px", color: "#2d4a6a" }}>{t.qty}</td>
                  <td style={{ padding: "3px 8px", color: "#4a6a9a" }}>${fmt(t.price)}</td>
                  <td style={{ padding: "3px 8px", color: "#4a6a9a" }}>{t.exitPrice ? "$"+fmt(t.exitPrice) : "—"}</td>
                  <td style={{ padding: "3px 8px", fontWeight: 700, color: t.pnl > 0 ? "#22c55e" : t.pnl < 0 ? "#ef4444" : "#2d4a6a" }}>
                    {t.exitPrice ? (t.pnl >= 0 ? "+" : "") + fmtC(t.pnl) : "open"}
                  </td>
                </tr>
              ))}
              {tradeLog.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 16, color: "#0f2040", textAlign: "center" }}>No trades yet — place your first order →</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* ── Right panel ────────────────────────────────────────────────────── */}
      <aside style={S.right}>

        {/* Balance */}
        <div style={{ ...S.sec, background: "#05090f" }}>
          <div style={S.lbl}>Virtual Balance</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: balance >= 10_000 ? "#22c55e" : "#ef4444" }}>{fmtC(balance)}</div>
          <div style={{ fontSize: 9, color: "#1e3a5f", marginTop: 2 }}>Started at $10,000.00</div>
        </div>

        {/* Stats */}
        <div style={{ ...S.sec, background: "#060b14" }}>
          <div style={S.lbl}>Today's Performance</div>
          <div style={{ display: "flex", gap: 4 }}>
            {[["P&L Today", tdPnl >= 0 ? "+"+fmtC(tdPnl) : fmtC(tdPnl), tdPnl >= 0 ? "#22c55e" : "#ef4444"],
              ["Win Rate",  winRate+"%", winRate >= 50 ? "#22c55e" : "#ef4444"],
              ["Closed",    closed.length, "#4a6a9a"]].map(([k,v,c]) => (
              <div key={k} style={{ ...S.stat, textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "#1e3a5f", marginBottom: 2 }}>{k}</div>
                <div style={{ fontWeight: 700, color: c, fontSize: 11 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
            <div style={S.stat}>
              <div style={{ fontSize: 9, color: "#1e3a5f", marginBottom: 2 }}>Total P&L</div>
              <div style={{ fontWeight: 700, color: totalPnl >= 0 ? "#22c55e" : "#ef4444", fontSize: 11 }}>{totalPnl >= 0 ? "+" : ""}{fmtC(totalPnl)}</div>
            </div>
            <div style={S.stat}>
              <div style={{ fontSize: 9, color: "#1e3a5f", marginBottom: 2 }}>Open Pos.</div>
              <div style={{ fontWeight: 700, color: "#4a6a9a", fontSize: 11 }}>{openPos.length}</div>
            </div>
          </div>
        </div>

        {/* Overtrading protection */}
        {mode === "beginner" && (
          <div style={{ ...S.sec, background: "#05090f" }}>
            <div style={S.lbl}>Overtrading Protection</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "#2d4a6a", fontSize: 10 }}>Trades today</span>
              <span style={{ fontWeight: 700, color: dayBlocked ? "#ef4444" : "#4a6a9a" }}>{todayCnt} / {cfg.maxTradesPerDay}</span>
            </div>
            <div style={{ display: "flex", gap: 3, marginBottom: 5 }}>
              {Array.from({ length: cfg.maxTradesPerDay }).map((_, i) => (
                <div key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: i < todayCnt ? (dayBlocked ? "#ef4444" : "#3b82f6") : "#0a1525", transition: "background 0.3s" }} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#2d4a6a", fontSize: 10 }}>Consec. losses</span>
              <span style={{ fontWeight: 700, color: consLosses >= 2 ? "#ef4444" : consLosses === 1 ? "#f59e0b" : "#22c55e" }}>{consLosses} / {cfg.maxConsecutiveLosses}</span>
            </div>
            {cooldown.remaining > 0 && (
              <div style={{ marginTop: 5, padding: "4px 7px", background: "#130e00", borderRadius: 4, border: "1px solid #78350f", color: "#fcd34d", fontSize: 10 }}>⏳ Next trade in {cooldown.remaining}s</div>
            )}
            {dayBlocked && (
              <div style={{ marginTop: 5, padding: "4px 7px", background: "#130404", borderRadius: 4, border: "1px solid #7f1d1d", color: "#fca5a5", fontSize: 10 }}>⛔ Trading disabled for today</div>
            )}
          </div>
        )}

        {/* Order form */}
        <div style={S.sec}>
          <div style={S.lbl}>Place Order</div>
          <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
            <button onClick={() => setSide("buy")}  style={{ ...S.btn(side==="buy"  ? "#1d4ed8":"#08111e", side==="buy"  ? "#3b82f6":"#0f2040"), flex:1 }}>▲ BUY</button>
            <button onClick={() => setSide("sell")} style={{ ...S.btn(side==="sell" ? "#991b1b":"#08111e", side==="sell" ? "#ef4444":"#0f2040"), flex:1 }}>▼ SELL</button>
          </div>

          <div style={{ textAlign: "center", marginBottom: 10, padding: 6, background: "#08111e", borderRadius: 4, border: "1px solid #0f2040" }}>
            <div style={{ fontSize: 9, color: "#1e3a5f", marginBottom: 2 }}>Live Market Price</div>
            {price
              ? <div style={{ fontSize: 17, fontWeight: 700, color: bull ? "#3b82f6" : "#ef4444" }}>${fmt(price)}</div>
              : <div style={{ fontSize: 12, color: "#1e3a5f" }}>Connecting…</div>}
          </div>

          {[["Volume", volume, setVolume, 0.01, 0.01], ["Lot Size", lotSize, setLotSize, 1, 1], ["Risk %", riskPct, setRiskPct, 0.1, 0.1]].map(([lbl, val, set, mn, st]) => (
            <div key={lbl} style={{ marginBottom: 7 }}>
              <div style={{ ...S.lbl, marginBottom: 2 }}>{lbl}</div>
              <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                <button onClick={() => set(v => Math.max(mn, +(v-st).toFixed(2)))} style={{ background: "#08111e", border: "1px solid #0f2040", color: "#4a6a9a", borderRadius: 3, padding: "3px 7px", cursor: "pointer" }}>−</button>
                <input type="number" value={val} min={mn} step={st} onChange={e => set(+e.target.value)} style={{ ...S.inp, textAlign: "center" }} />
                <button onClick={() => set(v => +(+v+st).toFixed(2))} style={{ background: "#08111e", border: "1px solid #0f2040", color: "#4a6a9a", borderRadius: 3, padding: "3px 7px", cursor: "pointer" }}>+</button>
              </div>
            </div>
          ))}

          <div style={{ background: "#08111e", borderRadius: 4, padding: 7, marginBottom: 8, border: "1px solid #0f2040", fontSize: 10 }}>
            {price
              ? [["Est. Value", "$"+fmt(volume*lotSize*price), "#4a6a9a"], ["Risk Amt", "$"+fmt((riskPct/100)*balance), "#f59e0b"], ["Qty", volume*lotSize+" units", "#4a6a9a"]].map(([k,v,c]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ color: "#1e3a5f" }}>{k}</span><span style={{ color: c }}>{v}</span>
                </div>
              ))
              : <div style={{ color: "#1e3a5f", textAlign: "center" }}>Waiting for live price…</div>}
          </div>

          <button onClick={executeTrade} disabled={isBlocked || !price}
            style={{ ...S.btn(isBlocked||!price ? "#0a1525" : side==="buy" ? "#1d4ed8" : "#991b1b", isBlocked||!price ? "#0f2040" : side==="buy" ? "#3b82f6" : "#ef4444"), opacity: isBlocked||!price ? 0.5 : 1, cursor: isBlocked||!price ? "not-allowed" : "pointer", fontSize: 13, padding: 11 }}>
            {!price ? "WAITING FOR PRICE" : cooldown.remaining > 0 ? `⏳ COOLDOWN ${cooldown.remaining}s` : dayBlocked && mode==="beginner" ? "⛔ DISABLED TODAY" : `${side==="buy" ? "▲ BUY" : "▼ SELL"} ${ticker}`}
          </button>
        </div>

        {/* Open positions with live unrealised P&L */}
        {openPos.length > 0 && (
          <div style={{ ...S.sec, borderBottom: "none" }}>
            <div style={S.lbl}>Open Positions ({openPos.length})</div>
            {openPos.map(p => {
              const unreal = price ? (price - p.price) * p.qty * (p.side === "sell" ? -1 : 1) : 0
              return (
                <div key={p.id} style={{ background: "#08111e", borderRadius: 4, padding: "5px 7px", marginBottom: 3, border: "1px solid #0f2040", fontSize: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span><span style={S.tag(p.side==="buy" ? "#3b82f6":"#ef4444")}>{p.side.toUpperCase()}</span> {p.ticker} × {p.qty}</span>
                    <span style={{ color: unreal>=0 ? "#22c55e":"#ef4444", fontWeight: 700 }}>{unreal>=0?"+":""}{fmtC(unreal)}</span>
                  </div>
                  <div style={{ color: "#1e3a5f", marginTop: 2 }}>Entry ${fmt(p.price)} · Live ${price ? fmt(price) : "…"}</div>
                </div>
              )
            })}
          </div>
        )}
      </aside>
    </div>
  )
}