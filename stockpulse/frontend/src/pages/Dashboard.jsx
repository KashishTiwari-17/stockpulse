/**
 * Dashboard — root page.
 *
 * NEW: Two-level time controls
 *   Row 1 — RANGE buttons: 1D | 5D | 1M  (how much history to show)
 *   Row 2 — INTERVAL buttons: 1m | 5m | 15m | 1h  (candle size)
 *
 * Selecting a range automatically picks the best default interval and
 * re-fetches history. Interval can still be changed independently.
 */

import { useState, useCallback, useEffect, useRef } from "react"
import { useStockSocket } from "../hooks/useStockSocket"
import { useNotificationStore } from "../store"

import PortfolioPanel    from "../components/PortfolioPanel"
import PriceTicker       from "../components/PriceTicker"
import CandlestickChart  from "../components/CandlestickChart"
import AlertsPanel       from "../components/AlertsPanel"
import RSIChart          from "../components/RSIChart"
import ConnectionStatus  from "../components/ConnectionStatus"
import NotificationToast from "../components/NotificationToast"

const API = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "") || "/api/v1"

const MAX_CANDLES = { "1m": 390, "5m": 200, "15m": 150, "1h": 200, "1d": 365 }
const DEFAULT_MAX = 200

// Range → default interval + REST params
const RANGE_CONFIG = {
  "1D":  { period: "1d",  interval: "5m",  label: "1 Day"   },
  "5D":  { period: "5d",  interval: "15m", label: "5 Days"  },
  "1M":  { period: "1mo", interval: "1h",  label: "1 Month" },
}

// Fallback chains per interval when primary period returns no data
const FALLBACK_CHAIN = {
  "1m":  [{ period: "1d",  interval: "1m"  }, { period: "5d",  interval: "5m"  }, { period: "1mo", interval: "1d" }],
  "5m":  [{ period: "5d",  interval: "5m"  }, { period: "1mo", interval: "1d"  }],
  "15m": [{ period: "5d",  interval: "15m" }, { period: "1mo", interval: "1d"  }],
  "1h":  [{ period: "1mo", interval: "1h"  }, { period: "3mo", interval: "1d"  }],
  "1d":  [{ period: "1y",  interval: "1d"  }, { period: "3mo", interval: "1d"  }],
}

// Allowed intervals per range (shown in the interval row)
const RANGE_INTERVALS = {
  "1D": ["1m", "5m", "15m"],
  "5D": ["5m", "15m", "1h"],
  "1M": ["1h", "1d"],
}

const BUCKET_MINUTES = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "1d": 1440 }

function isValidCandle(c) {
  const t = new Date(c.ts).getTime()
  return !isNaN(t) && t > 946684800000 && Number(c.close) > 0
}

function bucketTs(tsMs, minutes) {
  const ms = minutes * 60 * 1000
  return Math.floor(tsMs / ms) * ms
}

function mergeCandle(prev, newCandle, bucketMinutes, maxCandles) {
  if (!isValidCandle(newCandle)) return prev
  const newBkt = bucketTs(new Date(newCandle.ts).getTime(), bucketMinutes)
  if (prev.length > 0) {
    const last    = prev[prev.length - 1]
    const lastBkt = bucketTs(new Date(last.ts).getTime(), bucketMinutes)
    if (lastBkt === newBkt) {
      return [...prev.slice(0, -1), {
        ...last,
        high:   Math.max(Number(last.high),  Number(newCandle.high)),
        low:    Math.min(Number(last.low),   Number(newCandle.low)),
        close:  Number(newCandle.close),
        volume: (Number(last.volume) || 0) + (Number(newCandle.volume) || 0),
      }]
    }
  }
  return [...prev, newCandle].slice(-maxCandles)
}

function limitCandles(candles, interval) {
  return candles.filter(isValidCandle).slice(-(MAX_CANDLES[interval] ?? DEFAULT_MAX))
}

async function fetchWithFallback(ticker, interval) {
  const chain = FALLBACK_CHAIN[interval] ?? FALLBACK_CHAIN["5m"]
  for (const { period, interval: iv } of chain) {
    try {
      const url = `${API}/stock/${ticker}/history?period=${period}&interval=${iv}`
      console.log("Trying:", url)
      const res = await fetch(url)
      if (!res.ok) { console.warn(`HTTP ${res.status} for ${period}/${iv}`); continue }
      const data    = await res.json()
      const candles = (data.candles ?? []).filter(isValidCandle)
      if (candles.length > 0) {
        console.log(`✓ ${candles.length} candles (${period}/${iv})`, candles[0])
        return candles
      }
    } catch (e) { console.warn("Fetch error:", e) }
  }
  return []
}

export default function Dashboard() {
  const [activeTicker,   setActiveTicker]   = useState("AAPL")
  const [candles,        setCandles]        = useState([])
  const [liveData,       setLiveData]       = useState({ price: null, change: 0, changePct: 0, volume: 0 })
  const [analytics,      setAnalytics]      = useState(null)
  const [wsStatus,       setWsStatus]       = useState("connecting")
  const [range,          setRange]          = useState("1D")          // 1D | 5D | 1M
  const [interval,       setInterval_]      = useState("5m")          // candle size
  const [rightTab,       setRightTab]       = useState("alerts")
  const [historyLoading, setHistoryLoading] = useState(false)

  const intervalRef = useRef("5m")
  const pushNotification = useNotificationStore((s) => s.push)
  useEffect(() => { intervalRef.current = interval }, [interval])

  // ── Load history whenever ticker or interval changes ──────────────────────
  const loadHistory = useCallback(async (ticker, iv) => {
    setCandles([])
    setHistoryLoading(true)
    const loaded = await fetchWithFallback(ticker, iv)
    setCandles(limitCandles(loaded, iv))
    setHistoryLoading(false)
  }, [])

  useEffect(() => {
    loadHistory(activeTicker, interval)
  }, [activeTicker, interval, loadHistory])

  // ── Range button clicked ──────────────────────────────────────────────────
  const handleRangeChange = (r) => {
    const cfg      = RANGE_CONFIG[r]
    const newIv    = cfg.interval
    // Make sure the current interval is valid for this range; if not, reset
    const allowed  = RANGE_INTERVALS[r]
    const iv       = allowed.includes(interval) ? interval : newIv
    setRange(r)
    setInterval_(iv)
    intervalRef.current = iv
    // loadHistory fires via useEffect on interval change
  }

  // ── Interval button clicked ───────────────────────────────────────────────
  const handleIntervalChange = (iv) => {
    setInterval_(iv)
    intervalRef.current = iv
  }

  // ── Analytics ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setAnalytics(null)
    fetch(`${API}/stock/${activeTicker}/analytics`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data) => setAnalytics({
        sma_20:     data.sma20 ?? data.sma_20 ?? [],
        sma_50:     data.sma50 ?? data.sma_50 ?? [],
        rsi14:      data.rsi14 ?? [],
        timestamps: data.timestamps ?? [],
      }))
      .catch(() => setAnalytics({ sma_20: [], sma_50: [], rsi14: [], timestamps: [] }))
  }, [activeTicker])

  // ── WebSocket ─────────────────────────────────────────────────────────────
  const onHistory = useCallback((historicCandles) => {
    setCandles((prev) => {
      if (prev.length > 0) return prev
      return limitCandles(historicCandles, intervalRef.current)
    })
    setWsStatus("connected")
  }, [])

  const onCandle = useCallback((data) => {
    setWsStatus("connected")
    if (!data.close || data.close <= 0) return
    setLiveData({ price: data.close, change: data.change, changePct: data.change_pct, volume: data.volume })
    const iv   = intervalRef.current
    const bMin = BUCKET_MINUTES[iv] ?? 5
    const maxC = MAX_CANDLES[iv]    ?? DEFAULT_MAX
    setCandles((prev) => mergeCandle(prev, data, bMin, maxC))
  }, [])

  const onAlert = useCallback((data) => pushNotification({ message: data.message }), [pushNotification])
  const onError = useCallback((msg)  => { setWsStatus("disconnected"); console.warn("WS:", msg) }, [])

  useStockSocket({ ticker: activeTicker, onCandle, onHistory, onAlert, onError })

  const handleTickerChange = (t) => {
    const ticker = t.trim().toUpperCase()
    if (!ticker) return
    setActiveTicker(ticker)
    setCandles([])
    setLiveData({ price: null, change: 0, changePct: 0, volume: 0 })
    setWsStatus("connecting")
    setRange("1D"); setInterval_("5m"); intervalRef.current = "5m"
  }

  const RANGES    = ["1D", "5D", "1M"]
  const INTERVALS = RANGE_INTERVALS[range]

  return (
    <div style={{
      display: "flex", height: "100vh", overflow: "hidden",
      background: "#060d1a", color: "#f1f5f9", fontFamily: "'DM Sans', sans-serif",
    }}>
      <PortfolioPanel activeTicker={activeTicker} onSelect={handleTickerChange} />

      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 24px", borderBottom: "1px solid #1e293b", flexShrink: 0,
        }}>
          {/* Logo + search */}
          <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{
                width: "28px", height: "28px", background: "linear-gradient(135deg, #1d4ed8, #7c3aed)",
                borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem",
              }}>⚡</div>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "0.9rem", color: "#64748b", letterSpacing: "0.08em" }}>
                STOCK<span style={{ color: "#3b82f6" }}>PULSE</span>
              </span>
            </div>
            <input
              defaultValue={activeTicker}
              onKeyDown={(e) => { if (e.key === "Enter") handleTickerChange(e.target.value) }}
              style={{
                background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: "8px",
                padding: "6px 12px", color: "#f1f5f9",
                fontFamily: "'Space Mono', monospace", fontSize: "0.85rem",
                width: "120px", outline: "none", textTransform: "uppercase",
              }}
              placeholder="Ticker…"
            />
          </div>

          {/* Time controls + status */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>

            {/* Range pills */}
            <div style={{
              display: "flex", gap: "2px", background: "#0a0f1a",
              border: "1px solid #1e293b", borderRadius: "8px", padding: "3px",
            }}>
              {RANGES.map((r) => (
                <button key={r} onClick={() => handleRangeChange(r)}
                  style={{
                    padding: "4px 12px", borderRadius: "6px", border: "none",
                    background: range === r ? "#1d4ed8" : "transparent",
                    color:      range === r ? "#fff"    : "#475569",
                    fontFamily: "'Space Mono', monospace", fontSize: "0.72rem",
                    cursor: "pointer", transition: "all 0.15s", fontWeight: range === r ? 600 : 400,
                  }}
                >{r}</button>
              ))}
            </div>

            {/* Separator */}
            <div style={{ width: "1px", height: "20px", background: "#1e293b" }} />

            {/* Interval pills */}
            <div style={{
              display: "flex", gap: "2px", background: "#0a0f1a",
              border: "1px solid #1e293b", borderRadius: "8px", padding: "3px",
            }}>
              {INTERVALS.map((iv) => (
                <button key={iv} onClick={() => handleIntervalChange(iv)} disabled={historyLoading}
                  style={{
                    padding: "4px 10px", borderRadius: "6px", border: "none",
                    background: interval === iv ? "#1e293b" : "transparent",
                    color:      interval === iv ? "#3b82f6" : "#475569",
                    fontFamily: "'Space Mono', monospace", fontSize: "0.72rem",
                    cursor: historyLoading ? "wait" : "pointer",
                    transition: "all 0.15s", opacity: historyLoading ? 0.5 : 1,
                  }}
                >{iv}</button>
              ))}
            </div>

            <ConnectionStatus status={wsStatus} />
          </div>
        </header>

        {/* ── Price Ticker ──────────────────────────────────────────────── */}
        <div style={{ padding: "14px 24px 0", flexShrink: 0 }}>
          <PriceTicker
            ticker={activeTicker} price={liveData.price}
            change={liveData.change} changePct={liveData.changePct} volume={liveData.volume}
          />
        </div>

        {/* ── Chart ─────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, padding: "14px 24px", overflow: "hidden", minHeight: 0 }}>
          {candles.length === 0 ? (
            <div style={{
              height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
              color: "#1e3a5f", flexDirection: "column", gap: "12px",
            }}>
              <div style={{ fontSize: "2rem" }}>📡</div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "0.85rem" }}>
                {historyLoading
                  ? `Loading ${RANGE_CONFIG[range].label} · ${interval}…`
                  : `Awaiting data for ${activeTicker}…`}
              </div>
            </div>
          ) : (
            <CandlestickChart candles={candles} analytics={analytics} ticker={activeTicker} interval={interval} />
          )}
        </div>
      </main>

      {/* ── Right panel ───────────────────────────────────────────────────── */}
      <aside style={{
        width: "280px", flexShrink: 0, borderLeft: "1px solid #1e293b",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ display: "flex", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
          {[["alerts", "🔔 Alerts"], ["analytics", "📊 Indicators"]].map(([key, label]) => (
            <button key={key} onClick={() => setRightTab(key)} style={{
              flex: 1, padding: "14px 8px",
              background: rightTab === key ? "#0a0f1a" : "transparent",
              border: "none",
              borderBottom: rightTab === key ? "2px solid #3b82f6" : "2px solid transparent",
              color: rightTab === key ? "#f1f5f9" : "#475569",
              cursor: "pointer", fontSize: "0.75rem", transition: "all 0.15s",
            }}>{label}</button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {rightTab === "alerts" ? (
            <AlertsPanel currentTicker={activeTicker} currentPrice={liveData.price} />
          ) : (
            <div>
              <RSIChart analytics={analytics || { rsi14: [], timestamps: [] }} />
              {analytics && (
                <div style={{ marginTop: "24px" }}>
                  <div style={{ fontSize: "0.7rem", color: "#475569", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" }}>
                    Moving Averages
                  </div>
                  {[
                    { label: "SMA 20", color: "#f59e0b", values: analytics?.sma_20 ?? [] },
                    { label: "SMA 50", color: "#818cf8", values: analytics?.sma_50 ?? [] },
                  ].map(({ label, color, values }) => {
                    const last = values?.filter(Boolean).slice(-1)[0]
                    return (
                      <div key={label} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "8px 10px", background: "#0a0f1a", borderRadius: "8px",
                        marginBottom: "6px", border: `1px solid ${color}22`,
                      }}>
                        <span style={{ fontSize: "0.8rem", color, display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ width: "20px", height: "2px", background: color, display: "inline-block" }} />
                          {label}
                        </span>
                        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "0.8rem", color: "#94a3b8" }}>
                          {last ? `$${Number(last).toFixed(2)}` : "—"}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      <NotificationToast />
    </div>
  )
}