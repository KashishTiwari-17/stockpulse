/**
 * RSIChart — standalone RSI-14 panel with overbought/oversold zones.
 *
 * FIX: analytics object uses `rsi14` (not `rsi_14`) and `timestamps`
 *      to match what the /analytics endpoint returns.
 */

import { useEffect, useRef } from "react"
import {
  Chart, LineController, LineElement, PointElement,
  LinearScale, TimeScale, Tooltip, Filler,
} from "chart.js"
import "chartjs-adapter-luxon"

Chart.register(LineController, LineElement, PointElement, LinearScale, TimeScale, Tooltip, Filler)

export default function RSIChart({ analytics }) {
  const canvasRef = useRef(null)
  const chartRef  = useRef(null)

  useEffect(() => {
    if (!canvasRef.current) return

    // Support both field names for safety
    const rsi  = analytics?.rsi14 ?? analytics?.rsi_14 ?? []
    const tss  = analytics?.timestamps ?? []

    chartRef.current?.destroy()

    if (rsi.length === 0 || tss.length === 0) return

    const valid = tss
      .map((ts, i) => ({ x: new Date(ts).getTime(), y: rsi[i] }))
      .filter((p) => p.y != null && !isNaN(p.y))

    if (valid.length === 0) return

    const ctx = canvasRef.current.getContext("2d")
    chartRef.current = new Chart(ctx, {
      type: "line",
      data: {
        datasets: [
          {
            label: "RSI 14",
            data: valid,
            borderColor: "#a78bfa",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3,
            fill: false,
          },
          {
            label: "Overbought",
            data: valid.map((p) => ({ x: p.x, y: 70 })),
            borderColor: "#ef444455",
            borderWidth: 1,
            borderDash: [4, 4],
            pointRadius: 0,
            fill: false,
          },
          {
            label: "Oversold",
            data: valid.map((p) => ({ x: p.x, y: 30 })),
            borderColor: "#22c55e55",
            borderWidth: 1,
            borderDash: [4, 4],
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: {
            type: "time",
            time: { unit: "day", displayFormats: { day: "MMM d" } },
            ticks: { color: "#475569", maxTicksLimit: 6 },
            grid:  { color: "#0f172a" },
          },
          y: {
            min: 0, max: 100,
            position: "right",
            ticks: {
              color: "#475569",
              callback: (v) => v === 70 ? "OB" : v === 30 ? "OS" : v,
            },
            grid: { color: "#1e293b" },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0f172a",
            bodyColor: "#a78bfa",
            callbacks: { label: (c) => `RSI: ${Number(c.raw.y).toFixed(1)}` },
          },
        },
      },
    })

    return () => chartRef.current?.destroy()
  }, [analytics])

  return (
    <div>
      <div style={{ fontSize: "0.7rem", color: "#475569", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>
        RSI (14) — Daily
      </div>
      <div style={{ height: "120px" }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}