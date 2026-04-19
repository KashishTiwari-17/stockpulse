/**
 * CandlestickChart — OHLC chart with volume, SMA overlays, drawing tools.
 *
 * FIXES:
 *  1. Y-axis showed $0–$1 because the candlestick dataset wasn't rendering —
 *     the financial plugin requires x/o/h/l/c fields but the volume y-axis
 *     was dominating when prices were falsy. Now the price y-axis has explicit
 *     min/max derived from actual OHLC values.
 *  2. Single-candle edge case handled — chart no longer crashes with 1 candle.
 *  3. Time unit detection is more robust — falls back to "minute" safely.
 *  4. Added console.log of first candle so you can verify data in DevTools.
 */

import { useEffect, useRef, useCallback, useState } from "react"
import {
  Chart, CategoryScale, LinearScale, TimeScale, Tooltip, Legend,
} from "chart.js"
import "chartjs-adapter-luxon"
import {
  CandlestickController, CandlestickElement,
  OhlcController, OhlcElement,
} from "chartjs-chart-financial"
import { BarController, BarElement } from "chart.js"

Chart.register(
  CategoryScale, LinearScale, TimeScale, Tooltip, Legend,
  CandlestickController, CandlestickElement,
  OhlcController, OhlcElement,
  BarController, BarElement,
)

try {
  if (CandlestickElement.defaults) {
    CandlestickElement.defaults.color = {
      up: "#22c55e", down: "#ef4444", unchanged: "#94a3b8",
    }
  }
} catch (_) {}

const SMA_COLORS = { sma20: "#f59e0b", sma50: "#818cf8" }
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
const FIB_COLORS = ["#ef4444","#f59e0b","#22c55e","#3b82f6","#22c55e","#f59e0b","#ef4444"]
const TOOLS = [
  { id: "crosshair", icon: "✛", label: "Crosshair"      },
  { id: "trend",     icon: "╱", label: "Trend Line"      },
  { id: "hline",     icon: "—", label: "Horizontal Line" },
  { id: "rect",      icon: "▭", label: "Rectangle"       },
  { id: "fib",       icon: "Φ", label: "Fibonacci"       },
  { id: "text",      icon: "T", label: "Text Label"      },
  { id: "eraser",    icon: "⌫", label: "Erase Drawing"   },
]

function detectTimeUnit(timestamps) {
  if (timestamps.length < 2) return "minute"
  const spanMs = timestamps[timestamps.length - 1] - timestamps[0]
  const spanHours = spanMs / (1000 * 60 * 60)
  if (spanHours <= 12)  return "minute"
  if (spanHours <= 168) return "hour"    // up to 7 days
  return "day"
}

function destroyCanvas(canvas) {
  if (!canvas) return
  try { Chart.getChart(canvas)?.destroy() } catch (_) {}
}

export default function CandlestickChart({ candles, analytics, ticker }) {
  const canvasRef   = useRef(null)
  const chartRef    = useRef(null)
  const overlayRef  = useRef(null)
  const drawingsRef = useRef([])
  const activeRef   = useRef(null)
  const mouseRef    = useRef({ x: 0, y: 0 })

  const [tool,      setTool]      = useState("crosshair")
  const [drawColor, setDrawColor] = useState("#3b82f6")
  const [textInput, setTextInput] = useState(null)

  const destroyChart = useCallback(() => {
    if (chartRef.current) {
      try { chartRef.current.destroy() } catch (_) {}
      chartRef.current = null
    }
    destroyCanvas(canvasRef.current)
  }, [])

  useEffect(() => {
    if (!canvasRef.current || candles.length === 0) return

    // ── Validate & parse candles ────────────────────────────────────────────
    const valid = candles
      .map((c) => ({
        ...c,
        ts:    c.ts,
        open:  Number(c.open)  || 0,
        high:  Number(c.high)  || 0,
        low:   Number(c.low)   || 0,
        close: Number(c.close) || 0,
        vol:   Number(c.volume)|| 0,
        _t:    new Date(c.ts).getTime(),
      }))
      .filter((c) => !isNaN(c._t) && c._t > 100_000_000_000 && c.close > 0)

    if (valid.length === 0) {
      console.warn("CandlestickChart: no valid candles to render", candles.slice(0, 3))
      return
    }

    // Debug: log first candle so you can verify in DevTools
    console.log(`Chart: ${valid.length} candles, first=`, valid[0], "last=", valid[valid.length - 1])

    const timestamps = valid.map((c) => c._t)
    const xMin       = timestamps[0]
    const xMax       = timestamps[timestamps.length - 1]
    const timeUnit   = detectTimeUnit(timestamps)

    // ── Price range for y-axis ──────────────────────────────────────────────
    const allLows   = valid.map((c) => c.low).filter(Boolean)
    const allHighs  = valid.map((c) => c.high).filter(Boolean)
    const priceMin  = Math.min(...allLows)
    const priceMax  = Math.max(...allHighs)
    const pricePad  = (priceMax - priceMin) * 0.05 || priceMax * 0.01 || 1

    // ── Volume range ────────────────────────────────────────────────────────
    const maxVol = Math.max(...valid.map((c) => c.vol), 1)

    // ── Datasets ────────────────────────────────────────────────────────────
    const ohlcData = valid.map((c) => ({
      x: c._t,
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
    }))

    const volData = valid.map((c) => ({
      x: c._t,
      y: c.vol,
    }))

    const datasets = [
      {
        type: "candlestick",
        label: ticker,
        data: ohlcData,
        yAxisID: "y",
        color: { up: "#22c55e", down: "#ef4444", unchanged: "#94a3b8" },
        borderColor: { up: "#22c55e", down: "#ef4444", unchanged: "#94a3b8" },
      },
      {
        type: "bar",
        label: "Volume",
        data: volData,
        yAxisID: "volume",
        backgroundColor: valid.map((c) =>
          c.close >= c.open ? "#22c55e33" : "#ef444433"
        ),
        borderRadius: 2,
        barPercentage: 0.8,
      },
    ]

    // SMA overlays
    const sma20    = analytics?.sma_20 ?? analytics?.sma20 ?? []
    const sma50    = analytics?.sma_50 ?? analytics?.sma50 ?? []
    const smaTimes = analytics?.timestamps ?? []

    if (smaTimes.length > 0) {
      const f20 = smaTimes
        .map((ts, i) => ({ x: new Date(ts).getTime(), y: sma20[i] ?? null }))
        .filter((p) => p.y != null && p.x >= xMin && p.x <= xMax)
      const f50 = smaTimes
        .map((ts, i) => ({ x: new Date(ts).getTime(), y: sma50[i] ?? null }))
        .filter((p) => p.y != null && p.x >= xMin && p.x <= xMax)

      if (f20.length > 0) datasets.push({
        type: "line", label: "SMA 20", data: f20, yAxisID: "y",
        borderColor: SMA_COLORS.sma20, backgroundColor: "transparent",
        borderWidth: 1.5, pointRadius: 0, tension: 0.3,
      })
      if (f50.length > 0) datasets.push({
        type: "line", label: "SMA 50", data: f50, yAxisID: "y",
        borderColor: SMA_COLORS.sma50, backgroundColor: "transparent",
        borderWidth: 1.5, pointRadius: 0, tension: 0.3,
      })
    }

    destroyChart()

    try {
      const ctx = canvasRef.current.getContext("2d")
      chartRef.current = new Chart(ctx, {
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 100 },
          interaction: { mode: "index", intersect: false },
          scales: {
            x: {
              type: "time",
              min: xMin,
              max: xMax,
              time: {
                unit: timeUnit,
                displayFormats: {
                  minute: "HH:mm",
                  hour:   "MMM d HH:mm",
                  day:    "MMM d",
                },
              },
              ticks: { color: "#94a3b8", maxTicksLimit: 10, maxRotation: 0 },
              grid:  { color: "#1e293b" },
            },
            // Price axis — explicit min/max so it never shows $0–$1
            y: {
              position: "right",
              min: priceMin - pricePad,
              max: priceMax + pricePad,
              ticks: {
                color: "#94a3b8",
                callback: (v) => `$${Number(v).toFixed(2)}`,
              },
              grid: { color: "#1e293b" },
            },
            // Volume axis — hidden, scaled so bars take bottom ~20% of chart
            volume: {
              position: "left",
              min: 0,
              max: maxVol * 5,   // pushes bars to bottom 20%
              ticks: { display: false },
              grid:  { display: false },
            },
          },
          plugins: {
            legend: {
              labels: { color: "#94a3b8", usePointStyle: true, pointStyle: "line" },
            },
            tooltip: {
              backgroundColor: "#0f172a", borderColor: "#1e293b", borderWidth: 1,
              titleColor: "#f1f5f9", bodyColor: "#94a3b8",
              callbacks: {
                label: (ctx) => {
                  const d = ctx.raw
                  if (d?.o !== undefined)
                    return [
                      `O: $${Number(d.o).toFixed(2)}`,
                      `H: $${Number(d.h).toFixed(2)}`,
                      `L: $${Number(d.l).toFixed(2)}`,
                      `C: $${Number(d.c).toFixed(2)}`,
                    ]
                  return `${ctx.dataset.label}: ${typeof d === "object" ? (d.y ?? 0).toLocaleString() : d}`
                },
              },
            },
          },
        },
      })
    } catch (err) {
      console.error("Chart build failed:", err)
    }

    return destroyChart
  }, [candles, analytics, ticker, destroyChart])

  // ── Overlay canvas ────────────────────────────────────────────────────────
  const renderOverlay = useCallback(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    const ctx = overlay.getContext("2d")
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    const { x, y } = mouseRef.current
    if (tool === "crosshair" || activeRef.current) {
      ctx.strokeStyle = "#47556988"; ctx.lineWidth = 1; ctx.setLineDash([4, 4])
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, overlay.height); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(overlay.width, y); ctx.stroke()
      ctx.setLineDash([])
    }
    const all = [...drawingsRef.current, ...(activeRef.current ? [activeRef.current] : [])]
    for (const d of all) renderDrawing(ctx, d)
  }, [tool])

  function renderDrawing(ctx, d) {
    ctx.save()
    ctx.strokeStyle = d.color || "#3b82f6"; ctx.fillStyle = d.color || "#3b82f6"; ctx.lineWidth = 2
    if (d.type === "trend") {
      ctx.beginPath(); ctx.moveTo(d.x1, d.y1); ctx.lineTo(d.x2, d.y2); ctx.stroke()
      ctx.beginPath(); ctx.arc(d.x1, d.y1, 4, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(d.x2, d.y2, 4, 0, Math.PI * 2); ctx.fill()
    } else if (d.type === "hline") {
      ctx.setLineDash([6, 3])
      ctx.beginPath(); ctx.moveTo(0, d.y1); ctx.lineTo(overlayRef.current?.width || 800, d.y1); ctx.stroke()
      ctx.setLineDash([])
    } else if (d.type === "rect") {
      const rx = Math.min(d.x1, d.x2), ry = Math.min(d.y1, d.y2)
      const rw = Math.abs(d.x2 - d.x1), rh = Math.abs(d.y2 - d.y1)
      ctx.fillStyle = (d.color || "#3b82f6") + "22"; ctx.fillRect(rx, ry, rw, rh); ctx.strokeRect(rx, ry, rw, rh)
    } else if (d.type === "fib") {
      const totalH = Math.abs(d.y2 - d.y1), topY = Math.min(d.y1, d.y2)
      FIB_LEVELS.forEach((level, i) => {
        const fy = topY + totalH * (d.y1 < d.y2 ? level : 1 - level)
        ctx.strokeStyle = FIB_COLORS[i] + "cc"; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
        ctx.beginPath(); ctx.moveTo(d.x1, fy); ctx.lineTo(d.x2, fy); ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = FIB_COLORS[i]; ctx.textAlign = "left"
        ctx.fillText(`${(level * 100).toFixed(1)}%`, d.x2 + 4, fy + 3)
      })
    } else if (d.type === "text") {
      ctx.fillStyle = d.color || "#f59e0b"; ctx.font = "13px 'DM Sans', sans-serif"; ctx.textAlign = "left"
      ctx.fillText(d.text || "", d.x1, d.y1)
    }
    ctx.restore()
  }

  useEffect(() => {
    const resize = () => {
      const o = overlayRef.current; if (!o) return
      o.width = o.offsetWidth; o.height = o.offsetHeight; renderOverlay()
    }
    window.addEventListener("resize", resize); resize()
    return () => window.removeEventListener("resize", resize)
  }, [renderOverlay])

  const getPos = (e) => {
    const r = overlayRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const onMouseMove = (e) => {
    const pos = getPos(e); mouseRef.current = pos
    if (activeRef.current) { activeRef.current.x2 = pos.x; activeRef.current.y2 = pos.y }
    renderOverlay()
  }
  const onMouseDown = (e) => {
    if (tool === "crosshair") return
    const pos = getPos(e)
    if (tool === "eraser") {
      drawingsRef.current = drawingsRef.current.filter((d) =>
        Math.hypot(d.x1 - pos.x, d.y1 - pos.y) > 20 &&
        Math.hypot((d.x2 || d.x1) - pos.x, (d.y2 || d.y1) - pos.y) > 20
      )
      renderOverlay(); return
    }
    if (tool === "text") { setTextInput(pos); return }
    activeRef.current = { type: tool, color: drawColor, x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y }
  }
  const onMouseUp = (e) => {
    if (!activeRef.current) return
    const pos = getPos(e)
    activeRef.current.x2 = pos.x; activeRef.current.y2 = pos.y
    if (Math.hypot(pos.x - activeRef.current.x1, pos.y - activeRef.current.y1) > 5)
      drawingsRef.current.push({ ...activeRef.current })
    activeRef.current = null; renderOverlay()
  }
  const submitText = (text) => {
    if (text && textInput) drawingsRef.current.push({ type: "text", text, x1: textInput.x, y1: textInput.y, color: drawColor })
    setTextInput(null); renderOverlay()
  }

  const cursorMap = { crosshair:"crosshair", trend:"crosshair", hline:"row-resize", rect:"crosshair", fib:"crosshair", text:"text", eraser:"cell" }

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>

      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: "4px", flexShrink: 0,
        padding: "6px 8px", marginBottom: "6px",
        background: "#0a0f1a", borderRadius: "8px", border: "1px solid #1e293b",
      }}>
        <span style={{ fontSize: "0.62rem", color: "#334155", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginRight: "2px" }}>Tools</span>
        {TOOLS.map((t) => (
          <button key={t.id} title={t.label} onClick={() => { setTool(t.id); setTextInput(null) }} style={{
            padding: "4px 10px", borderRadius: "6px", border: "1px solid",
            borderColor: tool === t.id ? "#3b82f6" : "#1e293b",
            background:  tool === t.id ? "#1d4ed822" : "transparent",
            color:       tool === t.id ? "#3b82f6"   : "#475569",
            cursor: "pointer", fontSize: "0.85rem", minWidth: "30px",
            fontFamily: t.id === "text" ? "sans-serif" : "monospace", transition: "all 0.12s",
          }}>{t.icon}</button>
        ))}
        <div style={{ width: "1px", height: "18px", background: "#1e293b", margin: "0 4px" }} />
        <input type="color" value={drawColor} onChange={(e) => setDrawColor(e.target.value)}
          title="Line color" style={{ width: "24px", height: "24px", border: "none", borderRadius: "4px", cursor: "pointer", padding: 0 }} />
        <button title="Clear all" onClick={() => { drawingsRef.current = []; renderOverlay() }} style={{
          marginLeft: "auto", padding: "4px 10px", borderRadius: "6px",
          border: "1px solid #1e293b", background: "transparent",
          color: "#475569", cursor: "pointer", fontSize: "0.7rem", fontFamily: "monospace",
        }}>Clear</button>
        <span style={{ fontSize: "0.62rem", color: "#1e3a5f", fontFamily: "monospace", marginLeft: "8px" }}>
          {tool === "crosshair" && "hover to inspect"}{tool === "trend" && "drag to draw line"}
          {tool === "hline" && "click to pin level"}{tool === "rect" && "drag to mark zone"}
          {tool === "fib" && "drag for fibonacci"}{tool === "text" && "click to add label"}
          {tool === "eraser" && "click to erase"}
        </span>
      </div>

      {/* Chart */}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
        <canvas ref={overlayRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: cursorMap[tool] || "default" }}
          onMouseMove={onMouseMove} onMouseDown={onMouseDown} onMouseUp={onMouseUp}
          onMouseLeave={() => { mouseRef.current = { x: -1, y: -1 }; renderOverlay() }}
        />
        {textInput && (
          <form style={{ position: "absolute", left: textInput.x, top: textInput.y - 18, zIndex: 20 }}
            onSubmit={(e) => { e.preventDefault(); submitText(e.target.elements.txt.value) }}>
            <input name="txt" autoFocus placeholder="Type label…" onBlur={(e) => submitText(e.target.value)}
              style={{ background: "#0f172a", border: "1px solid #3b82f6", borderRadius: "4px",
                padding: "4px 8px", color: "#f59e0b", fontFamily: "'DM Sans', sans-serif", fontSize: "13px", outline: "none", width: "160px" }} />
          </form>
        )}
      </div>
    </div>
  )
}