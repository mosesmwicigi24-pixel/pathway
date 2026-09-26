// Finance → Reports (/finance/reports) — docs/FINANCE_ERP.md §5 "Reports".
// Five reports, one tab each (?tab=): Income for a year (by fund, channel or
// source), Expenses for a year (by category or fund), Pledges for a year, the
// Income & expenditure statement for a period, and the statement of Financial
// position as of a day. Every figure is per currency — one table per currency,
// never a sum across — and every table is checked to foot. Each tab has its CSV
// (finance:export).
import type { ReactElement } from "react";
import { BarChart3 } from "lucide-react";
import { FINANCE_CSV, FinanceApi, type ExpensesReportBy, type FinancePledgesReport, type IncomeReportBy } from "../../../api/finance";
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  ExportButton,
  FIN,
  FilterBar,
  FinancePage,
  SectionCard,
  Skeleton,
  Tabs,
  inputStyle,
  useUrlParam,
  useUrlTab,
  type Column,
} from "../../finance/kit";
import { formatMinor } from "../../finance/money";
import { currentYearEAT, fmtDay, isIsoDate, periodFor, presetRange, todayEAT, type DatePreset, type PeriodValue } from "../../finance/dates";
import { useResource } from "../../finance/b/hooks";
import { MONTH_LABELS, parseYear } from "../../finance/b/logic";
import { MatrixBlock } from "../../finance/b/ReportMatrix";
import { FinancialPositionView, IncomeExpenditureView } from "../../finance/b/ReportStatements";
import { Segmented, YearSelect } from "../../finance/b/ui";

const TAB_KEYS = ["income", "expenses", "pledges", "ie", "position"] as const;
type TabKey = (typeof TAB_KEYS)[number];
const TABS = [
  { key: "income", label: "Income" },
  { key: "expenses", label: "Expenses" },
  { key: "pledges", label: "Pledges" },
  { key: "ie", label: "Income & expenditure" },
  { key: "position", label: "Financial position" },
] as const satisfies readonly { key: TabKey; label: string }[];

const INCOME_BY: readonly { key: IncomeReportBy; label: string; row: string }[] = [
  { key: "fund", label: "By fund", row: "Fund" },
  { key: "channel", label: "By channel", row: "Channel" },
  { key: "source", label: "By source", row: "Source" },
];
const EXPENSES_BY: readonly { key: ExpensesReportBy; label: string; row: string }[] = [
  { key: "category", label: "By category", row: "Category" },
  { key: "fund", label: "By fund", row: "Fund" },
];

function Loading(): ReactElement {
  return (
    <Card style={{ padding: 20 }}>
      <Skeleton width="40%" height={16} />
      <div style={{ height: 12 }} />
      <Skeleton width="100%" height={120} />
    </Card>
  );
}

/* ---------- Income / Expenses (matrices) ---------- */

function MatrixTab({ kind, year }: { kind: "income" | "expenses"; year: number }): ReactElement {
  const options: readonly { key: string; label: string; row: string }[] = kind === "income" ? INCOME_BY : EXPENSES_BY;
  const fallback = kind === "income" ? { key: "fund", label: "By fund", row: "Fund" } : { key: "category", label: "By category", row: "Category" };
  // One ?by= for both tabs; a grouping the other report does not have reads as its default.
  const [byRaw, setBy] = useUrlParam("by", fallback.key);
  const by = options.find((o) => o.key === byRaw) ?? fallback;
  const res = useResource(
    () => (kind === "income" ? FinanceApi.incomeReport({ year, by: by.key as IncomeReportBy }) : FinanceApi.expensesReport({ year, by: by.key as ExpensesReportBy })),
    `${kind}:${year}:${by.key}`,
    { errorFallback: `Could not load the ${kind} report.` },
  );
  const noun = kind === "income" ? "income" : "approved expenses";
  return (
    <>
      <Card style={{ padding: "12px 14px" }}>
        <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
          <Segmented ariaLabel="Group by" options={options} value={by.key} onChange={setBy} />
          <span style={{ fontSize: 12, color: FIN.muted }}>
            {kind === "income"
              ? "Succeeded gifts by the month they were given (EAT) — a reversed gift drops out of its month."
              : "Approved expenses by the month they were spent — a void drops out."}
          </span>
          <span style={{ marginLeft: "auto" }}>
            <ExportButton path={kind === "income" ? FINANCE_CSV.incomeReport : FINANCE_CSV.expensesReport} params={{ year, by: by.key }} filename={`${kind}-${year}-by-${by.key}`} />
          </span>
        </div>
      </Card>
      {res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <Loading />
      ) : (
        res.data.currencies.map((block) => (
          <MatrixBlock key={block.currency} block={block} rowHeader={by.row} emptyText={`No ${noun} in ${block.currency} in ${year}.`} chart={kind === "income"} />
        ))
      )}
    </>
  );
}

/* ---------- Pledges ---------- */

type PledgeMonth = FinancePledgesReport["currencies"][number]["months"][number];

function PledgesTab({ year }: { year: number }): ReactElement {
  const res = useResource(() => FinanceApi.pledgesReport({ year }), `pledges:${year}`, { errorFallback: "Could not load the pledges report." });
  const columns = (currency: string): Column<PledgeMonth>[] => [
    { key: "month", header: "Month", cell: (m) => `${MONTH_LABELS[m.month - 1] ?? m.month} ${year}` },
    { key: "pledged", header: <span title="Monthly pledges' instalments due in the month + total pledges' targets due in the month">Pledged</span>, cell: (m) => formatMinor(m.pledged_minor, currency, { withCode: false }), align: "right", mono: true },
    { key: "paid", header: <span title="Succeeded payments toward pledges, by the month they were paid">Paid</span>, cell: (m) => formatMinor(m.paid_minor, currency, { withCode: false }), align: "right", mono: true },
    { key: "kept", header: <span title="Monthly instalments due in the month that were paid in full (on time or late)">Kept</span>, cell: (m) => m.kept, align: "right", mono: true },
    { key: "missed", header: <span title="Monthly instalments due in the month that are missed as of today">Missed</span>, cell: (m) => <span style={{ color: m.missed > 0 ? FIN.warn : undefined }}>{m.missed}</span>, align: "right", mono: true },
    { key: "behind", header: <span title="Distinct partners with a missed instalment due in the month">Partners behind</span>, cell: (m) => m.behind_partners, align: "right", mono: true },
  ];
  return (
    <>
      <Card style={{ padding: "12px 14px" }}>
        <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
          <span style={{ fontSize: 12, color: FIN.muted }}>From the instalment ledger — the same rule as the member's statement and the pledge register.</span>
          <span style={{ marginLeft: "auto" }}>
            <ExportButton path={FINANCE_CSV.pledgesReport} params={{ year }} filename={`pledges-${year}`} />
          </span>
        </div>
      </Card>
      {res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <Loading />
      ) : res.data.currencies.length === 0 ? (
        <Card>
          <EmptyState title={`No pledges in ${year}`}>Pledges members made or paid toward in {year} appear here, month by month.</EmptyState>
        </Card>
      ) : (
        res.data.currencies.map((c) => (
          <section key={c.currency} aria-label={`${c.currency} table`} data-currency-block={c.currency}>
            <SectionCard title={`${c.currency} · pledged ${formatMinor(c.totals.pledged_minor, c.currency)} · paid ${formatMinor(c.totals.paid_minor, c.currency)}`} subtitle={`Amounts in ${c.currency}.`} flush>
              <DataTable
                ariaLabel={`Pledges ${c.currency}`}
                columns={columns(c.currency)}
                rows={c.months}
                rowKey={(m) => String(m.month)}
                minWidth={760}
                footer={
                  <tr style={{ borderTop: `2px solid ${FIN.border}`, background: FIN.surface }}>
                    {[
                      "Year",
                      formatMinor(c.totals.pledged_minor, c.currency, { withCode: false }),
                      formatMinor(c.totals.paid_minor, c.currency, { withCode: false }),
                      String(c.totals.kept),
                      String(c.totals.missed),
                      `${c.totals.behind_partners} (distinct)`,
                    ].map((v, i) => (
                      <td key={i} style={{ padding: "10px 16px", fontSize: 12.5, fontWeight: 700, color: FIN.navy, fontFamily: i === 0 ? undefined : FIN.mono, textAlign: i === 0 ? "left" : "right" }}>
                        {v}
                      </td>
                    ))}
                  </tr>
                }
              />
            </SectionCard>
          </section>
        ))
      )}
    </>
  );
}

/* ---------- Income & expenditure ---------- */

const IE_PRESETS: readonly DatePreset[] = ["this_month", "last_month", "this_quarter", "this_year", "last_12_months", "custom"];

function IncomeExpenditureTab(): ReactElement {
  const [presetRaw, setPreset] = useUrlParam("period", "this_month");
  const [fromRaw, setFrom] = useUrlParam("from", "");
  const [toRaw, setTo] = useUrlParam("to", "");
  const preset: DatePreset = (IE_PRESETS as readonly string[]).includes(presetRaw) ? (presetRaw as DatePreset) : "this_month";
  const period: PeriodValue = preset === "custom" ? periodFor("custom", new Date(), { from: fromRaw, to: toRaw }) : periodFor(preset);
  const res = useResource(() => FinanceApi.incomeExpenditure({ from: period.from, to: period.to }), `ie:${period.from}:${period.to}`, { errorFallback: "Could not load the income and expenditure statement." });
  return (
    <>
      <FilterBar
        period={period}
        presets={IE_PRESETS}
        onPeriodChange={(p) => {
          setPreset(p.preset);
          if (p.preset === "custom") {
            setFrom(p.from);
            setTo(p.to);
          } else {
            setFrom("");
            setTo("");
          }
        }}
        trailing={<ExportButton path={FINANCE_CSV.incomeExpenditure} params={{ from: period.from, to: period.to }} filename={`income-expenditure-${period.from}-${period.to}`} />}
      />
      <span style={{ fontSize: 12, color: FIN.muted }}>
        Gifts net of reversals and approved expenses, dated by when they happened. Transfers between funds and opening balances move money inside the church and are left out.
      </span>
      {res.error ? <ErrorState message={res.error} onRetry={res.reload} /> : !res.data ? <Loading /> : <IncomeExpenditureView data={res.data} />}
    </>
  );
}

/* ---------- Financial position ---------- */

function PositionTab(): ReactElement {
  const today = todayEAT();
  const [asOfRaw, setAsOf] = useUrlParam("as_of", "");
  const asOf = isIsoDate(asOfRaw) && asOfRaw <= today ? asOfRaw : today;
  const res = useResource(() => FinanceApi.financialPosition({ as_of: asOf }), `position:${asOf}`, { errorFallback: "Could not load the statement of financial position." });
  return (
    <>
      <Card style={{ padding: "12px 14px" }}>
        <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
          <label htmlFor="as-of" className="nuru-eyebrow">
            As of the end of
          </label>
          <input id="as-of" type="date" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value === today ? "" : e.target.value)} style={{ ...inputStyle, width: 160, fontFamily: FIN.mono }} />
          <span style={{ fontSize: 12, color: FIN.muted }}>{asOf === today ? "today" : fmtDay(asOf)} (EAT) · every posting up to then, transfers and opening balances included.</span>
          <span style={{ marginLeft: "auto" }}>
            <ExportButton path={FINANCE_CSV.financialPosition} params={{ as_of: asOf }} filename={`financial-position-${asOf}`} />
          </span>
        </div>
      </Card>
      {res.error ? <ErrorState message={res.error} onRetry={res.reload} /> : !res.data ? <Loading /> : <FinancialPositionView data={res.data} />}
    </>
  );
}

/* ---------- page ---------- */

export function FinanceReports(): ReactElement {
  const [tab, setTab] = useUrlTab(TAB_KEYS, "income");
  const thisYear = currentYearEAT();
  const [yearRaw, setYearRaw] = useUrlParam("year", "");
  const year = parseYear(yearRaw, thisYear);
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);
  const yearly = tab === "income" || tab === "expenses" || tab === "pledges";
  const thisMonth = presetRange("this_month");

  return (
    <FinancePage
      title="Reports"
      subtitle="The year's income, spending and pledges month by month, and the two financial statements — each per currency, each checked to add up."
      actions={yearly ? <YearSelect value={year} years={years} onChange={(y) => setYearRaw(y === thisYear ? "" : String(y))} /> : null}
      hero={
        <div className="flex items-center" style={{ gap: 8, color: "rgba(232,239,245,0.62)", fontSize: 12.5 }}>
          <BarChart3 size={14} />
          {yearly ? `Showing ${year}${year === thisYear ? ` (to ${fmtDay(thisMonth.to)})` : ""}.` : tab === "ie" ? "Choose the period below." : "Choose the day below."} KES and USD are reported side by side, never added.
        </div>
      }
      tabs={<Tabs tabs={TABS} value={tab} onChange={setTab} ariaLabel="Reports" />}
    >
      {tab === "income" ? <MatrixTab key="income" kind="income" year={year} /> : null}
      {tab === "expenses" ? <MatrixTab key="expenses" kind="expenses" year={year} /> : null}
      {tab === "pledges" ? <PledgesTab year={year} /> : null}
      {tab === "ie" ? <IncomeExpenditureTab /> : null}
      {tab === "position" ? <PositionTab /> : null}
    </FinancePage>
  );
}
