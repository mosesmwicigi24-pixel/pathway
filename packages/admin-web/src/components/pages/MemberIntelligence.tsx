// Member Intelligence — SuperAdmin/Admin analytics cockpit. Ported to match the
// iPad app's "People Intelligence" design (iPad has design precedence): pastel
// tinted KPI cards, premium tables, charts with visible axes, brand colours
// (bright green / gold / navy) only. Every number is real (AdminApi.intelligence
// → /admin/analytics/intelligence). Telemetry not yet captured (device model,
// screen dwell, login frequency, geo) is gated on the payload's boolean capture
// flags and rendered as honest "coming" notes — never fabricated. Prayer is
// excluded (pastoral-private, §5.4).
//
// Data fetching + wiring are unchanged from the prior version — this is a
// visual/design port only.
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import {
  Brain, Wallet, Users, Smartphone, Activity, BookOpen, MapPin, TrendingUp,
  Sparkles, Clock, Lock, Trophy, Gift, Repeat, PieChart as PieIcon, Grid2x2,
  Building2, Globe, BarChart3, CalendarCheck, CalendarDays, BadgeCheck,
  CheckCircle2, HelpCircle, Hourglass, Radio, type LucideIcon,
} from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, AreaChart, Area, Legend,
} from "recharts";
import { AdminApi, type MemberIntelligence as Intel } from "../../api/client";

// ── Brand palette (matches index.css tokens; bright green / gold / navy only) ──
const NAVY = "#1d4e86";        // brand navy used for charts (lighter, on-brand)
const NAVY_INK = "#0b1f33";    // deep navy for text / hero
const GOLD = "#c89b3c";
const GREEN = "#22c55e";       // --nuru-green / --lum-green
const TEAL = "#0d7e73";
const VIOLET = "#5b2bb8";
const RED = "#dc2626";
// Brand tint rotation for ranked bars / fund rows.
const BRAND_TINTS = [NAVY, GOLD, TEAL, GREEN, VIOLET];

// Canonical engagement-band ordering + colour for the donut.
const BANDS: { key: string; name: string; color: string }[] = [
  { key: "thriving", name: "Thriving", color: GREEN },
  { key: "steady", name: "Steady", color: NAVY },
  { key: "watch", name: "Watch", color: GOLD },
  { key: "at_risk", name: "At-risk", color: RED },
];

const money = (minor: number, ccy: string): string =>
  `${ccy} ${Math.round((minor ?? 0) / 100).toLocaleString()}`;
const pct1 = (v: number): string => `${(v ?? 0).toFixed(1)}%`;
const pretty = (s: string): string => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const methodLabel = (m: string): string => {
  switch (m.toLowerCase()) {
    case "mpesa": return "M-Pesa";
    case "airtel": return "Airtel";
    case "paypal": return "PayPal";
    case "card": case "stripe": return "Card";
    case "bank": case "bank_transfer": return "Bank";
    default: return m ? pretty(m) : "—";
  }
};

const KIND_LABEL: Record<string, string> = {
  lesson_open: "Lessons", lesson_view: "Lessons",
  scripture_read: "Scripture", verse_read: "Scripture",
  video_75pct: "Video", video_complete: "Video", video_play: "Video",
  quiz_attempt: "Quizzes", quiz_submit: "Quizzes",
  reflection_submit: "Reflections", reflection: "Reflections",
  plan_open: "Reading plans", reading_plan: "Reading plans",
  prayer: "Prayer", prayer_log: "Prayer",
  habit_check: "Habits", habit: "Habits",
  event_rsvp: "Events", event_view: "Events",
  give_open: "Giving", giving: "Giving",
  chat_open: "Chat", message: "Chat",
};
const kindLabel = (k: string): string => KIND_LABEL[k.toLowerCase()] ?? pretty(k);

const platformLabel = (p: string): string => {
  switch (p.toLowerCase()) {
    case "ios": return "iOS";
    case "android": return "Android";
    case "web": return "Web";
    default: return p ? pretty(p) : "Unknown";
  }
};
const platformColor = (p: string): string => {
  switch (p.toLowerCase()) {
    case "ios": return NAVY;
    case "android": return GREEN;
    case "web": return GOLD;
    default: return "#9ca3af";
  }
};

const hourLabel = (h: number): string => {
  const hr = ((h % 24) + 24) % 24;
  if (hr === 0) return "12a";
  if (hr === 12) return "12p";
  return hr < 12 ? `${hr}a` : `${hr - 12}p`;
};

const monthShort = (s: string): string => {
  const parts = s.split("-");
  const m = parts.length >= 2 ? Number(parts[1]) : NaN;
  if (m >= 1 && m <= 12) {
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] ?? s;
  }
  return s;
};

let regionNames: Intl.DisplayNames | null = null;
try { regionNames = new Intl.DisplayNames(undefined, { type: "region" }); } catch { regionNames = null; }
const countryName = (code: string): string => {
  const c = (code ?? "").toUpperCase();
  if (!c) return "—";
  try { return regionNames?.of(c) ?? c; } catch { return c; }
};

export function MemberIntelligence(): ReactElement {
  const [d, setD] = useState<Intel | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    AdminApi.intelligence().then(setD).catch(() => setErr("Could not load intelligence (Admin/SuperAdmin only)."));
  }, []);

  const ccy = d?.giving.currency || "KES";

  // Engagement bands ordered canonically; missing bands default to 0.
  const bandData = useMemo(() => {
    const by = new Map((d?.engagement.bands ?? []).map((b) => [b.band, b.members]));
    return BANDS.map((b) => ({ name: b.name, value: by.get(b.key) ?? 0, color: b.color }));
  }, [d]);

  const platformData = useMemo(
    () => (d?.devices.platforms ?? []).filter((p) => p.members > 0)
      .map((p) => ({ name: platformLabel(p.platform), value: p.members, color: platformColor(p.platform) })),
    [d],
  );

  if (err) {
    return (
      <div style={cardStyle(20)}>
        <h3 style={{ color: NAVY_INK, fontWeight: 700, fontFamily: "var(--font-display)" }}>Member Intelligence</h3>
        <p style={{ color: "var(--muted-foreground)", marginTop: 6 }}>{err}</p>
      </div>
    );
  }
  if (!d) return <div style={{ padding: 24, color: "var(--muted-foreground)" }}>Loading intelligence…</div>;

  const k = d.kpis;
  const g = d.giving;
  const dv = d.devices;
  const en = d.engagement;
  const gr = d.growth;
  const loc = d.location;
  const passRate = gr.quiz_attempts > 0 ? Math.round((gr.quiz_passed / gr.quiz_attempts) * 100) : 0;

  // Giving frequency, fixed bucket order, missing → 0.
  const freqOrder = ["1", "2-3", "4-6", "7+"];
  const freqByBucket = new Map(g.frequency.map((f) => [f.bucket, f.givers]));
  const freqColors = [NAVY, GOLD, TEAL, GREEN];
  const freqData = freqOrder.map((b, i) => ({ bucket: b, givers: freqByBucket.get(b) ?? 0, color: freqColors[i] ?? GOLD }));
  const freqTotal = freqData.reduce((s, f) => s + f.givers, 0);

  // Activity by hour 0..23, missing → 0; flag the peak.
  const hourMap = new Map(en.by_hour.map((h) => [h.hour, h.events]));
  const hourData = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: hourLabel(h), events: hourMap.get(h) ?? 0 }));
  const hourTotal = hourData.reduce((s, h) => s + h.events, 0);
  const peakHour = hourData.reduce((a, b) => (b.events > a.events ? b : a), hourData[0]!);

  // Giving trend (KES major units).
  const trendData = g.trend.map((t) => ({ month: monthShort(t.month), v: Math.round(t.total_minor / 100) }));

  // Per-level distribution (learners + completed).
  const levelData = [...gr.by_level].sort((a, b) => a.level_number - b.level_number)
    .map((l) => ({ level: `L${l.level_number}`, Learners: l.learners, Completed: l.completed }));
  const levelHasData = levelData.some((l) => l.Learners > 0 || l.Completed > 0);

  const bandTotal = bandData.reduce((s, b) => s + b.value, 0);
  const platTotal = platformData.reduce((s, p) => s + p.value, 0);
  const active7Pct = k.total_members > 0 ? Math.round((k.active_7d / k.total_members) * 100) : 0;

  const deviceComing: string[] = [];
  if (!dv.model_capture) deviceComing.push("Exact device model & OS version — coming with capture-on-login.");
  if (!en.screen_dwell_capture) deviceComing.push("Per-screen time (which areas they linger in) — coming once screen telemetry ships.");
  if (!en.login_capture) deviceComing.push("Active-days are used as the login proxy — exact sign-in timestamps aren't captured yet.");

  return (
    <div className="flex flex-col gap-6" style={{ padding: 4 }}>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--nuru-navy-gradient, " + NAVY_INK + ")", color: "#fff", padding: "24px 26px", position: "relative" }}>
        <div style={{ position: "absolute", right: -50, top: -60, width: 200, height: 200, borderRadius: 999, background: "rgba(200,155,60,0.16)" }} />
        <div className="flex items-center justify-between" style={{ position: "relative" }}>
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "rgba(255,255,255,0.75)" }}>
            <span>System</span><span style={{ opacity: 0.5 }}>›</span><span style={{ color: "#fff" }}>People Intelligence</span>
          </div>
          <span className="flex items-center gap-1" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: GOLD, background: "rgba(200,155,60,0.16)", padding: "4px 9px", borderRadius: 999 }}>
            <Lock size={11} /> Admin only
          </span>
        </div>
        <div style={{ position: "relative", marginTop: 14 }}>
          <div className="flex items-center gap-1.5" style={{ color: "#e6c46a", fontSize: 11, fontWeight: 700, letterSpacing: 1.8, textTransform: "uppercase" }}>
            <Brain size={14} /> People &amp; Growth
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 30, marginTop: 6, lineHeight: 1.1 }}>People Intelligence</h1>
          <p style={{ color: "rgba(255,255,255,0.72)", fontSize: 13.5, marginTop: 6, maxWidth: 620, lineHeight: 1.55 }}>
            Who your people are, how engaged they are, who gives, and how they use the app — one live read across the whole platform.
          </p>
        </div>
        {/* Hero stat strip */}
        <div style={{ position: "relative", marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: 1, background: "rgba(255,255,255,0.08)", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
          {[
            { label: "Members", value: `${k.total_members}`, hint: "on the pathway" },
            { label: "Active (7d)", value: `${k.active_7d}`, hint: "in-app last week" },
            { label: "Avg engagement", value: pct1(k.avg_engagement), hint: "0–100 score" },
            { label: "At risk", value: `${k.members_at_risk}`, hint: "need attention" },
            { label: "Givers", value: `${k.givers}`, hint: `${k.recurring_givers} recurring` },
          ].map((s) => (
            <div key={s.label} style={{ background: "rgba(255,255,255,0.05)", padding: "11px 13px" }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "rgba(255,255,255,0.6)" }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginTop: 3 }}>{s.value}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 1 }}>{s.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 1 · KPI strip (pastel tinted cards) ──────────────── */}
      <Section icon={Users} title="Overview" hint="Live membership, engagement & giving signal">
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <Kpi icon={Users} tint="navy" label="Total members" value={k.total_members} />
          <Kpi icon={Smartphone} tint="green" label="Active (7d)" value={k.active_7d} />
          <Kpi icon={CalendarDays} tint="teal" label="Active (30d)" value={k.active_30d} />
          <Kpi icon={TrendingUp} tint="gold" label="Avg engagement" value={pct1(k.avg_engagement)} />
          <Kpi icon={Activity} tint="rose" label="Members at risk" value={k.members_at_risk} />
          <Kpi icon={BadgeCheck} tint="green" label="Givers" value={k.givers} />
          <Kpi icon={Repeat} tint="violet" label="Recurring givers" value={k.recurring_givers} />
          <Kpi icon={Trophy} tint="amber" label="Certificates (mo.)" value={k.certificates_this_month} />
        </div>
      </Section>

      {/* ── 2 · Giving intelligence ──────────────────────────── */}
      <Section icon={Gift} title="Giving intelligence" hint={`${g.gift_count} gifts · ${g.givers} givers`}>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginBottom: 14 }}>
          <Kpi icon={Wallet} tint="green" label="Total giving" value={money(g.total_minor, ccy)} small />
          <Kpi icon={TrendingUp} tint="gold" label="Avg / transaction" value={money(g.avg_per_txn_minor, ccy)} small />
          <Kpi icon={BarChart3} tint="violet" label="Median gift" value={money(g.median_minor, ccy)} small />
          <Kpi icon={Users} tint="navy" label="Givers" value={g.givers} small />
        </div>

        {/* Giving frequency */}
        <SubCard icon={BarChart3} title="Giving frequency" hint="givers by gift count" className="mb-4">
          {freqTotal === 0 ? <Empty text="No giving recorded yet." /> : (
            <>
              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={freqData} margin={{ top: 18, right: 6, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="bucket" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 11, fill: "#6b7280" }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} width={34} />
                    <Tooltip cursor={{ fill: "rgba(11,31,51,0.05)" }} contentStyle={tip} />
                    <Bar dataKey="givers" radius={[5, 5, 0, 0]} maxBarSize={40}>
                      <LabelList dataKey="givers" position="top" style={{ fontSize: 10, fontWeight: 700, fill: NAVY_INK }} />
                      {freqData.map((f) => <Cell key={f.bucket} fill={f.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-3.5 gap-y-1.5" style={{ marginTop: 10 }}>
                {freqData.map((f) => (
                  <span key={f.bucket} className="flex items-center gap-1.5" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: f.color, display: "inline-block" }} /> {f.bucket} gifts
                  </span>
                ))}
              </div>
            </>
          )}
        </SubCard>

        {/* Top givers — premium table */}
        <div style={{ ...cardStyle(0), overflow: "hidden", marginBottom: 16 }}>
          <CardHeader icon={Trophy} title="Top givers" hint="by total" />
          {g.top_givers.length === 0 ? <div style={{ padding: 16 }}><Empty text="No givers yet." /></div> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--secondary)" }}>
                  <th style={{ ...thL }}>GIVER</th>
                  <th style={thR}>GIFTS</th>
                  <th style={thR}>TOTAL</th>
                  <th style={thR}>AVG</th>
                  <th style={thR}>LAST</th>
                </tr>
              </thead>
              <tbody>
                {g.top_givers.slice(0, 12).map((t, i) => {
                  const name = t.name || "Anonymous";
                  return (
                    <tr key={t.user_id || name} style={{ borderTop: "1px solid var(--border)", background: i % 2 === 1 ? "rgba(238,240,243,0.45)" : "transparent" }}>
                      <td style={{ ...tdL }}>
                        <span className="flex items-center gap-2.5">
                          <span style={rankBadge(i + 1)}>{i + 1}</span>
                          <span style={monogram()}>{initials(name)}</span>
                          <span style={{ fontWeight: 600, color: NAVY_INK }}>{name}</span>
                        </span>
                      </td>
                      <td style={tdR}>{t.gifts}</td>
                      <td style={{ ...tdR, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14.5, color: NAVY_INK }}>{money(t.total_minor, ccy)}</td>
                      <td style={{ ...tdR, color: "var(--muted-foreground)" }}>{money(t.avg_minor, ccy)}</td>
                      <td style={{ ...tdR, color: "#9ca3af", fontWeight: 500 }}>
                        {t.last_at ? new Date(t.last_at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Giving trend */}
        <SubCard icon={TrendingUp} title="Giving trend" hint={`last 6 months · ${ccy}`} className="mb-4">
          {trendData.length === 0 ? <Empty text="No giving recorded yet." /> : (
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 8, right: 6, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="giveTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={GOLD} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={GOLD} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 11, fill: "#6b7280" }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#6b7280" }} width={40}
                    tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)} />
                  <Tooltip cursor={{ stroke: GOLD, strokeOpacity: 0.4 }} contentStyle={tip} />
                  <Area type="monotone" dataKey="v" stroke={GOLD} strokeWidth={2.5} fill="url(#giveTrend)" dot={{ r: 3, fill: GOLD }} activeDot={{ r: 5 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </SubCard>

        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          {/* By fund */}
          <SubCard icon={Wallet} title="Giving by fund" hint={`all-time · ${ccy}`}>
            <BarList
              rows={[...g.by_fund].filter((f) => f.total_minor > 0).sort((a, b) => b.total_minor - a.total_minor)
                .map((f, i) => ({
                  label: f.code ? pretty(f.code) : "—",
                  value: Math.round(f.total_minor / 100),
                  display: money(f.total_minor, ccy),
                  tag: `${f.count}`,
                  color: BRAND_TINTS[i % BRAND_TINTS.length],
                }))}
              showPct
              emptyText="No fund giving recorded yet."
            />
          </SubCard>

          {/* By method — recurring schedules table */}
          <div style={{ ...cardStyle(0), overflow: "hidden" }}>
            <CardHeader icon={Repeat} title="Recurring by method" hint="active schedules" />
            {g.by_method.length === 0 ? <div style={{ padding: 16 }}><Empty text="No active recurring schedules." /></div> : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--secondary)" }}>
                    <th style={thL}>METHOD</th><th style={thR}>SCHEDULES</th><th style={thR}>GIVERS</th>
                  </tr>
                </thead>
                <tbody>
                  {[...g.by_method].sort((a, b) => b.schedules - a.schedules).map((m, i) => (
                    <tr key={m.method} style={{ borderTop: "1px solid var(--border)", background: i % 2 === 1 ? "rgba(238,240,243,0.45)" : "transparent" }}>
                      <td style={tdL}>
                        <span className="flex items-center gap-2.5">
                          <span style={tintChip(BRAND_TINTS[i % BRAND_TINTS.length])}><Wallet size={14} /></span>
                          <span style={{ fontWeight: 600, color: NAVY_INK }}>{methodLabel(m.method)}</span>
                        </span>
                      </td>
                      <td style={{ ...tdR, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14.5, color: NAVY_INK }}>{m.schedules}</td>
                      <td style={{ ...tdR, color: "var(--muted-foreground)" }}>{m.givers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </Section>

      {/* ── 3 · App usage & devices ──────────────────────────── */}
      <Section icon={Smartphone} title="App usage & devices" hint="Platforms, versions & when the app is used">
        {/* Active highlight */}
        <div style={{ ...cardStyle(18), marginBottom: 16 }} className="flex items-center gap-4">
          <span style={{ width: 52, height: 52, borderRadius: 14, background: "var(--tint-green-bg)", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <Radio size={24} style={{ color: "var(--tint-green-fg)" }} />
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted-foreground)" }}>Active in app</div>
            <div className="flex items-baseline gap-5" style={{ marginTop: 2 }}>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 30, color: NAVY_INK, lineHeight: 1 }}>{k.active_7d}</div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: "#9ca3af", marginTop: 2 }}>LAST 7 DAYS</div>
              </div>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 30, color: "var(--tint-green-fg)", lineHeight: 1 }}>{k.active_30d}</div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: "#9ca3af", marginTop: 2 }}>LAST 30 DAYS</div>
              </div>
            </div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--tint-green-fg)", lineHeight: 1 }}>{active7Pct}%</div>
            <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>of {k.total_members}</div>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", marginBottom: 16 }}>
          {/* Platform split donut */}
          <SubCard icon={PieIcon} title="Platform split" hint={`${platTotal} devices`}>
            {platTotal === 0 ? <Empty text="No platform data yet." /> : (
              <div className="flex items-center gap-4">
                <Donut data={platformData} centerLabel="Devices" centerValue={platTotal} />
                <ul className="flex flex-col gap-2" style={{ flex: 1 }}>
                  {platformData.map((p) => (
                    <li key={p.name} className="flex items-center gap-2">
                      <span style={{ width: 9, height: 9, borderRadius: 99, background: p.color }} />
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: NAVY_INK }}>{p.name}</span>
                      <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 600, color: NAVY_INK }}>{p.value}</span>
                      <span style={{ fontSize: 11, color: "var(--muted-foreground)", width: 36, textAlign: "right" }}>
                        {Math.round((p.value / platTotal) * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SubCard>

          {/* App version adoption table */}
          <SubCard icon={Smartphone} title="App-version adoption" hint={`top ${Math.min(dv.app_versions.length, 8)}`}>
            {dv.app_versions.length === 0 ? <Empty text="No version data yet." /> : (
              <BarList
                rows={dv.app_versions.slice(0, 8).map((v, i) => ({
                  label: v.app_version || "—",
                  value: v.members,
                  display: `${v.members}`,
                  color: i === 0 ? GREEN : GOLD,
                  mono: true,
                }))}
              />
            )}
          </SubCard>
        </div>

        {/* Activity by hour */}
        <SubCard icon={Clock} title="Activity by hour" hint={hourTotal > 0 ? `peak ${peakHour.label}` : "when the app is used"} className="mb-4">
          {hourTotal === 0 ? <Empty text="No in-app activity recorded yet." /> : (
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourData} margin={{ top: 8, right: 6, left: -16, bottom: 0 }} barCategoryGap={1}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 10, fill: "#6b7280" }}
                    ticks={["12a", "6a", "12p", "6p"]} interval={0} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} width={34} />
                  <Tooltip cursor={{ fill: "rgba(11,31,51,0.05)" }} contentStyle={tip} />
                  <Bar dataKey="events" radius={[2, 2, 0, 0]}>
                    {hourData.map((h) => <Cell key={h.hour} fill={h.hour === peakHour.hour ? GREEN : GOLD} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SubCard>

        {/* Gated "coming" notes — only genuinely-missing telemetry */}
        {deviceComing.length > 0 && (
          <div style={comingCard}>
            {deviceComing.map((n) => (
              <div key={n} className="flex items-start gap-2" style={{ marginBottom: 6 }}>
                <Hourglass size={12} style={{ color: "#cbd5e1", marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, color: "#9ca3af", lineHeight: 1.45 }}>{n}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── 4 · App-area affinity ────────────────────────────── */}
      <Section icon={Grid2x2} title="App-area affinity" hint="Which content members engage with most">
        <div style={{ ...cardStyle(0), overflow: "hidden" }}>
          <CardHeader icon={Grid2x2} title="Content areas" hint="events · members" />
          {en.by_kind.length === 0 ? <div style={{ padding: 16 }}><Empty text="No app-area engagement recorded yet." /></div> : (
            <BarList
              padded
              rows={[...en.by_kind].sort((a, b) => b.events - a.events).map((x, i) => ({
                label: kindLabel(x.kind),
                value: x.events,
                display: `${x.events.toLocaleString()}`,
                tag: `${x.members} ppl`,
                color: BRAND_TINTS[i % BRAND_TINTS.length],
              }))}
            />
          )}
        </div>
      </Section>

      {/* ── 5 · Engagement & growth ──────────────────────────── */}
      <Section icon={PieIcon} title="Engagement & growth" hint={`${bandTotal} members · ${pct1(k.avg_engagement)} avg score`}>
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", marginBottom: 16 }}>
          {/* Engagement bands donut */}
          <SubCard icon={PieIcon} title="Engagement bands" hint={`${bandTotal} members`}>
            <div className="flex items-center gap-4">
              <Donut data={bandTotal === 0 ? [{ name: "None", value: 1, color: "var(--border)" }] : bandData} centerLabel="Members" centerValue={bandTotal} />
              <ul className="flex flex-col gap-2" style={{ flex: 1 }}>
                {bandData.map((b) => (
                  <li key={b.name} className="flex items-center gap-2">
                    <span style={{ width: 9, height: 9, borderRadius: 99, background: b.color }} />
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: NAVY_INK }}>{b.name}</span>
                    <span style={{ marginLeft: "auto", fontFamily: "var(--font-display)", fontSize: 15, color: NAVY_INK }}>{b.value}</span>
                    <span style={{ fontSize: 11, color: "var(--muted-foreground)", width: 38, textAlign: "right" }}>
                      {bandTotal > 0 ? Math.round((b.value / bandTotal) * 100) : 0}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </SubCard>

          {/* Per-level distribution */}
          <SubCard icon={BarChart3} title="Per-level distribution" hint="learners & completions">
            {!levelHasData ? <Empty text="No level enrolment recorded yet." /> : (
              <div style={{ height: 188 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={levelData} margin={{ top: 8, right: 6, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="level" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 10, fill: "#6b7280" }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} width={34} />
                    <Tooltip cursor={{ fill: "rgba(11,31,51,0.05)" }} contentStyle={tip} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#6b7280" }} />
                    <Bar dataKey="Learners" fill={NAVY} radius={[3, 3, 0, 0]} maxBarSize={14} />
                    <Bar dataKey="Completed" fill={GREEN} radius={[3, 3, 0, 0]} maxBarSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </SubCard>
        </div>

        {/* Word & curriculum growth tiles */}
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <Kpi icon={BookOpen} tint="green" label="Verse learners" value={gr.verse_learners} />
          <Kpi icon={BadgeCheck} tint="gold" label="Verses mastered" value={gr.verses_mastered} />
          <Kpi icon={CalendarCheck} tint="navy" label="Plans completed" value={gr.plans_completed} />
          <Kpi icon={CalendarDays} tint="teal" label="Plans active" value={gr.plans_active} />
          <Kpi icon={HelpCircle} tint="violet" label="Quiz attempts" value={gr.quiz_attempts} />
          <Kpi icon={CheckCircle2} tint="amber" label={`Quiz passed · ${passRate}%`} value={gr.quiz_passed} />
        </div>
      </Section>

      {/* ── 6 · Location ─────────────────────────────────────── */}
      <Section icon={MapPin} title="Location" hint="Where your people are — coarse, free-text">
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          {/* By city */}
          <SubCard icon={Building2} title="Members by city" hint={`top ${Math.min(loc.by_city.filter((c) => c.members > 0).length, 10)}`}>
            <BarList
              rows={[...loc.by_city].filter((c) => c.members > 0).sort((a, b) => b.members - a.members).slice(0, 10)
                .map((c, i) => ({ label: c.city || "Unknown", value: c.members, display: `${c.members}`, color: BRAND_TINTS[i % BRAND_TINTS.length] }))}
              emptyText="No city data captured yet."
            />
          </SubCard>

          {/* By country */}
          <SubCard icon={Globe} title="Members by country" hint={`top ${Math.min(loc.by_country.filter((c) => c.members > 0).length, 8)}`}>
            <BarList
              showPct
              rows={[...loc.by_country].filter((c) => c.members > 0).sort((a, b) => b.members - a.members).slice(0, 8)
                .map((c, i) => ({ label: countryName(c.country_code), value: c.members, display: `${c.members}`, color: BRAND_TINTS[i % BRAND_TINTS.length] }))}
              emptyText="No country data captured yet."
            />
          </SubCard>
        </div>

        {/* Proximity coming — gated on geo_capture, no fake coordinates */}
        {!loc.geo_capture && (
          <div style={{ ...cardStyle(18), marginTop: 16 }}>
            <div className="flex items-center gap-2.5">
              <span style={{ width: 36, height: 36, borderRadius: 11, background: "var(--tint-violet-bg)", display: "grid", placeItems: "center" }}>
                <Sparkles size={18} style={{ color: "var(--tint-violet-fg)" }} />
              </span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: NAVY_INK }}>Location &amp; proximity matching</div>
                <div style={{ fontSize: 11, color: "var(--tint-violet-fg)", fontWeight: 600 }}>Coming soon</div>
              </div>
              <Sparkles size={14} style={{ color: GOLD, marginLeft: "auto" }} />
            </div>
            <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 12, lineHeight: 1.55 }}>
              Today we only know coarse, free-text city and country — no precise coordinates are collected. When opt-in location
              tagging ships, we'll surface members who live near each other and suggest pairing them into the same cell, so no one is
              discipled in isolation. Nothing here is estimated.
            </p>
            <ul className="flex flex-col gap-1.5" style={{ marginTop: 12, padding: 12, background: "var(--secondary)", borderRadius: 10, border: "1px solid var(--border)" }}>
              {[
                "Opt-in, privacy-first location tags (area, never precise coordinates in the admin view)",
                "Proximity clusters that respect congregation and language boundaries",
                "One-tap 'suggest a cell' from nearby unassigned members",
                "Travel-aware reassignment when a member relocates",
              ].map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <span style={{ width: 8, height: 8, borderRadius: 99, border: "1.5px dashed #cbd5e1", marginTop: 4, flexShrink: 0 }} />
                  <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.45 }}>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* Footer */}
      <p style={{ fontSize: 11, color: "var(--muted-foreground)", textAlign: "center", padding: "4px 0 12px" }}>
        <Lock size={11} style={{ display: "inline", verticalAlign: "-1px", marginRight: 4 }} />
        SuperAdmin / Admin only · prayer activity excluded (pastoral-private, §5.4) · As of {new Date(d.generated_at).toLocaleString()}
      </p>
    </div>
  );
}

// ── building blocks ──────────────────────────────────────────────────────────

const SHADOW = "0 1px 3px rgba(11,31,51,0.06), 0 1px 2px rgba(11,31,51,0.04)";
const cardStyle = (pad: number): React.CSSProperties => ({
  background: "#fff", border: "1px solid var(--border)", borderRadius: 16, padding: pad, boxShadow: SHADOW,
});
const tip = { background: "#fff", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, boxShadow: SHADOW } as const;

const thBase: React.CSSProperties = { padding: "10px 16px", fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: "var(--muted-foreground)" };
const thL: React.CSSProperties = { ...thBase, textAlign: "left" };
const thR: React.CSSProperties = { ...thBase, textAlign: "right" };
const tdBase: React.CSSProperties = { padding: "12px 16px", color: "var(--foreground)" };
const tdL: React.CSSProperties = { ...tdBase, textAlign: "left" };
const tdR: React.CSSProperties = { ...tdBase, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--muted-foreground)" };

const comingCard: React.CSSProperties = {
  ...cardStyle(14),
  background: "repeating-linear-gradient(45deg, #fff, #fff 10px, rgba(11,31,51,0.012) 10px, rgba(11,31,51,0.012) 20px)",
};

// Pastel-tint registry (uses index.css --tint-*-bg / --tint-*-fg tokens).
type Tint = "navy" | "green" | "gold" | "teal" | "amber" | "rose" | "violet";
const tintBg = (t: Tint): string => (t === "teal" ? "#e2f4f1" : `var(--tint-${t}-bg)`);
const tintFg = (t: Tint): string => (t === "teal" ? TEAL : `var(--tint-${t}-fg)`);

function Kpi({ icon: Icon, label, value, tint, small }: { icon: LucideIcon; label: string; value: number | string; tint: Tint; small?: boolean }): ReactElement {
  return (
    <div className="rounded-2xl" style={{ background: tintBg(tint), padding: 14, border: `1px solid ${tintFg(tint)}2e` }}>
      <span style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.55)", display: "grid", placeItems: "center" }}>
        <Icon size={17} style={{ color: tintFg(tint) }} />
      </span>
      <div style={{ fontFamily: "var(--font-display)", fontSize: small ? 18 : 22, color: NAVY_INK, marginTop: 10, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", fontWeight: 500, marginTop: 6 }}>{label}</div>
    </div>
  );
}

function Section({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint?: string; children: ReactNode }): ReactElement {
  return (
    <section style={cardStyle(20)}>
      <div className="flex items-center gap-2.5 mb-4">
        <span style={{ width: 32, height: 32, borderRadius: 10, background: "var(--tint-navy-bg)", display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Icon size={16} style={{ color: "var(--tint-navy-fg)" }} />
        </span>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: NAVY_INK, lineHeight: 1.2 }}>{title}</h2>
          {hint ? <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 1 }}>{hint}</div> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function CardHeader({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }): ReactElement {
  return (
    <div className="flex items-center gap-1.5" style={{ padding: "16px 16px 12px" }}>
      <Icon size={14} style={{ color: NAVY }} />
      <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY_INK }}>{title}</h3>
      {hint ? <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted-foreground)" }}>{hint}</span> : null}
    </div>
  );
}

// White inset SubCard (used inside Sections) with icon + title + hint header.
function SubCard({ icon: Icon, title, hint, children, className }: { icon: LucideIcon; title: string; hint?: string; children: ReactNode; className?: string }): ReactElement {
  return (
    <div className={className} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 14, padding: 16, boxShadow: SHADOW }}>
      <div className="flex items-center gap-1.5 mb-3">
        <Icon size={13} style={{ color: NAVY }} />
        <h3 style={{ fontSize: 13.5, fontWeight: 700, color: NAVY_INK }}>{title}</h3>
        {hint ? <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted-foreground)" }}>{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

type BarRow = { label: string; value: number; display?: string; tag?: string; color?: string | undefined; mono?: boolean };
function BarList({ rows, showPct, padded, emptyText }: { rows: BarRow[]; showPct?: boolean; padded?: boolean; emptyText?: string }): ReactElement {
  if (rows.length === 0) return <div style={{ padding: padded ? "0 16px 16px" : 0 }}><Empty text={emptyText ?? "No data yet."} /></div>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <ul className="flex flex-col" style={{ gap: 11, padding: padded ? "4px 16px 16px" : 0 }}>
      {rows.map((r, i) => (
        <li key={r.label + i}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 5 }}>
            <span style={{ fontSize: 12.5, color: NAVY_INK, fontWeight: 600, fontFamily: r.mono ? "var(--font-mono)" : undefined }}>{r.label}</span>
            <span className="flex items-baseline gap-1.5">
              <span style={{ fontSize: 12.5, color: NAVY_INK, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{r.display ?? r.value.toLocaleString()}</span>
              {r.tag ? <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>· {r.tag}</span> : null}
              {showPct ? <span style={{ fontSize: 10.5, color: "var(--muted-foreground)", width: 32, textAlign: "right" }}>{total > 0 ? Math.round((r.value / total) * 100) : 0}%</span> : null}
            </span>
          </div>
          <div style={{ height: 7, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: "100%", borderRadius: 99, background: r.color ?? BRAND_TINTS[i % BRAND_TINTS.length] ?? NAVY }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Donut({ data, centerLabel, centerValue }: { data: { name: string; value: number; color: string }[]; centerLabel: string; centerValue: number }): ReactElement {
  return (
    <div style={{ position: "relative", width: 128, height: 128, flexShrink: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={40} outerRadius={62} paddingAngle={2} stroke="none">
            {data.map((x) => <Cell key={x.name} fill={x.color} />)}
          </Pie>
          <Tooltip contentStyle={tip} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: NAVY_INK, lineHeight: 1 }}>{centerValue}</div>
        <div style={{ fontSize: 8.5, color: "var(--muted-foreground)", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 3, fontWeight: 700 }}>{centerLabel}</div>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }): ReactElement {
  return <p style={{ fontSize: 12, color: "var(--muted-foreground)", padding: "8px 0" }}>{text}</p>;
}

// ── small visual helpers ──
const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

const rankBadge = (rank: number): React.CSSProperties => ({
  width: 24, height: 24, borderRadius: 99, display: "grid", placeItems: "center", flexShrink: 0,
  fontSize: 11, fontWeight: 700,
  background: rank <= 3 ? "rgba(200,155,60,0.16)" : "var(--secondary)",
  color: rank <= 3 ? "#8a6b1f" : "var(--muted-foreground)",
});
const monogram = (): React.CSSProperties => ({
  width: 28, height: 28, borderRadius: 99, display: "grid", placeItems: "center", flexShrink: 0,
  fontSize: 11, fontWeight: 700, color: "#fff",
  background: "var(--nuru-navy-gradient, " + NAVY_INK + ")",
});
const tintChip = (color: string | undefined): React.CSSProperties => {
  const c = color ?? NAVY;
  return { width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", flexShrink: 0, color: c, background: `${c}1f` };
};
