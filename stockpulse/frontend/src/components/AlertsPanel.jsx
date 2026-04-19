/**
 * AlertsPanel — create and view price alerts.
 * Direction: above / below a threshold price.
 */

import { useState, useEffect } from "react"
import { useAlertStore } from "../store"

export default function AlertsPanel({ currentTicker, currentPrice }) {
  const { alerts, fetchAlerts, addAlert } = useAlertStore()
  const [ticker, setTicker] = useState(currentTicker || "")
  const [threshold, setThreshold] = useState("")
  const [direction, setDirection] = useState("above")
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState("")

  useEffect(() => { fetchAlerts() }, [])
  useEffect(() => { setTicker(currentTicker || "") }, [currentTicker])
  useEffect(() => { if (currentPrice) setThreshold(currentPrice.toFixed(2)) }, [currentPrice])

  const handleAdd = async () => {
    if (!ticker || !threshold) return
    setAdding(true)
    await addAlert(ticker.toUpperCase(), parseFloat(threshold), direction)
    setMsg(`✓ Alert set for ${ticker.toUpperCase()} ${direction} $${threshold}`)
    setTimeout(() => setMsg(""), 3000)
    setAdding(false)
  }

  const active = alerts.filter((a) => !a.triggered)
  const triggered = alerts.filter((a) => a.triggered)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* Create alert form */}
      <div style={{
        background: "#0a0f1a", border: "1px solid #1e293b",
        borderRadius: "12px", padding: "20px",
      }}>
        <div style={{ fontSize: "0.7rem", color: "#475569", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "16px" }}>
          New Alert
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
          <div>
            <label style={{ fontSize: "0.7rem", color: "#64748b", display: "block", marginBottom: "4px" }}>Ticker</label>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="AAPL"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ fontSize: "0.7rem", color: "#64748b", display: "block", marginBottom: "4px" }}>Price ($)</label>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="0.00"
              step="0.01"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Direction toggle */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
          {["above", "below"].map((d) => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              style={{
                flex: 1, padding: "8px", border: "1px solid",
                borderColor: direction === d ? (d === "above" ? "#22c55e" : "#ef4444") : "#1e293b",
                borderRadius: "8px", cursor: "pointer", fontSize: "0.8rem",
                color: direction === d ? (d === "above" ? "#22c55e" : "#ef4444") : "#475569",
                background: direction === d ? (d === "above" ? "#22c55e11" : "#ef444411") : "transparent",
                transition: "all 0.15s",
              }}
            >
              {d === "above" ? "▲ Above" : "▼ Below"}
            </button>
          ))}
        </div>

        <button
          onClick={handleAdd}
          disabled={adding || !ticker || !threshold}
          style={{
            width: "100%", padding: "10px", background: adding ? "#1e3a8a" : "#1d4ed8",
            border: "none", borderRadius: "8px", color: "white",
            cursor: adding ? "not-allowed" : "pointer", fontSize: "0.85rem", fontWeight: 600,
            transition: "background 0.2s",
          }}
        >
          {adding ? "Setting…" : "Set Alert"}
        </button>

        {msg && <div style={{ color: "#22c55e", fontSize: "0.78rem", marginTop: "8px", textAlign: "center" }}>{msg}</div>}
      </div>

      {/* Active alerts */}
      {active.length > 0 && (
        <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: "12px", padding: "16px" }}>
          <div style={{ fontSize: "0.7rem", color: "#475569", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" }}>
            Active ({active.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {active.map((a) => (
              <div key={a.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 10px", background: "#111827", borderRadius: "8px",
              }}>
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "0.8rem", color: "#94a3b8" }}>
                  {a.ticker}
                </span>
                <span style={{ fontSize: "0.75rem", color: a.direction === "above" ? "#22c55e" : "#ef4444" }}>
                  {a.direction === "above" ? "▲" : "▼"} ${a.threshold.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Triggered alerts */}
      {triggered.length > 0 && (
        <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: "12px", padding: "16px" }}>
          <div style={{ fontSize: "0.7rem", color: "#475569", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" }}>
            Triggered
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {triggered.slice(0, 5).map((a) => (
              <div key={a.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 10px", background: "#111827", borderRadius: "8px", opacity: 0.5,
              }}>
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "0.8rem", color: "#64748b" }}>
                  {a.ticker}
                </span>
                <span style={{ fontSize: "0.75rem", color: "#475569" }}>
                  {a.direction === "above" ? "▲" : "▼"} ${a.threshold.toFixed(2)} ✓
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const inputStyle = {
  width: "100%", background: "#111827", border: "1px solid #1e293b",
  borderRadius: "8px", padding: "8px 10px",
  color: "#f1f5f9", fontSize: "0.85rem",
  fontFamily: "'Space Mono', monospace",
  outline: "none", boxSizing: "border-box",
}
