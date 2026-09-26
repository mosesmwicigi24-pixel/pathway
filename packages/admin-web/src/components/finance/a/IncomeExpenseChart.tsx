// Overview — twelve months of income against expenses, one currency at a time
// (KES and USD are never drawn on one axis, never added). Bars are drawn from
// integer minor units; the axis is compact ("1.2M") and the tooltip exact.
import { useMemo, useState, type ReactElement } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { FinanceOverview } from "../../../api/finance";
import { FIN, Skeleton } from "../kit";
import { compareCurrencies, formatMinor } from "../money";
import { fmtMonth } from "../dates";
import { compactMinor } from "./helpers";

const INCOME = "#C89B3C";
const EXPENSES = "#1E4068";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

interface Row {
  month: string;
  short: string;
  income: number;
  expenses: number;
}

function shortMonth(month: string): string {
  const m = /^\d{4}-(\d{2})/.exec(month);
  const i = m ? Number(m[1]) - 1 : -1;
  return MONTHS[i] ?? month;
}

function ChartTip({ active, row, currency }: { active: boolean; row: Row | null; currency: string }): ReactElement | null {
  if (!active || !row) return null;
  const net = row.income - row.expenses;
  return (
    <div style={{ background: FIN.card, border: `1px solid ${FIN.border}`, borderRadius: 10, padding: "8px 12px", fontSize: 12, boxShadow: "0 6px 18px rgba(7,22,41,0.12)" }}>
      <div style={{ fontWeight: 700, color: FIN.navy, marginBottom: 4 }}>{fmtMonth(row.month)}</div>
      <div style={{ fontFamily: FIN.mono, color: FIN.navy, display: "grid", gridTemplateColumns: "auto auto", gap: "2px 12px" }}>
        <span style={{ color: INCOME }}>Income</span>
        <span style={{ textAlign: "right" }}>{formatMinor(row.income, currency)}</span>
        <span style={{ color: EXPENSES }}>Expenses</span>
        <span style={{ textAlign: "right" }}>{formatMinor(row.expenses, currency)}</span>
        <span style={{ color: FIN.muted }}>Net</span>
        <span style={{ textAlign: "right", color: net < 0 ? FIN.danger : FIN.navy }}>{formatMinor(net, currency)}</span>
      </div>
    </div>
  );
}

export function IncomeExpenseChart({ series, loading }: { series: FinanceOverview["series"] | null; loading: boolean }): ReactElement {
  const ordered = useMemo(() => [...(series ?? [])].sort((a, b) => compareCurrencies(a.currency, b.currency)), [series]);
  const [picked, setPicked] = useState<string | null>(null);
  const active = ordered.find((s) => s.currency === picked) ?? ordered[0] ?? null;
  const rows: Row[] = useMemo(
    () => (active ? active.months.map((m) => ({ month: m.month, short: shortMonth(m.month), income: m.income_minor, expenses: m.expenses_minor })) : []),
    [active],
  );
  const currency = active?.currency ?? "KES";
  const empty = rows.every((r) => r.income === 0 && r.expenses === 0);

  if (loading && !active) return <Skeleton height={220} />;
  if (!active) return <div style={{ fontSize: 13, color: FIN.muted, padding: "24px 0" }}>No months to show.</div>;

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, marginBottom: 10 }}>
        <div className="flex items-center" style={{ gap: 14, fontSize: 12, color: FIN.muted }}>
          <span className="inline-flex items-center" style={{ gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: INCOME }} /> Income (succeeded gifts)
          </span>
          <span className="inline-flex items-center" style={{ gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: EXPENSES }} /> Expenses (approved)
          </span>
        </div>
        {ordered.length > 1 ? (
          <div role="group" aria-label="Currency" className="inline-flex" style={{ border: `1px solid ${FIN.border}`, borderRadius: 10, overflow: "hidden" }}>
            {ordered.map((s) => {
              const on = s.currency === currency;
              return (
                <button
                  key={s.currency}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked(s.currency)}
                  style={{ padding: "5px 12px", fontSize: 12, fontFamily: FIN.mono, border: "none", background: on ? FIN.navy : FIN.card, color: on ? "#fff" : FIN.navy, cursor: "pointer" }}
                >
                  {s.currency}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <div style={{ height: 240, minWidth: 0, opacity: loading ? 0.55 : 1, transition: "opacity 150ms", position: "relative" }}>
        {empty ? (
          <div className="flex items-center justify-center" style={{ height: "100%", fontSize: 13, color: FIN.muted, border: `1px dashed ${FIN.border}`, borderRadius: 12 }}>
            No {currency} income or expenses in these twelve months.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="short" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#6B7280", fontFamily: "DM Mono" }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => compactMinor(v)} />
              <Tooltip
                cursor={{ fill: "rgba(11,31,51,0.04)" }}
                content={(p: TooltipContentProps) => <ChartTip active={p.active} row={(p.payload?.[0]?.payload as Row | undefined) ?? null} currency={currency} />}
              />
              <Bar dataKey="income" name="Income" fill={INCOME} radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="expenses" name="Expenses" fill={EXPENSES} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
