import { useEffect, useState } from "react";
import { api } from "../services/api.js";

export default function BackendStatus() {
  const [status, setStatus] = useState({ ok: false, code: 0, time: null, error: "" });

  async function check() {
    try {
      const data = await api.get("/health");
      const ok = !!data && (data.ok === true || data.code === 200);
      setStatus({ ok, code: Number(data?.code || (ok ? 200 : 0)), time: new Date(), error: "" });
    } catch (e) {
      setStatus({ ok: false, code: 0, time: new Date(), error: String(e?.message || e) });
    }
  }

  useEffect(() => {
    check();
    const id = setInterval(check, 10000);
    return () => clearInterval(id);
  }, []);

  const baseStyle = {
    position: "fixed",
    right: 8,
    bottom: 8,
    zIndex: 1000,
    padding: "6px 10px",
    borderRadius: 6,
    fontSize: 12,
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    background: status.ok ? "#e6ffed" : "#ffecec",
    color: status.ok ? "#0f5132" : "#842029",
    border: `1px solid ${status.ok ? "#b7ffd3" : "#ffb3b3"}`,
  };

  const dotStyle = {
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: "50%",
    marginRight: 6,
    background: status.ok ? "#28a745" : "#dc3545",
  };

  const timeStr = status.time ? new Date(status.time).toLocaleTimeString() : "";

  return (
    <div style={baseStyle}>
      <span style={dotStyle}></span>
      <span>{status.ok ? `API ${status.code}` : `API DOWN`}</span>
      <span style={{ marginLeft: 8 }}>{timeStr}</span>
    </div>
  );
}