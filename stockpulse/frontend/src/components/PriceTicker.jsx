/**
 * PriceTicker — animated top bar showing live ticker price,
 * change, and a sparkline pulse indicator.
 */

import { useState, useEffect } from "react"

export default function PriceTicker({ ticker, price, change, changePct, volume }) {
  const [flash, setFlash] = useState(null) // "up" | "down" | null

  useEffect(() => {
    if (change === undefined) return
    setFlash(change >= 0 ? "up" : "down")
    const t = setTimeout(() => setFlash(null), 600)
    return () => clearTimeout(t)
  }, [price])

  const isUp = change >= 0
  const color = isUp ? "#22c55e" : "#ef4444"
  const bg = isUp ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)"
  const flashBg = flash === "up" ? "rgba(34,197,94,0.18)" : flash === "down" ? "rgba(239,68,68,0.18)" : bg

  return (
    <div style={{
      background: flashBg,
      border: `1px solid ${color}33`,
      borderRadius: "12px",
      padding: "16px 24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      transition: "background 0.3s ease",
      gap: "32px",
      flexWrap: "wrap",
    }}>
      {/* Ticker name */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{
          width: "8px", height: "8px", borderRadius: "50%",
          background: "#22c55e",
          boxShadow: "0 0 6px #22c55e",
          animation: "pulse 2s infinite",
        }} />
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "1.1rem", color: "#94a3b8", letterSpacing: "0.1em" }}>
          {ticker}
        </span>
      </div>

      {/* Price */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "0.7rem", color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>Price</div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "1.8rem", fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.02em" }}>
          ${price?.toFixed(2) ?? "—"}
        </div>
      </div>

      {/* Change */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "0.7rem", color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>Change</div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "1.1rem", color, fontWeight: 600 }}>
          {change >= 0 ? "+" : ""}{change?.toFixed(2) ?? "—"}
        </div>
      </div>

      {/* % Change */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "0.7rem", color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>% Change</div>
        <div style={{
          fontFamily: "'Space Mono', monospace", fontSize: "1.1rem", fontWeight: 600,
          background: color + "22", color, padding: "2px 10px", borderRadius: "6px",
        }}>
          {isUp ? "▲" : "▼"} {Math.abs(changePct)?.toFixed(2) ?? "—"}%
        </div>
      </div>

      {/* Volume */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "0.7rem", color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>Volume</div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "1rem", color: "#64748b" }}>
          {volume ? (volume >= 1e6 ? `${(volume / 1e6).toFixed(2)}M` : volume.toLocaleString()) : "—"}
        </div>
      </div>
    </div>
  )
}
