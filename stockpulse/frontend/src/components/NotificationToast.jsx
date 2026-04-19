/**
 * NotificationToast — overlay toasts for triggered alerts.
 * Auto-dismiss after 6 s, max 4 visible at once.
 */

import { useEffect } from "react"
import { useNotificationStore } from "../store"

export default function NotificationToast() {
  const { notifications, dismiss } = useNotificationStore()
  const visible = notifications.slice(0, 4)

  useEffect(() => {
    if (visible.length === 0) return
    const id = visible[0].id
    const t = setTimeout(() => dismiss(id), 6000)
    return () => clearTimeout(t)
  }, [visible.length])

  if (visible.length === 0) return null

  return (
    <div style={{
      position: "fixed", bottom: "24px", right: "24px",
      display: "flex", flexDirection: "column", gap: "10px",
      zIndex: 9999,
    }}>
      {visible.map((n) => (
        <div
          key={n.id}
          style={{
            background: "#0f172a",
            border: "1px solid #f59e0b44",
            borderLeft: "3px solid #f59e0b",
            borderRadius: "10px",
            padding: "14px 18px",
            minWidth: "280px",
            maxWidth: "340px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "12px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            animation: "slideIn 0.2s ease",
          }}
        >
          <div>
            <div style={{ fontSize: "0.7rem", color: "#f59e0b", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>
              🚨 Price Alert
            </div>
            <div style={{ fontSize: "0.85rem", color: "#e2e8f0" }}>{n.message}</div>
          </div>
          <button
            onClick={() => dismiss(n.id)}
            style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: "1.1rem" }}
          >×</button>
        </div>
      ))}
    </div>
  )
}
