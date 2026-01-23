import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n.jsx";
import { colors, marketThemes, radius, typography, animation, shadows, glassCard, badge as badgeStyle } from "../styles/tokens.js";

// ═══════════════════════════════════════════════════════════════════════════
// Welcome Page - TradingView / Bloomberg Style
// ═══════════════════════════════════════════════════════════════════════════

export default function Onboarding() {
  const { lang } = useI18n();
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(0);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [entered, setEntered] = useState(false);
  const containerRef = useRef(null);

  const totalPages = 4;
  const minSwipeDistance = 50;

  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    setEntered(false);
    const t = setTimeout(() => setEntered(true), 30);
    return () => clearTimeout(t);
  }, [currentPage]);

  // 内容配置
  const pages = [
    {
      theme: marketThemes.poland,
      badge: "GPW · WSE",
      icon: "🇵🇱",
      title: lang === "zh" ? "波兰市场" : lang === "en" ? "Polish Market" : "Rynek Polski",
      subtitle: lang === "zh" ? "监管合规 · 本币结算 · 极速执行" : lang === "en" ? "Regulated · PLN Native · Fast Execution" : "Regulowany · PLN · Szybka Realizacja",
      features: [
        lang === "zh" ? "10ms 执行" : lang === "en" ? "10ms Execution" : "10ms Realizacja",
        lang === "zh" ? "KNF 监管" : lang === "en" ? "KNF Regulated" : "Regulacja KNF",
        lang === "zh" ? "PLN 结算" : lang === "en" ? "PLN Settlement" : "Rozliczenie PLN",
      ],
    },
    {
      theme: marketThemes.usa,
      badge: "NASDAQ · NYSE",
      icon: "🇺🇸",
      title: lang === "zh" ? "美国市场" : lang === "en" ? "US Market" : "Rynek USA",
      subtitle: lang === "zh" ? "专业图表 · 深度数据 · 直连交易所" : lang === "en" ? "Pro Charts · L2 Data · Direct Access" : "Wykresy Pro · Dane L2 · Bezpośredni Dostęp",
      features: [
        "TradingView",
        lang === "zh" ? "Level 2 数据" : lang === "en" ? "Level 2 Data" : "Dane Level 2",
        lang === "zh" ? "直连交易所" : lang === "en" ? "Direct Access" : "Bezpośredni Dostęp",
      ],
    },
    {
      theme: marketThemes.crypto,
      badge: "BTC · ETH · SOL",
      icon: "₿",
      title: lang === "zh" ? "数字资产" : lang === "en" ? "Digital Assets" : "Aktywa Cyfrowe",
      subtitle: lang === "zh" ? "冷存储 · 零佣金 · 全天候" : lang === "en" ? "Cold Storage · Zero Fees · 24/7" : "Cold Storage · Zero Opłat · 24/7",
      features: [
        lang === "zh" ? "冷存储" : lang === "en" ? "Cold Storage" : "Cold Storage",
        lang === "zh" ? "零佣金" : lang === "en" ? "Zero Fees" : "Zero Opłat",
        "24/7",
      ],
    },
  ];

  const ctaContent = {
    theme: marketThemes.cta,
    badge: "START",
    icon: "🚀",
    title: lang === "zh" ? "开始交易" : lang === "en" ? "Start Trading" : "Zacznij Handlować",
    subtitle: lang === "zh" ? "加入专业投资者社区" : lang === "en" ? "Join professional investors" : "Dołącz do profesjonalnych inwestorów",
    register: lang === "zh" ? "创建账户" : lang === "en" ? "Create Account" : "Utwórz Konto",
    login: lang === "zh" ? "登录" : lang === "en" ? "Log In" : "Zaloguj się",
    skip: lang === "zh" ? "浏览市场" : lang === "en" ? "Browse Markets" : "Przeglądaj Rynki",
  };

  const swipeText = lang === "zh" ? "滑动" : lang === "en" ? "Swipe" : "Przesuń";

  // Handlers
  const markAsSeen = () => { try { localStorage.setItem("onboarding:seen", "1"); } catch {} };
  const goToPage = (i) => setCurrentPage(Math.max(0, Math.min(totalPages - 1, i)));
  const nextPage = () => currentPage < totalPages - 1 && setCurrentPage(currentPage + 1);
  const prevPage = () => currentPage > 0 && setCurrentPage(currentPage - 1);

  const onTouchStart = (e) => { setTouchEnd(null); setTouchStart(e.targetTouches[0].clientX); setIsDragging(true); };
  const onTouchMove = (e) => {
    if (!isDragging || touchStart === null) return;
    const curr = e.targetTouches[0].clientX;
    setTouchEnd(curr);
    setDragOffset(Math.max(-120, Math.min(120, curr - touchStart)));
  };
  const onTouchEnd = () => {
    setIsDragging(false); setDragOffset(0);
    if (touchStart && touchEnd) {
      const dist = touchStart - touchEnd;
      if (dist > minSwipeDistance) nextPage();
      else if (dist < -minSwipeDistance) prevPage();
    }
  };

  const onMouseDown = (e) => { setTouchEnd(null); setTouchStart(e.clientX); setIsDragging(true); };
  const onMouseMove = (e) => {
    if (!isDragging || touchStart === null) return;
    setTouchEnd(e.clientX);
    setDragOffset(Math.max(-120, Math.min(120, e.clientX - touchStart)));
  };
  const onMouseUp = () => onTouchEnd();
  const onMouseLeave = () => isDragging && onTouchEnd();

  useEffect(() => {
    const h = (e) => { if (e.key === "ArrowRight") nextPage(); if (e.key === "ArrowLeft") prevPage(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [currentPage]);

  const handleRegister = () => { markAsSeen(); navigate("/register"); };
  const handleLogin = () => { markAsSeen(); navigate("/login"); };
  const handleSkip = () => { markAsSeen(); navigate("/home"); };

  const translateX = -currentPage * 100 + (dragOffset / (typeof window !== "undefined" ? window.innerWidth : 1)) * 100;
  const currentTheme = currentPage < 3 ? pages[currentPage].theme : ctaContent.theme;

  const getAnimStyle = (delay = 0) => ({
    opacity: entered ? 1 : 0,
    transform: entered ? "translateY(0)" : "translateY(16px)",
    transition: `all ${animation.duration.slow} ${animation.easing.default}`,
    transitionDelay: `${delay}ms`,
  });

  return (
    <div 
      ref={containerRef}
      style={styles.container}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
    >
      {/* 背景层 */}
      <div style={styles.bgBase} />
      <div style={styles.bgNoise} />
      <div style={{ ...styles.bgGlow, boxShadow: `0 -200px 400px 100px ${currentTheme.glow}`, transition: `box-shadow ${animation.duration.slow} ease` }} />

      {/* 页面容器 */}
      <div style={{ ...styles.pagesWrapper, transform: `translateX(${translateX}%)`, transition: isDragging ? "none" : `transform ${animation.duration.slow} ${animation.easing.default}` }}>
        
        {/* 市场页 */}
        {pages.map((page, idx) => (
          <div key={page.theme.id} style={styles.page}>
            <div style={styles.pageContent}>
              
              {/* Badge */}
              <div style={{ ...styles.badge, ...getAnimStyle(0), boxShadow: shadows.glow(page.theme.glow) }}>
                <span style={{ ...styles.badgeDot, background: page.theme.accent, boxShadow: `0 0 6px ${page.theme.accent}` }} />
                <span style={styles.badgeLabel}>{page.badge}</span>
              </div>

              {/* Icon */}
              <div style={{ ...styles.iconBox, ...getAnimStyle(40) }}>
                <span style={styles.icon}>{page.icon}</span>
                <div style={{ ...styles.iconRing, borderColor: `${page.theme.accent}30` }} />
            </div>

              {/* Typography */}
              <h1 style={{ ...styles.title, ...getAnimStyle(80) }}>{page.title}</h1>
              <p style={{ ...styles.subtitle, ...getAnimStyle(100) }}>{page.subtitle}</p>

              {/* Features */}
              <div style={{ ...styles.featuresRow, ...getAnimStyle(140) }}>
                {page.features.map((f, i) => (
                  <div key={i} style={{ ...styles.featureChip, borderColor: currentPage === idx ? `${page.theme.accent}25` : colors.glass.border }}>
                    <span style={styles.featureLabel}>{f}</span>
                  </div>
                ))}
                </div>

              {/* Accent Line */}
              <div style={{ ...styles.accentLine, background: `linear-gradient(90deg, transparent, ${page.theme.accent}40, transparent)`, ...getAnimStyle(180) }} />
            </div>
          </div>
        ))}

        {/* CTA 页 */}
        <div style={styles.page}>
          <div style={styles.pageContent}>
            
            <div style={{ ...styles.badge, ...getAnimStyle(0), boxShadow: shadows.glow(ctaContent.theme.glow) }}>
              <span style={{ ...styles.badgeDot, background: ctaContent.theme.accent, boxShadow: `0 0 6px ${ctaContent.theme.accent}` }} />
              <span style={styles.badgeLabel}>{ctaContent.badge}</span>
            </div>

            <div style={{ ...styles.iconBox, ...getAnimStyle(40) }}>
              <span style={styles.icon}>{ctaContent.icon}</span>
              <div style={{ ...styles.iconRing, borderColor: `${ctaContent.theme.accent}30` }} />
            </div>

            <h1 style={{ ...styles.title, ...getAnimStyle(80) }}>{ctaContent.title}</h1>
            <p style={{ ...styles.subtitle, ...getAnimStyle(100) }}>{ctaContent.subtitle}</p>

            {/* CTA Buttons */}
            <div style={{ ...styles.ctaGroup, ...getAnimStyle(160) }}>
              <button style={styles.primaryBtn} onClick={handleRegister}>
                <span style={styles.btnShine} />
                <span style={styles.btnText}>{ctaContent.register}</span>
              </button>
              <button style={styles.secondaryBtn} onClick={handleLogin}>
                {ctaContent.login}
              </button>
              <button style={styles.ghostBtn} onClick={handleSkip}>
                {ctaContent.skip} →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 底部导航 */}
      <div style={styles.footer}>
        {currentPage < 3 && <p style={styles.swipeHint}>{swipeText} →</p>}
        <div style={styles.progress}>
          {[0, 1, 2, 3].map((i) => {
            const t = i < 3 ? pages[i].theme : ctaContent.theme;
            const active = i === currentPage;
            return (
              <button
                key={i}
                onClick={() => goToPage(i)}
              style={{
                ...styles.dot,
                  width: active ? 24 : 6,
                  background: active ? t.accent : colors.text.muted,
                  boxShadow: active ? `0 0 10px ${t.glow}` : "none",
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════
const styles = {
  container: {
    position: "fixed",
    inset: 0,
    overflow: "hidden",
    touchAction: "pan-x",
    userSelect: "none",
    fontFamily: typography.fontFamily,
  },
  bgBase: {
    position: "absolute",
    inset: 0,
    background: `linear-gradient(180deg, ${colors.bg.primary} 0%, ${colors.bg.secondary} 50%, ${colors.bg.primary} 100%)`,
  },
  bgNoise: {
    position: "absolute",
    inset: 0,
    opacity: 0.02,
    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
    pointerEvents: "none",
  },
  bgGlow: {
    position: "absolute",
    top: 0,
    left: "50%",
    transform: "translateX(-50%)",
    width: "100%",
    height: "50%",
    pointerEvents: "none",
  },
  pagesWrapper: {
    display: "flex",
    height: "100%",
    willChange: "transform",
  },
  page: {
    minWidth: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 24px",
    boxSizing: "border-box",
  },
  pageContent: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 14,
    width: "100%",
    maxWidth: 360,
    paddingBottom: 80,
  },
  // Badge
  badge: {
    ...badgeStyle,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  badgeDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
  },
  badgeLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    color: colors.text.secondary,
    letterSpacing: "1px",
  },
  // Icon
  iconBox: {
    position: "relative",
    width: 80,
    height: 80,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  icon: {
    fontSize: 44,
    position: "relative",
    zIndex: 1,
  },
  iconRing: {
    position: "absolute",
    inset: 0,
    borderRadius: "50%",
    border: "1px solid",
  },
  // Typography
  title: {
    fontSize: typography.size.display,
    fontWeight: typography.weight.heavy,
    color: colors.text.primary,
    margin: 0,
    textAlign: "center",
    letterSpacing: "-0.02em",
    lineHeight: 1.1,
  },
  subtitle: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.normal,
    color: colors.text.tertiary,
    margin: 0,
    textAlign: "center",
    letterSpacing: "0.5px",
  },
  // Features
  featuresRow: {
    display: "flex",
    gap: 8,
    marginTop: 20,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  featureChip: {
    ...glassCard,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 16px",
    borderRadius: radius.full,
    transition: `all ${animation.duration.normal} ease`,
  },
  featureLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    color: colors.text.secondary,
    letterSpacing: "0.3px",
  },
  accentLine: {
    width: 60,
    height: 2,
    borderRadius: 1,
    marginTop: 24,
  },
  // CTA
  ctaGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    width: "100%",
    marginTop: 28,
  },
  primaryBtn: {
    position: "relative",
    height: 50,
    borderRadius: radius.md,
    border: "none",
    background: `linear-gradient(135deg, ${marketThemes.cta.accent} 0%, ${marketThemes.cta.accentMuted} 100%)`,
    color: "#fff",
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    cursor: "pointer",
    overflow: "hidden",
    boxShadow: `0 4px 24px ${marketThemes.cta.glow}, inset 0 1px 0 rgba(255,255,255,0.2)`,
    transition: `all ${animation.duration.fast} ease`,
  },
  btnShine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "45%",
    background: "linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 100%)",
    borderRadius: `${radius.md}px ${radius.md}px 50% 50%`,
    pointerEvents: "none",
  },
  btnText: {
    position: "relative",
    zIndex: 1,
  },
  secondaryBtn: {
    height: 46,
    borderRadius: radius.md,
    border: `1px solid ${colors.border.hover}`,
    background: colors.glass.bg,
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    color: colors.text.primary,
    fontSize: typography.size.base,
    fontWeight: typography.weight.medium,
    cursor: "pointer",
    transition: `all ${animation.duration.fast} ease`,
  },
  ghostBtn: {
    height: 40,
    borderRadius: radius.sm,
    border: "none",
    background: "transparent",
    color: colors.text.tertiary,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.normal,
    cursor: "pointer",
    transition: `all ${animation.duration.fast} ease`,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: "16px 24px 32px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    zIndex: 10,
  },
  swipeHint: {
    fontSize: typography.size.xs,
    color: colors.text.muted,
    margin: 0,
  },
  progress: {
    display: "flex",
    gap: 6,
    alignItems: "center",
  },
  dot: {
    height: 6,
    borderRadius: 3,
    border: "none",
    cursor: "pointer",
    padding: 0,
    transition: `all ${animation.duration.normal} ${animation.easing.default}`,
  },
};

// Hover styles
if (typeof document !== "undefined" && !document.querySelector('style[data-onboarding-hover]')) {
  const s = document.createElement("style");
  s.setAttribute("data-onboarding-hover", "true");
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  `;
  document.head.appendChild(s);
}
