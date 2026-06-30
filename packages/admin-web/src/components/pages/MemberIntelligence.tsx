// Member Intelligence — SuperAdmin/Admin analytics cockpit. Giving behaviour,
// devices, engagement + "what they love", curriculum & Word growth, location, and
// the proximity-grouping hook for the coming location feature. Every number is
// real (AdminApi.intelligence → /admin/analytics/intelligence); metrics not yet
// captured (device model, screen dwell, login frequency, geo) render as honest
// "coming with telemetry" cards. Prayer is excluded (pastoral-private, §5.4).
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import {
  Brain, Wallet, Users, Smartphone, Activity, BookOpen, MapPin, TrendingUp,
  Sparkles, Clock, Star, Lock, type LucideIcon,
} from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { AdminApi, type MemberIntelligence as Intel } from "../../api/client";

const NAVY = "#0B1F33";
const GOLD = "#C89B3C";
const GREEN = "#22B07D";
const TONES = [GOLD, NAVY, GREEN, "#6366F1", "#E07B39", "#EC4899", "#14B8A6", "#3FA9F5"];
const BAND_COLOR: Record<string, string> = {
  thriving: GREEN, steady: GOLD, growing: GOLD, watch: "#E07B39", at_risk: "#D4183D", dormant: "#9CA3AF",
};

const money = (minor: number, ccy: string): string => `${ccy} ${Math.round((minor ?? 0) / 100).toLocaleString()}`;
const pretty = (s: string): string => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function MemberIntelligence(): ReactElement {
  const [d, setD] = useState<Intel | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    AdminApi.intelligence().then(setD).catch(() => setErr("Could not load intelligence (Admin/SuperAdmin only)."));
  }, []);

  const ccy = d?.giving.currency ?? "KES";
  const bandData = useMemo(
    () => (d?.engagement.bands ?? []).map((b) => ({ name: pretty(b.band), value: b.members, color: BAND_COLOR[b.band] ?? "#9CA3AF" })),
    [d],
  );
  const platformData = useMemo(
    () => (d?.devices.platforms ?? []).map((p, i) => ({ name: pretty(p.platform), value: p.members, color: p.platform === "ios" ? NAVY : GREEN || TONES[i] })),
    [d],
  );

  if (err) return <div style={card(20)}><h3 style={{ color: NAVY, fontWeight: 700 }}>Member Intelligence</h3><p style={{ color: "var(--muted-foreground)", marginTop: 6 }}>{err}</p></div>;
  if (!d) return <div style={{ padding: 24, color: "var(--muted-foreground)" }}>Loading intelligence…</div>;

  const k = d.kpis;
  const g = d.giving;
  const passRate = g && d.growth.quiz_attempts > 0 ? Math.round((d.growth.quiz_passed / d.growth.quiz_attempts) * 100) : 0;

  return (
    <div className="flex flex-col gap-6" style={{ padding: 4 }}>
      {/* Hero */}
      <div className="rounded-2xl overflow-hidden" style={{ background: NAVY, color: "#fff", padding: "22px 24px", position: "relative" }}>
        <div style={{ position: "absolute", right: -40, top: -50, width: 180, height: 180, borderRadius: 99, background: "rgba(200,155,60,0.18)" }} />
        <div className="flex items-center gap-2" style={{ color: GOLD, fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>
          <Brain size={14} /> Member Intelligence
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, marginTop: 6 }}>Who your people are, in the data</h1>
        <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 4 }}>
          Giving, engagement, devices, growth and location — every number live from the database. Generated {new Date(d.generated_at).toLocaleString()}.
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <Kpi icon={Users} tone="#EEF2F7" label="Members" value={k.total_members} />
        <Kpi icon={Activity} tone="#E9F7F0" label="Active · 30d" value={k.active_30d} sub={`${k.active_7d} this week`} />
        <Kpi icon={Wallet} tone="#FBF3DF" label="Givers" value={k.givers} sub={`${k.recurring_givers} recurring`} />
        <Kpi icon={TrendingUp} tone="#EEF2F7" label="Avg engagement" value={k.avg_engagement} sub="of 100" />
        <Kpi icon={Star} tone="#FBF3DF" label="At-risk" value={k.members_at_risk} />
        <Kpi icon={Users} tone="#E9F7F0" label="Cells" value={k.cohorts} />
      </div>

      {/* GIVING */}
      <Section icon={Wallet} title="Giving intelligence" hint="all-time, succeeded gifts">
        <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <Stat label="Total given" value={money(g.total_minor, ccy)} big />
          <Stat label="Avg / transaction" value={money(g.avg_per_txn_minor, ccy)} accent />
          <Stat label="Median gift" value={money(g.median_minor, ccy)} />
          <Stat label="Gifts" value={g.gift_count.toLocaleString()} />
          <Stat label="Givers" value={g.givers.toLocaleString()} />
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <SubCard title="By fund">
            <BarList rows={g.by_fund.map((f) => ({ label: pretty(f.code), value: Math.round(f.total_minor / 100), tag: `${f.count}` }))} suffix={ccy} />
          </SubCard>
          <SubCard title="Giving frequency" hint="gifts per giver">
            <div style={{ height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={g.frequency} barCategoryGap={10}>
                  <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis hide />
                  <Tooltip cursor={{ fill: "rgba(11,31,51,0.05)" }} contentStyle={tip} />
                  <Bar dataKey="givers" fill={GOLD} radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SubCard>
          <SubCard title="Recurring methods" hint="active schedules">
            {g.by_method.length ? (
              <BarList rows={g.by_method.map((m) => ({ label: pretty(m.method), value: m.givers, tag: `${m.schedules} sched.` }))} />
            ) : <Empty text="No active recurring gifts yet." />}
          </SubCard>
          <SubCard title="6-month trend" hint={ccy}>
            <div style={{ height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={g.trend.map((t) => ({ month: t.month, v: Math.round(t.total_minor / 100) }))} barCategoryGap={8}>
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis hide />
                  <Tooltip cursor={{ fill: "rgba(11,31,51,0.05)" }} contentStyle={tip} />
                  <Bar dataKey="v" fill={NAVY} radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SubCard>
        </div>
        <SubCard title="Top givers" hint="by total" className="mt-4">
          {g.top_givers.length ? (
            <table style={{ width: "100%", fontSize: 13 }}>
              <thead><tr style={{ color: "var(--muted-foreground)", fontSize: 11, textAlign: "left" }}>
                <th style={th}>Member</th><th style={th}>Gifts</th><th style={th}>Avg</th><th style={{ ...th, textAlign: "right" }}>Total</th>
              </tr></thead>
              <tbody>
                {g.top_givers.map((t, i) => (
                  <tr key={t.user_id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                    <td style={{ ...td, fontWeight: 600, color: NAVY }}>{t.name}</td>
                    <td style={td}>{t.gifts}</td>
                    <td style={td}>{money(t.avg_minor, ccy)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: NAVY }}>{money(t.total_minor, ccy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty text="No gifts recorded yet." />}
        </SubCard>
      </Section>

      {/* ENGAGEMENT */}
      <Section icon={Activity} title="Engagement & what they love" hint="last 30 days">
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <SubCard title="Engagement bands">
            <Donut data={bandData} centerLabel="Members" centerValue={bandData.reduce((s, b) => s + b.value, 0)} />
          </SubCard>
          <SubCard title="What they engage with" hint="activity by type">
            {d.engagement.by_kind.length ? (
              <BarList rows={d.engagement.by_kind.map((x) => ({ label: pretty(x.kind), value: x.events, tag: `${x.members} ppl` }))} />
            ) : <Empty text="No activity in the last 30 days." />}
          </SubCard>
          <SubCard title="When they're active" hint="events by hour">
            <div style={{ height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.engagement.by_hour} barCategoryGap={1}>
                  <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} interval={2} />
                  <YAxis hide />
                  <Tooltip cursor={{ fill: "rgba(11,31,51,0.05)" }} contentStyle={tip} />
                  <Bar dataKey="events" fill={GREEN} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SubCard>
          <Coming title="Time spent per area" note="Which screens they love (Pathway, Word, Give…) unlocks once per-screen telemetry is emitted from the app." />
          <Coming title="Login frequency" note="Exact sign-in cadence unlocks with login-event capture; today's proxy is active-days above." />
        </div>
      </Section>

      {/* DEVICES */}
      <Section icon={Smartphone} title="Devices & reach" hint="from registered clients">
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <SubCard title="Platform split">
            {platformData.length ? <Donut data={platformData} centerLabel="Devices" centerValue={platformData.reduce((s, p) => s + p.value, 0)} />
              : <Empty text="No devices registered yet." />}
          </SubCard>
          <SubCard title="App versions" hint="adoption">
            {d.devices.app_versions.length ? (
              <BarList rows={d.devices.app_versions.map((v) => ({ label: v.app_version, value: v.members }))} />
            ) : <Empty text="No version data yet." />}
          </SubCard>
          <Coming title="Phone models & OS" note="Exact device model, manufacturer and OS version aren't captured yet — only platform (iOS/Android) + app version. A small capture-on-login change lights this up." />
        </div>
      </Section>

      {/* GROWTH & WORD */}
      <Section icon={BookOpen} title="Growth & the Word" hint="curriculum + scripture depth">
        <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <Stat label="Verses mastered" value={d.growth.verses_mastered.toLocaleString()} sub={`${d.growth.verse_learners} learners`} accent />
          <Stat label="Plans completed" value={d.growth.plans_completed.toLocaleString()} sub={`${d.growth.plans_active} active`} />
          <Stat label="Quiz pass rate" value={`${passRate}%`} sub={`${d.growth.quiz_attempts} attempts`} />
          <Stat label="Certs this month" value={k.certificates_this_month.toLocaleString()} />
        </div>
        <SubCard title="Members by level" hint="curriculum pipeline">
          {d.growth.by_level.length ? (
            <BarList rows={d.growth.by_level.map((l) => ({ label: `Level ${l.level_number}`, value: l.learners, tag: `${l.completed} done` }))} />
          ) : <Empty text="No enrolments yet." />}
        </SubCard>
      </Section>

      {/* LOCATION & PROXIMITY */}
      <Section icon={MapPin} title="Location & proximity" hint="coarse today">
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <SubCard title="By city" hint="member-stated">
            {d.location.by_city.length ? <BarList rows={d.location.by_city.map((c) => ({ label: c.city, value: c.members }))} /> : <Empty text="No city data yet." />}
          </SubCard>
          <SubCard title="By country">
            {d.location.by_country.length ? <BarList rows={d.location.by_country.map((c) => ({ label: c.country_code, value: c.members }))} /> : <Empty text="No country data yet." />}
          </SubCard>
          <Coming icon={Sparkles} title="Proximity grouping" note="Precise location tagging (lat/lng) isn't captured yet. Once it ships, this becomes a map + 'who's near whom' matcher that auto-suggests members to couple into the same cell." />
        </div>
      </Section>

      <p style={{ fontSize: 11, color: "var(--muted-foreground)", textAlign: "center", padding: "4px 0 12px" }}>
        <Lock size={11} style={{ display: "inline", verticalAlign: "-1px", marginRight: 4 }} />
        SuperAdmin / Admin only · prayer activity excluded (pastoral-private, §5.4)
      </p>
    </div>
  );
}

// ---- building blocks --------------------------------------------------------
const card = (pad: number): React.CSSProperties => ({ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: pad });
const tip = { background: "#fff", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 } as const;
const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "8px", color: "var(--foreground)" };

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: LucideIcon; label: string; value: number | string; sub?: string; tone: string }): ReactElement {
  return (
    <div className="rounded-2xl" style={{ background: tone, padding: "14px 16px", border: "1px solid var(--border)" }}>
      <Icon size={16} style={{ color: NAVY, opacity: 0.7 }} />
      <div style={{ fontFamily: "var(--font-display)", fontSize: 26, color: NAVY, marginTop: 8, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: NAVY, fontWeight: 600, marginTop: 4 }}>{label}</div>
      {sub ? <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 1 }}>{sub}</div> : null}
    </div>
  );
}

function Section({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint?: string; children: ReactNode }): ReactElement {
  return (
    <section style={card(20)}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--secondary)", display: "grid", placeItems: "center" }}><Icon size={16} style={{ color: GOLD }} /></span>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 19, color: NAVY }}>{title}</h2>
        </div>
        {hint ? <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function SubCard({ title, hint, children, className }: { title: string; hint?: string; children: ReactNode; className?: string }): ReactElement {
  return (
    <div className={className} style={{ background: "var(--secondary)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
      <div className="flex items-center justify-between mb-2">
        <h3 style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{title}</h3>
        {hint ? <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, sub, big, accent }: { label: string; value: string; sub?: string; big?: boolean; accent?: boolean }): ReactElement {
  return (
    <div style={{ background: accent ? "#FBF3DF" : "var(--secondary)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--muted-foreground)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: big ? 24 : 19, color: NAVY, marginTop: 4, lineHeight: 1.1 }}>{value}</div>
      {sub ? <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

function BarList({ rows, suffix }: { rows: { label: string; value: number; tag?: string }[]; suffix?: string }): ReactElement {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <li key={r.label + i}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 12.5, color: NAVY, fontWeight: 600 }}>{r.label}</span>
            <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{suffix ? `${suffix} ` : ""}{r.value.toLocaleString()}{r.tag ? ` · ${r.tag}` : ""}</span>
          </div>
          <div style={{ height: 7, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: "100%", borderRadius: 99, background: TONES[i % TONES.length] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Donut({ data, centerLabel, centerValue }: { data: { name: string; value: number; color: string }[]; centerLabel: string; centerValue: number }): ReactElement {
  return (
    <div style={{ position: "relative", height: 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="none">
            {data.map((x) => <Cell key={x.name} fill={x.color} />)}
          </Pie>
          <Tooltip contentStyle={tip} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: NAVY, lineHeight: 1 }}>{centerValue}</div>
        <div style={{ fontSize: 10, color: "var(--muted-foreground)", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 3 }}>{centerLabel}</div>
      </div>
    </div>
  );
}

function Coming({ title, note, icon: Icon = Clock }: { title: string; note: string; icon?: LucideIcon }): ReactElement {
  return (
    <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "14px 16px", background: "repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(11,31,51,0.015) 10px, rgba(11,31,51,0.015) 20px)" }}>
      <div className="flex items-center gap-1.5" style={{ color: GOLD, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
        <Icon size={13} /> Coming with telemetry
      </div>
      <h3 style={{ fontSize: 13.5, fontWeight: 700, color: NAVY, marginTop: 6 }}>{title}</h3>
      <p style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 4, lineHeight: 1.5 }}>{note}</p>
    </div>
  );
}

function Empty({ text }: { text: string }): ReactElement {
  return <p style={{ fontSize: 12, color: "var(--muted-foreground)", padding: "8px 0" }}>{text}</p>;
}
