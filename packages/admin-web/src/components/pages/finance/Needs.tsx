// Finance → Department needs (/finance/needs) — docs/FINANCE_ERP.md §5.
// Department needs as Finance sees them (GET /admin/finance/needs, finance:view
// — never the Departments API, which a finance-only person cannot read):
// target against raised (the Departments page's own figure — every succeeded
// gift to the need or to a pledge toward it), gifts, deadline, and the fund a
// gift to it is booked to. Read-only: approving and closing needs stays in
// Departments, linked for those who hold departments:view.
import { type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, Target } from "lucide-react";
import { FinanceApi, type FinanceNeedRow, type NeedStatusValue, type NeedsQuery } from "../../../api/finance";
import {
  Button,
  DataTable,
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
import { formatMinor } from "../../finance/money";
import { fmtDay, todayEAT } from "../../finance/dates";
import { useFunds, usePermissions } from "../../finance/b/hooks";
import { daysBetween, percentOf } from "../../finance/b/logic";
import { FiguresStrip, ProgressBar, Stacked } from "../../finance/b/ui";

const STATUSES: readonly { value: NeedStatusValue | "all"; label: string }[] = [
  { value: "approved", label: "Approved (open for giving)" },
  { value: "pending", label: "Pending approval" },
  { value: "closed", label: "Closed" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

function deadlineNote(n: FinanceNeedRow, today: string): { text: string; late: boolean } | null {
  if (!n.deadline) return null;
  const d = daysBetween(today, n.deadline);
  if (d > 0) return { text: `${d} ${d === 1 ? "day" : "days"} left`, late: false };
  if (d === 0) return { text: "due today", late: false };
  return { text: `passed ${-d} ${-d === 1 ? "day" : "days"} ago`, late: n.raised_minor < n.target_minor && n.status === "approved" };
}

export function FinanceNeeds(): ReactElement {
  const navigate = useNavigate();
  const permissions = usePermissions();
  // A link, not a write — but only for someone who can open Departments (hidden while /me loads).
  const canReview = permissions?.includes("departments:view") ?? false;
  const funds = useFunds();
  const today = todayEAT();
  const [statusRaw, setStatus] = useUrlParam("status", "approved");
  const [q, setQ] = useUrlParam("q", "");
  const status = STATUSES.find((s) => s.value === statusRaw)?.value ?? "approved";
  const filters: NeedsQuery = { status, q: q || null };
  const list = usePagedList((cursor) => FinanceApi.needs({ ...filters, cursor, limit: 100 }), JSON.stringify(filters), { errorFallback: "Could not load the department needs." });
  const firstLoad = list.loading && list.totals.length === 0 && list.rows.length === 0;
  const needCount = list.totals.reduce((n, t) => n + t.count, 0);

  const columns: Column<FinanceNeedRow>[] = [
    {
      key: "need",
      header: "Need",
      cell: (n) => <Stacked primary={n.title} secondary={<span title={n.why}>{n.why.length > 90 ? `${n.why.slice(0, 90)}…` : n.why}</span>} strong />,
      width: 280,
    },
    { key: "dept", header: "Department", cell: (n) => n.department_name },
    { key: "target", header: "Target", cell: (n) => <MoneyText amount_minor={n.target_minor} currency={n.currency} />, align: "right" },
    {
      key: "raised",
      header: <span title="Every succeeded gift to the need, or to a pledge toward it — church-wide. The Departments page shows the same figure.">Raised</span>,
      cell: (n) => <Stacked primary={<MoneyText amount_minor={n.raised_minor} currency={n.currency} strong />} secondary={`${n.gifts_count} ${n.gifts_count === 1 ? "gift" : "gifts"}`} />,
      align: "right",
    },
    {
      key: "progress",
      header: "Progress",
      cell: (n) => {
        const pct = percentOf(n.raised_minor, n.target_minor);
        const dl = deadlineNote(n, today);
        return (
          <div style={{ minWidth: 150 }}>
            <div className="flex items-center" style={{ gap: 8 }}>
              <ProgressBar percent={pct} tone={pct !== null && pct >= 100 ? "good" : dl?.late ? "warn" : "default"} width={110} label={`${n.title}: ${pct ?? 0}%`} />
              <span style={{ fontFamily: FIN.mono, fontSize: 12, color: FIN.muted }}>{pct === null ? "—" : `${pct}%`}</span>
            </div>
            {pct !== null && pct < 100 ? <div style={{ fontSize: 11, color: FIN.muted, marginTop: 3 }}>{formatMinor(n.target_minor - n.raised_minor, n.currency)} to go</div> : null}
          </div>
        );
      },
    },
    {
      key: "deadline",
      header: "Deadline",
      cell: (n) => {
        const dl = deadlineNote(n, today);
        return dl ? <Stacked primary={<span style={{ fontFamily: FIN.mono }}>{fmtDay(n.deadline)}</span>} secondary={<span style={{ color: dl.late ? FIN.warn : undefined }}>{dl.text}</span>} /> : <span style={{ color: FIN.muted }}>No deadline</span>;
      },
      nowrap: true,
    },
    { key: "status", header: "Status", cell: (n) => <StatusChip status={n.status} /> },
    {
      key: "books_to",
      header: <span title="Where a gift to this need is booked: the department's fund when it names an active one, else the fund the giver chose.">Books to</span>,
      cell: (n) => (n.fund_code ? funds.nameOf(n.fund_code) : <span style={{ color: FIN.muted }}>The gift's own fund</span>),
    },
    {
      key: "review",
      header: "",
      align: "right",
      hidden: !canReview,
      cell: (n) => (
        <Button size="sm" variant="ghost" icon={<ExternalLink size={12} />} onClick={() => navigate(`/departments?department=${encodeURIComponent(n.department_id)}`)} title={`Open ${n.department_name} in Departments`}>
          Review in Departments
        </Button>
      ),
    },
  ];

  return (
    <FinancePage
      title="Department needs"
      subtitle="What each department has asked the church to give toward, and how far it has come. Read-only here — needs are approved and closed in Departments."
      actions={
        canReview ? (
          <Button onDark icon={<ExternalLink size={13} />} onClick={() => navigate("/departments?tab=needs")}>
            Review in Departments
          </Button>
        ) : null
      }
      hero={
        <KpiStrip>
          <KpiTile label="Needs" icon={<Target size={12} />} value={firstLoad ? "…" : needCount.toLocaleString()} hint={STATUSES.find((s) => s.value === status)?.label.toLowerCase()} />
          <KpiTile label="Target" value={<PerCurrency amounts={list.totals.map((t) => ({ currency: t.currency, amount_minor: t.target_minor }))} />} loading={firstLoad} hint="per currency" />
          <KpiTile label="Raised" tone="good" value={<PerCurrency amounts={list.totals.map((t) => ({ currency: t.currency, amount_minor: t.raised_minor }))} />} loading={firstLoad} hint="gifts + pledge payments" />
        </KpiStrip>
      }
    >
      <FilterBar
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Need or department"
        selects={[{ key: "status", label: "Status", value: status, options: STATUSES, onChange: setStatus }]}
        clearable={status !== "approved" || Boolean(q)}
        onClear={() => {
          setStatus("approved");
          setQ("");
        }}
      />
      <FiguresStrip
        label="Totals"
        loading={list.loading}
        groups={list.totals.map((t) => ({
          currency: t.currency,
          figures: [
            { label: "Target", amount_minor: t.target_minor },
            { label: "Raised", amount_minor: t.raised_minor, tone: "good" as const },
          ],
          note: `${t.count.toLocaleString()} ${t.count === 1 ? "need" : "needs"} · ${percentOf(t.raised_minor, t.target_minor) ?? 0}% raised`,
        }))}
        extra="Over every need that matches, per currency."
      />
      <SectionCard title="Needs" subtitle="Newest first." flush>
        <DataTable
          ariaLabel="Department needs"
          columns={columns}
          rowKey={(n) => n.need_id}
          empty={q ? "No needs match that search." : status === "approved" ? "No approved needs. Departments submit needs; once approved in Departments they appear here with what has been raised." : "No needs with this status."}
          minWidth={1180}
          {...pagedTableProps(list)}
        />
      </SectionCard>
    </FinancePage>
  );
}
