/**
 * useStockSocket — single stable WebSocket per ticker.
 *
 * CHANGES vs previous version:
 *  • Adds onOpen callback — called as soon as the socket handshake completes,
 *    so the Dashboard can flip wsStatus to "connected" immediately without
 *    waiting for the first candle/history message (which can take 5–10s).
 *  • All callbacks (onOpen, onCandle, onHistory, onAlert, onError) are stored
 *    in refs so they are always current but NEVER trigger a reconnect.
 *  • Effect depends only on [ticker] — no callback in the dep array.
 *  • Guard prevents opening a second socket if one is already connecting/open.
 */

import { useEffect, useRef } from "react"

const MAX_BACKOFF = 30_000

function getWsBase() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}`
}

export function useStockSocket({ ticker, onOpen, onCandle, onHistory, onAlert, onError }) {
  // Stable refs — always current, never cause reconnect
  const cbOpen    = useRef(onOpen)
  const cbCandle  = useRef(onCandle)
  const cbHistory = useRef(onHistory)
  const cbAlert   = useRef(onAlert)
  const cbError   = useRef(onError)
  useEffect(() => { cbOpen.current    = onOpen    }, [onOpen])
  useEffect(() => { cbCandle.current  = onCandle  }, [onCandle])
  useEffect(() => { cbHistory.current = onHistory }, [onHistory])
  useEffect(() => { cbAlert.current   = onAlert   }, [onAlert])
  useEffect(() => { cbError.current   = onError   }, [onError])

  const wsRef      = useRef(null)
  const pingRef    = useRef(null)
  const backoffRef = useRef(1_000)
  const mountedRef = useRef(false)
  const tickerRef  = useRef(null)

  useEffect(() => {
    if (!ticker) return

    mountedRef.current = true
    tickerRef.current  = ticker
    backoffRef.current = 1_000

    function cleanup(noReconnect = false) {
      clearInterval(pingRef.current)
      const ws = wsRef.current
      if (ws) {
        ws._noReconnect = noReconnect
        ws.onclose = null
        if (ws.readyState < WebSocket.CLOSING) ws.close()
        wsRef.current = null
      }
    }

    function connect() {
      // Don't open a second socket if one is already alive
      const existing = wsRef.current
      if (existing && existing.readyState <= WebSocket.OPEN) return

      const t   = ticker
      const url = `${getWsBase()}/ws/${t.toUpperCase()}`
      console.log("[WS] connecting:", url)

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (tickerRef.current !== t) { ws.close(); return }
        console.log("[WS] connected:", t)
        backoffRef.current = 1_000
        clearInterval(pingRef.current)
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("ping")
        }, 20_000)
        // ← Notify Dashboard immediately so status badge flips to "connected"
        cbOpen.current?.()
      }

      ws.onmessage = ({ data }) => {
        if (data === "pong") return
        try {
          const msg = JSON.parse(data)
          switch (msg.type) {
            case "candle":  cbCandle.current?.(msg.data);          break
            case "history": cbHistory.current?.(msg.data.candles); break
            case "alert":   cbAlert.current?.(msg.data);           break
            case "error":   cbError.current?.(msg.data.message);   break
            default: break
          }
        } catch (e) {
          console.error("[WS] parse error", e)
        }
      }

      ws.onerror = () => {
        cbError.current?.("WebSocket connection error")
      }

      ws.onclose = () => {
        clearInterval(pingRef.current)
        if (ws._noReconnect) return
        if (!mountedRef.current || tickerRef.current !== t) return
        const delay = backoffRef.current
        backoffRef.current = Math.min(delay * 2, MAX_BACKOFF)
        console.log(`[WS] closed — reconnecting in ${delay}ms`)
        setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      mountedRef.current = false
      cleanup(true)
    }
  }, [ticker])
}