// Finance → Overview (/finance) — docs/FINANCE_ERP.md §5. One read
// (GET /admin/finance/overview?from&to): per-currency income against the same
// period last year, expenses, net, outstanding pledges and partners behind in
// the hero; the work queues that need someone (each opens the queue behind the
// number); twelve months of income against expenses; money in by channel; and
// the largest fund balances. Every figure is per currency — KES and USD are
// never added — and every one says what it counts.
import { type ReactElement, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Bell, CheckCircle2, ChevronRight, CircleDollarSign, Clock, PiggyBank, RefreshCw, TrendingUp, XCircle } from "lucide-react";
import { FinanceApi, type FinanceOverview as Overview } from "../../../api/finance";
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
  PerCurrency,
  SectionCard,
  Skeleton,
  StatusChip,
  TONES,
  channelLabel,
} from "../../finance/kit";
import { compareCurrencies, formatMinor, sortTotals } from "../../finance/money";
import { fmtDay, fmtMonth, fmtRange } from "../../finance/dates";
import { ALERT_COPY, alertLink, fmtPct, pctChange, plural } from "../../finance/a/helpers";
import { periodQuery, useAsync, usePeriodParam } from "../../finance/a/hooks";
import { IncomeExpenseChart } from "../../finance/a/IncomeExpenseChart";

const PRESETS = ["this_month", "last_month", "this_quarter", "this_year", "last_12_months", "custom"] as const;

/** Income per currency, each with its change against the same period last year. */
function IncomeValue({ income }: { income: Overview["income"] }): ReactElement {
  if (income.length === 0) return <span>—</span>;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      {sortTotals(income).map((i) => {
        const p = pctChange(i.period_minor, i.same_period_last_year_minor);
        const color = p === null ? "rgba(232,239,245,0.5)" : p >= 0 ? "#86EFAC" : "#F5A3A3";
        return (
          <span key={i.currency} style={{ display: "inline-flex", flexDirection: "column" }}>
            <span style={{ whiteSpace: "nowrap" }}>{formatMinor(i.period_minor, i.currency)}</span>
            <span style={{ fontFamily: FIN.mono, fontSize: 11, color, whiteSpace: "nowrap" }}>
              {p === null
                ? i.same_period_last_year_minor === 0 && i.period_minor > 0
                  ? "new — nothing this time last year"
                  : "nothing to compare"
                : `${fmtPct(p)} vs ${formatMinor(i.same_period_last_year_minor, i.currency)} last year`}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function NetValue({ net }: { net: Overview["net"] }): ReactElement {
  if (net.length === 0) return <span>—</span>;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      {sortTotals(net).map((n) => (
        <span key={n.currency} style={{ whiteSpace: "nowrap", color: n.period_minor < 0 ? "#F5A3A3" : undefined }}>
          {formatMinor(n.period_minor, n.currency)}
        </span>
      ))}
    </span>
  );
}

function CountLink({ icon, label, count, hint, onClick, tone }: { icon: ReactNode; label: string; count: number; hint: string; onClick: () => void; tone: "warn" | "error" | "info" }): ReactElement {
  const t = TONES[count > 0 ? tone : "info"];
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl text-left transition-opacity hover:opacity-85"
      style={{ padding: "10px 12px", border: `1px solid ${count > 0 ? t.border : FIN.border}`, background: count > 0 ? t.bg : FIN.card, cursor: "pointer", minWidth: 0 }}
    >
      <span style={{ display: "inline-flex", color: count > 0 ? t.color : FIN.muted }}>{icon}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: FIN.navy }}>
          {label} <span style={{ fontFamily: FIN.mono, color: count > 0 ? t.color : FIN.muted }}>{count.toLocaleString()}</span>
        </span>
        <span style={{ display: "block", fontSize: 11.5, color: FIN.muted }}>{hint}</span>
      </span>
      <ChevronRight size={14} color="#6B7280" />
    </button>
  );
}

function AlertsCard({ data, loading, periodLink }: { data: Overview | null; loading: boolean; periodLink: string }): ReactElement {
  const navigate = useNavigate();
  const alerts = (data?.alerts ?? []).filter((a) => a.count > 0);
  const counts = data?.counts;
  return (
    <SectionCard title="Needs attention" icon={<Bell size={15} />} subtitle="Each line opens the queue behind the number.">
      {loading && !data ? (
        <div style={{ display: "grid", gap: 10 }}>
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex items-center gap-2" style={{ fontSize: 13, color: FIN.good, fontWeight: 600, padding: "4px 0 2px" }}>
          <CheckCircle2 size={16} /> Nothing waiting — no claims, expenses to approve, failing recurring gifts, stuck payments or books issues.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {alerts.map((a) => {
            const copy = ALERT_COPY[a.kind];
            const t = TONES[copy.tone];
            return (
              <button
                key={a.kind}
                type="button"
                onClick={() => navigate(alertLink(a.kind, a.link))}
                className="flex items-center gap-3 rounded-xl text-left transition-opacity hover:opacity-85"
                style={{ padding: "10px 14px", background: t.bg, border: `1px solid ${t.border}`, cursor: "pointer" }}
              >
                <span
                  style={{ minWidth: 30, height: 26, padding: "0 8px", borderRadius: 999, background: "rgba(255,255,255,0.7)", color: t.color, fontFamily: FIN.mono, fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                >
                  {a.count.toLocaleString()}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: t.color }}>{copy.title(a.count)}</span>
                  <span style={{ display: "block", fontSize: 12, color: FIN.navy, opacity: 0.8 }}>{copy.hint}</span>
                </span>
                <ArrowRight size={15} color={t.color} />
              </button>
            );
          })}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 8, marginTop: 14 }}>
        <CountLink
          icon={<Clock size={16} />}
          label="Processing now"
          count={counts?.processing ?? 0}
          hint="Payments started and not yet settled, any age."
          tone="warn"
          onClick={() => navigate("/finance/transactions?status=processing&period=last_12_months")}
        />
        <CountLink
          icon={<XCircle size={16} />}
          label="Failed in the period"
          count={counts?.failed_in_period ?? 0}
          hint="Cancelled or refused — nothing was posted."
          tone="info"
          onClick={() => navigate(`/finance/transactions?status=failed&${periodLink}`)}
        />
        <CountLink
          icon={<AlertTriangle size={16} />}
          label="Stuck processing"
          count={counts?.stale_processing ?? 0}
          hint="M-Pesa over 30 minutes, card over a day."
          tone="warn"
          onClick={() => navigate("/finance/reconciliation?tab=exceptions")}
        />
      </div>
    </SectionCard>
  );
}

function ChannelsCard({ data, loading }: { data: Overview | null; loading: boolean }): ReactElement {
  const rows = [...(data?.channels ?? [])].sort((a, b) => compareCurrencies(a.currency, b.currency) || b.net_minor - a.net_minor);
  const currencies = Array.from(new Set(rows.map((r) => r.currency)));
  const th = { fontSize: 11, fontWeight: 700, color: FIN.muted, textTransform: "uppercase" as const, letterSpacing: 0.6, padding: "9px 14px", whiteSpace: "nowrap" as const };
  const td = { padding: "9px 14px", fontSize: 12.5, color: FIN.navy };
  return (
    <SectionCard
      flush
      title="Money in by channel"
      icon={<CircleDollarSign size={15} />}
      subtitle="Received into each cash account in the period, net of reversals (a reversal is dated at the gift it corrects)."
    >
      {loading && !data ? (
        <div style={{ padding: 20, display: "grid", gap: 8 }}>
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No money received in this period">Gifts show here per channel — M-Pesa, card, cash, bank — once they settle.</EmptyState>
      ) : (
        <div className="r-table-scroll" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }} aria-label="Money in by channel">
            <thead>
              <tr style={{ background: FIN.surface }}>
                <th style={{ ...th, textAlign: "left" }}>Channel</th>
                <th style={{ ...th, textAlign: "right" }}>Gifts</th>
                <th style={{ ...th, textAlign: "right" }}>Received</th>
                <th style={{ ...th, textAlign: "right" }}>Reversed</th>
                <th style={{ ...th, textAlign: "right" }}>Net</th>
              </tr>
            </thead>
            <tbody style={{ opacity: loading ? 0.55 : 1 }}>
              {rows.map((r) => (
                <tr key={`${r.account}|${r.currency}`} style={{ borderTop: `1px solid ${FIN.border}` }}>
                  <td style={td}>
                    <span style={{ fontWeight: 600 }}>{channelLabel(r.channel === "stripe" ? "card" : r.channel)}</span>{" "}
                    <span style={{ fontFamily: FIN.mono, fontSize: 11, color: FIN.muted }}>{r.account}</span>
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: FIN.mono }}>{r.count.toLocaleString()}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <MoneyText amount_minor={r.received_minor} currency={r.currency} />
                  </td>
                  <td style={{ ...td, textAlign: "right", color: r.reversed_minor > 0 ? FIN.danger : FIN.muted }}>
                    {r.reversed_minor > 0 ? <MoneyText amount_minor={-r.reversed_minor} currency={r.currency} /> : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <MoneyText amount_minor={r.net_minor} currency={r.currency} strong />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {currencies.map((c) => {
                const mine = rows.filter((r) => r.currency === c);
                const sum = (k: "count" | "received_minor" | "reversed_minor" | "net_minor"): number => mine.reduce((s, r) => s + r[k], 0);
                return (
                  <tr key={c} style={{ borderTop: `2px solid ${FIN.border}`, background: FIN.surface }}>
                    <td style={{ ...td, fontWeight: 700 }}>Total {c}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: FIN.mono, fontWeight: 700 }}>{sum("count").toLocaleString()}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <MoneyText amount_minor={sum("received_minor")} currency={c} strong />
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{sum("reversed_minor") > 0 ? <MoneyText amount_minor={-sum("reversed_minor")} currency={c} strong /> : "—"}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <MoneyText amount_minor={sum("net_minor")} currency={c} strong />
                    </td>
                  </tr>
                );
              })}
            </tfoot>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function FundBalancesCard({ data, loading }: { data: Overview | null; loading: boolean }): ReactElement {
  const navigate = useNavigate();
  const funds = data?.fund_balances ?? [];
  return (
    <SectionCard
      flush
      title="Fund balances"
      icon={<PiggyBank size={15} />}
      subtitle="All time: everything credited to the fund, less what left it (expenses, transfers out). The six largest by KES."
      actions={
        <Button size="sm" icon={<ArrowRight size={12} />} onClick={() => navigate("/finance/funds")}>
          All funds
        </Button>
      }
    >
      {loading && !data ? (
        <div style={{ padding: 20, display: "grid", gap: 8 }}>
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : funds.length === 0 ? (
        <EmptyState title="No fund holds money yet">Balances appear as gifts settle, expenses are approved and transfers are posted.</EmptyState>
      ) : (
        <div style={{ opacity: loading ? 0.55 : 1 }}>
          {funds.map((f, i) => (
            <button
              key={f.code}
              type="button"
              onClick={() => navigate(`/finance/funds?fund=${encodeURIComponent(f.code)}`)}
              className="flex items-center gap-3 w-full text-left transition-colors hover:bg-[var(--input-background)]"
              style={{
                padding: "11px 20px",
                borderTop: i === 0 ? "none" : `1px solid ${FIN.border}`,
                borderLeft: "none",
                borderRight: "none",
                borderBottom: "none",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: FIN.navy }}>{f.name}</span>{" "}
                <span style={{ fontFamily: FIN.mono, fontSize: 11, color: FIN.muted }}>fund:{f.code}</span>{" "}
                {!f.is_active ? <StatusChip status="inactive" /> : null}
              </span>
              <span style={{ fontFamily: FIN.mono, fontSize: 13, fontWeight: 600, color: FIN.navy, textAlign: "right" }}>
                <PerCurrency amounts={f.balances.map((b) => ({ currency: b.currency, amount_minor: b.balance_minor }))} />
              </span>
              <ChevronRight size={14} color="#6B7280" />
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function FinanceOverview(): ReactElement {
  const navigate = useNavigate();
  const [period, setPeriod] = usePeriodParam("this_month");
  const ov = useAsync(() => FinanceApi.overview({ from: period.from, to: period.to }), `${period.from}|${period.to}`, {
    errorFallback: "Could not load the overview.",
  });
  const d = ov.data;
  const first = ov.loading && !d;
  const year = d?.period.to.slice(0, 4) ?? period.to.slice(0, 4);
  const outstandingPledges = d ? d.outstanding_pledges.reduce((s, o) => s + o.pledges, 0) : 0;
  const anyNegativeNet = (d?.net ?? []).some((n) => n.period_minor < 0);

  return (
    <FinancePage
      title="Overview"
      subtitle={`${fmtRange(period)}, East Africa Time. Income is succeeded gifts dated in the period; expenses are approved expenses by the day they were spent. Each currency stands alone — KES and USD are never added.`}
      actions={
        <Button onDark icon={<RefreshCw size={13} />} onClick={ov.reload} busy={ov.loading && !!d}>
          Refresh
        </Button>
      }
      hero={
        <KpiStrip minTileWidth={190}>
          <KpiTile label="Income" icon={<TrendingUp size={11} />} loading={first} value={d ? <IncomeValue income={d.income} /> : "—"} hint="Succeeded gifts in the period" />
          <KpiTile
            label="Expenses"
            loading={first}
            value={d ? <PerCurrency amounts={d.expenses.map((e) => ({ currency: e.currency, amount_minor: e.period_minor }))} /> : "—"}
            hint="Approved expenses in the period"
            onClick={() => navigate("/finance/expenses")}
          />
          <KpiTile label="Net" loading={first} tone={anyNegativeNet ? "danger" : "default"} value={d ? <NetValue net={d.net} /> : "—"} hint="Income − expenses" />
          <KpiTile
            label="Outstanding pledges"
            loading={first}
            value={d ? <PerCurrency amounts={d.outstanding_pledges.map((o) => ({ currency: o.currency, amount_minor: o.remaining_year_minor }))} /> : "—"}
            hint={d ? `Still to come in ${year} on ${plural(outstandingPledges, "active pledge")}` : `Still to come in ${year}`}
            onClick={() => navigate("/finance/pledges")}
          />
          <KpiTile
            label="Partners behind"
            loading={first}
            tone={d && d.partners.behind > 0 ? "warn" : "default"}
            value={d ? `${d.partners.behind.toLocaleString()} of ${d.partners.count.toLocaleString()}` : "—"}
            hint="A pledge instalment is overdue, as of today"
            onClick={() => navigate("/finance/partners?status=behind")}
          />
        </KpiStrip>
      }
    >
      <FilterBar period={period} onPeriodChange={setPeriod} presets={PRESETS} />
      {ov.error ? (
        <Card>
          <ErrorState message={ov.error} onRetry={ov.reload} />
        </Card>
      ) : null}
      <AlertsCard data={d} loading={ov.loading} periodLink={periodQuery(period)} />
      <SectionCard
        title="Income and expenses, twelve months"
        icon={<TrendingUp size={15} />}
        subtitle={`Twelve calendar months ending with ${fmtMonth(period.to)} (its last day counted: ${fmtDay(period.to)}). Hover a month for the exact figures and the net.`}
      >
        <IncomeExpenseChart series={d?.series ?? null} loading={ov.loading} />
      </SectionCard>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 16 }}>
        <ChannelsCard data={d} loading={ov.loading} />
        <FundBalancesCard data={d} loading={ov.loading} />
      </div>
    </FinancePage>
  );
}
