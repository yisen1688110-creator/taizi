import { useEffect, useState } from "react";

export default function VersionBadge() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/version");
        const data = await res.json();
        if (mounted) setInfo(data);
      } catch (e) {
        // ignore
      }
    })();
    return () => { mounted = false; };
  }, []);

  const display = () => {
    try {
      const v = info?.buildInfo?.version || info?.frontendVersion || info?.version || "";
      const git = info?.buildInfo?.git || info?.git || "";
      const time = info?.buildInfo?.buildTime || "";
      const hasV = !!String(v).trim();
      const hasGit = !!String(git).trim();
      const hasTime = !!String(time).trim();
      if (!hasV && !hasGit && !hasTime) return "";
      return `${hasV ? v : ""}${hasV && hasGit ? " • " : (!hasV && hasGit ? "" : "")}${hasGit ? git : ""}${hasTime ? ` @ ${time}` : ""}`;
    } catch {
      return "";
    }
  };

  return (
    display() ? (
      <div style={{ position: 'fixed', right: 12, bottom: 12, background: 'rgba(24,24,24,0.85)', color: '#9aa0a6', padding: '6px 10px', borderRadius: 8, fontSize: 12, zIndex: 9999 }}>
        {display()}
      </div>
    ) : null
  );
}