// Finance → Transactions (/finance/transactions) — docs/FINANCE_ERP.md §5. The
// register of every gift and payment (GET /admin/finance/transactions): filter
// by period, fund, status, channel, source, pledge, need and a search; totals
// per currency for the WHOLE filtered set; CSV of the same filters; a drawer
// with every field and ledger leg (?tx=<id> opens it — Overview and
// Reconciliation link here); Reverse for office entries; Record a gift.
// Every filter lives in the URL, so a view can be linked to.
//
// Two reports (owner ask, 2026-10-13), as tabs over the same register:
//   · Succeeded — money that reached the church, and only that;
//   · Failed — gifts that did not go through: what they would have been,
//     why (in the member's words), and whether that giver gave again within
//     7 days, so the office knows who still needs a call;
//   · All — the full register with the status filter, as before.
// `?report=` holds the tab; a link with only `?status=` (Overview,
// Reconciliation) lands on the matching tab.
import { useMemo, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, PhoneCall, Plus, UserRound } from "lucide-react";
import {
  FinanceApi,
  FINANCE_CSV,
  type AnyYesNo,
  type FinanceChannel,
  type FinanceFailureReason,
  type FinanceTransactionRow,
  type TransactionSource,
  type TransactionStatus,
  type TransactionsFilters,
} from "../../../api/finance";
import {
  Button,
  DataTable,
  ExportButton,
  FIN,
  FilterBar,
  FinancePage,
  MoneyText,
  SectionCard,
  StatusChip,
  Tabs,
  TotalsStrip,
  channelLabel,
  pagedTableProps,
  useFinanceCaps,
  usePagedList,
  useUrlParam,
  type Column,
  type FilterOption,
} from "../../finance/kit";
import { fmtDateEAT, fmtDateTimeEAT } from "../../finance/dates";
import { useFunds, usePeriodParam } from "../../finance/a/hooks";
import { RecordGiftDrawer } from "../../finance/a/RecordGiftDrawer";
import { SOURCE_LABELS, TransactionDrawer, memberHref } from "../../finance/a/TransactionDrawer";

const STATUSES: readonly FilterOption[] = [
  { value: "", label: "All" },
  { value: "succeeded", label: "Succeeded" },
  { value: "processing", label: "Processing" },
  { value: "requires_action", label: "Awaiting payer" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded / reversed" },
];
const CHANNELS: readonly FilterOption[] = [
  { value: "", label: "All" },
  { value: "mpesa", label: "M-Pesa (online + office)" },
  { value: "card", label: "Card" },
  { value: "airtel", label: "Airtel Money" },
  { value: "paypal", label: "PayPal" },
  { value: "onhand", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other (office)" },
  { value: "manual", label: "Confirmed claims" },
];
const SOURCES: readonly FilterOption[] = [
  { value: "", label: "All" },
  { value: "app", label: "Member app" },
  { value: "website", label: "Website" },
  { value: "paybill", label: "Paybill (direct)" },
  { value: "admin", label: "Office" },
];
const YES_NO: readonly FilterOption[] = [
  { value: "any", label: "Any" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];
const FILTER_KEYS = ["q", "fund", "status", "channel", "source", "pledged", "need", "period", "from", "to"] as const;

type Report = "succeeded" | "failed" | "all";
const REPORTS = ["succeeded", "failed", "all"] as const;
const REPORT_TABS = [
  { key: "succeeded", label: "Succeeded" },
  { key: "failed", label: "Failed" },
  { key: "all", label: "All transactions" },
] as const;
/** The tab: `?report=` when set; else the tab a bare `?status=` link means; else Succeeded. */
export function reportFor(report: string, status: string): Report {
  if ((REPORTS as readonly string[]).includes(report)) return report as Report;
  if (status === "succeeded" || status === "failed") return status;
  if (status) return "all";
  return "succeeded";
}

const pick = <T extends string>(v: string, options: readonly FilterOption[]): T | null => (v && options.some((o) => o.value === v) ? (v as T) : null);

function Tag({ children, title }: { children: string; title?: string | undefined }): ReactElement {
  return (
    <span
      title={title}
      style={{ display: "inline-block", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "middle", fontSize: 11, fontWeight: 600, color: "#1E4068", background: "#E6EDF5", borderRadius: 999, padding: "2px 8px" }}
    >
      {children}
    </span>
  );
}

export function FinanceTransactions(): ReactElement {
  const caps = useFinanceCaps();
  const [, setParams] = useSearchParams();
  const [period, setPeriod] = usePeriodParam("this_month");
  const [q, setQ] = useUrlParam("q");
  const [fund, setFund] = useUrlParam("fund");
  const [status, setStatus] = useUrlParam("status");
  const [reportParam] = useUrlParam("report");
  const report = reportFor(reportParam, status);
  const setReport = (next: Report): void =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set("report", next);
        // The tab is the status on Succeeded / Failed; All starts unfiltered.
        n.delete("status");
        return n;
      },
      { replace: true },
    );
  const [channel, setChannel] = useUrlParam("channel");
  const [source, setSource] = useUrlParam("source");
  const [pledged, setPledged] = useUrlParam("pledged", "any");
  const [need, setNeed] = useUrlParam("need", "any");
  const [tx, setTx] = useUrlParam("tx");
  const [recordOpen, setRecordOpen] = useState(false);
  const funds = useFunds();

  const filters: TransactionsFilters = useMemo(
    () => ({
      from: period.from,
      to: period.to,
      fund: fund || null,
      status: report === "all" ? pick<TransactionStatus>(status, STATUSES) : report,
      channel: pick<FinanceChannel>(channel, CHANNELS),
      source: pick<TransactionSource>(source, SOURCES),
      q: q || null,
      pledged: pick<AnyYesNo>(pledged, YES_NO) ?? "any",
      need: pick<AnyYesNo>(need, YES_NO) ?? "any",
    }),
    [period.from, period.to, fund, status, report, channel, source, q, pledged, need],
  );
  const list = usePagedList((cursor) => FinanceApi.transactions({ ...filters, cursor }), JSON.stringify(filters), {
    errorFallback: "Could not load the transactions.",
  });

  const clearable = Boolean(q || fund || (report === "all" && filters.status) || filters.channel || filters.source || filters.pledged !== "any" || filters.need !== "any" || period.preset !== "this_month");
  const clear = (): void =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        for (const k of FILTER_KEYS) n.delete(k);
        // Clear resets the filters, never the report you are on.
        n.set("report", report);
        return n;
      },
      { replace: true },
    );

  const fundOptions: FilterOption[] = useMemo(() => {
    const opts: FilterOption[] = [{ value: "", label: "All" }, ...funds.rows.map((f) => ({ value: f.code, label: f.is_active ? f.name : `${f.name} (inactive)` }))];
    // A fund in the URL that the list doesn't have (yet) still shows as chosen.
    if (fund && !opts.some((o) => o.value === fund)) opts.push({ value: fund, label: fund });
    return opts;
  }, [funds.rows, fund]);

  const columns: Column<FinanceTransactionRow>[] = [
    {
      key: "date",
      header: "Date (EAT)",
      nowrap: true,
      cell: (r) => (
        <span>
          <span style={{ fontFamily: FIN.mono, fontSize: 12 }}>{fmtDateEAT(r.created_at)}</span>
          {r.source !== "admin" ? <span style={{ display: "block", fontFamily: FIN.mono, fontSize: 11, color: FIN.muted }}>{fmtDateTimeEAT(r.created_at).split(", ")[1]}</span> : null}
        </span>
      ),
    },
    { key: "receipt", header: "Receipt", mono: true, cell: (r) => r.receipt_code ?? <span style={{ color: FIN.muted }}>—</span> },
    {
      key: "giver",
      header: "Giver",
      cell: (r) => (
        <span className="inline-flex items-center" style={{ gap: 6, maxWidth: 200 }}>
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.display_name}</span>
          {r.user_id ? (
            <Link
              to={memberHref(r.user_id)}
              onClick={(e) => e.stopPropagation()}
              title="Open the member's profile"
              aria-label={`Open ${r.display_name}'s profile`}
              style={{ display: "inline-flex", color: FIN.muted }}
            >
              <UserRound size={13} />
            </Link>
          ) : null}
        </span>
      ),
    },
    {
      key: "fund",
      header: "Fund · for",
      cell: (r) => (
        <span className="inline-flex flex-col" style={{ gap: 3, maxWidth: 190 }}>
          <span>{r.fund_name ?? r.fund ?? <span style={{ color: FIN.muted }}>—</span>}</span>
          {r.pledge_title ? <Tag title={`Pledge: ${r.pledge_title}`}>{`Pledge · ${r.pledge_title}`}</Tag> : null}
          {r.need_title ? <Tag title={`Department need: ${r.need_title}`}>{`Need · ${r.need_title}`}</Tag> : null}
        </span>
      ),
    },
    {
      key: "channel",
      header: "Channel · source",
      nowrap: true,
      cell: (r) => (
        <span className="inline-flex flex-col" style={{ gap: 3, alignItems: "flex-start" }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: FIN.navy, background: FIN.surface, border: `1px solid ${FIN.border}`, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
            {r.provider === "manual" && !r.office_channel ? "Claim" : channelLabel(r.channel)}
          </span>
          <span style={{ fontSize: 11, color: FIN.muted }}>{SOURCE_LABELS[r.source] ?? r.source}</span>
        </span>
      ),
    },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <MoneyText amount_minor={r.amount_minor} currency={r.currency} strong={r.status === "succeeded"} style={r.status === "succeeded" ? undefined : { color: FIN.muted }} /> },
    { key: "status", header: "Status", cell: (r) => <StatusChip status={r.status} label={r.reversed_at ? "Reversed" : undefined} /> },
  ];
  const failedColumns: Column<FinanceTransactionRow>[] = [
    ...columns.filter((c) => c.key !== "status" && c.key !== "receipt"),
    {
      key: "reason",
      header: "Why it failed",
      cell: (r) => (
        <span title={r.failure_detail ?? undefined} style={{ display: "block", maxWidth: 240, fontSize: 12.5 }}>
          {r.failure?.reason ?? "Declined."}
        </span>
      ),
    },
    { key: "gave_after", header: "Gave again?", nowrap: true, cell: (r) => <GaveAgain value={r.gave_after} /> },
  ];
  const tableColumns = report === "failed" ? failedColumns : report === "succeeded" ? columns.filter((c) => c.key !== "status") : columns;
  const totals = report === "failed" ? list.totals.map((t) => ({ ...t, amount_minor: t.attempted_minor ?? t.amount_minor })) : list.totals;
  const reasons = report === "failed" ? (list.page?.failure_reasons ?? []) : [];

  return (
    <FinancePage
      title="Transactions"
      tabs={<Tabs tabs={REPORT_TABS} value={report} onChange={setReport} ariaLabel="Transaction reports" />}
      subtitle="Every gift and payment — online and recorded by the office. Dates are East Africa Time; an office gift is dated the day the money was received. Click a row for its ledger postings."
      actions={
        <>
          {caps.manage ? (
            <Button variant="primary" onDark icon={<Plus size={14} />} onClick={() => setRecordOpen(true)}>
              Record a gift
            </Button>
          ) : null}
          <ExportButton onDark path={FINANCE_CSV.transactions} params={filters} filename={`transactions-${report === "all" ? "" : `${report}-`}${period.from}-to-${period.to}.csv`} />
        </>
      }
    >
      <FilterBar
        period={period}
        onPeriodChange={setPeriod}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Receipt, name, phone, M-Pesa code"
        selects={[
          { key: "fund", label: "Fund", value: fund, options: fundOptions, onChange: setFund },
          ...(report === "all" ? [{ key: "status", label: "Status", value: filters.status ?? "", options: STATUSES, onChange: setStatus }] : []),
          { key: "channel", label: "Channel", value: filters.channel ?? "", options: CHANNELS, onChange: setChannel },
          { key: "source", label: "Source", value: filters.source ?? "", options: SOURCES, onChange: setSource },
          { key: "pledged", label: "Pledge", value: filters.pledged ?? "any", options: YES_NO, onChange: setPledged },
          { key: "need", label: "Need", value: filters.need ?? "any", options: YES_NO, onChange: setNeed },
        ]}
        clearable={clearable}
        onClear={clear}
      />
      {report === "succeeded" ? (
        <TotalsStrip totals={totals} loading={list.loading} label="Received" noun={["gift", "gifts"]} extra="Succeeded gifts only: money that reached the church" />
      ) : report === "failed" ? (
        <TotalsStrip
          totals={totals}
          loading={list.loading}
          label="Did not arrive"
          noun={["failed gift", "failed gifts"]}
          extra="What these givers tried to give. Nothing was taken from them."
        />
      ) : (
        <TotalsStrip
          totals={totals}
          loading={list.loading}
          label="Total"
          noun={["transaction", "transactions"]}
          extra="Amount = succeeded gifts only · count = every row in this filter, any status"
        />
      )}
      {report === "failed" && reasons.length > 0 ? <FailureReasons reasons={reasons} /> : null}
      <SectionCard
        flush
        title={report === "succeeded" ? "Succeeded gifts" : report === "failed" ? "Failed gifts" : "Register"}
        subtitle={list.hasMore ? "Newest first — load more at the bottom." : "Newest first."}
      >
        <DataTable
          ariaLabel={report === "succeeded" ? "Succeeded transactions" : report === "failed" ? "Failed transactions" : "Transactions"}
          columns={tableColumns}
          rowKey={(r) => r.transaction_id}
          onRowClick={(r) => setTx(r.transaction_id)}
          selectedKey={tx || null}
          minWidth={860}
          empty={
            clearable
              ? "No transactions match these filters."
              : report === "failed"
                ? "No failed gifts in this period."
                : report === "succeeded"
                  ? "No gifts received in this period yet."
                  : "No transactions in this period yet."
          }
          {...pagedTableProps(list)}
        />
      </SectionCard>

      {recordOpen ? (
        <RecordGiftDrawer
          funds={funds.active}
          fundsLoading={funds.loading}
          fundsError={funds.error}
          onClose={() => setRecordOpen(false)}
          onRecorded={() => list.reload()}
          onView={(id) => setTx(id)}
        />
      ) : null}
      <TransactionDrawer transactionId={tx || null} onClose={() => setTx("")} onChanged={list.reload} />
    </FinancePage>
  );
}

/** "Gave again?" on a failed row: yes (sorted out) or no (worth a call). */
function GaveAgain({ value }: { value: boolean | null | undefined }): ReactElement {
  if (value === true) {
    return (
      <span className="inline-flex items-center" style={{ gap: 5, fontSize: 12, fontWeight: 600, color: FIN.good }}>
        <CheckCircle2 size={13} /> Gave again
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inline-flex items-center" style={{ gap: 5, fontSize: 12, fontWeight: 600, color: FIN.warn }}>
        <PhoneCall size={13} /> Not yet
      </span>
    );
  }
  return <span style={{ color: FIN.muted }}>—</span>;
}

/** The Failed report's "why": one line per reason, most frequent first. */
export function FailureReasons({ reasons }: { reasons: readonly FinanceFailureReason[] }): ReactElement {
  const total = reasons.reduce((a, r) => a + r.count, 0);
  const gave = reasons.reduce((a, r) => a + r.gave_after, 0);
  return (
    <SectionCard
      title="Why they failed"
      subtitle={`${gave.toLocaleString()} of ${total.toLocaleString()} gave again within 7 days. The rest may need a call.`}
    >
      <ul aria-label="Failure reasons" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
        {reasons.map((r) => (
          <li key={r.code} className="flex flex-wrap items-baseline" style={{ gap: "4px 14px", paddingBottom: 10, borderBottom: `1px solid ${FIN.border}` }}>
            <span style={{ fontWeight: 600, color: FIN.navy, flex: "1 1 260px" }}>
              {r.reason}
              <span style={{ display: "block", fontWeight: 400, fontSize: 12, color: FIN.muted }}>{r.hint}</span>
            </span>
            <span style={{ fontFamily: FIN.mono, fontSize: 12.5 }}>
              {r.count.toLocaleString()} {r.count === 1 ? "gift" : "gifts"}
            </span>
            <span className="inline-flex flex-wrap" style={{ gap: 10 }}>
              {r.by_currency.map((c) => (
                <MoneyText key={c.currency} amount_minor={c.amount_minor} currency={c.currency} style={{ color: FIN.muted }} />
              ))}
            </span>
            <span style={{ fontSize: 12, color: r.gave_after > 0 ? FIN.good : FIN.muted }}>
              {r.gave_after.toLocaleString()} gave again
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
