import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "pbm_v4_data";
const FORCED_OVERRIDES = { "Discover 1554": 2559, "Care Credit": 805 };

const INIT_DATA = {
  income: [{ n: "Salary", v: "14000" }],
  cats: [
    { name: "Housing", icon: "\u{1F3E0}", items: [{ n: "Rent/Mortgage", v: "1985" }, { n: "Utilities", v: 150 }] },
    { name: "Food", icon: "\u{1F37D}", items: [{ n: "Groceries", v: "800" }, { n: "Dining out", v: 150 }] },
    { name: "Transport", icon: "\u{1F697}", items: [{ n: "Gas", v: 120 }, { n: "Insurance", v: "150" }, { n: "Car Payment", v: "300" }] },
    { name: "Entertainment", icon: "\u{1F3AC}", items: [{ n: "Streaming", v: 30 }, { n: "Accessories", v: "300" }] },
    { name: "Health", icon: "\u2764\uFE0F", items: [{ n: "Gym", v: 40 }] },
    { name: "Savings", icon: "\u{1F3E6}", items: [] },
    { name: "Roth IRA Contributions", icon: "\u{1F3E6}", items: [{ n: "Charles Schwab IRA", v: "300" }] },
    { name: "Child Support Payments", icon: "\u{1F3AF}", items: [{ n: "Child Support and Alimony Payments", v: "2368.23" }] },
  ],
  cards: [
    { name: "Amex Delta",    balance: 14953.77, limit: 16400, minPay: 412,    apr: 18.74, due: "April 8",   notes: "" },
    { name: "Amex Cash",     balance: 0,        limit: 2100,  minPay: 50,     apr: 26.49, due: "Apr 21",   notes: "" },
    { name: "Citi 7805",     balance: 8266.25,  limit: 14500, minPay: 197.53, apr: 21.49, due: "April 23", notes: "" },
    { name: "Citi 2421",     balance: 13740.94, limit: 28000, minPay: 204.50, apr: 28.24, due: "April 3",  notes: "" },
    { name: "Discover 1554", balance: 10038.88, limit: 28000, minPay: 298,    apr: 28.24, due: "April 8",  notes: "" },
    { name: "Discover 8363", balance: 20965.82, limit: 23500, minPay: 454,    apr: 26.49, due: "April 8",  notes: "" },
    { name: "Capital One",   balance: 4389.00,  limit: 6400,  minPay: 122,    apr: 19.80, due: "April 6",  notes: "" },
    { name: "Rooms To Go",   balance: 5185.73,  limit: 25000, minPay: 99,     apr: 0,     due: "April 11", notes: "Interest starts 9/18/2030" },
    { name: "Care Credit",   balance: 3893.00,  limit: 16500, minPay: 131,    apr: 0,     due: "April 1",  notes: "Interest starts 8/9/2026" },
    { name: "Lowes",         balance: 3154.96,  limit: 25000, minPay: 50,     apr: 0,     due: "March 25", notes: "Interest starts 2/2/2027" },
  ],
  overrides: { "Discover 1554": 2559, "Care Credit": 805 },
  settings: { minRemaining: 3000, startMonth: "2026-04" }
};

const fmt = (v) => "$" + parseFloat(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v) => parseFloat(v) || 0;

const FONT = "'Inter','Helvetica Neue',Arial,sans-serif";
const FONT_MONO = "'JetBrains Mono','Fira Mono',monospace";

const CAT_COLORS = ["#E65100","#7B1FA2","#2E7D32","#F9A825","#C62828","#0097A7","#EC407A","#558B2F","#FB8C00","#5C6BC0"];
const PIE_COLORS = ["#E65100","#7B1FA2","#2E7D32","#F9A825","#C62828","#0097A7","#EC407A","#558B2F","#FB8C00","#5C6BC0"];

const CARD_ACCENTS = ["#3b82f6","#a855f7","#22c55e","#ef4444","#f59e0b","#06b6d4","#ec4899","#84cc16","#fb923c","#818cf8"];

function promoScore(notes) {
  if (!notes) return 99;
  if (notes.includes("2026")) return 0;
  if (notes.includes("2027")) return 1;
  if (notes.includes("2030")) return 5;
  return 3;
}

function getPlanPay(card, overrides) {
  const o = (overrides || {})[card.name];
  return o !== undefined ? num(o) : num(card.minPay);
}

function loadData() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    const base = s ? JSON.parse(s) : INIT_DATA;
    return { ...base, overrides: { ...(base.overrides || {}), ...FORCED_OVERRIDES } };
  } catch(e) {
    return INIT_DATA;
  }
}

function buildPlan(data) {
  const overrides = { ...(data.overrides || {}), ...FORCED_OVERRIDES };
  const parts = (data.settings && data.settings.startMonth ? data.settings.startMonth : "2026-04").split("-");
  const sy = parseInt(parts[0]);
  const sm = parseInt(parts[1]);
  const activeCards = data.cards.filter(c => num(c.balance) > 0.01);
  let simCards = activeCards.map(c => ({
    name: c.name, balance: num(c.balance), minPay: num(c.minPay),
    planPay: getPlanPay(c, overrides), apr: num(c.apr), limit: num(c.limit),
    due: c.due, notes: c.notes || "",
    colorIdx: data.cards.findIndex(x => x.name === c.name) % CARD_ACCENTS.length,
  }));
  const priorityOrder = [...simCards].sort((a, b) => {
    if (a.apr > 0 && b.apr > 0) return b.apr - a.apr;
    if (a.apr > 0) return -1;
    if (b.apr > 0) return 1;
    return promoScore(a.notes) - promoScore(b.notes);
  }).map(c => c.name);
  const cascadeMap = {};
  const paidOffSet = new Set();
  const schedule = [];
  let totalInterestAccum = 0;
  function getPayNow(name, basePlanPay) {
    return cascadeMap[name] !== undefined ? cascadeMap[name] : basePlanPay;
  }
  for (let mo = 0; mo < 120 && simCards.some(c => c.balance > 0.01); mo++) {
    const d = new Date(sy, sm - 1 + mo, 1);
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const isoDate = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-15";
    simCards = simCards.map(c => {
      const interest = c.balance * (c.apr / 100 / 12);
      totalInterestAccum += interest;
      return { ...c, balance: c.balance + interest };
    });
    const payments = [];
    simCards = simCards.map(c => {
      const pay = Math.min(getPayNow(c.name, c.planPay), c.balance);
      const nb = Math.max(0, c.balance - pay);
      payments.push({ name: c.name, pay: parseFloat(pay.toFixed(2)), newBalance: parseFloat(nb.toFixed(2)), colorIdx: c.colorIdx, apr: c.apr, minPay: c.minPay, planPay: c.planPay });
      return { ...c, balance: nb };
    });
    const paidOff = simCards.filter(c => c.balance <= 0.01 && !paidOffSet.has(c.name));
    const switchInstructions = [];
    paidOff.forEach(p => {
      paidOffSet.add(p.name);
      const freed = getPayNow(p.name, p.planPay);
      const nextName = priorityOrder.find(n => !paidOffSet.has(n) && n !== p.name);
      if (nextName) {
        const nc = simCards.find(c => c.name === nextName);
        const cur = getPayNow(nextName, nc ? nc.planPay : 0);
        cascadeMap[nextName] = cur + freed;
        switchInstructions.push({ paidOff: p.name, freedAmt: freed, nextCard: nextName, newAmount: cascadeMap[nextName] });
      } else {
        switchInstructions.push({ paidOff: p.name, freedAmt: freed, nextCard: null, newAmount: 0 });
      }
    });
    simCards = simCards.filter(c => c.balance > 0.01);
    schedule.push({
      month: mo + 1, label, isoDate,
      totalRemaining: parseFloat(simCards.reduce((s, c) => s + c.balance, 0).toFixed(2)),
      payments, paidOff: paidOff.map(c => ({ name: c.name, colorIdx: c.colorIdx })),
      switchInstructions,
      monthPayments: parseFloat(payments.reduce((s, p) => s + p.pay, 0).toFixed(2)),
      monthInterest: parseFloat(payments.reduce((s, p) => s + (p.apr > 0 ? p.newBalance * (p.apr / 100 / 12) : 0), 0).toFixed(2)),
    });
  }
  const initialAllocs = activeCards.map(c => ({
    name: c.name, minPay: num(c.minPay),
    planPay: getPlanPay(c, overrides),
    isOverride: overrides[c.name] !== undefined,
    apr: num(c.apr), balance: num(c.balance), due: c.due, notes: c.notes || "",
    colorIdx: data.cards.findIndex(x => x.name === c.name) % CARD_ACCENTS.length,
  })).sort((a, b) => {
    if (a.apr > 0 && b.apr > 0) return b.apr - a.apr;
    if (a.apr > 0) return -1;
    if (b.apr > 0) return 1;
    return promoScore(a.notes) - promoScore(b.notes);
  });
  return {
    schedule, totalInterest: parseFloat(totalInterestAccum.toFixed(2)),
    initialAllocs,
    totalMonthlyDebt: parseFloat(initialAllocs.reduce((s, c) => s + c.planPay, 0).toFixed(2)),
    priorityOrder,
  };
}

/* ── Glassmorphism panel matching DWS style ── */
const panel = (c) => ({
  background: "rgba(255,255,255,0.82)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  border: `1.5px solid ${c}44`,
  borderRadius: 20,
  padding: "22px 24px",
  boxShadow: `0 8px 32px ${c}15, 0 1px 3px rgba(0,0,0,0.04)`,
  marginBottom: 18,
  transition: "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
  position: "relative",
  overflow: "hidden",
});

/* Hover-enabled panel wrapper */
function HoverPanel({ color, children, style, onClick }) {
  return (
    <div onClick={onClick} style={{ ...panel(color), ...style, cursor: onClick ? "pointer" : "default" }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 12px 40px ${color}30, 0 2px 8px rgba(0,0,0,0.08)`; e.currentTarget.style.borderColor = color; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = `0 8px 32px ${color}15, 0 1px 3px rgba(0,0,0,0.04)`; e.currentTarget.style.borderColor = `${color}44`; }}>
      {children}
    </div>
  );
}

/* Section header with gradient accent line */
function SectionHead({ title, color, sub }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: sub ? 4 : 0 }}>
        <div style={{ width: 4, height: 22, borderRadius: 2, background: `linear-gradient(180deg, ${color}, ${color}66)` }} />
        <div style={{ fontSize: 13, fontWeight: 800, color, letterSpacing: 2, fontFamily: FONT_MONO, textTransform: "uppercase" }}>{title}</div>
      </div>
      {sub && <div style={{ fontSize: 12, color: "#999", marginLeft: 16, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const inputSt = (c) => ({
  background: "rgba(255,255,255,0.95)", border: `1.5px solid ${c}44`,
  color: "#1a1a2e", borderRadius: 10, padding: "10px 14px", fontSize: 13,
  fontFamily: FONT, width: "100%", boxSizing: "border-box", outline: "none",
  transition: "border-color 0.2s, box-shadow 0.2s",
});

const btnPrimary = (c) => ({
  background: `linear-gradient(135deg, ${c}, ${c}cc)`, border: "none",
  color: "#fff", borderRadius: 12, padding: "10px 18px", fontSize: 13,
  fontWeight: 700, cursor: "pointer", fontFamily: FONT,
  boxShadow: `0 4px 16px ${c}35`, letterSpacing: 0.3,
  transition: "all 0.2s ease",
});

const btnLight = {
  background: "rgba(255,255,255,0.7)", border: "1px solid #e0e0e8",
  color: "#555", borderRadius: 10, padding: "8px 16px", fontSize: 12,
  cursor: "pointer", fontFamily: FONT, fontWeight: 600,
  transition: "all 0.2s ease",
};

const btnDanger = {
  background: "none", border: "1px solid rgba(198,40,40,0.25)",
  color: "#C62828", borderRadius: 8, padding: "6px 10px", fontSize: 12,
  cursor: "pointer", fontFamily: FONT, fontWeight: 600,
  transition: "all 0.2s ease",
};

/* ── Debt Progress Bar — hero progress visualization ── */
function DebtProgressBar({ totalDebt, plan, cards }) {
  const originalDebt = cards.reduce((s, c) => s + num(c.balance), 0) + plan.schedule.reduce((s, mo) => s + mo.monthPayments, 0) - plan.schedule.reduce((s, mo) => {
    const interest = mo.payments.reduce((si, p) => si + (p.apr > 0 ? p.newBalance * (p.apr / 100 / 12) : 0), 0);
    return s + interest;
  }, 0);
  const estOriginal = Math.max(originalDebt, totalDebt + plan.schedule.reduce((s, mo) => s + mo.monthPayments, 0));
  const amountPaid = Math.max(0, estOriginal - totalDebt);
  const pctPaid = estOriginal > 0 ? Math.min((amountPaid / estOriginal) * 100, 100) : 0;
  const debtFreeMonth = plan.schedule.length > 0 ? plan.schedule[plan.schedule.length - 1] : null;
  const motivations = [
    { min: 0, max: 10, text: "Every journey starts with a single step. You've got this!", icon: "\u{1F4AA}" },
    { min: 10, max: 25, text: "Momentum is building. Keep pushing!", icon: "\u{1F525}" },
    { min: 25, max: 50, text: "You're crushing it — over a quarter done!", icon: "\u{1F680}" },
    { min: 50, max: 75, text: "Past the halfway mark! The finish line is in sight!", icon: "\u{1F3C3}" },
    { min: 75, max: 95, text: "Almost there — the home stretch!", icon: "\u{1F3C1}" },
    { min: 95, max: 101, text: "DEBT FREE! You did it!", icon: "\u{1F389}" },
  ];
  const motivation = motivations.find(m => pctPaid >= m.min && pctPaid < m.max) || motivations[0];

  return (
    <HoverPanel color="#6A1B9A" style={{ marginBottom: 22, padding: 0, overflow: "hidden" }}>
      <div style={{ height: 5, background: "linear-gradient(90deg, #C62828, #E65100, #F9A825, #2E7D32)" }} />
      <div style={{ padding: "24px 28px 22px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#1a1a2e", letterSpacing: -0.3 }}>
            {"\u{1F4B0}"} Debt Payoff Progress
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, fontFamily: FONT_MONO, background: `linear-gradient(135deg, ${pctPaid > 50 ? "#2E7D32" : "#C62828"}, ${pctPaid > 50 ? "#4CAF50" : "#E65100"})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
            {pctPaid.toFixed(1)}%
          </div>
        </div>
        {/* Progress bar */}
        <div style={{ position: "relative", height: 28, background: "rgba(0,0,0,0.06)", borderRadius: 14, overflow: "hidden", marginBottom: 18, boxShadow: "inset 0 2px 4px rgba(0,0,0,0.08)" }}>
          <div style={{
            height: 28, width: pctPaid + "%", borderRadius: 14,
            background: `linear-gradient(90deg, #C62828, #E65100 ${Math.min(pctPaid * 2, 50)}%, #F9A825 ${Math.min(pctPaid * 1.5, 70)}%, #2E7D32)`,
            transition: "width 1.2s cubic-bezier(0.4, 0, 0.2, 1)",
            boxShadow: "0 0 20px rgba(46,125,50,0.3), inset 0 1px 2px rgba(255,255,255,0.3)",
            position: "relative",
          }}>
            <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.95)", fontFamily: FONT_MONO, textShadow: "0 1px 3px rgba(0,0,0,0.3)" }}>
              {pctPaid > 8 ? pctPaid.toFixed(1) + "%" : ""}
            </div>
          </div>
        </div>
        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
          {[
            { label: "Original Debt", val: fmt(estOriginal), color: "#C62828", icon: "\u{1F4C9}" },
            { label: "Current Debt", val: fmt(totalDebt), color: "#E65100", icon: "\u{1F4B3}" },
            { label: "Amount Paid", val: fmt(amountPaid), color: "#2E7D32", icon: "\u2705" },
            { label: "Debt-Free Date", val: debtFreeMonth ? debtFreeMonth.label : "\u2014", color: "#0097A7", icon: "\u{1F3C6}" },
          ].map((s, i) => (
            <div key={i} style={{ textAlign: "center", padding: "10px 6px", borderRadius: 12, background: `${s.color}08`, border: `1px solid ${s.color}18` }}>
              <div style={{ fontSize: 15, marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontSize: 9, color: "#999", letterSpacing: 1.5, fontWeight: 700, fontFamily: FONT_MONO, textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: s.color, fontFamily: FONT_MONO }}>{s.val}</div>
            </div>
          ))}
        </div>
        {/* Motivation */}
        <div style={{ textAlign: "center", padding: "10px 16px", borderRadius: 12, background: "linear-gradient(135deg, rgba(106,27,154,0.06), rgba(0,151,167,0.06))", border: "1px solid rgba(106,27,154,0.12)" }}>
          <span style={{ fontSize: 18, marginRight: 8 }}>{motivation.icon}</span>
          <span style={{ fontSize: 13, color: "#555", fontWeight: 600, fontStyle: "italic" }}>{motivation.text}</span>
        </div>
      </div>
    </HoverPanel>
  );
}

/* ── Stat box with uniform sizing and gradient top strip ── */
function StatBox({ label, val, color, sub, icon }) {
  return (
    <div style={{ ...panel(color), padding: 0, marginBottom: 0, overflow: "hidden" }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px) scale(1.02)"; e.currentTarget.style.boxShadow = `0 12px 36px ${color}35`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = `0 8px 32px ${color}15, 0 1px 3px rgba(0,0,0,0.04)`; }}>
      <div style={{ height: 4, background: `linear-gradient(90deg, ${color}, ${color}88)` }} />
      <div style={{ padding: "14px 12px 12px", textAlign: "center" }}>
        {icon && <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>}
        <div style={{ fontSize: 9, color: "#999", letterSpacing: 2, fontWeight: 700, fontFamily: FONT_MONO, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 16, fontWeight: 900, color, fontFamily: FONT_MONO, lineHeight: 1.2, whiteSpace: "nowrap" }}>{val}</div>
        {sub && <div style={{ fontSize: 10, color: "#E65100", marginTop: 6, fontWeight: 700, background: "rgba(230,81,0,0.08)", borderRadius: 6, padding: "3px 8px", display: "inline-block" }}>{sub}</div>}
      </div>
    </div>
  );
}

/* ── Animated progress bar ── */
function UtilBar({ val, max, color, height, showLabel }) {
  const p = max > 0 ? Math.min(val / max * 100, 100) : 0;
  const h = height || 7;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ height: h, background: "rgba(0,0,0,0.05)", borderRadius: h, position: "relative", overflow: "hidden" }}>
        <div style={{ height: h, width: p + "%", background: `linear-gradient(90deg, ${color}, ${color}bb)`, borderRadius: h, transition: "width 0.6s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: `0 0 8px ${color}40` }} />
      </div>
      {showLabel && <div style={{ fontSize: 11, color: "#aaa", marginTop: 3, fontFamily: FONT_MONO, fontWeight: 600 }}>{p.toFixed(1)}%</div>}
    </div>
  );
}

/* ── Donut chart — larger, bolder ── */
function DonutChart({ slices, total }) {
  const [hov, setHov] = useState(null);
  const size = 240, cx = 120, cy = 120, R = 96, inner = 58;
  let angle = -Math.PI / 2;
  const paths = slices.map((s) => {
    const pct = total > 0 ? s.val / total : 0;
    const sweep = pct * 2 * Math.PI;
    if (sweep < 0.001) return null;
    const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
    angle += sweep;
    const x2 = cx + R * Math.cos(angle), y2 = cy + R * Math.sin(angle);
    const xi1 = cx + inner * Math.cos(angle - sweep), yi1 = cy + inner * Math.sin(angle - sweep);
    const xi2 = cx + inner * Math.cos(angle), yi2 = cy + inner * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    return { d: `M${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} L${xi2},${yi2} A${inner},${inner} 0 ${large} 0 ${xi1},${yi1} Z`, color: s.color, label: s.label, val: s.val, pct: (pct * 100).toFixed(1) };
  }).filter(Boolean);
  const h = hov !== null ? paths[hov] : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap", justifyContent: "center" }}>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <svg width={size} height={size}>
          <defs>
            {paths.map((p, i) => (
              <filter key={i} id={`glow${i}`}><feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={p.color} floodOpacity="0.4" /></filter>
            ))}
          </defs>
          {paths.map((p, i) => (
            <path key={i} d={p.d} fill={p.color} opacity={hov === null || hov === i ? 1 : 0.2}
              filter={hov === i ? `url(#glow${i})` : "none"}
              style={{ cursor: "pointer", transition: "all 0.3s ease", transform: hov === i ? "scale(1.03)" : "scale(1)", transformOrigin: `${cx}px ${cy}px` }}
              onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} />
          ))}
          <circle cx={cx} cy={cy} r={inner} fill="rgba(255,255,255,0.9)" />
          <text x={cx} y={cy - 10} textAnchor="middle" fill="#1a1a2e" fontSize={11} fontWeight={700} fontFamily={FONT}>{h ? h.label.slice(0, 14) : "Monthly Total"}</text>
          <text x={cx} y={cy + 8} textAnchor="middle" fill={h ? h.color : "#1a1a2e"} fontSize={15} fontWeight={900} fontFamily={FONT_MONO}>{h ? fmt(h.val) : fmt(total)}</text>
          {h && <text x={cx} y={cy + 24} textAnchor="middle" fill="#aaa" fontSize={11} fontFamily={FONT_MONO} fontWeight={600}>{h.pct}%</text>}
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        {slices.map((s, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", borderRadius: 10, marginBottom: 2, cursor: "pointer", background: hov === i ? `${s.color}0a` : "transparent", transition: "all 0.2s", opacity: hov === null || hov === i ? 1 : 0.35 }}
            onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 12, height: 12, borderRadius: 4, background: `linear-gradient(135deg, ${s.color}, ${s.color}aa)`, flexShrink: 0, boxShadow: `0 2px 6px ${s.color}30` }} />
              <span style={{ fontSize: 13, color: "#333", fontWeight: 600 }}>{s.label}</span>
            </div>
            <span style={{ fontSize: 13, color: s.color, fontWeight: 800, fontFamily: FONT_MONO }}>{fmt(s.val)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════ TAB: OVERVIEW ══════════════════════ */
function OverviewTab({ data, setData, totalIncome, totalLiving, totalDebtPay, totalOut, remaining, totalDebt, totalLimit, plan }) {
  const util = totalLimit > 0 ? totalDebt / totalLimit * 100 : 0;
  const debtFree = plan.schedule[plan.schedule.length - 1];
  const catSlices = data.cats.map((cat, i) => ({ label: cat.icon + " " + cat.name, val: cat.items.reduce((s, it) => s + num(it.v), 0), color: PIE_COLORS[i % PIE_COLORS.length], catIdx: i })).filter(s => s.val > 0);
  const allSlices = [...catSlices, { label: "\u{1F4B3} CC Payments", val: totalDebtPay, color: "#C62828", catIdx: -1 }].filter(s => s.val > 0);
  const [editingCat, setEditingCat] = useState(null);
  const [editCatVal, setEditCatVal] = useState("");
  const [editIncome, setEditIncome] = useState(false);
  const [incomeVal, setIncomeVal] = useState("");

  const handleCatEdit = (catIdx, currentVal) => {
    if (catIdx < 0) return; // CC payments not editable here
    setEditingCat(catIdx);
    setEditCatVal(String(currentVal));
  };

  const saveCatEdit = () => {
    if (editingCat === null) return;
    const newTotal = num(editCatVal);
    const cat = data.cats[editingCat];
    const oldTotal = cat.items.reduce((s, it) => s + num(it.v), 0);
    if (oldTotal > 0 && newTotal > 0) {
      const ratio = newTotal / oldTotal;
      setData(d => ({
        ...d,
        cats: d.cats.map((c, i) => i !== editingCat ? c : {
          ...c,
          items: c.items.map(it => ({ ...it, v: String((num(it.v) * ratio).toFixed(2)) }))
        })
      }));
    } else if (cat.items.length > 0 && newTotal > 0) {
      const perItem = newTotal / cat.items.length;
      setData(d => ({
        ...d,
        cats: d.cats.map((c, i) => i !== editingCat ? c : {
          ...c,
          items: c.items.map(it => ({ ...it, v: String(perItem.toFixed(2)) }))
        })
      }));
    }
    setEditingCat(null);
  };

  const saveIncome = () => {
    const newInc = num(incomeVal);
    if (newInc > 0 && data.income.length > 0) {
      setData(d => ({ ...d, income: d.income.map((inc, i) => i === 0 ? { ...inc, v: String(newInc) } : inc) }));
    }
    setEditIncome(false);
  };

  return (
    <div>
      <DebtProgressBar totalDebt={totalDebt} totalLimit={totalLimit} plan={plan} cards={data.cards} />
      <div className="budget-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
        <StatBox label="Income" val={fmt(totalIncome)} color="#2E7D32" icon={"\u{1F4B0}"} />
        <StatBox label="Living" val={fmt(totalLiving)} color="#E65100" icon={"\u{1F3E0}"} />
        <StatBox label="CC Payments" val={fmt(totalDebtPay)} color="#C62828" icon={"\u{1F4B3}"} />
        <StatBox label="Total Out" val={fmt(totalOut)} color="#7B1FA2" icon={"\u{1F4C9}"} />
        <StatBox label="Remaining" val={fmt(remaining)} color={remaining >= 3000 ? "#2E7D32" : "#C62828"} sub={remaining < 3000 ? "\u26A0 Below $3k" : null} icon={remaining >= 3000 ? "\u2705" : "\u26A0\uFE0F"} />
        <StatBox label="Total Debt" val={fmt(totalDebt)} color="#6A1B9A" icon={"\u{1F4CA}"} />
        <StatBox label="Utilization" val={util.toFixed(1) + "%"} color={util > 80 ? "#C62828" : util > 50 ? "#E65100" : "#2E7D32"} icon={"\u{1F4C8}"} />
        <StatBox label="Debt-Free" val={debtFree ? debtFree.label : "\u2014"} color="#0097A7" icon={"\u{1F3C6}"} />
      </div>
      <HoverPanel color="#7B1FA2">
        <SectionHead title="Spending Breakdown" color="#6A1B9A" sub="Click a category name to edit its total" />
        <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap", justifyContent: "center" }}>
          <DonutChart slices={allSlices} total={totalOut} />
        </div>
        {/* Editable legend */}
        <div style={{ marginTop: 14 }}>
          {allSlices.map((s, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", borderRadius: 10, marginBottom: 2, transition: "all 0.2s" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                <div style={{ width: 12, height: 12, borderRadius: 4, background: `linear-gradient(135deg, ${s.color}, ${s.color}aa)`, flexShrink: 0, boxShadow: `0 2px 6px ${s.color}30` }} />
                {editingCat === s.catIdx ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}>
                    <span style={{ fontSize: 13, color: "#333", fontWeight: 600 }}>{s.label}</span>
                    <input style={{ ...inputSt(s.color), width: 100, padding: "4px 8px", fontSize: 13 }}
                      value={editCatVal} onChange={e => setEditCatVal(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveCatEdit(); if (e.key === "Escape") setEditingCat(null); }}
                      autoFocus />
                    <button style={{ ...btnPrimary(s.color), padding: "4px 10px", fontSize: 11 }} onClick={saveCatEdit}>{"\u2713"}</button>
                    <button style={{ ...btnLight, padding: "4px 8px", fontSize: 11 }} onClick={() => setEditingCat(null)}>{"\u2715"}</button>
                  </div>
                ) : (
                  <span style={{ fontSize: 13, color: "#333", fontWeight: 600, cursor: s.catIdx >= 0 ? "pointer" : "default", borderBottom: s.catIdx >= 0 ? "1px dashed #ccc" : "none" }}
                    onClick={() => handleCatEdit(s.catIdx, s.val)}
                    title={s.catIdx >= 0 ? "Click to edit total" : ""}>
                    {s.label}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 13, color: s.color, fontWeight: 800, fontFamily: FONT_MONO }}>{fmt(s.val)}</span>
            </div>
          ))}
        </div>
      </HoverPanel>
      <HoverPanel color="#2E7D32">
        <SectionHead title="Income Allocation" color="#1B5E20" sub={`${fmt(totalIncome)} monthly income`} />
        {[
          { label: "Living expenses", val: totalLiving, color: "#7B1FA2", icon: "\u{1F3E0}" },
          { label: "Credit card payments", val: totalDebtPay, color: "#C62828", icon: "\u{1F4B3}" },
          { label: "$3,000 emergency buffer", val: 3000, color: "#2E7D32", icon: "\u{1F6E1}\uFE0F" },
          { label: "Unallocated surplus", val: Math.max(0, remaining - 3000), color: "#999", icon: "\u{1F4AD}" },
        ].map((r, i) => (
          <div key={i} style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 12, background: `${r.color}06`, border: `1px solid ${r.color}15`, transition: "all 0.2s" }}
            onMouseEnter={e => { e.currentTarget.style.background = `${r.color}10`; e.currentTarget.style.borderColor = `${r.color}30`; }}
            onMouseLeave={e => { e.currentTarget.style.background = `${r.color}06`; e.currentTarget.style.borderColor = `${r.color}15`; }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6, alignItems: "center" }}>
              <span style={{ color: "#333", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 16 }}>{r.icon}</span> {r.label}</span>
              <span style={{ color: r.color, fontFamily: FONT_MONO, fontSize: 14, fontWeight: 800 }}>{fmt(r.val)} <span style={{ fontSize: 11, color: "#bbb", fontWeight: 500 }}>({totalIncome > 0 ? (r.val / totalIncome * 100).toFixed(1) : 0}%)</span></span>
            </div>
            <div style={{ height: 10, background: "rgba(0,0,0,0.04)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ height: 10, width: (totalIncome > 0 ? Math.min(r.val / totalIncome * 100, 100) : 0) + "%", background: `linear-gradient(90deg, ${r.color}, ${r.color}aa)`, borderRadius: 6, transition: "width 0.6s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: `0 0 10px ${r.color}25` }} />
            </div>
          </div>
        ))}
      </HoverPanel>
      {/* Quick Edit Panel */}
      <HoverPanel color="#0097A7">
        <SectionHead title="Quick Edit" color="#006064" sub="Instantly adjust your monthly income" />
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 18 }}>{"\u{1F4B0}"}</span>
          <span style={{ fontSize: 13, color: "#666", fontWeight: 600 }}>Monthly Income:</span>
          {editIncome ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input style={{ ...inputSt("#0097A7"), width: 140, padding: "8px 12px", fontSize: 15, fontFamily: FONT_MONO, fontWeight: 700 }}
                value={incomeVal} onChange={e => setIncomeVal(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveIncome(); if (e.key === "Escape") setEditIncome(false); }}
                autoFocus />
              <button style={{ ...btnPrimary("#0097A7"), padding: "8px 14px" }} onClick={saveIncome}>{"\u2713"} Save</button>
              <button style={btnLight} onClick={() => setEditIncome(false)}>{"\u2715"}</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}
              onClick={() => { setEditIncome(true); setIncomeVal(String(totalIncome)); }}>
              <span style={{ fontSize: 22, fontWeight: 900, color: "#0097A7", fontFamily: FONT_MONO }}>{fmt(totalIncome)}</span>
              <span style={{ fontSize: 11, color: "#aaa", fontWeight: 600, background: "rgba(0,151,167,0.08)", padding: "3px 8px", borderRadius: 6, border: "1px dashed rgba(0,151,167,0.25)" }}>click to edit</span>
            </div>
          )}
        </div>
      </HoverPanel>
    </div>
  );
}

/* ══════════════════════ TAB: EXPENSES ══════════════════════ */
function ExpensesTab({ data, setData, totalLiving, totalDebtPay, totalIncome }) {
  const [editCat, setEditCat] = useState(null);
  const [newItem, setNewItem] = useState({ n: "", v: "" });
  const [newInc, setNewInc] = useState({ n: "", v: "" });
  const updInc = (i, f, v) => setData(d => ({ ...d, income: d.income.map((x, idx) => idx === i ? { ...x, [f]: v } : x) }));
  const delInc = i => setData(d => ({ ...d, income: d.income.filter((_, idx) => idx !== i) }));
  const addInc = () => { if (!newInc.n) return; setData(d => ({ ...d, income: [...d.income, { ...newInc }] })); setNewInc({ n: "", v: "" }); };
  const updItem = (ci, ii, f, v) => setData(d => ({ ...d, cats: d.cats.map((c, ci2) => ci2 !== ci ? c : { ...c, items: c.items.map((it, ii2) => ii2 !== ii ? it : { ...it, [f]: v }) }) }));
  const delItem = (ci, ii) => setData(d => ({ ...d, cats: d.cats.map((c, ci2) => ci2 !== ci ? c : { ...c, items: c.items.filter((_, ii2) => ii2 !== ii) }) }));
  const addItem = ci => { if (!newItem.n) return; setData(d => ({ ...d, cats: d.cats.map((c, ci2) => ci2 !== ci ? c : { ...c, items: [...c.items, { ...newItem }] }) })); setNewItem({ n: "", v: "" }); setEditCat(null); };
  const AC = "#7B1FA2";
  return (
    <div>
      <div style={panel("#2E7D32")}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#1B5E20", letterSpacing: 1, marginBottom: 12 }}>INCOME SOURCES</div>
        {data.income.map((inc, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <input style={{ ...inputSt("#2E7D32"), flex: 2 }} value={inc.n} onChange={e => updInc(i, "n", e.target.value)} />
            <input style={{ ...inputSt("#2E7D32"), flex: 1 }} value={inc.v} onChange={e => updInc(i, "v", e.target.value)} placeholder="Amount" />
            <button style={btnDanger} onClick={() => delInc(i)}>{"\u2715"}</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input style={{ ...inputSt("#2E7D32"), flex: 2 }} value={newInc.n} onChange={e => setNewInc(p => ({ ...p, n: e.target.value }))} placeholder="Source name" />
          <input style={{ ...inputSt("#2E7D32"), flex: 1 }} value={newInc.v} onChange={e => setNewInc(p => ({ ...p, v: e.target.value }))} placeholder="Amount" />
          <button style={btnPrimary("#2E7D32")} onClick={addInc}>+ Add</button>
        </div>
      </div>
      {data.cats.map((cat, ci) => {
        const ac = CAT_COLORS[ci % CAT_COLORS.length];
        const catTotal = cat.items.reduce((s, i) => s + num(i.v), 0);
        return (
          <div key={ci} style={panel(ac)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#1a1a2e", letterSpacing: 0.5 }}>{cat.icon} {cat.name}</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: ac, fontFamily: FONT_MONO }}>{fmt(catTotal)}</div>
            </div>
            {cat.items.map((item, ii) => (
              <div key={ii} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <input style={{ ...inputSt(ac), flex: 2 }} value={item.n} onChange={e => updItem(ci, ii, "n", e.target.value)} />
                <input style={{ ...inputSt(ac), flex: 1 }} value={item.v} onChange={e => updItem(ci, ii, "v", e.target.value)} placeholder="Amount" />
                <button style={btnDanger} onClick={() => delItem(ci, ii)}>{"\u2715"}</button>
              </div>
            ))}
            {editCat === ci ? (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input style={{ ...inputSt(ac), flex: 2 }} value={newItem.n} onChange={e => setNewItem(p => ({ ...p, n: e.target.value }))} placeholder="Item name" />
                <input style={{ ...inputSt(ac), flex: 1 }} value={newItem.v} onChange={e => setNewItem(p => ({ ...p, v: e.target.value }))} placeholder="Amount" />
                <button style={btnPrimary(ac)} onClick={() => addItem(ci)}>Add</button>
                <button style={btnLight} onClick={() => setEditCat(null)}>Cancel</button>
              </div>
            ) : (
              <button style={{ ...btnLight, marginTop: 4, width: "100%" }} onClick={() => { setEditCat(ci); setNewItem({ n: "", v: "" }); }}>+ Add item</button>
            )}
          </div>
        );
      })}
      <div style={panel("#C62828")}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#C62828", letterSpacing: 1 }}>CREDIT CARD PAYMENTS</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>Discover 1554: <span style={{ color: "#C62828", fontWeight: 700 }}>$2,559</span> | Care Credit: <span style={{ color: "#C62828", fontWeight: 700 }}>$805</span> | Others at min</div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#C62828", fontFamily: FONT_MONO }}>{fmt(totalDebtPay)}</div>
        </div>
      </div>
      <div style={panel("#7B1FA2")}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 8 }}>
          <span style={{ color: "#666", fontWeight: 500 }}>Living expenses</span>
          <span style={{ color: "#1a1a2e", fontWeight: 700, fontFamily: FONT_MONO }}>{fmt(totalLiving)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 8 }}>
          <span style={{ color: "#666", fontWeight: 500 }}>CC payments</span>
          <span style={{ color: "#C62828", fontWeight: 700, fontFamily: FONT_MONO }}>{fmt(totalDebtPay)}</span>
        </div>
        <div style={{ borderTop: "2px solid #f0f0f5", paddingTop: 10, marginTop: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, marginBottom: 6 }}>
            <span style={{ color: "#1a1a2e", fontWeight: 700 }}>Total monthly out</span>
            <span style={{ color: "#7B1FA2", fontWeight: 900, fontFamily: FONT_MONO }}>{fmt(totalLiving + totalDebtPay)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
            <span style={{ color: "#1a1a2e", fontWeight: 700 }}>Remaining from {fmt(totalIncome)}</span>
            <span style={{ color: totalIncome - (totalLiving + totalDebtPay) >= 3000 ? "#2E7D32" : "#C62828", fontWeight: 900, fontFamily: FONT_MONO }}>{fmt(totalIncome - (totalLiving + totalDebtPay))}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════ TAB: CARDS ══════════════════════ */
function CardsTab({ data, setData, totalDebt, totalLimit, totalMinPay, totalDebtPay }) {
  const [editing, setEditing] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newCard, setNewCard] = useState({ name: "", balance: "", limit: "", minPay: "", apr: "", due: "", notes: "" });
  const updCard = (i, f, v) => setData(d => ({ ...d, cards: d.cards.map((c, idx) => idx !== i ? c : { ...c, [f]: v }) }));
  const delCard = i => setData(d => ({ ...d, cards: d.cards.filter((_, idx) => idx !== i) }));
  const addCard = () => {
    if (!newCard.name) return;
    setData(d => ({ ...d, cards: [...d.cards, { ...newCard, balance: num(newCard.balance), minPay: num(newCard.minPay), apr: num(newCard.apr), limit: num(newCard.limit) }] }));
    setNewCard({ name: "", balance: "", limit: "", minPay: "", apr: "", due: "", notes: "" }); setShowAdd(false);
  };
  const updOverride = (name, v) => setData(d => ({ ...d, overrides: { ...(d.overrides || {}), ...FORCED_OVERRIDES, [name]: num(v) } }));
  const clearOverride = name => {
    if (FORCED_OVERRIDES[name] !== undefined) return;
    setData(d => { const o = { ...(d.overrides || {}) }; delete o[name]; return { ...d, overrides: { ...o, ...FORCED_OVERRIDES } }; });
  };
  const effectiveOverrides = { ...(data.overrides || {}), ...FORCED_OVERRIDES };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 20 }}>
        <StatBox label="Total Balance" val={fmt(totalDebt)} color="#C62828" icon={"\u{1F4B8}"} />
        <StatBox label="Total Credit" val={fmt(totalLimit)} color="#0097A7" icon={"\u{1F3E6}"} />
        <StatBox label="Utilization" val={(totalLimit > 0 ? totalDebt / totalLimit * 100 : 0).toFixed(1) + "%"} color="#E65100" icon={"\u{1F4CA}"} />
        <StatBox label="Min Payments" val={fmt(totalMinPay)} color="#888" icon={"\u{1F4C3}"} />
        <StatBox label="Plan Payments" val={fmt(totalDebtPay)} color="#7B1FA2" icon={"\u{1F680}"} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 }}>
        {data.cards.map((card, i) => {
          const ac = CARD_ACCENTS[i % CARD_ACCENTS.length];
          const bal = num(card.balance), lim = num(card.limit), utilP = lim > 0 ? bal / lim * 100 : 0;
          const planPay = getPlanPay(card, effectiveOverrides);
          const isOverride = effectiveOverrides[card.name] !== undefined;
          return (
            <div key={i} style={panel(ac)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#1a1a2e" }}>{card.name}</div>
                  <div style={{ fontSize: 12, color: ac, fontWeight: 600, fontFamily: FONT_MONO, marginTop: 2 }}>{num(card.apr) > 0 ? card.apr + "% APR" : "0% Promo"} | Due {card.due}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#1a1a2e", fontFamily: FONT_MONO }}>{fmt(card.balance)}</div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>of {fmt(card.limit)}</div>
                </div>
              </div>
              <UtilBar val={bal} max={lim} color={ac} />
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 4, marginBottom: 8, fontFamily: FONT_MONO }}>{utilP.toFixed(1)}% utilized</div>
              {card.notes && <div style={{ fontSize: 12, color: "#E65100", fontWeight: 600, marginBottom: 8 }}>{"\u26A0"} {card.notes}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "12px 14px", borderRadius: 12, background: "rgba(0,0,0,0.03)", border: `1px solid ${ac}22`, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#aaa", letterSpacing: 1, fontWeight: 600, fontFamily: FONT_MONO, marginBottom: 3 }}>MIN PAY</div>
                  <div style={{ fontSize: 15, color: "#888", fontFamily: FONT_MONO }}>{fmt(card.minPay)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: "#aaa", letterSpacing: 1, fontWeight: 600, fontFamily: FONT_MONO, marginBottom: 3 }}>PLAN PAY</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: isOverride ? ac : "#888", fontFamily: FONT_MONO }}>{fmt(planPay)}</div>
                  {isOverride && planPay > num(card.minPay) && <div style={{ fontSize: 10, color: ac, fontWeight: 600 }}>+{fmt(planPay - num(card.minPay))} above min</div>}
                </div>
              </div>
              {editing === i ? (
                <div style={{ marginTop: 4 }}>
                  {[["balance","Balance"],["limit","Limit"],["minPay","Min Pay"],["apr","APR %"],["due","Due Date"],["notes","Notes"]].map(([f, l]) => (
                    <div key={f} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                      <label style={{ fontSize: 12, color: "#888", width: 70, flexShrink: 0, fontWeight: 600 }}>{l}</label>
                      <input style={inputSt(ac)} value={card[f] || ""} onChange={e => updCard(i, f, e.target.value)} />
                    </div>
                  ))}
                  {FORCED_OVERRIDES[card.name] ? (
                    <div style={{ fontSize: 12, color: ac, fontWeight: 600, marginBottom: 6 }}>Plan payment locked: {fmt(FORCED_OVERRIDES[card.name])}/mo</div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                      <label style={{ fontSize: 12, color: "#888", width: 70, flexShrink: 0, fontWeight: 600 }}>Plan pay</label>
                      <input style={inputSt(ac)} value={(data.overrides || {})[card.name] !== undefined ? (data.overrides || {})[card.name] : ""} placeholder={"Default: " + fmt(card.minPay)} onChange={e => updOverride(card.name, e.target.value)} />
                      {(data.overrides || {})[card.name] !== undefined && <button style={btnDanger} onClick={() => clearOverride(card.name)}>Clear</button>}
                    </div>
                  )}
                  <button style={{ ...btnLight, marginTop: 6 }} onClick={() => setEditing(null)}>Done</button>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                  <button style={btnLight} onClick={() => setEditing(i)}>Edit</button>
                  <button style={btnDanger} onClick={() => delCard(i)}>{"\u2715"}</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 14 }}>
        {showAdd ? (
          <div style={panel("#0097A7")}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#006064", letterSpacing: 1, marginBottom: 12 }}>NEW CARD</div>
            {[["name","Card name"],["balance","Balance"],["limit","Credit limit"],["minPay","Min payment"],["apr","APR %"],["due","Due date"],["notes","Notes"]].map(([f, l]) => (
              <div key={f} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                <label style={{ fontSize: 12, color: "#888", width: 100, flexShrink: 0, fontWeight: 600 }}>{l}</label>
                <input style={inputSt("#0097A7")} value={newCard[f] || ""} onChange={e => setNewCard(p => ({ ...p, [f]: e.target.value }))} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button style={btnPrimary("#0097A7")} onClick={addCard}>Add card</button>
              <button style={btnLight} onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button style={{ ...btnPrimary("#7B1FA2"), width: "100%", padding: 14, fontSize: 14 }} onClick={() => setShowAdd(true)}>+ Add Credit Card</button>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════ TAB: PLAN ══════════════════════ */
function PlanTab({ data, setData, plan, totalIncome, totalLiving }) {
  const [showAll, setShowAll] = useState(false);
  const minRem = num(data.settings && data.settings.minRemaining ? data.settings.minRemaining : 3000);
  const display = showAll ? plan.schedule : plan.schedule.slice(0, 18);
  const allSwitches = plan.schedule.flatMap(mo => mo.switchInstructions.map(sw => ({ ...sw, date: mo.label, isoDate: mo.isoDate, remaining: mo.totalRemaining })));

  return (
    <div>
      <WhatIfSlider plan={plan} data={data} />
      <div style={panel("#7B1FA2")}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#6A1B9A", letterSpacing: 1, marginBottom: 10 }}>PLAN SETTINGS</div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, color: "#666", fontWeight: 500 }}>Monthly buffer floor:</label>
          <input style={{ ...inputSt("#7B1FA2"), width: 120 }} value={minRem} onChange={e => setData(d => ({ ...d, settings: { ...d.settings, minRemaining: num(e.target.value) } }))} />
        </div>
        <div style={{ fontSize: 13, color: "#888", marginTop: 10, fontFamily: FONT_MONO }}>
          Income: <span style={{ color: "#2E7D32", fontWeight: 700 }}>{fmt(totalIncome)}</span> | Living: <span style={{ color: "#E65100", fontWeight: 700 }}>{fmt(totalLiving)}</span> | CC: <span style={{ color: "#C62828", fontWeight: 700 }}>{fmt(plan.totalMonthlyDebt)}</span> | Buffer: <span style={{ color: "#7B1FA2", fontWeight: 700 }}>{fmt(minRem)}</span>
        </div>
      </div>

      <div style={panel("#0097A7")}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#006064", letterSpacing: 1, marginBottom: 4 }}>MONTHLY PAYMENT ALLOCATIONS</div>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>
          All at min | <span style={{ color: "#E65100", fontWeight: 700 }}>Discover 1554: $2,559/mo</span> | <span style={{ color: "#E65100", fontWeight: 700 }}>Care Credit: $805/mo</span> | Total: <span style={{ color: "#1a1a2e", fontWeight: 700 }}>{fmt(plan.totalMonthlyDebt)}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 70px", gap: 6, padding: "8px 10px", borderBottom: "2px solid #f0f0f5", marginBottom: 4 }}>
          {["Card", "Min Pay", "Plan Pay", "APR"].map((h, i) => (
            <div key={i} style={{ fontSize: 11, color: "#aaa", fontWeight: 700, fontFamily: FONT_MONO, letterSpacing: 1, textAlign: i > 0 ? "right" : "left" }}>{h}</div>
          ))}
        </div>
        {plan.initialAllocs.map((card, i) => {
          const ac = CARD_ACCENTS[card.colorIdx];
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 70px", gap: 6, padding: "10px 10px", borderRadius: 10, background: card.isOverride ? `${ac}08` : "transparent", border: card.isOverride ? `1.5px solid ${ac}33` : "1px solid transparent", marginBottom: 4, alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: card.isOverride ? 700 : 500, color: "#1a1a2e" }}>{card.name}</div>
                {card.isOverride && <div style={{ fontSize: 10, color: ac, fontWeight: 600 }}>+{fmt(card.planPay - card.minPay)} above min</div>}
                {card.notes && <div style={{ fontSize: 10, color: "#E65100", fontWeight: 600 }}>{"\u26A0"} {card.notes}</div>}
              </div>
              <div style={{ fontSize: 13, color: "#aaa", textAlign: "right", fontFamily: FONT_MONO }}>{fmt(card.minPay)}</div>
              <div style={{ fontSize: card.isOverride ? 15 : 13, fontWeight: card.isOverride ? 800 : 400, color: card.isOverride ? ac : "#aaa", textAlign: "right", fontFamily: FONT_MONO }}>{fmt(card.planPay)}</div>
              <div style={{ fontSize: 12, color: num(card.apr) > 0 ? "#E65100" : "#2E7D32", textAlign: "right", fontWeight: 600, fontFamily: FONT_MONO }}>{num(card.apr) > 0 ? card.apr + "%" : "0%"}</div>
            </div>
          );
        })}
        <div style={{ borderTop: "2px solid #f0f0f5", marginTop: 8, paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 14, color: "#666", fontWeight: 600 }}>Total monthly debt payment</span>
          <span style={{ fontSize: 16, fontWeight: 900, color: "#0097A7", fontFamily: FONT_MONO }}>{fmt(plan.totalMonthlyDebt)}</span>
        </div>
      </div>

      {allSwitches.length > 0 && (
        <div style={panel("#2E7D32")}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#1B5E20", letterSpacing: 1, marginBottom: 14 }}>CARD SWITCH SCHEDULE</div>
          {allSwitches.map((sw, i) => (
            <div key={i} style={{ padding: "14px 0", borderBottom: i < allSwitches.length - 1 ? "1px solid #f0f0f5" : "none" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#2E7D32", marginBottom: 4 }}>{"\u2713"} {sw.paidOff} \u2014 PAID OFF \u2014 {sw.date}</div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 3 }}>Remaining debt: <span style={{ color: "#1a1a2e", fontWeight: 700 }}>{fmt(sw.remaining)}</span></div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 3 }}>Freed payment: <span style={{ color: "#E65100", fontWeight: 700 }}>{fmt(sw.freedAmt)}/mo</span></div>
              {sw.nextCard ? (
                <div>
                  <div style={{ fontSize: 13, color: "#0097A7", fontWeight: 600 }}>{"\u2192"} Redirect {fmt(sw.freedAmt)} to <span style={{ color: "#1a1a2e", fontWeight: 700 }}>{sw.nextCard}</span></div>
                  <div style={{ fontSize: 13, color: "#0097A7", fontWeight: 600 }}>{"\u2192"} New payment: <span style={{ color: "#E65100", fontWeight: 700 }}>{fmt(sw.newAmount)}/mo</span></div>
                </div>
              ) : (
                <div style={{ fontSize: 14, color: "#2E7D32", fontWeight: 800 }}>{"\u{1F389}"} All cards paid off \u2014 DEBT FREE!</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={panel("#E65100")}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#BF360C", letterSpacing: 1, marginBottom: 14 }}>MONTH-BY-MONTH SCHEDULE</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 460 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #f0f0f5" }}>
                {["Month", "Remaining", "Interest", "Paid", "Milestone"].map((h, i) => (
                  <th key={i} style={{ textAlign: i > 0 && i < 4 ? "right" : "left", padding: "8px 10px", color: "#aaa", fontWeight: 700, fontFamily: FONT_MONO, fontSize: 11, letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {display.map((m, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f0f0f5", background: m.paidOff.length ? "rgba(46,125,50,0.06)" : "transparent" }}>
                  <td style={{ padding: "8px 10px", color: m.paidOff.length ? "#2E7D32" : "#1a1a2e", fontWeight: m.paidOff.length ? 700 : 400 }}>{m.label}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: "#666", fontFamily: FONT_MONO }}>{fmt(m.totalRemaining)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: "#C62828", fontFamily: FONT_MONO }}>{fmt(m.monthInterest)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: "#0097A7", fontFamily: FONT_MONO }}>{fmt(m.monthPayments)}</td>
                  <td style={{ padding: "8px 10px", color: "#2E7D32", fontWeight: 700 }}>{m.paidOff.map(p => p.name + " \u2713").join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button style={{ ...btnLight, marginTop: 12, width: "100%", textAlign: "center" }} onClick={() => setShowAll(v => !v)}>
          {showAll ? "\u25B2 Show less" : "\u25BC Show all " + plan.schedule.length + " months"}
        </button>
      </div>
    </div>
  );
}

/* ── What-If Slider — explore extra payment scenarios ── */
function WhatIfSlider({ plan, data }) {
  const [extra, setExtra] = useState(0);
  const baseMonths = plan.schedule.length;
  const baseTotalInterest = plan.totalInterest;
  const baseDebtFree = plan.schedule.length > 0 ? plan.schedule[plan.schedule.length - 1].label : "\u2014";

  // Simulate with extra payment
  const simWithExtra = (extraAmt) => {
    if (extraAmt <= 0) return { months: baseMonths, interest: baseTotalInterest, debtFree: baseDebtFree };
    const overrides = { ...(data.overrides || {}), ...FORCED_OVERRIDES };
    const parts = (data.settings && data.settings.startMonth ? data.settings.startMonth : "2026-04").split("-");
    const sy = parseInt(parts[0]);
    const sm = parseInt(parts[1]);
    const activeCards = data.cards.filter(c => num(c.balance) > 0.01);
    let simCards = activeCards.map(c => ({
      name: c.name, balance: num(c.balance), minPay: num(c.minPay),
      planPay: getPlanPay(c, overrides), apr: num(c.apr), notes: c.notes || "",
    }));
    const priorityOrder = [...simCards].sort((a, b) => {
      if (a.apr > 0 && b.apr > 0) return b.apr - a.apr;
      if (a.apr > 0) return -1;
      if (b.apr > 0) return 1;
      return promoScore(a.notes) - promoScore(b.notes);
    }).map(c => c.name);

    let totalInt = 0;
    let months = 0;
    const paidOffSet = new Set();
    const cascadeMap = {};
    function getPayNow(name, basePay) { return cascadeMap[name] !== undefined ? cascadeMap[name] : basePay; }

    // Apply extra to highest priority active card
    for (let mo = 0; mo < 120 && simCards.some(c => c.balance > 0.01); mo++) {
      months = mo + 1;
      simCards = simCards.map(c => {
        const interest = c.balance * (c.apr / 100 / 12);
        totalInt += interest;
        return { ...c, balance: c.balance + interest };
      });
      // Find top priority card for extra
      const topPriority = priorityOrder.find(n => !paidOffSet.has(n));
      simCards = simCards.map(c => {
        let pay = Math.min(getPayNow(c.name, c.planPay), c.balance);
        if (c.name === topPriority) pay = Math.min(pay + extraAmt, c.balance);
        return { ...c, balance: Math.max(0, c.balance - pay) };
      });
      const paidOff = simCards.filter(c => c.balance <= 0.01 && !paidOffSet.has(c.name));
      paidOff.forEach(p => {
        paidOffSet.add(p.name);
        const freed = getPayNow(p.name, p.planPay);
        const nextName = priorityOrder.find(n => !paidOffSet.has(n) && n !== p.name);
        if (nextName) {
          const nc = simCards.find(c => c.name === nextName);
          cascadeMap[nextName] = getPayNow(nextName, nc ? nc.planPay : 0) + freed;
        }
      });
      simCards = simCards.filter(c => c.balance > 0.01);
    }
    const d = new Date(sy, sm - 1 + months - 1, 1);
    const debtFree = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    return { months, interest: parseFloat(totalInt.toFixed(2)), debtFree };
  };

  const sim = simWithExtra(extra);
  const monthsSooner = baseMonths - sim.months;
  const interestSaved = baseTotalInterest - sim.interest;

  return (
    <HoverPanel color="#0097A7" style={{ marginBottom: 22 }}>
      <div style={{ height: 4, background: "linear-gradient(90deg, #0097A7, #00BCD4, #0097A7)", position: "absolute", top: 0, left: 0, right: 0 }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 900, color: "#006064", letterSpacing: 0.5 }}>
            {"\u{1F52E}"} What If?
          </div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>Explore the impact of extra monthly payments</div>
        </div>
        <div style={{ fontSize: 28, fontWeight: 900, fontFamily: FONT_MONO, color: extra > 0 ? "#0097A7" : "#ccc" }}>
          +{fmt(extra)}
        </div>
      </div>
      {/* Slider */}
      <div style={{ marginBottom: 18 }}>
        <input type="range" min={0} max={2000} step={25} value={extra}
          onChange={e => setExtra(parseInt(e.target.value))}
          style={{ width: "100%", height: 8, borderRadius: 4, outline: "none", cursor: "pointer", accentColor: "#0097A7" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#aaa", fontFamily: FONT_MONO, marginTop: 4 }}>
          <span>$0</span><span>$500</span><span>$1,000</span><span>$1,500</span><span>$2,000</span>
        </div>
      </div>
      {/* Results */}
      {extra > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <div style={{ textAlign: "center", padding: "14px 8px", borderRadius: 14, background: "rgba(46,125,50,0.06)", border: "1px solid rgba(46,125,50,0.18)" }}>
            <div style={{ fontSize: 15, marginBottom: 6 }}>{"\u26A1"}</div>
            <div style={{ fontSize: 9, color: "#999", letterSpacing: 1.5, fontWeight: 700, fontFamily: FONT_MONO, textTransform: "uppercase", marginBottom: 6 }}>Months Sooner</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#2E7D32", fontFamily: FONT_MONO }}>{monthsSooner}</div>
            <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>{(monthsSooner / 12).toFixed(1)} years</div>
          </div>
          <div style={{ textAlign: "center", padding: "14px 8px", borderRadius: 14, background: "rgba(230,81,0,0.06)", border: "1px solid rgba(230,81,0,0.18)" }}>
            <div style={{ fontSize: 15, marginBottom: 6 }}>{"\u{1F4B0}"}</div>
            <div style={{ fontSize: 9, color: "#999", letterSpacing: 1.5, fontWeight: 700, fontFamily: FONT_MONO, textTransform: "uppercase", marginBottom: 6 }}>Interest Saved</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#E65100", fontFamily: FONT_MONO }}>{fmt(interestSaved)}</div>
          </div>
          <div style={{ textAlign: "center", padding: "14px 8px", borderRadius: 14, background: "rgba(0,151,167,0.06)", border: "1px solid rgba(0,151,167,0.18)" }}>
            <div style={{ fontSize: 15, marginBottom: 6 }}>{"\u{1F3C6}"}</div>
            <div style={{ fontSize: 9, color: "#999", letterSpacing: 1.5, fontWeight: 700, fontFamily: FONT_MONO, textTransform: "uppercase", marginBottom: 6 }}>New Debt-Free</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: "#0097A7", fontFamily: FONT_MONO }}>{sim.debtFree}</div>
            <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>vs {baseDebtFree}</div>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "16px", color: "#bbb", fontSize: 13, fontStyle: "italic" }}>
          Drag the slider to see how extra payments accelerate your debt payoff
        </div>
      )}
    </HoverPanel>
  );
}

/* ══════════════════════ TAB: CALENDAR ══════════════════════ */
function CalendarTab({ plan, onPushToCalendar, cards }) {
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  const [pushed, setPushed] = useState({});

  const allSwitches = plan.schedule.flatMap(mo => mo.switchInstructions.map(sw => ({ ...sw, date: mo.label, isoDate: mo.isoDate, remaining: mo.totalRemaining })));
  const reviews = [];
  for (let i = 0; i < plan.schedule.length; i += 3) {
    const m = plan.schedule[i];
    if (m) reviews.push({ label: "Budget Review \u2014 " + m.label, date: m.isoDate, remaining: m.totalRemaining, desc: "Quarterly budget review.\nDebt remaining: " + fmt(m.totalRemaining) + "\nReview paydown plan and adjust allocations." });
  }

  const pushEvent = (title, date, desc, key) => {
    if (onPushToCalendar) {
      onPushToCalendar({ title, date, description: desc });
      setPushed(p => ({ ...p, [key || title + date]: true }));
    }
  };

  const pushAllDueDates = () => {
    if (!onPushToCalendar || !cards) return;
    cards.forEach(card => {
      if (num(card.balance) <= 0) return;
      const key = "due-" + card.name;
      const desc = card.name + " payment due\nBalance: " + fmt(card.balance) + "\nMin: " + fmt(card.minPay) + "\nPlan: " + fmt(getPlanPay(card, { ...(FORCED_OVERRIDES) }));
      onPushToCalendar({ title: "\u{1F4B3} " + card.name + " Due", date: new Date().toISOString().slice(0, 10), description: desc });
      setPushed(p => ({ ...p, [key]: true }));
    });
  };

  const pushAllMilestones = () => {
    if (!onPushToCalendar) return;
    allSwitches.forEach((sw, i) => {
      const key = "milestone-" + i;
      const desc = sw.paidOff + " PAID OFF!\nDebt remaining: " + fmt(sw.remaining) + "\nFreed: " + fmt(sw.freedAmt) + "/mo\n" + (sw.nextCard ? "Move " + fmt(sw.freedAmt) + " to " + sw.nextCard : "COMPLETELY DEBT FREE!");
      onPushToCalendar({ title: "\u2713 " + sw.paidOff + " Paid Off!", date: sw.isoDate, description: desc });
      setPushed(p => ({ ...p, [key]: true }));
    });
  };

  // Calendar grid helpers
  const daysInMonth = new Date(calMonth.year, calMonth.month + 1, 0).getDate();
  const firstDow = new Date(calMonth.year, calMonth.month, 1).getDay();
  const monthLabel = new Date(calMonth.year, calMonth.month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Build events map for this month
  const dayEvents = {};
  const addDayEvent = (day, ev) => { if (!dayEvents[day]) dayEvents[day] = []; dayEvents[day].push(ev); };

  // Card due dates — parse due dates for current view month
  if (cards) {
    cards.forEach((card, ci) => {
      if (num(card.balance) <= 0) return;
      const dueStr = (card.due || "").toLowerCase();
      const dayMatch = dueStr.match(/(\d+)/);
      if (dayMatch) {
        const day = parseInt(dayMatch[1]);
        if (day >= 1 && day <= daysInMonth) {
          addDayEvent(day, { type: "due", label: card.name, color: CARD_ACCENTS[ci % CARD_ACCENTS.length] });
        }
      }
    });
  }

  // Payoff milestones
  allSwitches.forEach(sw => {
    const d = new Date(sw.isoDate);
    if (d.getFullYear() === calMonth.year && d.getMonth() === calMonth.month) {
      addDayEvent(d.getDate(), { type: "milestone", label: sw.paidOff + " paid off", color: "#2E7D32" });
    }
  });

  // Quarterly reviews
  reviews.forEach(r => {
    const d = new Date(r.date);
    if (d.getFullYear() === calMonth.year && d.getMonth() === calMonth.month) {
      addDayEvent(d.getDate(), { type: "review", label: "Budget Review", color: "#7B1FA2" });
    }
  });

  const prevMonth = () => setCalMonth(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { year: p.year, month: p.month - 1 });
  const nextMonth = () => setCalMonth(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { year: p.year, month: p.month + 1 });
  const today = new Date();
  const isToday = (day) => today.getFullYear() === calMonth.year && today.getMonth() === calMonth.month && today.getDate() === day;

  const calCells = [];
  for (let i = 0; i < firstDow; i++) calCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calCells.push(d);

  return (
    <div>
      {/* Month-view calendar grid */}
      <HoverPanel color="#0097A7" style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <button style={{ ...btnLight, padding: "8px 14px", fontSize: 16, fontWeight: 700 }} onClick={prevMonth}>{"\u2039"}</button>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#006064", letterSpacing: 0.5 }}>{monthLabel}</div>
          <button style={{ ...btnLight, padding: "8px 14px", fontSize: 16, fontWeight: 700 }} onClick={nextMonth}>{"\u203A"}</button>
        </div>
        {/* Day headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
            <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#aaa", fontFamily: FONT_MONO, letterSpacing: 1, padding: "4px 0", textTransform: "uppercase" }}>{d}</div>
          ))}
        </div>
        {/* Calendar cells */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {calCells.map((day, i) => {
            if (day === null) return <div key={"e" + i} style={{ minHeight: 60 }} />;
            const evts = dayEvents[day] || [];
            const hasMilestone = evts.some(e => e.type === "milestone");
            const hasReview = evts.some(e => e.type === "review");
            return (
              <div key={day} style={{
                minHeight: 60, padding: "4px 3px", borderRadius: 10, position: "relative",
                background: isToday(day) ? "rgba(0,151,167,0.08)" : hasMilestone ? "rgba(46,125,50,0.06)" : hasReview ? "rgba(123,31,162,0.06)" : "rgba(0,0,0,0.015)",
                border: isToday(day) ? "2px solid #0097A7" : "1px solid rgba(0,0,0,0.04)",
                transition: "all 0.2s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,151,167,0.1)"; e.currentTarget.style.transform = "scale(1.03)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = isToday(day) ? "rgba(0,151,167,0.08)" : hasMilestone ? "rgba(46,125,50,0.06)" : hasReview ? "rgba(123,31,162,0.06)" : "rgba(0,0,0,0.015)"; e.currentTarget.style.transform = "none"; }}>
                <div style={{ fontSize: 11, fontWeight: isToday(day) ? 900 : 600, color: isToday(day) ? "#0097A7" : "#555", fontFamily: FONT_MONO, marginBottom: 2, textAlign: "right", paddingRight: 2 }}>{day}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {evts.slice(0, 3).map((ev, ei) => (
                    <div key={ei} style={{
                      fontSize: 8, fontWeight: 700, color: "#fff", padding: "1px 4px", borderRadius: 4,
                      background: ev.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      lineHeight: "14px",
                    }} title={ev.label}>
                      {ev.type === "due" ? "\u{1F4B3}" : ev.type === "milestone" ? "\u2713" : "\u{1F4CB}"} {ev.label.slice(0, 10)}
                    </div>
                  ))}
                  {evts.length > 3 && <div style={{ fontSize: 8, color: "#999", textAlign: "center" }}>+{evts.length - 3}</div>}
                </div>
              </div>
            );
          })}
        </div>
        {/* Legend */}
        <div style={{ display: "flex", gap: 16, marginTop: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {[
            { label: "Due Date", color: "#3b82f6", icon: "\u{1F4B3}" },
            { label: "Payoff Milestone", color: "#2E7D32", icon: "\u2713" },
            { label: "Quarterly Review", color: "#7B1FA2", icon: "\u{1F4CB}" },
          ].map((l, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#888" }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />
              <span>{l.icon} {l.label}</span>
            </div>
          ))}
        </div>
      </HoverPanel>

      {/* Push All buttons */}
      {onPushToCalendar && (
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          <button style={{ ...btnPrimary("#0097A7"), flex: 1, padding: "12px 16px", fontSize: 13 }} onClick={pushAllDueDates}>
            {"\u{1F4B3}"} Push All Due Dates
          </button>
          <button style={{ ...btnPrimary("#2E7D32"), flex: 1, padding: "12px 16px", fontSize: 13 }} onClick={pushAllMilestones}>
            {"\u{1F3C6}"} Push All Milestones
          </button>
        </div>
      )}

      <div style={panel("#0097A7")}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#006064", letterSpacing: 1, marginBottom: 4 }}>CALENDAR EVENTS</div>
        <div style={{ fontSize: 13, color: "#888" }}>{onPushToCalendar ? "Click to push directly to your Google Calendar." : "Connect Google to push events to your calendar."}</div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: 2, marginBottom: 12, fontFamily: FONT_MONO }}>PAYOFF MILESTONES</div>
        {allSwitches.map((sw, i) => {
          const key = "milestone-" + i;
          const isPushed = pushed[key];
          const desc = sw.paidOff + " PAID OFF!\nDebt remaining: " + fmt(sw.remaining) + "\nFreed: " + fmt(sw.freedAmt) + "/mo\n" + (sw.nextCard ? "Move " + fmt(sw.freedAmt) + " to " + sw.nextCard + "\nNew payment: " + fmt(sw.newAmount) + "/mo" : "COMPLETELY DEBT FREE!");
          return (
            <div key={i} onClick={() => !isPushed && pushEvent("\u2713 " + sw.paidOff + " Paid Off!", sw.isoDate, desc, key)}
              style={{ ...panel("#2E7D32"), cursor: onPushToCalendar && !isPushed ? "pointer" : "default", marginBottom: 10, opacity: isPushed ? 0.7 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#2E7D32", marginBottom: 4 }}>{"\u2713"} {sw.paidOff} paid off | {sw.date}</div>
                  <div style={{ fontSize: 13, color: "#666", marginBottom: 3 }}>Remaining: <span style={{ color: "#1a1a2e", fontWeight: 700 }}>{fmt(sw.remaining)}</span> | Freed: <span style={{ color: "#E65100", fontWeight: 700 }}>{fmt(sw.freedAmt)}/mo</span></div>
                  {sw.nextCard ? (
                    <div style={{ fontSize: 13, color: "#0097A7", fontWeight: 600 }}>{"\u2192"} Move {fmt(sw.freedAmt)} to <span style={{ fontWeight: 700 }}>{sw.nextCard}</span> | new total: <span style={{ color: "#E65100", fontWeight: 700 }}>{fmt(sw.newAmount)}/mo</span></div>
                  ) : (
                    <div style={{ fontSize: 14, color: "#2E7D32", fontWeight: 800 }}>{"\u{1F389}"} Completely debt free!</div>
                  )}
                </div>
                {onPushToCalendar && (
                  isPushed
                    ? <div style={{ fontSize: 14, color: "#2E7D32", fontWeight: 700, marginLeft: 12, flexShrink: 0 }}>{"\u2705"}</div>
                    : <div style={{ fontSize: 12, color: "#0097A7", fontWeight: 700, marginLeft: 12, flexShrink: 0, fontFamily: FONT_MONO }}>PUSH {"\u2192"}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: 2, marginBottom: 12, fontFamily: FONT_MONO }}>QUARTERLY REVIEWS</div>
        {reviews.map((r, i) => {
          const key = "review-" + i;
          const isPushed = pushed[key];
          return (
            <div key={i} onClick={() => !isPushed && pushEvent(r.label, r.date, r.desc, key)}
              style={{ ...panel("#7B1FA2"), cursor: onPushToCalendar && !isPushed ? "pointer" : "default", marginBottom: 10, opacity: isPushed ? 0.7 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>{r.label}</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>Remaining: {fmt(r.remaining)}</div>
                </div>
                {onPushToCalendar && (
                  isPushed
                    ? <div style={{ fontSize: 14, color: "#2E7D32", fontWeight: 700 }}>{"\u2705"}</div>
                    : <div style={{ fontSize: 12, color: "#7B1FA2", fontWeight: 700, fontFamily: FONT_MONO }}>PUSH {"\u2192"}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════ MAIN EXPORT ══════════════════════ */
export default function BudgetManager({ onPushToCalendar }) {
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState(loadData);
  const [saveStatus, setSaveStatus] = useState("saved");
  const timer = useRef(null);

  useEffect(() => {
    setSaveStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const toSave = { ...data, overrides: { ...(data.overrides || {}), ...FORCED_OVERRIDES } };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
        setSaveStatus("saved");
      } catch(e) { setSaveStatus("error"); }
    }, 900);
  }, [data]);

  const plan = buildPlan(data);
  const totalIncome = data.income.reduce((s, i) => s + num(i.v), 0);
  const totalLiving = data.cats.reduce((s, c) => s + c.items.reduce((ss, i) => ss + num(i.v), 0), 0);
  const totalDebtPay = plan.totalMonthlyDebt;
  const totalOut = totalLiving + totalDebtPay;
  const remaining = totalIncome - totalOut;
  const totalDebt = data.cards.reduce((s, c) => s + num(c.balance), 0);
  const totalLimit = data.cards.reduce((s, c) => s + num(c.limit), 0);
  const totalMinPay = data.cards.reduce((s, c) => s + num(c.minPay), 0);

  const TABS = ["overview", "expenses", "cards", "plan", "calendar"];
  const TAB_LABELS = { overview: "Overview", expenses: "Expenses", cards: "Cards", plan: "Plan", calendar: "Calendar" };
  const TAB_COLORS = { overview: "#7B1FA2", expenses: "#E65100", cards: "#C62828", plan: "#0097A7", calendar: "#2E7D32" };

  const TAB_ICONS = { overview: "\u{1F4CA}", expenses: "\u{1F4DD}", cards: "\u{1F4B3}", plan: "\u{1F680}", calendar: "\u{1F4C5}" };

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: -0.5, background: "linear-gradient(135deg, #7B1FA2, #E65100, #0097A7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Personal Budget</div>
          <div style={{ fontSize: 11, color: "#aaa", fontFamily: FONT_MONO, letterSpacing: 2, marginTop: 2 }}>HYBRID PAYDOWN ENGINE</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: saveStatus === "saved" ? "#2E7D32" : saveStatus === "saving" ? "#E65100" : "#C62828", animation: saveStatus === "saving" ? "pulseDot 1.5s ease-in-out infinite" : "none" }} />
          <span style={{ fontSize: 11, color: saveStatus === "saved" ? "#2E7D32" : saveStatus === "saving" ? "#E65100" : "#C62828", fontWeight: 700, fontFamily: FONT_MONO, letterSpacing: 1 }}>
            {saveStatus === "saved" ? "AUTO-SAVED" : saveStatus === "saving" ? "SAVING\u2026" : "ERROR"}
          </span>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, padding: "6px", borderRadius: 16, background: "rgba(255,255,255,0.5)", backdropFilter: "blur(12px)", border: "1px solid rgba(0,0,0,0.06)" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, minWidth: 60, padding: "10px 6px", borderRadius: 12, cursor: "pointer",
            fontSize: 11, fontWeight: 700, textAlign: "center", fontFamily: FONT_MONO,
            letterSpacing: 0.5, textTransform: "uppercase", whiteSpace: "nowrap",
            border: "none",
            background: tab === t ? `linear-gradient(135deg, ${TAB_COLORS[t]}, ${TAB_COLORS[t]}cc)` : "transparent",
            color: tab === t ? "#fff" : "#999",
            boxShadow: tab === t ? `0 4px 16px ${TAB_COLORS[t]}30` : "none",
            transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          onMouseEnter={e => { if (tab !== t) { e.currentTarget.style.background = "rgba(0,0,0,0.03)"; e.currentTarget.style.color = "#555"; } }}
          onMouseLeave={e => { if (tab !== t) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#999"; } }}>
            <span style={{ display: "block", fontSize: 14, marginBottom: 2 }}>{TAB_ICONS[t]}</span>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab data={data} setData={setData} totalIncome={totalIncome} totalLiving={totalLiving} totalDebtPay={totalDebtPay} totalOut={totalOut} remaining={remaining} totalDebt={totalDebt} totalLimit={totalLimit} plan={plan} />}
      {tab === "expenses" && <ExpensesTab data={data} setData={setData} totalLiving={totalLiving} totalDebtPay={totalDebtPay} totalIncome={totalIncome} />}
      {tab === "cards" && <CardsTab data={data} setData={setData} totalDebt={totalDebt} totalLimit={totalLimit} totalMinPay={totalMinPay} totalDebtPay={totalDebtPay} />}
      {tab === "plan" && <PlanTab data={data} setData={setData} plan={plan} totalIncome={totalIncome} totalLiving={totalLiving} />}
      {tab === "calendar" && <CalendarTab plan={plan} onPushToCalendar={onPushToCalendar} cards={data.cards} />}

      <style>{`
        @media (max-width: 768px) {
          .budget-stat-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
      `}</style>
    </div>
  );
}
