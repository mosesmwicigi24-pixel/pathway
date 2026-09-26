// Budget vs actual for an approved budget (Finance → Budgets; GET
// /admin/finance/budgets/:id/actuals, KES). Per line and month: budget,
// actual, variance (actual − budget), with year-to-date and the year; totals
// per kind with "unbudgeted" — actual money of that kind no line covers, so
// actual + unbudgeted foots to the year's KES total. Income below budget and
// expense above budget are the warnings. USD money is outside budgets and is
// reported beside them, from the year's income and expense reports.
import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { FinanceApi, type BooksBudgetActuals, type BooksBudgetActualsRow, type BudgetLineKind } from "../../../api/finance";
import { ErrorState, FIN, MoneyText, Notice, Skeleton } from "../kit";
import { formatMinor } from "../money";
import { useResource } from "./hooks";
import { MONTH_LABELS, signedMinor, varianceTone, ytdMonthCount, ytdSum } from "./logic";
import { Segmented } from "./ui";

const th: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: FIN.muted, textTransform: "uppercase", letterSpacing: 0.6, padding: "8px 8px", whiteSpace: "nowrap", borderBottom: `1px solid ${FIN.border}`, background: FIN.surface, textAlign: "right" };
const td: CSSProperties = { padding: "5px 8px", fontSize: 12, fontFamily: FIN.mono, textAlign: "right", whiteSpace: "nowrap", color: FIN.navy };
const labelTd: CSSProperties = { padding: "5px 10px", fontSize: 12.5, color: FIN.navy, position: "sticky", left: 0, background: FIN.card, zIndex: 1, minWidth: 220 };

const TONE: Record<"good" | "warn" | "neutral", string> = { good: FIN.good, warn: FIN.warn, neutral: FIN.muted };

/** Everything outside the budget: non-KES income and expenses for the year. */
async function outsideBudget(year: number): Promise<{ income: { currency: string; amount_minor: number }[]; expenses: { currency: string; amount_minor: number }[] }> {
  const [inc, exp] = await Promise.all([FinanceApi.incomeReport({ year, by: "fund" }), FinanceApi.expensesReport({ year, by: "category" })]);
  const pick = (m: typeof inc): { currency: string; amount_minor: number }[] =>
    m.currencies.filter((c) => c.currency !== "KES" && c.totals.total_minor !== 0).map((c) => ({ currency: c.currency, amount_minor: c.totals.total_minor }));
  return { income: pick(inc), expenses: pick(exp) };
}

type View = "months" | "summary";

export function BudgetActuals({ budgetId, year, now = new Date() }: { budgetId: string; year: number; now?: Date }): ReactElement {
  const res = useResource(() => FinanceApi.budgetActuals(budgetId), budgetId, { errorFallback: "Could not load budget vs actual." });
  const usd = useResource(() => outsideBudget(year), `outside:${year}`, { errorFallback: "Could not read the year's non-KES money." });
  const [view, setView] = useState<View>("summary");
  const ytd = ytdMonthCount(year, now);

  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  const a = res.data;
  if (!a) return <Skeleton width="100%" height={120} />;

  const totalsFor = (kind: BudgetLineKind): (BooksBudgetActuals["totals"][number]) | undefined => a.totals.find((t) => t.kind === kind);
  const inc = totalsFor("income");
  const exp = totalsFor("expense");
  const ytdOf = (r: BooksBudgetActualsRow): { budget: number; actual: number; variance: number } => {
    const budget = ytdSum(r.budget_minor, ytd);
    const actual = ytdSum(r.actual_minor, ytd);
    return { budget, actual, variance: actual - budget };
  };

  const summaryRow = (key: string, label: ReactNode, kind: BudgetLineKind, r: BooksBudgetActualsRow, strong = false): ReactElement => {
    const y = ytdOf(r);
    const cell = (v: number, variance = false): ReactElement => (
      <td style={{ ...td, fontWeight: strong ? 700 : 500, color: variance ? TONE[varianceTone(kind, v)] : td.color }}>{variance ? signedMinor(v, null, false) : formatMinor(v, null)}</td>
    );
    return (
      <tr key={key} style={{ borderTop: `1px solid ${FIN.border}`, background: strong ? FIN.surface : undefined }}>
        <td style={{ ...labelTd, fontWeight: strong ? 700 : 500, background: strong ? FIN.surface : FIN.card }}>{label}</td>
        {cell(y.budget)}
        {cell(y.actual)}
        {cell(y.variance, true)}
        {cell(r.budget_total_minor)}
        {cell(r.actual_total_minor)}
        {cell(r.variance_total_minor, true)}
      </tr>
    );
  };

  const monthRows = (key: string, label: ReactNode, kind: BudgetLineKind, r: BooksBudgetActualsRow, strong = false): ReactElement[] => {
    const y = ytdOf(r);
    const line = (what: "Budget" | "Actual" | "Variance", values: number[], ytdValue: number, year: number): ReactElement => {
      const variance = what === "Variance";
      return (
        <tr key={`${key}-${what}`} style={{ borderTop: what === "Budget" ? `1px solid ${FIN.border}` : undefined, background: strong ? FIN.surface : undefined }}>
          <td style={{ ...labelTd, background: strong ? FIN.surface : FIN.card }}>
            {what === "Budget" ? <span style={{ fontWeight: strong ? 700 : 600 }}>{label}</span> : null}
            <span style={{ float: "right", fontSize: 10.5, color: FIN.muted, textTransform: "uppercase", letterSpacing: 0.5, marginLeft: 8 }}>{what}</span>
          </td>
          {values.map((v, m) => (
            <td key={m} style={{ ...td, color: variance ? TONE[varianceTone(kind, v)] : m < ytd ? FIN.navy : FIN.muted }}>
              {variance ? signedMinor(v, null, false) : formatMinor(v, null)}
            </td>
          ))}
          <td style={{ ...td, fontWeight: 700, color: variance ? TONE[varianceTone(kind, ytdValue)] : FIN.navy }}>{variance ? signedMinor(ytdValue, null, false) : formatMinor(ytdValue, null)}</td>
          <td style={{ ...td, fontWeight: 700, color: variance ? TONE[varianceTone(kind, year)] : FIN.navy }}>{variance ? signedMinor(year, null, false) : formatMinor(year, null)}</td>
        </tr>
      );
    };
    return [
      line("Budget", r.budget_minor, y.budget, r.budget_total_minor),
      line("Actual", r.actual_minor, y.actual, r.actual_total_minor),
      line("Variance", r.variance_minor, y.variance, r.variance_total_minor),
    ];
  };

  const lineLabel = (l: BooksBudgetActuals["lines"][number]): ReactElement => (
    <span>
      {l.label}
      <span style={{ display: "block", fontSize: 11, color: FIN.muted, fontWeight: 400 }}>
        {l.kind === "income" ? l.fund?.name : `${l.category?.name ?? ""}${l.fund ? ` · ${l.fund.name}` : " · church-wide"}`}
      </span>
    </span>
  );

  const unbudgetedRow = (t: BooksBudgetActuals["totals"][number]): BooksBudgetActualsRow => ({
    budget_minor: Array.from({ length: 12 }, () => 0),
    actual_minor: t.unbudgeted_minor,
    variance_minor: t.unbudgeted_minor,
    budget_total_minor: 0,
    actual_total_minor: t.unbudgeted_total_minor,
    variance_total_minor: t.unbudgeted_total_minor,
  });

  const sections: { kind: BudgetLineKind; title: string }[] = [
    { kind: "income", title: "Income" },
    { kind: "expense", title: "Expenses" },
  ];
  const ytdLabel = ytd === 12 ? "Year" : ytd === 0 ? "YTD (not started)" : `YTD (Jan–${MONTH_LABELS[ytd - 1]})`;
  const netActualYtd = (inc ? ytdSum(inc.actual_minor, ytd) : 0) - (exp ? ytdSum(exp.actual_minor, ytd) : 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
        <Segmented
          ariaLabel="Budget vs actual view"
          value={view}
          onChange={setView}
          options={[
            { key: "summary", label: "Year to date" },
            { key: "months", label: "Month by month" },
          ]}
        />
        <span style={{ fontSize: 12, color: FIN.muted }}>
          All figures KES. Variance = actual − budget; <span style={{ color: FIN.warn, fontWeight: 700 }}>amber</span> is income below budget or spending above it.
        </span>
      </div>
      <div style={{ overflowX: "auto", border: `1px solid ${FIN.border}`, borderRadius: 12 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: view === "months" ? 1650 : 900 }} aria-label="Budget vs actual">
          <thead>
            {view === "summary" ? (
              <tr>
                <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, zIndex: 2 }}>Line</th>
                <th style={th}>Budget {ytdLabel}</th>
                <th style={th}>Actual {ytdLabel}</th>
                <th style={th}>Variance</th>
                <th style={th}>Budget year</th>
                <th style={th}>Actual year</th>
                <th style={th}>Variance</th>
              </tr>
            ) : (
              <tr>
                <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, zIndex: 2 }}>Line</th>
                {MONTH_LABELS.map((m) => (
                  <th key={m} style={th}>
                    {m}
                  </th>
                ))}
                <th style={th}>{ytd === 12 ? "Year" : "YTD"}</th>
                <th style={th}>Year</th>
              </tr>
            )}
          </thead>
          {sections.map(({ kind, title }) => {
            const t = totalsFor(kind);
            const lines = a.lines.filter((l) => l.kind === kind);
            return (
              <tbody key={kind}>
                <tr>
                  <td colSpan={view === "months" ? 15 : 7} style={{ ...labelTd, fontWeight: 700, color: kind === "income" ? FIN.good : FIN.warn, paddingTop: 12 }}>
                    {title}
                  </td>
                </tr>
                {lines.flatMap((l) => (view === "summary" ? [summaryRow(l.line_id, lineLabel(l), kind, l)] : monthRows(l.line_id, lineLabel(l), kind, l)))}
                {t ? (view === "summary" ? [summaryRow(`${kind}-total`, `Total ${title.toLowerCase()}`, kind, t, true)] : monthRows(`${kind}-total`, `Total ${title.toLowerCase()}`, kind, t, true)) : null}
                {t && t.unbudgeted_total_minor !== 0
                  ? view === "summary"
                    ? [summaryRow(`${kind}-unbudgeted`, <span title="Actual money of this kind that no budget line covers">Unbudgeted</span>, kind, unbudgetedRow(t))]
                    : monthRows(`${kind}-unbudgeted`, <span title="Actual money of this kind that no budget line covers">Unbudgeted</span>, kind, unbudgetedRow(t))
                  : null}
              </tbody>
            );
          })}
        </table>
      </div>
      <div className="flex flex-wrap items-baseline" style={{ gap: "6px 24px", fontSize: 12.5, color: FIN.navy }}>
        <span>
          Net actual {ytd === 12 ? "for the year" : "to date"}: <MoneyText amount_minor={netActualYtd} currency="KES" strong />
        </span>
        {inc ? (
          <span style={{ color: FIN.muted }}>
            Income {ytd === 12 ? "" : "to date "}is {formatMinor(Math.abs(ytdSum(inc.actual_minor, ytd) - ytdSum(inc.budget_minor, ytd)), "KES")}{" "}
            {ytdSum(inc.actual_minor, ytd) >= ytdSum(inc.budget_minor, ytd) ? "above" : "below"} budget.
          </span>
        ) : null}
        {exp ? (
          <span style={{ color: FIN.muted }}>
            Spending {ytd === 12 ? "" : "to date "}is {formatMinor(Math.abs(ytdSum(exp.actual_minor, ytd) - ytdSum(exp.budget_minor, ytd)), "KES")}{" "}
            {ytdSum(exp.actual_minor, ytd) > ytdSum(exp.budget_minor, ytd) ? "above" : "within"} budget.
          </span>
        ) : null}
      </div>
      <Notice tone="info">
        Budgets are in KES; USD giving is reported beside them, never against them.{" "}
        {usd.error
          ? "The year's non-KES figures could not be read — see Reports."
          : usd.data
            ? usd.data.income.length === 0 && usd.data.expenses.length === 0
              ? `No non-KES income or spending in ${year}.`
              : `Outside the budget in ${year}: ${[
                  ...usd.data.income.map((x) => `income ${formatMinor(x.amount_minor, x.currency)}`),
                  ...usd.data.expenses.map((x) => `spending ${formatMinor(x.amount_minor, x.currency)}`),
                ].join(" · ")} (see Reports).`
            : ""}
      </Notice>
    </div>
  );
}
