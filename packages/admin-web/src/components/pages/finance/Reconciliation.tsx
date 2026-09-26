// Finance → Reconciliation (/finance/reconciliation) — docs/FINANCE_ERP.md §5.
// One read (GET /admin/finance/reconciliation?from&to), three tabs (?tab=, so
// Overview's alerts can open ?tab=exceptions):
// - Settlement: per day and cash channel, what came in, what was reversed and
//   the net — the figures to tick against the M-Pesa statement, the bank
//   statement and the cash book.
// - Exceptions: every payment or posting that needs a person, grouped by kind,
//   each kind with a one-line explanation and what to do, each row opening its
//   transaction or journal. Only `failed` is bounded by the period.
// - Integrity: Σ debits and Σ credits over the whole ledger, per currency.
import { Fragment, useMemo, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink, RefreshCw, XCircle } from "lucide-react";
import { FinanceApi, type FinanceReconciliation as Rec, type FinanceReconciliationException, type ReconciliationExceptionKind } from "../../../api/finance";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FIN,
  FilterBar,
  FinancePage,
  KpiStrip,
  KpiTile,
  MoneyText,
  Notice,
  PerCurrency,
  SectionCard,
  Skeleton,
  Tabs,
  TONES,
  channelLabel,
  useUrlTab,
  type TabDef,
} from "../../finance/kit";
import { compareCurrencies, totalsByCurrency } from "../../finance/money";
import { fmtDateTimeEAT, fmtDay, fmtRange } from "../../finance/dates";
import { EXCEPTION_COPY, EXCEPTION_ORDER, plural } from "../../finance/a/helpers";
import { useAsync, usePeriodParam } from "../../finance/a/hooks";
import { Explain, miniTd, miniTh } from "../../finance/a/ui";

type RecTab = "settlement" | "exceptions" | "integrity";
const TAB_KEYS: readonly RecTab[] = ["settlement", "exceptions", "integrity"];

/** Where an exception row leads: its transaction's drawer, or its journal. */
export function exceptionHref(x: Pick<FinanceReconciliationException, "transaction_id" | "journal_id">): string | null {
  if (x.transaction_id) return `/finance/transactions?tx=${encodeURIComponent(x.transaction_id)}`;
  if (x.journal_id) return `/finance/ledger?tab=journals&journal=${encodeURIComponent(x.journal_id)}`;
  return null;
}

function Settlement({ d }: { d: Rec }): ReactElement {
  const rows = d.settlement;
  const byChannel = useMemo(() => {
    const m = new Map<string, { channel: string; account: string; currency: string; count: number; received: number; reversedCount: number; reversed: number; net: number }>();
    for (const r of rows) {
      const k = `${r.account}|${r.currency}`;
      const t = m.get(k) ?? { channel: r.channel, account: r.account, currency: r.currency, count: 0, received: 0, reversedCount: 0, reversed: 0, net: 0 };
      t.count += r.count;
      t.received += r.received_minor;
      t.reversedCount += r.reversed_count;
      t.reversed += r.reversed_minor;
      t.net += r.amount_minor;
      m.set(k, t);
    }
    return [...m.values()].sort((a, b) => compareCurrencies(a.currency, b.currency) || b.net - a.net);
  }, [rows]);

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState title="Nothing settled in this period">Each day's money in — per M-Pesa, card, cash, bank and cheque account — appears here once gifts settle.</EmptyState>
      </Card>
    );
  }
  const th = { ...miniTh, padding: "10px 16px" };
  const td = { ...miniTd, padding: "9px 16px" };
  return (
    <>
      <SectionCard flush title="Period totals by channel" subtitle="Tick each line against its statement: the M-Pesa till statement, the bank statement, the cash book.">
        <div className="r-table-scroll" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }} aria-label="Period totals by channel">
            <thead>
              <tr style={{ background: FIN.surface }}>
                <th style={{ ...th, textAlign: "left" }}>Channel</th>
                <th style={{ ...th, textAlign: "right" }}>Gifts</th>
                <th style={{ ...th, textAlign: "right" }}>Received</th>
                <th style={{ ...th, textAlign: "right" }}>Reversed</th>
                <th style={{ ...th, textAlign: "right" }}>Net</th>
              </tr>
            </thead>
            <tbody>
              {byChannel.map((c) => (
                <tr key={`${c.account}|${c.currency}`} style={{ borderTop: `1px solid ${FIN.border}` }}>
                  <td style={td}>
                    <span style={{ fontWeight: 600 }}>{channelLabel(c.channel === "stripe" ? "card" : c.channel)}</span>{" "}
                    <span style={{ fontFamily: FIN.mono, fontSize: 11, color: FIN.muted }}>
                      {c.account} · {c.currency}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: FIN.mono }}>{c.count.toLocaleString()}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <MoneyText amount_minor={c.received} currency={c.currency} />
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{c.reversed > 0 ? <MoneyText amount_minor={-c.reversed} currency={c.currency} /> : <span style={{ color: FIN.muted }}>—</span>}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <MoneyText amount_minor={c.net} currency={c.currency} strong />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
      <SectionCard flush title="Day by day" subtitle="Newest day first. A reversal is dated at the gift it corrects, so it lands on the day it restates.">
        <div className="r-table-scroll" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }} aria-label="Daily settlement">
            <thead>
              <tr style={{ background: FIN.surface }}>
                <th style={{ ...th, textAlign: "left" }}>Day</th>
                <th style={{ ...th, textAlign: "left" }}>Channel</th>
                <th style={{ ...th, textAlign: "right" }}>Gifts</th>
                <th style={{ ...th, textAlign: "right" }}>Received</th>
                <th style={{ ...th, textAlign: "right" }}>Reversed</th>
                <th style={{ ...th, textAlign: "right" }}>Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const firstOfDay = i === 0 || rows[i - 1]?.day !== r.day;
                return (
                  <tr key={`${r.day}|${r.account}|${r.currency}`} style={{ borderTop: firstOfDay ? `2px solid ${FIN.border}` : `1px solid ${FIN.border}` }}>
                    <td style={{ ...td, fontFamily: FIN.mono, whiteSpace: "nowrap", color: firstOfDay ? FIN.navy : "transparent" }}>{fmtDay(r.day)}</td>
                    <td style={td}>
                      <span style={{ fontWeight: 600 }}>{channelLabel(r.channel === "stripe" ? "card" : r.channel)}</span>{" "}
                      <span style={{ fontFamily: FIN.mono, fontSize: 11, color: FIN.muted }}>{r.currency}</span>
                    </td>
                    <td style={{ ...td, textAlign: "right", fontFamily: FIN.mono }}>{r.count.toLocaleString()}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <MoneyText amount_minor={r.received_minor} currency={r.currency} />
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {r.reversed_minor > 0 ? (
                        <span title={plural(r.reversed_count, "reversal")}>
                          <MoneyText amount_minor={-r.reversed_minor} currency={r.currency} />
                        </span>
                      ) : (
                        <span style={{ color: FIN.muted }}>—</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <MoneyText amount_minor={r.amount_minor} currency={r.currency} strong />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </>
  );
}

function Exceptions({ d }: { d: Rec }): ReactElement {
  const groups = EXCEPTION_ORDER.map((kind) => ({ kind, rows: d.exceptions.filter((x) => x.kind === kind), count: d.exception_counts[kind] ?? 0 })).filter((g) => g.count > 0 || g.rows.length > 0);
  if (groups.length === 0) {
    return (
      <Card>
        <EmptyState icon={<CheckCircle2 size={22} />} title="No exceptions">
          Every payment settled or failed cleanly, nothing is stuck, and every posting has its other side.
        </EmptyState>
      </Card>
    );
  }
  return (
    <>
      <Card style={{ padding: "12px 16px" }}>
        <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
          {groups.map((g) => {
            const t = TONES[EXCEPTION_COPY[g.kind].tone];
            return (
              <a key={g.kind} href={`#exc-${g.kind}`} style={{ textDecoration: "none", background: t.bg, color: t.color, border: `1px solid ${t.border}`, borderRadius: 999, padding: "4px 11px", fontSize: 12, fontWeight: 700 }}>
                {EXCEPTION_COPY[g.kind].title} · {g.count.toLocaleString()}
              </a>
            );
          })}
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: FIN.muted }}>Only “Failed” is limited to the period; everything else stays here until it is fixed.</span>
        </div>
      </Card>
      {groups.map((g) => {
        const copy = EXCEPTION_COPY[g.kind];
        return (
          <div key={g.kind} id={`exc-${g.kind}`}>
            <SectionCard flush title={`${copy.title} · ${g.count.toLocaleString()}`} subtitle={copy.explain}>
              <div style={{ padding: "12px 16px 4px" }}>
                <Notice tone={copy.tone === "error" ? "error" : copy.tone === "warn" ? "warn" : "info"}>
                  <span style={{ fontWeight: 700 }}>What to do: </span>
                  <span style={{ fontWeight: 500 }}>{copy.todo}</span>
                </Notice>
              </div>
              <ExceptionRows kind={g.kind} rows={g.rows} />
            </SectionCard>
          </div>
        );
      })}
    </>
  );
}

function ExceptionRows({ kind, rows }: { kind: ReconciliationExceptionKind; rows: readonly FinanceReconciliationException[] }): ReactElement {
  if (rows.length === 0) return <Explain style={{ padding: "8px 16px 14px" }}>The count comes from the server; no rows were listed.</Explain>;
  const th = { ...miniTh, padding: "9px 16px" };
  const td = { ...miniTd, padding: "9px 16px" };
  return (
    <div className="r-table-scroll" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }} aria-label={EXCEPTION_COPY[kind].title}>
        <thead>
          <tr style={{ background: FIN.surface }}>
            <th style={{ ...th, textAlign: "left" }}>When</th>
            <th style={{ ...th, textAlign: "right" }}>Amount</th>
            <th style={{ ...th, textAlign: "left" }}>Detail</th>
            <th style={{ ...th, textAlign: "left" }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((x, i) => {
            const href = exceptionHref(x);
            return (
              <tr key={`${x.transaction_id ?? x.journal_id ?? "x"}-${i}`} style={{ borderTop: `1px solid ${FIN.border}` }}>
                <td style={{ ...td, fontFamily: FIN.mono, fontSize: 12, whiteSpace: "nowrap" }}>{x.at ? fmtDateTimeEAT(x.at) : "—"}</td>
                <td style={{ ...td, textAlign: "right" }}>{x.amount_minor !== null && x.currency ? <MoneyText amount_minor={x.amount_minor} currency={x.currency} /> : <span style={{ color: FIN.muted }}>—</span>}</td>
                <td style={{ ...td, maxWidth: 460 }}>{x.detail}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {href ? (
                    <Link to={href} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: FIN.navy }}>
                      {x.transaction_id ? (kind === "duplicate_receipt" ? "Open the office entry" : "Open transaction") : "Open journal"} <ExternalLink size={12} />
                    </Link>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Integrity({ d }: { d: Rec }): ReactElement {
  const rows = [...d.integrity].sort((a, b) => compareCurrencies(a.currency, b.currency));
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState title="The ledger is empty">Nothing has been posted yet.</EmptyState>
      </Card>
    );
  }
  return (
    <>
      <Explain>Every debit and every credit ever posted, gifts and journals alike, per currency. They must be equal: each posting has its other side.</Explain>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 16 }}>
        {rows.map((r) => (
          <Card key={r.currency} style={{ padding: 18 }}>
            <div className="flex items-center justify-between" style={{ gap: 10 }}>
              <div style={{ fontFamily: FIN.display, fontSize: 20, color: FIN.navy }}>{r.currency}</div>
              {r.balanced ? (
                <span className="inline-flex items-center gap-1.5" style={{ color: FIN.good, fontWeight: 700, fontSize: 13 }}>
                  <CheckCircle2 size={16} /> Balanced
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5" style={{ color: FIN.danger, fontWeight: 700, fontSize: 13 }}>
                  <XCircle size={16} /> Not balanced
                </span>
              )}
            </div>
            <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", margin: "14px 0 0", fontSize: 13 }}>
              <dt style={{ color: FIN.muted }}>Debits</dt>
              <dd style={{ margin: 0, textAlign: "right" }}>
                <MoneyText amount_minor={r.debit_minor} currency={r.currency} strong />
              </dd>
              <dt style={{ color: FIN.muted }}>Credits</dt>
              <dd style={{ margin: 0, textAlign: "right" }}>
                <MoneyText amount_minor={r.credit_minor} currency={r.currency} strong />
              </dd>
              <dt style={{ color: FIN.muted }}>Difference</dt>
              <dd style={{ margin: 0, textAlign: "right" }}>
                <MoneyText amount_minor={r.debit_minor - r.credit_minor} currency={r.currency} />
              </dd>
            </dl>
            {!r.balanced ? (
              <Notice tone="error" style={{ marginTop: 12 }}>
                Open Exceptions for the entries that don&apos;t balance and tell the developer. Don&apos;t post a correction by hand.
              </Notice>
            ) : null}
          </Card>
        ))}
      </div>
    </>
  );
}

export function FinanceReconciliation(): ReactElement {
  const [tab, setTab] = useUrlTab(TAB_KEYS, "settlement");
  const [period, setPeriod] = usePeriodParam("this_month");
  const rec = useAsync(() => FinanceApi.reconciliation({ from: period.from, to: period.to }), `${period.from}|${period.to}`, {
    errorFallback: "Could not load the reconciliation.",
  });
  const d = rec.data;
  const openExceptions = d ? Object.values(d.exception_counts).reduce((s, n) => s + n, 0) : null;
  const integrityOk = d ? d.integrity.every((i) => i.balanced) : null;
  const received = d ? totalsByCurrency(d.settlement.map((s) => ({ currency: s.currency, amount_minor: s.received_minor }))) : [];
  const reversed = d ? totalsByCurrency(d.settlement.filter((s) => s.reversed_minor > 0).map((s) => ({ currency: s.currency, amount_minor: s.reversed_minor }))) : [];
  const net = d ? totalsByCurrency(d.settlement.map((s) => ({ currency: s.currency, amount_minor: s.amount_minor }))) : [];
  const first = rec.loading && !d;
  const tabs: readonly TabDef<RecTab>[] = [
    { key: "settlement", label: "Daily settlement" },
    { key: "exceptions", label: "Exceptions", count: openExceptions },
    { key: "integrity", label: integrityOk === false ? "Integrity ✗" : "Integrity" },
  ];

  return (
    <FinancePage
      title="Reconciliation"
      subtitle={`${fmtRange(period)}. Tick what came in against the statements, work the exceptions, and confirm the books balance.`}
      actions={
        <Button onDark icon={<RefreshCw size={13} />} onClick={rec.reload} busy={rec.loading && !!d}>
          Refresh
        </Button>
      }
      hero={
        <KpiStrip>
          <KpiTile label="Received" loading={first} value={d ? <PerCurrency amounts={received} /> : "—"} hint="Into the cash accounts, in the period" />
          <KpiTile label="Reversed" loading={first} value={d ? <PerCurrency amounts={reversed} empty="None" /> : "—"} hint="Office entries taken back out" />
          <KpiTile label="Net" loading={first} value={d ? <PerCurrency amounts={net} /> : "—"} hint="Received − reversed" />
          <KpiTile
            label="Open exceptions"
            loading={first}
            tone={openExceptions ? "warn" : "default"}
            value={openExceptions === null ? "—" : openExceptions.toLocaleString()}
            hint="Need a person"
            onClick={() => setTab("exceptions")}
          />
          <KpiTile
            label="Books"
            loading={first}
            tone={integrityOk === false ? "danger" : integrityOk ? "good" : "default"}
            value={integrityOk === null ? "—" : integrityOk ? "Balanced" : "Not balanced"}
            hint="Σ debits = Σ credits"
            onClick={() => setTab("integrity")}
          />
        </KpiStrip>
      }
      tabs={<Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Reconciliation views" />}
    >
      {tab !== "integrity" ? <FilterBar period={period} onPeriodChange={setPeriod} /> : null}
      {rec.error ? (
        <Card>
          <ErrorState message={rec.error} onRetry={rec.reload} />
        </Card>
      ) : !d ? (
        <Card style={{ padding: 20, display: "grid", gap: 10 }}>
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </Card>
      ) : (
        <Fragment>
          <div style={{ display: "grid", gap: 16, opacity: rec.loading ? 0.55 : 1, transition: "opacity 150ms" }}>
            {tab === "settlement" ? <Settlement d={d} /> : null}
            {tab === "exceptions" ? <Exceptions d={d} /> : null}
            {tab === "integrity" ? <Integrity d={d} /> : null}
          </div>
        </Fragment>
      )}
    </FinancePage>
  );
}
