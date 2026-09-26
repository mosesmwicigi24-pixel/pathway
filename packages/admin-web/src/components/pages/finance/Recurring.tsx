// Finance → Recurring gifts (/finance/recurring) — docs/FINANCE_ERP.md §5.
// Every recurring giving schedule with its collection health (GET
// /admin/finance/schedules): who, how much, how often, by which method, the
// next and last run, consecutive failures with the last error, and status.
// "Needs attention" (paused, or failing) is the Overview's failing-schedules
// alert (?attention=true). Totals per currency: how many, and the "≈ per month"
// the ACTIVE ones bring in — weekly × 52 ÷ 12 plus monthly, integer math,
// labelled approximate. A row opens the member's partner drawer.
import { type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Repeat, TrendingUp } from "lucide-react";
import { FinanceApi, type AdminScheduleRow, type SchedulesQuery } from "../../../api/finance";
import {
  DataTable,
  FIN,
  FilterBar,
  FinancePage,
  KpiStrip,
  KpiTile,
  MoneyText,
  Notice,
  PerCurrency,
  SectionCard,
  StatusChip,
  channelLabel,
  useUrlParam,
  type Column,
} from "../../finance/kit";
import { fmtDateTimeEAT } from "../../finance/dates";
import { useFunds, useResource } from "../../finance/b/hooks";
import { recurringTotals } from "../../finance/b/logic";
import { FiguresStrip, Stacked } from "../../finance/b/ui";

/** The server's page size for this list (it does not page). */
const LIMIT = 200;

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "cancelled", label: "Cancelled" },
] as const;
type ScheduleStatus = (typeof STATUSES)[number]["value"];

const frequencyLabel = (f: string): string => (f ? f.charAt(0).toUpperCase() + f.slice(1) : "—");

export function FinanceRecurring(): ReactElement {
  const navigate = useNavigate();
  const funds = useFunds();
  const [statusRaw, setStatus] = useUrlParam("status", "");
  const [attentionRaw, setAttention] = useUrlParam("attention", "");
  const status = (STATUSES.find((s) => s.value === statusRaw)?.value ?? null) as ScheduleStatus | null;
  const attention = attentionRaw === "true" || attentionRaw === "1";
  const query: SchedulesQuery = { status, attention: attention ? true : null, limit: LIMIT };
  const res = useResource(() => FinanceApi.schedules(query), JSON.stringify(query), { errorFallback: "Could not load the recurring gifts." });
  const rows = res.data ?? [];
  const totals = recurringTotals(rows);
  const needAttention = rows.filter((r) => r.needs_attention).length;
  const failing = rows.filter((r) => r.consecutive_failures > 0).length;
  const truncated = rows.length >= LIMIT;
  const unknown = totals.reduce((n, t) => n + t.unknown, 0);
  const firstLoad = res.loading && !res.data;

  const columns: Column<AdminScheduleRow>[] = [
    { key: "member", header: "Member", cell: (r) => <Stacked primary={r.full_name ?? "—"} secondary={r.phone_number ?? undefined} strong />, width: 200 },
    { key: "fund", header: "Fund", cell: (r) => funds.nameOf(r.fund) },
    { key: "amount", header: "Amount", cell: (r) => <MoneyText amount_minor={r.amount_minor} currency={r.currency} strong />, align: "right" },
    { key: "frequency", header: "Every", cell: (r) => frequencyLabel(r.frequency) },
    { key: "method", header: "Method", cell: (r) => channelLabel(r.method) },
    { key: "next", header: "Next run", cell: (r) => (r.status === "active" ? fmtDateTimeEAT(r.next_run_at) : <span style={{ color: FIN.muted }}>—</span>), mono: true },
    { key: "last", header: "Last run", cell: (r) => fmtDateTimeEAT(r.last_run_at), mono: true },
    {
      key: "failures",
      header: <span title="Collections that failed in a row since the last success, and the provider's last error.">Failures</span>,
      cell: (r) =>
        r.consecutive_failures > 0 ? (
          <div style={{ maxWidth: 260 }}>
            <span style={{ fontFamily: FIN.mono, fontWeight: 700, color: FIN.danger }}>{r.consecutive_failures} in a row</span>
            {r.last_error ? (
              <div title={r.last_error} style={{ fontSize: 11.5, color: FIN.danger, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.last_error}
              </div>
            ) : null}
            {r.last_failed_at ? <div style={{ fontSize: 11, color: FIN.muted }}>last failed {fmtDateTimeEAT(r.last_failed_at)}</div> : null}
          </div>
        ) : (
          <span style={{ fontFamily: FIN.mono, color: FIN.muted }}>0</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
          <StatusChip status={r.status} />
          {r.needs_attention && r.status !== "paused" ? <StatusChip status="behind" label="Needs attention" /> : null}
          {r.status === "paused" && r.paused_at ? <span style={{ fontSize: 11, color: FIN.muted, whiteSpace: "nowrap" }}>since {fmtDateTimeEAT(r.paused_at)}</span> : null}
        </div>
      ),
    },
  ];

  return (
    <FinancePage
      title="Recurring gifts"
      subtitle="Every giving schedule and whether it is collecting — failing and paused ones first. The run-rate is what the active schedules bring in a month, approximately."
      hero={
        <KpiStrip>
          <KpiTile label="Schedules" icon={<Repeat size={12} />} value={firstLoad ? "…" : rows.length.toLocaleString()} hint={status ? `status ${status}` : "active and paused"} />
          <KpiTile
            label="≈ Per month"
            icon={<TrendingUp size={12} />}
            tone="good"
            value={<PerCurrency amounts={totals.filter((t) => t.active > 0).map((t) => ({ currency: t.currency, amount_minor: t.monthly_minor }))} />}
            loading={firstLoad}
            hint="active only · weekly × 52 ÷ 12"
          />
          <KpiTile
            label="Needs attention"
            icon={<AlertTriangle size={12} />}
            tone={needAttention > 0 ? "warn" : "default"}
            value={firstLoad ? "…" : needAttention.toLocaleString()}
            hint="paused, or failing"
            onClick={attention ? undefined : () => setAttention("true")}
          />
          <KpiTile label="Failing" tone={failing > 0 ? "danger" : "default"} value={firstLoad ? "…" : failing.toLocaleString()} hint="a collection failed last time" />
        </KpiStrip>
      }
    >
      <FilterBar
        selects={[
          { key: "status", label: "Status", value: status ?? "", options: [{ value: "", label: "Active & paused" }, ...STATUSES], onChange: setStatus },
          {
            key: "attention",
            label: "Show",
            value: attention ? "true" : "",
            options: [
              { value: "", label: "Everything" },
              { value: "true", label: "Needs attention" },
            ],
            onChange: setAttention,
          },
        ]}
        clearable={Boolean(status || attention)}
        onClear={() => {
          setStatus("");
          setAttention("");
        }}
      />
      {truncated ? (
        <Notice tone="warn">
          Showing the first {LIMIT} schedules the server returns (paused first, then the most failures) — the totals cover these {LIMIT} only. Narrow the status to see the rest.
        </Notice>
      ) : null}
      <FiguresStrip
        label="Run-rate"
        loading={res.loading}
        groups={totals.map((t) => ({
          currency: t.currency,
          figures: [{ label: "≈ per month", amount_minor: t.monthly_minor, tone: "good" as const, title: "(Σ weekly × 52 + Σ monthly × 12) ÷ 12 over the ACTIVE schedules, rounded to the cent" }],
          note: `${t.count.toLocaleString()} ${t.count === 1 ? "schedule" : "schedules"} · ${t.active.toLocaleString()} active${t.unknown ? ` · ${t.unknown} with a frequency not counted` : ""}`,
        }))}
        extra={`Approximate: weekly gifts × 52 ÷ 12, plus monthly gifts. Paused and cancelled schedules bring nothing in and are left out.${unknown ? " Schedules with another frequency are not in the figure." : ""}`}
      />
      <SectionCard title="Schedules" subtitle="Open a row for the member's partner record — pledges, payments and reminders." flush>
        <DataTable
          ariaLabel="Recurring gifts"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.schedule_id}
          loading={res.loading}
          error={res.error}
          onRetry={res.reload}
          onRowClick={(r) => navigate(`/finance/partners?member=${encodeURIComponent(r.user_id)}`)}
          empty={attention ? "Nothing needs attention — every schedule is collecting." : status ? `No ${status} schedules.` : "No recurring gifts yet — members set them up from Give in the app."}
          minWidth={1180}
        />
      </SectionCard>
    </FinancePage>
  );
}
