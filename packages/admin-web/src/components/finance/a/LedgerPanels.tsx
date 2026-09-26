// Ledger → Postings and Trial balance. Postings (GET /admin/finance/ledger):
// every leg, gift and journal alike, by the day it counts on, filterable by
// account and kind, totals of debits and credits per currency for the whole
// filter, CSV. Trial balance (GET /admin/finance/trial-balance): per account
// and currency, debits, credits and the balance on the account's normal side,
// with a plain Balanced / Not balanced verdict.
import { useMemo, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, XCircle } from "lucide-react";
import { FinanceApi, FINANCE_CSV, type FinanceFundRow, type FinanceLedgerRow, type FinanceLedgerTotal, type FinanceTrialBalance, type LedgerFilters } from "../../../api/finance";
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  ExportButton,
  FIN,
  FilterBar,
  MoneyText,
  Notice,
  SectionCard,
  Skeleton,
  pagedTableProps,
  usePagedList,
  useUrlParam,
  type Column,
  type FilterOption,
} from "../kit";
import { compareCurrencies, sortTotals } from "../money";
import { fmtDay, fmtRange } from "../dates";
import { CASH_ACCOUNT_LABELS, accountLabel, trialBalanceState } from "./helpers";
import { usePatchParams, useAsync, usePeriodParam } from "./hooks";
import { postingSource } from "./FundDetailDrawer";
import { Segmented, miniTd, miniTh } from "./ui";

const KINDS: readonly FilterOption[] = [
  { value: "", label: "All" },
  { value: "transaction", label: "Gifts & payments" },
  { value: "journal", label: "Journals" },
];

/** The account picker: every cash account, every fund, the prefixes, media sales. */
export function accountOptions(funds: readonly FinanceFundRow[], current: string): FilterOption[] {
  const opts: FilterOption[] = [
    { value: "", label: "All accounts" },
    { value: "cash:", label: "All cash accounts (cash:)" },
    ...Object.entries(CASH_ACCOUNT_LABELS).map(([a, l]) => ({ value: a, label: `${l} (${a})` })),
    { value: "fund:", label: "All funds (fund:)" },
    ...funds.map((f) => ({ value: `fund:${f.code}`, label: `${f.name} (fund:${f.code})${f.is_active ? "" : " — inactive"}` })),
    { value: "sales:media", label: "Media sales (sales:media)" },
  ];
  if (current && !opts.some((o) => o.value === current)) opts.push({ value: current, label: current });
  return opts;
}

/** Account order for the trial balance: cash, then funds, then the rest; by name. */
export function accountRank(account: string): number {
  if (account.startsWith("cash:")) return 0;
  if (account.startsWith("fund:")) return 1;
  return 2;
}

function LedgerTotals({ totals, loading }: { totals: readonly FinanceLedgerTotal[]; loading: boolean }): ReactElement {
  return (
    <Card style={{ padding: "12px 18px" }}>
      <div className="flex items-center flex-wrap" style={{ gap: "10px 28px", opacity: loading && totals.length > 0 ? 0.55 : 1 }} aria-busy={loading}>
        <span className="nuru-eyebrow">In this filter</span>
        {loading && totals.length === 0 ? (
          <Skeleton width={220} height={16} />
        ) : totals.length === 0 ? (
          <span style={{ fontSize: 13, color: FIN.muted }}>No postings.</span>
        ) : (
          sortTotals(totals).map((t) => (
            <span key={t.currency} className="inline-flex items-baseline flex-wrap" style={{ gap: 8, fontSize: 12.5, color: FIN.muted }}>
              <span style={{ fontFamily: FIN.mono, fontWeight: 700, color: FIN.navy }}>{t.currency}</span>
              debits <MoneyText amount_minor={t.debit_minor} currency={t.currency} withCode={false} strong style={{ color: FIN.navy }} />
              credits <MoneyText amount_minor={t.credit_minor} currency={t.currency} withCode={false} strong style={{ color: FIN.navy }} />
              <span>· {t.count.toLocaleString()} postings</span>
            </span>
          ))
        )}
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: FIN.muted }}>On one account, debits − credits is its movement; over the whole ledger they are equal.</span>
      </div>
    </Card>
  );
}

/** The Postings tab. `onJournal` opens a journal's drawer. */
export function PostingsPanel({
  funds,
  nameOf,
  onJournal,
  bump = 0,
}: {
  funds: readonly FinanceFundRow[];
  nameOf: (code: string) => string | null;
  onJournal: (id: string) => void;
  /** Changes after a reversal elsewhere on the page (reload). */
  bump?: number | undefined;
}): ReactElement {
  const navigate = useNavigate();
  const patch = usePatchParams();
  const [period, setPeriod] = usePeriodParam("this_month");
  const [account, setAccount] = useUrlParam("account");
  const [kind, setKind] = useUrlParam("kind");
  const filters: LedgerFilters = useMemo(
    () => ({
      from: period.from,
      to: period.to,
      account: account || null,
      kind: kind === "transaction" || kind === "journal" ? kind : null,
    }),
    [period.from, period.to, account, kind],
  );
  const list = usePagedList((cursor) => FinanceApi.ledger({ ...filters, cursor, limit: 100 }), JSON.stringify({ ...filters, bump }), { errorFallback: "Could not load the postings." });
  const label = (a: string): string => accountLabel(a, nameOf);

  const columns: Column<FinanceLedgerRow>[] = [
    { key: "posted", header: "Posted on", mono: true, cell: (r) => fmtDay(r.posted_on) },
    {
      key: "account",
      header: "Account",
      cell: (r) => (
        <span>
          <span style={{ fontWeight: 600 }}>{label(r.account)}</span> <span style={{ fontFamily: FIN.mono, fontSize: 11, color: FIN.muted }}>{r.account}</span>
        </span>
      ),
    },
    { key: "debit", header: "Debit", align: "right", cell: (r) => (r.side === "debit" ? <MoneyText amount_minor={r.amount_minor} currency={r.currency} /> : "") },
    { key: "credit", header: "Credit", align: "right", cell: (r) => (r.side === "credit" ? <MoneyText amount_minor={r.amount_minor} currency={r.currency} /> : "") },
    {
      key: "source",
      header: "Source",
      cell: (r) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, maxWidth: 380 }}>
          <span
            style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "2px 7px", whiteSpace: "nowrap", background: r.kind === "journal" ? "#E6EDF5" : "#E8F6EC", color: r.kind === "journal" ? "#1E4068" : FIN.good }}
          >
            {r.kind === "journal" ? "Journal" : "Gift"}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{postingSource(r)}</span>
        </span>
      ),
    },
  ];

  return (
    <>
      <FilterBar
        period={period}
        onPeriodChange={setPeriod}
        selects={[
          { key: "account", label: "Account", value: account, options: accountOptions(funds, account), onChange: setAccount },
          { key: "kind", label: "Kind", value: filters.kind ?? "", options: KINDS, onChange: setKind },
        ]}
        clearable={Boolean(account || filters.kind) || period.preset !== "this_month"}
        onClear={() => patch({ account: null, kind: null, period: null, from: null, to: null })}
        trailing={<ExportButton path={FINANCE_CSV.ledger} params={filters} filename={`ledger-${account ? account.replace(/:/g, "-") : "all"}-${period.from}-to-${period.to}.csv`} />}
      />
      <LedgerTotals totals={list.totals} loading={list.loading} />
      <SectionCard flush title="Postings" subtitle="Each leg on the day it counts: a gift on the day received, a reversal on the gift's own day, an expense on the day spent, a transfer on its date. Click a row for its gift or journal.">
        <DataTable
          ariaLabel="Postings"
          columns={columns}
          rowKey={(r) => r.entry_id}
          onRowClick={(r) => {
            if (r.transaction_id) navigate(`/finance/transactions?tx=${encodeURIComponent(r.transaction_id)}`);
            else if (r.journal_id) onJournal(r.journal_id);
          }}
          minWidth={900}
          empty="No postings match these filters."
          {...pagedTableProps(list)}
        />
      </SectionCard>
    </>
  );
}

function Verdict({ tb }: { tb: FinanceTrialBalance }): ReactElement {
  const state = trialBalanceState(tb);
  if (state === "empty") return <Notice tone="info">No postings in this period — nothing to balance.</Notice>;
  if (state === "balanced") {
    return (
      <div role="status" className="flex items-center gap-3 rounded-xl" style={{ padding: "12px 16px", background: "#E8F6EC", border: "1px solid #BFE3CB", color: FIN.good }}>
        <CheckCircle2 size={20} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Balanced ✓</div>
          <div style={{ fontSize: 12.5, color: FIN.navy }}>Debits equal credits in every currency — every posting has its other side.</div>
        </div>
      </div>
    );
  }
  const off = tb.totals.filter((t) => !t.balanced).map((t) => t.currency);
  return (
    <div role="alert" className="flex items-center gap-3 rounded-xl" style={{ padding: "12px 16px", background: "#FDECEC", border: "1px solid #F5C2C0", color: FIN.danger }}>
      <XCircle size={20} />
      <div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Not balanced</div>
        <div style={{ fontSize: 12.5, color: FIN.navy }}>
          Debits and credits differ in {off.join(", ") || "a currency"}. Reconciliation → Exceptions names the entries; tell the developer — don&apos;t post corrections by hand.
        </div>
      </div>
    </div>
  );
}

/** The Trial balance tab: all time by default, or a period. */
export function TrialBalancePanel({ nameOf }: { nameOf: (code: string) => string | null }): ReactElement {
  const [scope, setScope] = useUrlParam("tbscope", "all");
  const [period, setPeriod] = usePeriodParam("this_year", "tb");
  const byPeriod = scope === "period";
  const q = byPeriod ? { from: period.from, to: period.to } : {};
  const tb = useAsync(() => FinanceApi.trialBalance(q), JSON.stringify(q), { errorFallback: "Could not load the trial balance." });
  const data = tb.data;
  const currencies = data ? Array.from(new Set([...data.totals.map((t) => t.currency), ...data.data.map((r) => r.currency)])).sort(compareCurrencies) : [];

  return (
    <>
      <Card style={{ padding: "12px 14px" }}>
        <div className="flex items-center flex-wrap" style={{ gap: 12 }}>
          <Segmented
            ariaLabel="Trial balance scope"
            options={[
              { key: "all", label: "All time" },
              { key: "period", label: "A period" },
            ]}
            value={byPeriod ? "period" : "all"}
            onChange={(k) => setScope(k === "period" ? "period" : "all")}
          />
          <span style={{ fontSize: 12, color: FIN.muted }}>
            {byPeriod ? `Postings dated ${fmtRange(period)} only.` : "Every posting ever made — the balances the funds and cash accounts hold today."}
          </span>
        </div>
      </Card>
      {byPeriod ? <FilterBar period={period} onPeriodChange={setPeriod} /> : null}
      {tb.error ? (
        <Card>
          <ErrorState message={tb.error} onRetry={tb.reload} />
        </Card>
      ) : !data ? (
        <Card style={{ padding: 20 }}>
          <Skeleton height={48} />
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 16, opacity: tb.loading ? 0.55 : 1 }}>
          <Verdict tb={data} />
          {currencies.length === 0 ? (
            <Card>
              <EmptyState title="Nothing posted">Gifts, expenses, transfers and opening balances appear here once posted.</EmptyState>
            </Card>
          ) : (
            currencies.map((c) => {
              const rows = data.data.filter((r) => r.currency === c).sort((a, b) => accountRank(a.account) - accountRank(b.account) || accountLabel(a.account, nameOf).localeCompare(accountLabel(b.account, nameOf)));
              const tot = data.totals.find((t) => t.currency === c);
              return (
                <SectionCard key={c} flush title={`${c} accounts`} subtitle="Balance is on the account's normal side: cash accounts hold debits; funds and income accounts hold credits.">
                  <div className="r-table-scroll" style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }} aria-label={`Trial balance ${c}`}>
                      <thead>
                        <tr style={{ background: FIN.surface }}>
                          <th style={{ ...miniTh, padding: "10px 16px", textAlign: "left" }}>Account</th>
                          <th style={{ ...miniTh, padding: "10px 16px", textAlign: "right" }}>Debits</th>
                          <th style={{ ...miniTh, padding: "10px 16px", textAlign: "right" }}>Credits</th>
                          <th style={{ ...miniTh, padding: "10px 16px", textAlign: "right" }}>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={`${r.account}|${r.currency}`} style={{ borderTop: `1px solid ${FIN.border}` }}>
                            <td style={{ ...miniTd, padding: "9px 16px" }}>
                              <span style={{ fontWeight: 600 }}>{accountLabel(r.account, nameOf)}</span> <span style={{ fontFamily: FIN.mono, fontSize: 11, color: FIN.muted }}>{r.account}</span>
                            </td>
                            <td style={{ ...miniTd, padding: "9px 16px", textAlign: "right" }}>
                              <MoneyText amount_minor={r.debit_minor} currency={c} withCode={false} />
                            </td>
                            <td style={{ ...miniTd, padding: "9px 16px", textAlign: "right" }}>
                              <MoneyText amount_minor={r.credit_minor} currency={c} withCode={false} />
                            </td>
                            <td style={{ ...miniTd, padding: "9px 16px", textAlign: "right", whiteSpace: "nowrap" }}>
                              <MoneyText amount_minor={r.balance_minor} currency={c} withCode={false} strong />{" "}
                              <span style={{ fontSize: 10.5, color: FIN.muted, fontWeight: 700 }}>{r.normal_side === "debit" ? "Dr" : "Cr"}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {tot ? (
                        <tfoot>
                          <tr style={{ borderTop: `2px solid ${FIN.border}`, background: FIN.surface }}>
                            <td style={{ ...miniTd, padding: "10px 16px", fontWeight: 700 }}>
                              Total {c}{" "}
                              {tot.balanced ? <span style={{ color: FIN.good, marginLeft: 6 }}>✓ balanced</span> : <span style={{ color: FIN.danger, marginLeft: 6 }}>✗ off by {<MoneyText amount_minor={tot.debit_minor - tot.credit_minor} currency={c} />}</span>}
                            </td>
                            <td style={{ ...miniTd, padding: "10px 16px", textAlign: "right" }}>
                              <MoneyText amount_minor={tot.debit_minor} currency={c} withCode={false} strong />
                            </td>
                            <td style={{ ...miniTd, padding: "10px 16px", textAlign: "right" }}>
                              <MoneyText amount_minor={tot.credit_minor} currency={c} withCode={false} strong />
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      ) : null}
                    </table>
                  </div>
                </SectionCard>
              );
            })
          )}
        </div>
      )}
    </>
  );
}
