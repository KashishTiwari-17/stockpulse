/**
 * Global state — Zustand stores
 *
 * portfolioStore  — watchlist tickers + live prices
 * alertStore      — user-defined price alerts
 * notificationStore — triggered alert toasts
 */

import { create } from "zustand"
import { persist } from "zustand/middleware"

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1"

// ── Portfolio ─────────────────────────────────────────────────────────────────
export const usePortfolioStore = create(
  persist(
    (set, get) => ({
      watchlist: ["AAPL", "TSLA", "MSFT", "NVDA"],
      prices: {},          // ticker → { price, change, change_pct }

      addTicker: (ticker) =>
        set((s) => ({
          watchlist: [...new Set([...s.watchlist, ticker.toUpperCase()])]
        })),

      removeTicker: (ticker) =>
        set((s) => ({
          watchlist: s.watchlist.filter((t) => t !== ticker)
        })),

      updatePrice: (ticker, data) =>
        set((s) => ({ prices: { ...s.prices, [ticker]: data } })),

      fetchPortfolio: async () => {
        const tickers = get().watchlist.join(",")
        if (!tickers) return
        try {
          const res = await fetch(`${API}/portfolio?tickers=${tickers}`)
          const json = await res.json()
          const next = {}
          for (const item of json.portfolio) {
            if (!item.error) next[item.ticker] = { price: item.price }
          }
          set((s) => ({ prices: { ...s.prices, ...next } }))
        } catch (e) {
          console.error("Portfolio fetch failed", e)
        }
      },
    }),
    { name: "stockpulse-portfolio" }
  )
)

// ── Alerts ────────────────────────────────────────────────────────────────────
export const useAlertStore = create(
  persist(
    (set) => ({
      alerts: [],

      fetchAlerts: async () => {
        try {
          const res = await fetch(`${API}/alerts`)
          const alerts = await res.json()
          set({ alerts })
        } catch (e) {
          console.error("Alert fetch failed", e)
        }
      },

      addAlert: async (ticker, threshold, direction) => {
        try {
          const res = await fetch(`${API}/alerts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticker, threshold, direction }),
          })
          const alert = await res.json()
          set((s) => ({ alerts: [alert, ...s.alerts] }))
          return alert
        } catch (e) {
          console.error("Add alert failed", e)
        }
      },
    }),
    { name: "stockpulse-alerts" }
  )
)

// ── Notifications ─────────────────────────────────────────────────────────────
export const useNotificationStore = create((set) => ({
  notifications: [],

  push: (msg) =>
    set((s) => ({
      notifications: [
        { id: Date.now(), ...msg },
        ...s.notifications.slice(0, 19),
      ],
    })),

  dismiss: (id) =>
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
    })),
}))
