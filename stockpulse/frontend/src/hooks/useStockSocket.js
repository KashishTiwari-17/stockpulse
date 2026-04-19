/**
 * useStockSocket — manages a WebSocket connection to a single ticker.
 *
 * FIX: Uses a relative WebSocket URL (ws://localhost:5173/ws/...) so that
 *      Vite's dev-server proxy handles the upgrade, avoiding CORS failures
 *      when connecting directly to the backend on port 8000.
 *
 * Features:
 *  • Auto-reconnect with exponential backoff (max 30 s)
 *  • History seeding on connect
 *  • Publishes candle / alert / error messages via callbacks
 *  • Heartbeat ping every 20 s to keep connection alive
 */

import { useEffect, useRef, useCallback } from "react"

const MAX_BACKOFF = 30_000

// Derive the WS base from the current page origin so it works in dev
// (Vite proxy on :5173) and in production (same host) without any env var.
function getWsBase() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}`
}

export function useStockSocket({ ticker, onCandle, onHistory, onAlert, onError }) {
  const wsRef      = useRef(null)
  const backoffRef = useRef(1_000)
  const pingRef    = useRef(null)
  const mountedRef = useRef(true)

  const connect = useCallback(() => {
    if (!mountedRef.current || !ticker) return

    const url = `${getWsBase()}/ws/${ticker.toUpperCase()}`
    console.log("Connecting to WS:", url)

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      console.log("WS connected:", ticker)
      backoffRef.current = 1_000
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("ping")
      }, 20_000)
    }

    ws.onmessage = ({ data }) => {
      if (data === "pong") return          // heartbeat reply
      try {
        const msg = JSON.parse(data)
        switch (msg.type) {
          case "candle":  onCandle?.(msg.data);          break
          case "history": onHistory?.(msg.data.candles); break
          case "alert":   onAlert?.(msg.data);           break
          case "error":   onError?.(msg.data.message);   break
          default: break
        }
      } catch (e) {
        console.error("WS parse error", e)
      }
    }

    ws.onerror = (ev) => {
      console.error("WS error", ev)
      onError?.("WebSocket connection error")
    }

    ws.onclose = () => {
      clearInterval(pingRef.current)
      if (!mountedRef.current) return
      const delay = Math.min(backoffRef.current, MAX_BACKOFF)
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF)
      console.log(`WS closed — reconnecting in ${delay}ms`)
      setTimeout(connect, delay)
    }
  }, [ticker, onCandle, onHistory, onAlert, onError])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      clearInterval(pingRef.current)
      wsRef.current?.close()
    }
  }, [connect])
}