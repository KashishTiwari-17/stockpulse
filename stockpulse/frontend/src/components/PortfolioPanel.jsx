/**
 * PortfolioPanel — watchlist sidebar with live prices.
 * Add / remove tickers, click to switch active chart.
 */

import { useState, useEffect } from "react"
import { usePortfolioStore } from "../store"

export default function PortfolioPanel({ activeTicker, onSelect }) {
  const { watchlist, prices, addTicker, removeTicker, fetchPortfolio, updatePrice } = usePortfolioStore()
  const [input, setInput] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    fetchPortfolio()
    const id = setInterval(fetchPortfolio, 30_000)
    return () => clearInterval(id)
  }, [watchlist.join(",")])

  const handleAdd = () => {
    const t = input.trim().toUpperCase()
    if (!t) return
    if (t.length > 10) { setError("Too long"); return }
    if (watchlist.includes(t)) { setError("Already watching"); return }
    addTicker(t)
    setInput("")
    setError("")
  }

  return (
    <aside style={{
      width: "220px",
      flexShrink: 0,
      background: "#0a0f1a",
      borderRight: "1px solid #1e293b",
      display: "flex",
      flexDirection: "column",
      height: "100%",
    }}>
      {/* Header */}
      <div style={{ padding: "20px 16px 12px", borderBottom: "1px solid #1e293b" }}>
        <div style={{ fontSize: "0.65rem", color: "#475569", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "12px" }}>
          Watchlist
        </div>

        {/* Add ticker input */}
        <div style={{ display: "flex", gap: "6px" }}>
          <input
            value={input}
            onChange={(e) => { setInput(e.target.value.toUpperCase()); setError("") }}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="GOOG"
            maxLength={10}
            style={{
              flex: 1, background: "#111827", border: "1px solid #1e293b",
              borderRadius: "6px", padding: "6px 8px",
              color: "#f1f5f9", fontSize: "0.8rem",
              fontFamily: "'Space Mono', monospace",
              outline: "none",
            }}
          />
          <button
            onClick={handleAdd}
            style={{
              background: "#1d4ed8", border: "none", borderRadius: "6px",
              color: "white", padding: "6px 10px", cursor: "pointer",
              fontSize: "0.85rem", fontWeight: 700,
            }}
          >+</button>
        </div>
        {error && <div style={{ color: "#ef4444", fontSize: "0.7rem", marginTop: "4px" }}>{error}</div>}
      </div>

      {/* Ticker list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {watchlist.map((ticker) => {
          const data = prices[ticker]
          const isActive = ticker === activeTicker
          const isUp = (data?.change ?? 0) >= 0

          return (
            <div
              key={ticker}
              onClick={() => onSelect(ticker)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 16px", cursor: "pointer",
                background: isActive ? "#1e293b" : "transparent",
                borderLeft: isActive ? "2px solid #3b82f6" : "2px solid transparent",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "#111827" }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent" }}
            >
              <div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "0.85rem", color: "#f1f5f9", fontWeight: 600 }}>
                  {ticker}
                </div>
                {data?.price && (
                  <div style={{ fontSize: "0.7rem", color: isUp ? "#22c55e" : "#ef4444", marginTop: "2px" }}>
                    ${data.price.toFixed(2)}
                  </div>
                )}
              </div>

              <button
                onClick={(e) => { e.stopPropagation(); removeTicker(ticker) }}
                style={{
                  background: "none", border: "none", color: "#334155",
                  cursor: "pointer", fontSize: "1rem", lineHeight: 1,
                  padding: "2px",
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = "#ef4444"}
                onMouseLeave={(e) => e.currentTarget.style.color = "#334155"}
              >×</button>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
