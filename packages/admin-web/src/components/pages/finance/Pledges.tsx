// Finance → Pledges (/finance/pledges) — docs/FINANCE_ERP.md §5 "Pledges".
// The pledge register, read from the same instalment ledger the member's
// statement and pledge card use (GET /admin/finance/pledges): for the chosen
// year each pledge's pledged / paid / remaining, instalments kept of those due,
// its standing as of today, the next due date and — when behind — the date it
// has been overdue since. Totals are per currency over the WHOLE filtered set.
// A row opens that member's partner drawer (/finance/partners?member=<id>).
import { useMemo, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, HandCoins, Wallet } from "lucide-react";
import { FINANCE_CSV, FinanceApi, type FinancePledgeRow, type PledgeShapeValue, type PledgeStatusValue, type PledgesFilters } from "../../../api/finance";
import {
  DataTable,
  ExportButton,
  FIN,
  FilterBar,
  FinancePage,
  KpiStrip,
  KpiTile,
  MoneyText,
  PerCurrency,
  SectionCard,
  StatusChip,
  pagedTableProps,
  usePagedList,
  useUrlParam,
  type Column,
} from "../../finance/kit";
import { currentYearEAT, fmtDay } from "../../finance/dates";
import { keptOfDue, parseYear, pledgeTermsText } from "../../finance/b/logic";
import { useSetUrlParams } from "../../finance/b/hooks";
import { FiguresStrip, Stacked } from "../../finance/b/ui";

const STATUSES: readonly { value: PledgeStatusValue; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "cancelled", label: "Cancelled" },
];
const STANDINGS = [
  { value: "on_track", label: "On track" },
  { value: "behind", label: "Behind" },
] as const;
const SHAPES: readonly { value: PledgeShapeValue; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "total", label: "Total by a date" },
];

const pick = <T extends string>(raw: string, allowed: readonly { value: T }[]): T | null => (allowed.some((a) => a.value === raw) ? (raw as T) : null);

/** A column header that explains itself on hover. */
const Explained = ({ label, why }: { label: string; why: string }): ReactElement => (
  <span title={why} style={{ cursor: "help", borderBottom: `1px dotted ${FIN.muted}` }}>
    {label}
  </span>
);

export function FinancePledges(): ReactElement {
  const navigate = useNavigate();
  const thisYear = currentYearEAT();
  const [yearRaw, setYearRaw] = useUrlParam("year", "");
  const [statusRaw, setStatus] = useUrlParam("status", "");
  const [standingRaw, setStanding] = useUrlParam("standing", "");
  const [shapeRaw, setShape] = useUrlParam("shape", "");
  const [q, setQ] = useUrlParam("q", "");
  const setUrl = useSetUrlParams();

  const year = parseYear(yearRaw, thisYear);
  const status = pick(statusRaw, STATUSES);
  const standing = pick(standingRaw, STANDINGS);
  const shape = pick(shapeRaw, SHAPES);
  const filters: PledgesFilters = useMemo(() => ({ year, status, standing, shape, q: q || null }), [year, status, standing, shape, q]);
  const list = usePagedList((cursor) => FinanceApi.pledges({ ...filters, cursor, limit: 100 }), JSON.stringify(filters), { errorFallback: "Could not load the pledge register." });

  const yearWord = year === thisYear ? "this year" : `in ${year}`;
  const pledgeCount = list.totals.reduce((n, t) => n + t.count, 0);
  const clearable = Boolean(status || standing || shape || q || year !== thisYear);
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);

  const columns: Column<FinancePledgeRow>[] = [
    { key: "member", header: "Member", cell: (r) => <Stacked primary={r.member_name} secondary={r.member_phone ?? undefined} strong />, width: 200 },
    {
      key: "pledge",
      header: "Pledge",
      cell: (r) => <Stacked primary={r.title} secondary={r.shape === "monthly" ? "Monthly" : "Total by a date"} />,
    },
    {
      key: "terms",
      header: <Explained label="Instalment / target" why="A monthly pledge's instalment, or a total pledge's target and its date." />,
      cell: (r) => (
        <span style={{ fontFamily: FIN.mono, whiteSpace: "nowrap" }} title={pledgeTermsText(r)}>
          <MoneyText amount_minor={r.shape === "monthly" ? r.amount_minor : r.target_minor} currency={r.currency} />
          <span style={{ color: FIN.muted, fontSize: 11 }}>{r.shape === "monthly" ? " /mo" : r.due_on ? ` by ${fmtDay(r.due_on)}` : ""}</span>
        </span>
      ),
      nowrap: true,
    },
    {
      key: "paid",
      header: <Explained label={`Paid ${yearWord}`} why={`Succeeded payments toward this pledge ${yearWord} (the member statement's rule).`} />,
      cell: (r) => <MoneyText amount_minor={r.paid_year_minor} currency={r.currency} />,
      align: "right",
    },
    {
      key: "remaining",
      header: <Explained label="Remaining" why={`What is left of the ${year} promise: pledged ${yearWord} minus paid, never below zero.`} />,
      cell: (r) => <MoneyText amount_minor={r.remaining_year_minor} currency={r.currency} style={r.remaining_year_minor > 0 ? undefined : { color: FIN.muted }} />,
      align: "right",
    },
    {
      key: "kept",
      header: <Explained label="Kept / due" why="Monthly pledges: instalments paid in full (on time or late) of those due so far in the year." />,
      cell: (r) => keptOfDue(r),
      mono: true,
      align: "center",
    },
    { key: "next", header: "Next due", cell: (r) => fmtDay(r.next_due), mono: true },
    {
      key: "standing",
      header: <Explained label="Standing" why="As of today, the pledge card's own label: on track, behind (an instalment missed), fulfilled or paused." />,
      cell: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
          {r.status === "cancelled" ? <StatusChip status="cancelled" /> : <StatusChip status={r.standing} />}
          {r.overdue_since && r.status !== "cancelled" ? (
            <span style={{ fontSize: 11, color: FIN.warn, fontWeight: 600, whiteSpace: "nowrap" }}>Overdue since {fmtDay(r.overdue_since)}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "pays_to",
      header: <Explained label="Pays to" why="The fund this pledge's money is booked to — the one rule every gift, schedule charge and confirmed claim follows." />,
      cell: (r) => r.pays_to?.name ?? <span style={{ color: FIN.muted }}>—</span>,
    },
  ];

  return (
    <FinancePage
      title="Pledges"
      subtitle={`Every pledge, read from the same instalment ledger as the member's statement: what was promised ${yearWord}, what has been paid, instalments kept of those due, and who is behind — with the date they fell behind.`}
      actions={<ExportButton onDark path={FINANCE_CSV.pledges} params={filters} filename={`pledges-${year}`} />}
      hero={
        <KpiStrip>
          <KpiTile label="Pledges" icon={<HandCoins size={12} />} value={list.loading && list.totals.length === 0 ? "…" : pledgeCount.toLocaleString()} hint="in this selection" />
          <KpiTile label={`Pledged ${yearWord}`} value={<PerCurrency amounts={list.totals.map((t) => ({ currency: t.currency, amount_minor: t.pledged_minor }))} />} loading={list.loading && list.totals.length === 0} hint="instalments due + total targets" />
          <KpiTile label={`Paid ${yearWord}`} icon={<Wallet size={12} />} tone="good" value={<PerCurrency amounts={list.totals.map((t) => ({ currency: t.currency, amount_minor: t.paid_minor }))} />} loading={list.loading && list.totals.length === 0} hint="succeeded payments to pledges" />
          <KpiTile label="Remaining" icon={<AlertTriangle size={12} />} tone="warn" value={<PerCurrency amounts={list.totals.map((t) => ({ currency: t.currency, amount_minor: t.remaining_minor }))} />} loading={list.loading && list.totals.length === 0} hint={`still to come ${yearWord}`} />
        </KpiStrip>
      }
    >
      <FilterBar
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Member name or phone, or pledge title"
        selects={[
          { key: "year", label: "Year", value: String(year), options: years.map((y) => ({ value: String(y), label: String(y) })), onChange: (v) => setYearRaw(Number(v) === thisYear ? "" : v) },
          { key: "status", label: "Status", value: status ?? "", options: [{ value: "", label: "All" }, ...STATUSES], onChange: setStatus },
          { key: "standing", label: "Standing", value: standing ?? "", options: [{ value: "", label: "Any" }, ...STANDINGS], onChange: setStanding },
          { key: "shape", label: "Shape", value: shape ?? "", options: [{ value: "", label: "Both" }, ...SHAPES], onChange: setShape },
        ]}
        clearable={clearable}
        onClear={() => setUrl({ year: null, status: null, standing: null, shape: null, q: null })}
      />
      <FiguresStrip
        label={`Totals ${yearWord}`}
        loading={list.loading}
        groups={list.totals.map((t) => ({
          currency: t.currency,
          figures: [
            { label: "Pledged", amount_minor: t.pledged_minor, title: "Monthly instalments due in the year + total pledges' targets due in the year" },
            { label: "Paid", amount_minor: t.paid_minor, tone: "good" },
            { label: "Remaining", amount_minor: t.remaining_minor, tone: t.remaining_minor > 0 ? "warn" : "default" },
          ],
          note: `${t.count.toLocaleString()} ${t.count === 1 ? "pledge" : "pledges"}`,
        }))}
        extra="Over every pledge that matches — not just the rows loaded. KES and USD are never added."
      />
      <SectionCard title="Pledge register" subtitle="Newest pledge first. Open a row for the member's partner record — pledges, payments, reminders and statements." flush>
        <DataTable
          ariaLabel="Pledge register"
          columns={columns}
          rowKey={(r) => r.pledge_id}
          onRowClick={(r) => navigate(`/finance/partners?member=${encodeURIComponent(r.user_id)}`)}
          empty={clearable ? "No pledges match these filters." : "No pledges yet — members pledge from Give → Partners in the app."}
          minWidth={1180}
          {...pagedTableProps(list)}
        />
      </SectionCard>
    </FinancePage>
  );
}
