import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import BottomNav from "../components/BottomNav.jsx";
import { useI18n } from "../i18n.jsx";
import { getQuotes, getCryptoQuotes, getUsdPlnRate } from "../services/marketData.js";

export default function Symbol() {
  const { symbol } = useParams();
  const { t, lang } = useI18n();
  const navigate = useNavigate();

  const [market, setMarket] = useState("us");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [cryptoCurrency, setCryptoCurrency] = useState(() => {
    try { return localStorage.getItem("marketCryptoCurrency") || "USD"; } catch { return "USD"; }
  });
  const [favorites, setFavorites] = useState(() => {
    try {
      const o = JSON.parse(localStorage.getItem("market:favorites") || "{}");
      return { pl: o.pl || [], us: o.us || [], crypto: o.crypto || [] };
    } catch { return { pl: [], us: [], crypto: [] }; }
  });

  useEffect(() => {
    try { localStorage.setItem("market:favorites", JSON.stringify(favorites)); } catch {}
  }, [favorites]);

  function detectMarket(sym) {
    if (/\.WA$/i.test(sym)) return "pl";
    if (/^[A-Z][A-Z0-9.-]{0,6}$/i.test(sym)) return "us";
    return "crypto";
  }

  

  useEffect(() => {
    const m = detectMarket(symbol || "");
    setMarket(m);
  }, [symbol]);

  useEffect(() => {
    async function run() {
      if (!symbol) return;
      setLoading(true); setError("");
      try {
        if (market === "pl" || market === "us") {
          const list = await getQuotes({ market, symbols: [symbol] });
          setDetail(list[0] || null);
        } else {
          const base = (symbol || "").toUpperCase().replace(/USDT$/i, "");
          const { rate } = await getUsdPlnRate();
          const list = await getCryptoQuotes({ symbols: [base] });
          const q = list[0];
          const d = {
            symbol: q?.symbol || base,
            name: q?.name || base,
            priceUSD: Number(q?.priceUSD || q?.price || 0),
            pricePLN: Number(q?.priceUSD || q?.price || 0) * rate,
            changePct: Number(q?.changePct || 0),
            volume: Number(q?.volume || 0),
          };
          setDetail(d);
        }
      } catch (_e) {
        setError(lang === "pl" ? "No se pudo obtener datos" : "Failed to fetch data");
      } finally { setLoading(false); }
    }
    run();
  }, [symbol, market, lang]);

  function toggleFavorite(sym) {
    setFavorites(prev => {
      const arr = prev[market] || [];
      const exists = arr.includes(sym);
      const next = exists ? arr.filter(s => s !== sym) : [sym, ...arr].slice(0, 20);
      return { ...prev, [market]: next };
    });
  }

  const detailsUrl = useMemo(() => {
    if (!detail && !symbol) return "";
    const s = detail?.symbol || symbol;
    if (market === "pl" || market === "us") return `https://finance.yahoo.com/quote/${encodeURIComponent(s)}`;
    return `https://www.binance.com/en/trade/${encodeURIComponent(s)}_USDT?theme=dark`;
  }, [detail, symbol, market]);

  const isFav = (favorites[market] || []).includes((detail?.symbol || symbol || ""));
  const debugEnabled = (() => {
    try {
      const dev = !!import.meta.env?.DEV;
      const ls = String(localStorage.getItem("debug:market") || "").trim() === "1";
      return dev || ls;
    } catch { return true; }
  })();

  return (
    <div className="screen" style={{ alignItems: 'stretch', justifyContent: 'flex-start', padding: 0, width: '100%', maxWidth: '100%' }}>
      <div style={{ width: '100%', padding: '16px', boxSizing: 'border-box', paddingBottom: 100 }}>
        <h1 className="title" style={{ marginTop: 0 }}>{detail?.name || symbol}</h1>
        {loading ? (
          <p className="desc">Loading...</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : detail ? (
          <div>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="desc" style={{ minWidth: 100 }}>Symbol</span>
              <span className="desc">{detail.symbol}</span>
              <button className="pill pill-mini" onClick={() => toggleFavorite(detail.symbol)} aria-label="fav">
                {isFav ? "★" : "☆"}
              </button>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginTop: 8 }}>
              <span className="desc" style={{ minWidth: 100 }}>{t("price")}</span>
              {market === "crypto" ? (
                <>
                  <span className="desc">{cryptoCurrency === "PLN" ? 
                    `${new Intl.NumberFormat(lang === "pl" ? "pl-PL" : (lang === "zh" ? "zh-CN" : "en-US"), { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(detail.pricePLN || 0))} zł` :
                    new Intl.NumberFormat(lang === "pl" ? "pl-PL" : (lang === "zh" ? "zh-CN" : "en-US"), { style: "currency", currency: "USD" }).format(Number(detail.priceUSD || 0))
                  }</span>
                  <button className="pill pill-mini" onClick={() => setCryptoCurrency(c => c === "USD" ? "PLN" : "USD")}>{cryptoCurrency}</button>
                </>
              ) : (
                <span className="desc">{new Intl.NumberFormat(lang === "pl" ? "pl-PL" : (lang === "zh" ? "zh-CN" : "en-US"), { style: "currency", currency: "USD" }).format(Number(detail.price || 0))}</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginTop: 8 }}>
              <span className="desc" style={{ minWidth: 100 }}>{t("change24h")}</span>
              <span style={{ color: Number(detail.changePct || 0) > 0 ? "#5cff9b" : Number(detail.changePct || 0) < 0 ? "#ff5c7a" : "#a8b3cf" }}>{Number(detail.changePct || 0).toFixed(2)}%</span>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginTop: 8 }}>
              <span className="desc" style={{ minWidth: 100 }}>{t("volume")}</span>
              <span className="desc">{new Intl.NumberFormat(lang === "pl" ? "pl-PL" : (lang === "zh" ? "zh-CN" : "en-US"), { maximumFractionDigits: 0 }).format(Number(detail.volume || 0))}</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              {detailsUrl && (
                <a className="pill" href={detailsUrl} target="_blank" rel="noreferrer">{t("viewDetails")}</a>
              )}
              <button className="pill" onClick={() => navigate("/market")}>{lang === "pl" ? "Volver" : "Back"}</button>
            </div>
            {debugEnabled && (
              <div style={{ marginTop: 12, borderTop: "1px solid #1f2937", paddingTop: 12 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span className="desc" style={{ minWidth: 100 }}>Provider</span>
                  <span className="desc">{String(detail?.provider || "-")}</span>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginTop: 8 }}>
                  <span className="desc" style={{ minWidth: 100 }}>Exchange</span>
                  <span className="desc">{String(detail?.exchange || "-")}</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="desc" style={{ marginBottom: 12 }}>{t("detailsComing")}</p>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
