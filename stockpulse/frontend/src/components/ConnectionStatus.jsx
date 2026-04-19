/**
 * ConnectionStatus — top-right badge showing WS state.
 */

export default function ConnectionStatus({ status }) {
  const map = {
    connecting: { color: "#f59e0b", label: "Connecting…", glow: "#f59e0b" },
    connected:  { color: "#22c55e", label: "Live",         glow: "#22c55e" },
    reconnecting: { color: "#f59e0b", label: "Reconnecting", glow: "#f59e0b" },
    disconnected: { color: "#ef4444", label: "Offline",     glow: "#ef4444" },
  }
  const s = map[status] || map.disconnected

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <div style={{
        width: "7px", height: "7px", borderRadius: "50%",
        background: s.color,
        boxShadow: `0 0 6px ${s.glow}`,
        animation: status === "connected" ? "pulse 2s infinite" : "none",
      }} />
      <span style={{ fontSize: "0.72rem", color: s.color, fontFamily: "'Space Mono', monospace", letterSpacing: "0.05em" }}>
        {s.label}
      </span>
    </div>
  )
}
