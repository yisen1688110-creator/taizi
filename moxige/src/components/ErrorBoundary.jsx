import React from "react";
import { LanguageContext } from "../i18n.jsx";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this._onWindowError = this._onWindowError.bind(this);
    this._onWindowRejection = this._onWindowRejection.bind(this);
  }

  // 识别并忽略 TradingView 初始化相关的非致命错误
  isBenignTradingViewError(err) {
    try {
      const raw = err?.message || err || "";
      const msg = String(raw).toLowerCase();
      // 兼容包含引号的错误信息：Cannot access 'tv' before initialization
      const tvInitTDZ = msg.includes("cannot access tv before initialization")
        || /cannot\s+access\s+['"]?tv['"]?\s+before\s+initialization/i.test(msg)
        || /cannot\s+access\s+tv\b/i.test(msg)
        // 西语等多语言匹配
        || /no\s+se\s+puede\s+acceder\s+a\s+tv\s+antes\s+de\s+la\s+inicializaci[óo]n/i.test(msg);
      // tv/TradingView 未定义类错误
      const tvUndef = /(\btv\b|tradingview)\s+is\s+not\s+defined/i.test(msg)
        || /(\btv\b|tradingview)\s+no\s+est[áa]\s+definido/i.test(msg);
      // 常见嵌入脚本与部件命名
      const mentionsTv = msg.includes("tradingview") || msg.includes("tv.js") || msg.includes("tradingview.com") || msg.includes("embed-widget") || msg.includes("symbol-overview") || msg.includes("bento");
      // 仅当与 TradingView 关联时才放宽对 widget 关键词的判断
      const widgetWithTvContext = msg.includes("widget") && (mentionsTv || /\btv\b/.test(msg));
      const tvRelated = tvInitTDZ || tvUndef || mentionsTv || widgetWithTvContext;
      return tvRelated;
    } catch (_) {
      return false;
    }
  }

  static getDerivedStateFromError(error) {
    // 对 TradingView 初始化类错误不触发全屏错误覆盖，交由子组件自行回退
    try {
      const raw = error?.message || error || "";
      const msg = String(raw).toLowerCase();
      const tvInitTDZ = msg.includes("cannot access tv before initialization")
        || /cannot\s+access\s+['"]?tv['"]?\s+before\s+initialization/i.test(msg)
        || /cannot\s+access\s+tv\b/i.test(msg)
        || /no\s+se\s+puede\s+acceder\s+a\s+tv\s+antes\s+de\s+la\s+inicializaci[óo]n/i.test(msg);
      const tvUndef = /(\btv\b|tradingview)\s+is\s+not\s+defined/i.test(msg)
        || /(\btv\b|tradingview)\s+no\s+est[áa]\s+definido/i.test(msg);
      const mentionsTv = msg.includes("tradingview") || msg.includes("tv.js") || msg.includes("tradingview.com") || msg.includes("embed-widget") || msg.includes("symbol-overview") || msg.includes("bento");
      const widgetWithTvContext = msg.includes("widget") && (mentionsTv || /\btv\b/.test(msg));
      const tvRelated = tvInitTDZ || tvUndef || mentionsTv || widgetWithTvContext;
      if (tvRelated) return null;
    } catch {}
    return { error };
  }

  componentDidCatch(error, info) {
    try {
      console.error("UI ErrorBoundary caught:", error, info);
    } catch {}
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  handleClearCacheAndReload = () => {
    try { localStorage.clear(); } catch {}
    window.location.reload();
  };

  _onWindowError(evt) {
    try {
      const raw = evt?.message || evt?.error?.message || evt?.error || "";
      if (this.isBenignTradingViewError(raw)) {
        // 忽略并阻止传播，避免全屏覆盖
        if (evt?.preventDefault) evt.preventDefault();
        if (evt?.stopPropagation) evt.stopPropagation();
        // 清理已有错误状态（如果有）
        if (this.state.error) this.setState({ error: null });
        return true;
      }
    } catch {}
    return false;
  }

  _onWindowRejection(evt) {
    try {
      const raw = evt?.reason?.message || evt?.reason || "";
      if (this.isBenignTradingViewError(raw)) {
        if (evt?.preventDefault) evt.preventDefault();
        if (evt?.stopPropagation) evt.stopPropagation();
        if (this.state.error) this.setState({ error: null });
        return true;
      }
    } catch {}
    return false;
  }

  componentDidMount() {
    try {
      window.addEventListener("error", this._onWindowError, true);
      window.addEventListener("unhandledrejection", this._onWindowRejection, true);
    } catch {}
  }

  componentWillUnmount() {
    try {
      window.removeEventListener("error", this._onWindowError, true);
      window.removeEventListener("unhandledrejection", this._onWindowRejection, true);
    } catch {}
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <LanguageContext.Consumer>
          {({ t }) => (
            <div className="screen">
              <div className="card" role="alert">
                <h1 className="title">{t("globalErrorTitle")}</h1>
                <p className="desc">{String(error?.message || error || t("errorUnknown"))}</p>
                {error?.stack && (
                  <pre style={{ marginTop: 8, maxWidth: '100%', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                    {String(error.stack).slice(0, 1200)}
                  </pre>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn" onClick={this.handleRetry}>{t("btnRetry")}</button>
                  <button className="btn" onClick={this.handleClearCacheAndReload}>{t("btnClearCacheReload")}</button>
                </div>
              </div>
            </div>
          )}
        </LanguageContext.Consumer>
      );
    }
    return this.props.children;
  }
}