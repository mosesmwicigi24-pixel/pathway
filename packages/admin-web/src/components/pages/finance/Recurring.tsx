// Finance → Recurring gifts (/finance/recurring) — docs/FINANCE_ERP.md §5.
// Every recurring giving schedule with its collection health (GET
// /admin/finance/schedules): who, how much, how often, by which method, the
// next and last run, consecutive failures with the reason in the words the
// member was told, and status with WHY it is paused. "Needs attention" is the
// Overview's failing-schedules alert (?attention=true) and the server's one
// rule (Giving Cycle 7): failing, stopped after failed prompts, or our own
// outage — never a member's own pause. Totals per currency: how many, and the
// "≈ per month" the ACTIVE ones bring in — weekly × 52 ÷ 12 plus monthly,
// integer math, labelled approximate. A row opens the member's partner
// drawer. With finance:manage the office can pause, resume or cancel a gift
// when the member asks — a reason is required and the member is told.
import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Ban, Pause, Play, Repeat, TrendingUp } from "lucide-react";
import { FinanceApi, type AdminScheduleRow, type CollectionHealth, type SchedulesQuery } from "../../../api/finance";
import {
  Button,
  ConfirmDialog,
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
  inputStyle,
  useFinanceCaps,
  useFinanceToast,
  useUrlParam,
  type Column,
} from "../../finance/kit";
import { formatMinor } from "../../finance/money";
import { fmtDateTimeEAT } from "../../finance/dates";
import { useFunds, useResource, useSetUrlParams } from "../../finance/b/hooks";
import { nairobiTomorrow, nextAskLabel, pauseReasonLabel, recurringTotals } from "../../finance/b/logic";
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

type OfficeAction = "pause" | "resume" | "cancel";
type Pending = { row: AdminScheduleRow; action: OfficeAction };


export function FinanceRecurring(): ReactElement {
  const navigate = useNavigate();
  const funds = useFunds();
  const [statusRaw, setStatus] = useUrlParam("status", "");
  const [attentionRaw, setAttention] = useUrlParam("attention", "");
  const setUrl = useSetUrlParams();
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
  const caps = useFinanceCaps();
  const toast = useFinanceToast();
  const health = useResource(() => FinanceApi.collectionHealth(30), "collection-health", { errorFallback: "Could not load how collection is going." });
  const [pending, setPending] = useState<Pending | null>(null);
  const [until, setUntil] = useState("");

  const ask = (row: AdminScheduleRow, action: OfficeAction): void => {
    setUntil("");
    setPending({ row, action });
  };
  const act = async (note: string | null): Promise<void> => {
    if (!pending) return;
    const { row, action } = pending;
    await FinanceApi.scheduleAction(row.schedule_id, action, { note: note ?? "", resume_on: action === "pause" && until ? until : null });
    setPending(null);
    toast(`${action === "pause" ? "Paused" : action === "resume" ? "Resumed" : "Cancelled"} ${row.full_name ?? "the member"}'s gift — they have been told`);
    res.reload();
  };

  const columns: Column<AdminScheduleRow>[] = [
    { key: "member", header: "Member", cell: (r) => <Stacked primary={r.full_name ?? "—"} secondary={r.prompt_number ?? r.phone_number ?? undefined} strong />, width: 200 },
    {
      key: "fund",
      header: "Fund",
      cell: (r) => (r.pledge ? <Stacked primary={funds.nameOf(r.fund)} secondary={`Collects “${r.pledge.title}”`} /> : funds.nameOf(r.fund)),
    },
    {
      key: "amount",
      header: "Amount",
      cell: (r) => {
        const next = nextAskLabel(r);
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <MoneyText amount_minor={r.amount_minor} currency={r.currency} strong />
            {next ? <span style={{ fontSize: 11, color: FIN.muted, whiteSpace: "nowrap" }}>{next}</span> : null}
          </div>
        );
      },
      align: "right",
    },
    { key: "frequency", header: "Every", cell: (r) => frequencyLabel(r.frequency) },
    { key: "method", header: "Method", cell: (r) => channelLabel(r.method) },
    { key: "next", header: "Next run", cell: (r) => (r.status === "active" ? fmtDateTimeEAT(r.next_run_at) : <span style={{ color: FIN.muted }}>—</span>), mono: true },
    { key: "last", header: "Last run", cell: (r) => fmtDateTimeEAT(r.last_run_at), mono: true },
    {
      key: "failures",
      header: <span title="Prompts that failed in a row since the last success, and why — in the words the member was told.">Failures</span>,
      cell: (r) =>
        r.consecutive_failures > 0 ? (
          <div style={{ maxWidth: 260 }}>
            <span style={{ fontFamily: FIN.mono, fontWeight: 700, color: FIN.danger }}>{r.consecutive_failures} in a row</span>
            {r.last_failure || r.last_error ? (
              <div title={r.last_error ?? undefined} style={{ fontSize: 11.5, color: FIN.danger, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.last_failure?.reason ?? r.last_error}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start", maxWidth: 240 }}>
          <StatusChip status={r.status} />
          {r.needs_attention && r.status !== "paused" ? <StatusChip status="behind" label="Needs attention" /> : null}
          {pauseReasonLabel(r) ? <span style={{ fontSize: 11, color: r.pause_reason === "failures" || !r.pause_reason ? FIN.danger : FIN.muted }}>{pauseReasonLabel(r)}</span> : null}
          {r.status === "paused" && r.paused_at ? <span style={{ fontSize: 11, color: FIN.muted, whiteSpace: "nowrap" }}>since {fmtDateTimeEAT(r.paused_at)}</span> : null}
          {r.office_alert ? <span style={{ fontSize: 11, color: FIN.danger }} title={r.office_alert}>{r.office_alert}</span> : null}
        </div>
      ),
    },
    {
      key: "actions",
      header: <span title="At the member's request: pause, resume or cancel. A reason is required and the member is told.">Office</span>,
      align: "right",
      hidden: !caps.manage,
      cell: (r) => (
        <div className="inline-flex" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
          {r.status === "active" ? (
            <Button size="sm" variant="secondary" icon={<Pause size={12} />} onClick={() => ask(r, "pause")}>
              Pause
            </Button>
          ) : null}
          {r.status === "paused" && r.pause_reason !== "pledge" ? (
            <Button size="sm" variant="secondary" icon={<Play size={12} />} onClick={() => ask(r, "resume")}>
              Resume
            </Button>
          ) : null}
          {r.status !== "cancelled" ? (
            <Button size="sm" variant="danger" icon={<Ban size={12} />} onClick={() => ask(r, "cancel")}>
              Cancel
            </Button>
          ) : null}
        </div>
      ),
    },
  ];
  const gift = pending ? `${pending.row.full_name ?? "the member"}'s ${pending.row.frequency} gift of ${formatMinor(pending.row.amount_minor, pending.row.currency)}` : "";

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
            hint="failing, stopped after failures, or not sent by us"
            onClick={attention ? undefined : () => setAttention("true")}
          />
          <KpiTile label="Failing" tone={failing > 0 ? "danger" : "default"} value={firstLoad ? "…" : failing.toLocaleString()} hint="a collection failed last time" />
        </KpiStrip>
      }
    >
      {health.data ? <CollectionHealthCard h={health.data} /> : null}
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
        onClear={() => setUrl({ status: null, attention: null })}
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
          minWidth={caps.manage ? 1380 : 1180}
        />
      </SectionCard>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.action === "pause" ? "Pause this gift?" : pending?.action === "resume" ? "Resume this gift?" : "Cancel this gift?"}
        body={
          pending ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span>
                {pending.action === "pause"
                  ? `No prompts go to ${gift} while it is paused.`
                  : pending.action === "resume"
                    ? `${gift} picks up at its next occurrence — nothing missed is charged.`
                    : `${gift} stops for good. Only do this when the member asked.`}{" "}
                The member is told the office did it, at their request.
              </span>
              {pending.action === "pause" ? (
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  Until (optional — it resumes by itself that day)
                  <input type="date" value={until} min={nairobiTomorrow()} onChange={(e) => setUntil(e.target.value)} style={inputStyle} />
                </label>
              ) : null}
            </div>
          ) : null
        }
        reason={{ label: "Why — the member's request, in a line", placeholder: "e.g. Called the office: travelling in October", min: 3, max: 300 }}
        confirmLabel={pending?.action === "pause" ? "Pause gift" : pending?.action === "resume" ? "Resume gift" : "Cancel gift"}
        tone={pending?.action === "cancel" ? "danger" : "default"}
        errorFallback="Could not change the gift."
        onConfirm={act}
        onCancel={() => setPending(null)}
      />
    </FinancePage>
  );
}

/**
 * How collection is going (Giving Cycle 9): an outage banner when M-Pesa
 * itself looks unwell, then the window's success rate and failures by reason
 * in the words members were told — whose answer it was — and what the rest of
 * the month should bring in, each gift weighted by its own record.
 */
function CollectionHealthCard({ h }: { h: CollectionHealth }): ReactElement {
  const answered = h.paid + h.failed;
  return (
    <SectionCard
      title="How collection is going"
      subtitle={`M-Pesa prompts in the last ${h.window_days} days — ${h.paid.toLocaleString()} paid of ${answered.toLocaleString()} answered${h.waiting ? `, ${h.waiting.toLocaleString()} still waiting` : ""}.`}
    >
      {h.outage.suspected ? (
        <Notice tone="error">
          <strong>M-Pesa looks unwell right now.</strong> {h.outage.evidence} Gifts may fail until it recovers — nothing to fix on our side.
        </Notice>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: FIN.muted, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 }}>Success rate</div>
          <div style={{ fontFamily: FIN.mono, fontSize: 22, color: FIN.navy, fontWeight: 700 }}>{h.success_rate === null ? "—" : `${Math.round(h.success_rate * 100)}%`}</div>
          {h.not_sent_by_us > 0 ? (
            <div style={{ fontSize: 12, color: FIN.danger }}>{h.not_sent_by_us.toLocaleString()} recurring {h.not_sent_by_us === 1 ? "gift" : "gifts"} not sent by us today — the givers were not told.</div>
          ) : null}
        </div>
        <div>
          <div style={{ fontSize: 11, color: FIN.muted, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 }}>Why prompts failed</div>
          {h.by_reason.length === 0 ? (
            <div style={{ fontSize: 12.5, color: FIN.muted }}>None failed.</div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
              {h.by_reason.map((r) => (
                <li key={r.code} style={{ fontSize: 12.5, color: FIN.navy }}>
                  <span style={{ fontFamily: FIN.mono, fontWeight: 700 }}>{r.count.toLocaleString()}</span> {r.reason}{" "}
                  <span style={{ fontSize: 11, color: FIN.muted }}>{r.member_answered ? "(their answer)" : "(never reached them)"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div style={{ fontSize: 11, color: FIN.muted, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 }}>Rest of the month, expected</div>
          {h.forecast.length === 0 ? (
            <div style={{ fontSize: 12.5, color: FIN.muted }}>No recurring prompts left this month.</div>
          ) : (
            h.forecast.map((f) => (
              <div key={f.currency} style={{ fontSize: 12.5, color: FIN.navy }} title="Each gift's remaining prompts this month, weighted by how often that gift has been paid (its last six answered prompts).">
                <MoneyText amount_minor={f.expected_minor} currency={f.currency} strong /> of {formatMinor(f.scheduled_minor, f.currency)} scheduled
                <span style={{ color: FIN.muted }}> · {f.prompts.toLocaleString()} {f.prompts === 1 ? "prompt" : "prompts"}, {f.gifts.toLocaleString()} {f.gifts === 1 ? "gift" : "gifts"}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </SectionCard>
  );
}
