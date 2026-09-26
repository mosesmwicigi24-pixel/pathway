// Finance → Statements (/finance/statements) — docs/FINANCE_ERP.md §5.
// Year-end givers (GET /admin/finance/statements): every member who gave in the
// year — dated by the member statement's own rule, so each row foots with that
// member's statement — with gifts, totals per currency, the split by fund and
// what went toward a pledge; each member's Giving and Partner statement PDFs
// (a 404 says plainly there is none for that year); the list as CSV
// (finance:export). Memberless gifts (website, office walk-ins) have no
// statement and are not listed.
import { useMemo, type ReactElement } from "react";
import { FileText, Gift, Users } from "lucide-react";
import { FINANCE_CSV, FinanceApi, type FinanceStatementRow, type StatementsFilters } from "../../../api/finance";
import {
  DataTable,
  ExportButton,
  FIN,
  FilterBar,
  FinancePage,
  KpiStrip,
  KpiTile,
  PerCurrency,
  SectionCard,
  TotalsStrip,
  pagedTableProps,
  usePagedList,
  useUrlParam,
  type Column,
} from "../../finance/kit";
import { formatMinor } from "../../finance/money";
import { currentYearEAT, fmtDateEAT } from "../../finance/dates";
import { parseYear } from "../../finance/b/logic";
import { useSetUrlParams } from "../../finance/b/hooks";
import { StatementPdfButton, Stacked } from "../../finance/b/ui";

export function FinanceStatements(): ReactElement {
  const thisYear = currentYearEAT();
  const [yearRaw, setYearRaw] = useUrlParam("year", "");
  const [q, setQ] = useUrlParam("q", "");
  const setUrl = useSetUrlParams();
  const year = parseYear(yearRaw, thisYear);
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);
  const filters: StatementsFilters = useMemo(() => ({ year, q: q || null }), [year, q]);
  const list = usePagedList((cursor) => FinanceApi.statements({ ...filters, cursor, limit: 100 }), JSON.stringify(filters), { errorFallback: "Could not load the givers." });
  const gifts = list.totals.reduce((n, t) => n + t.count, 0);
  const firstLoad = list.loading && !list.page;

  const columns: Column<FinanceStatementRow>[] = [
    { key: "member", header: "Member", cell: (r) => <Stacked primary={r.full_name} secondary={r.phone ?? undefined} strong />, width: 200 },
    { key: "email", header: "Email", cell: (r) => r.email ?? <span style={{ color: FIN.muted }}>—</span> },
    { key: "gifts", header: "Gifts", cell: (r) => r.gifts, align: "right", mono: true },
    { key: "total", header: `Given in ${year}`, cell: (r) => <PerCurrency amounts={r.totals} style={{ fontFamily: FIN.mono, fontWeight: 700 }} />, align: "right" },
    {
      key: "by_fund",
      header: "By fund",
      cell: (r) =>
        r.by_fund.length === 0 ? (
          <span style={{ color: FIN.muted }}>—</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
            {r.by_fund.map((f) => (
              <span key={`${f.code}-${f.currency}`} style={{ whiteSpace: "nowrap" }}>
                {f.name} <span style={{ fontFamily: FIN.mono, color: FIN.muted }}>{formatMinor(f.amount_minor, f.currency)}</span>
              </span>
            ))}
          </div>
        ),
    },
    {
      key: "pledge",
      header: <span title="The part of the year's giving that went toward a pledge">Toward pledges</span>,
      cell: (r) => (r.pledge_paid.length === 0 ? <span style={{ color: FIN.muted }}>—</span> : <PerCurrency amounts={r.pledge_paid} style={{ fontFamily: FIN.mono }} />),
      align: "right",
    },
    { key: "last", header: "Last gift", cell: (r) => fmtDateEAT(r.last_gift_at), mono: true },
    {
      key: "pdfs",
      header: "Statements",
      align: "right",
      cell: (r) => (
        <div className="inline-flex flex-wrap justify-end" style={{ gap: 6 }}>
          <StatementPdfButton userId={r.user_id} year={year} kind="giving" memberName={r.full_name} />
          <StatementPdfButton userId={r.user_id} year={year} kind="partners" memberName={r.full_name} />
        </div>
      ),
    },
  ];

  return (
    <FinancePage
      title="Statements"
      subtitle={`Everyone who gave in ${year}, as their own statement counts it — and each member's Giving and Partner statement PDFs for the office to print or send.`}
      actions={<ExportButton onDark path={FINANCE_CSV.statements} params={filters} filename={`givers-${year}`} />}
      hero={
        <KpiStrip>
          <KpiTile label={`Given in ${year}`} icon={<Gift size={12} />} tone="good" value={<PerCurrency amounts={list.totals} />} loading={firstLoad} hint="by members, per currency" />
          <KpiTile label="Gifts" value={firstLoad ? "…" : gifts.toLocaleString()} hint="succeeded, every currency" />
          <KpiTile label="Givers" icon={<Users size={12} />} value={firstLoad ? "…" : `${list.rows.length.toLocaleString()}${list.hasMore ? "+" : ""}`} hint={list.hasMore ? "loaded so far — load more below" : "members with a statement"} />
        </KpiStrip>
      }
    >
      <FilterBar
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Member name, phone or email"
        selects={[{ key: "year", label: "Year", value: String(year), options: years.map((y) => ({ value: String(y), label: String(y) })), onChange: (v) => setYearRaw(Number(v) === thisYear ? "" : v) }]}
        clearable={Boolean(q) || year !== thisYear}
        onClear={() => setUrl({ q: null, year: null })}
      />
      <TotalsStrip totals={list.totals} loading={list.loading} label={`Given in ${year}`} noun={["gift", "gifts"]} extra="Members only — website and walk-in gifts have no statement." />
      <SectionCard title="Givers" subtitle="By name. Each row adds up to that member's own statement for the year." icon={<FileText size={15} />} flush>
        <DataTable
          ariaLabel="Givers"
          columns={columns}
          rowKey={(r) => r.user_id}
          empty={q ? "No giver matches that search." : `No member gave in ${year}.`}
          minWidth={1240}
          {...pagedTableProps(list)}
        />
      </SectionCard>
    </FinancePage>
  );
}
