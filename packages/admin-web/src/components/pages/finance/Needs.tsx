// Finance → Department needs (/finance/needs) — docs/FINANCE_ERP.md §5.
// Department needs as Finance sees them (GET /admin/finance/needs, finance:view
// — never the Departments API, which a finance-only person cannot read):
// target against raised (the Departments page's own figure — every succeeded
// gift to the need or to a pledge toward it), gifts, deadline, and the fund a
// gift to it is booked to.
//
// 2026-10-31 (owner: "we don't have a place where we can … create different
// needs for departments"): the page is now where the office runs needs too.
// "New need" picks a department and can approve it at once; each row can be
// approved, rejected or closed in place (departments:manage); what was SPENT
// against a need (approved payment vouchers, and what waits for approval)
// stands beside what was raised; "Record expense" opens an expense already
// pointed at the need (finance:manage). Departments themselves are still made
// in Departments, linked from here.
import { useEffect, useId, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ExternalLink, Plus, ReceiptText, Target, XCircle } from "lucide-react";
import { DepartmentsApi } from "../../../api/client";
import { FINANCE_LIMITS, FinanceApi, financeErrorMessage, type FinanceNeedRow, type NeedStatusValue, type NeedsQuery } from "../../../api/finance";
import {
  Button,
  ConfirmDialog,
  DataTable,
  Drawer,
  FIN,
  Field,
  FilterBar,
  FinancePage,
  KpiStrip,
  KpiTile,
  MoneyInput,
  MoneyText,
  Notice,
  PerCurrency,
  SectionCard,
  StatusChip,
  inputStyle,
  pagedTableProps,
  selectStyle,
  textareaStyle,
  useFinanceCaps,
  useFinanceToast,
  usePagedList,
  useUrlParam,
  type Column,
} from "../../finance/kit";
import { formatMinor, parseMajorToMinor } from "../../finance/money";
import { fmtDay, todayEAT } from "../../finance/dates";
import { useDepartmentOptions, useFunds, usePermissions, useSetUrlParams, type DepartmentOption } from "../../finance/b/hooks";
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
  // Creating and deciding needs is the Departments API (departments:manage).
  const canDecide = permissions?.includes("departments:manage") ?? false;
  const caps = useFinanceCaps();
  const toast = useFinanceToast();
  const departments = useDepartmentOptions();
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ need: FinanceNeedRow; decision: "approve" | "reject" | "close" } | null>(null);
  const funds = useFunds();
  const today = todayEAT();
  const [statusRaw, setStatus] = useUrlParam("status", "approved");
  const [q, setQ] = useUrlParam("q", "");
  const setUrl = useSetUrlParams();
  const status = STATUSES.find((s) => s.value === statusRaw)?.value ?? "approved";
  const filters: NeedsQuery = { status, q: q || null };
  const list = usePagedList((cursor) => FinanceApi.needs({ ...filters, cursor, limit: 100 }), JSON.stringify(filters), { errorFallback: "Could not load the department needs." });
  const firstLoad = list.loading && list.totals.length === 0 && list.rows.length === 0;
  const needCount = list.totals.reduce((n, t) => n + t.count, 0);

  /** What may be done to a need, shown under its title so it is never scrolled out of sight. */
  const actionsFor = (n: FinanceNeedRow): ReactElement => (
    <div className="flex items-center flex-wrap" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
      {canDecide && n.status === "pending" ? (
        <>
          <Button size="sm" variant="primary" icon={<CheckCircle2 size={12} />} onClick={() => setDeciding({ need: n, decision: "approve" })}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" icon={<XCircle size={12} />} onClick={() => setDeciding({ need: n, decision: "reject" })}>
            Reject
          </Button>
        </>
      ) : null}
      {caps.manage && n.status === "approved" ? (
        <Button
          size="sm"
          icon={<ReceiptText size={12} />}
          title="Record a payment out of this need — it opens the expense form already pointed at it"
          onClick={() => navigate(`/finance/expenses?record=1&department=${encodeURIComponent(n.department_id)}&need=${encodeURIComponent(n.need_id)}`)}
        >
          Record expense
        </Button>
      ) : null}
      {(n.expenses_count ?? 0) > 0 ? (
        <Button size="sm" variant="ghost" onClick={() => navigate(`/finance/expenses?need=${encodeURIComponent(n.need_id)}&spent=any`)}>
          {n.expenses_count} {n.expenses_count === 1 ? "expense" : "expenses"}
        </Button>
      ) : null}
      {canDecide && n.status === "approved" ? (
        <Button size="sm" variant="ghost" onClick={() => setDeciding({ need: n, decision: "close" })}>
          Close
        </Button>
      ) : null}
      {canReview && !canDecide ? (
        <Button size="sm" variant="ghost" icon={<ExternalLink size={12} />} onClick={() => navigate(`/departments?department=${encodeURIComponent(n.department_id)}`)} title={`Open ${n.department_name} in Departments`}>
          Review in Departments
        </Button>
      ) : null}
    </div>
  
  );

  const columns: Column<FinanceNeedRow>[] = [
    {
      key: "need",
      header: "Need",
      cell: (n) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Stacked primary={n.title} secondary={<span title={n.why}>{n.why.length > 90 ? `${n.why.slice(0, 90)}…` : n.why}</span>} strong />
          {actionsFor(n)}
        </div>
      ),
      width: 300,
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
      key: "spent",
      header: <span title="Approved payment vouchers spent against the need; below, what still waits for approval.">Spent</span>,
      cell: (n) => {
        const spent = n.spent_minor ?? 0;
        const waiting = n.awaiting_minor ?? 0;
        return (
          <Stacked
            primary={<MoneyText amount_minor={spent} currency={n.currency} strong={spent > 0} style={spent === 0 ? { color: FIN.muted } : undefined} />}
            secondary={waiting > 0 ? `${formatMinor(waiting, n.currency)} awaiting approval` : spent > 0 ? `${formatMinor(n.raised_minor - spent, n.currency)} unspent` : undefined}
          />
        );
      },
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
  ];

  return (
    <FinancePage
      title="Department needs"
      subtitle="What each department needs, what was raised for it, and what was spent on it. Add a need for any department, approve it, and record the payments made against it."
      actions={
        <>
          {canReview ? (
            <Button onDark icon={<ExternalLink size={13} />} onClick={() => navigate("/departments")}>
              Departments
            </Button>
          ) : null}
          {canDecide ? (
            <Button onDark variant="primary" icon={<Plus size={13} />} onClick={() => setCreating(true)}>
              New need
            </Button>
          ) : null}
        </>
      }
      hero={
        <KpiStrip>
          <KpiTile label="Needs" icon={<Target size={12} />} value={firstLoad ? "…" : needCount.toLocaleString()} hint={STATUSES.find((s) => s.value === status)?.label.toLowerCase()} />
          <KpiTile label="Target" value={<PerCurrency amounts={list.totals.map((t) => ({ currency: t.currency, amount_minor: t.target_minor }))} />} loading={firstLoad} hint="per currency" />
          <KpiTile label="Raised" tone="good" value={<PerCurrency amounts={list.totals.map((t) => ({ currency: t.currency, amount_minor: t.raised_minor }))} />} loading={firstLoad} hint="gifts + pledge payments" />
          <KpiTile label="Spent" value={<PerCurrency amounts={list.totals.map((t) => ({ currency: t.currency, amount_minor: t.spent_minor ?? 0 }))} />} loading={firstLoad} hint="approved payment vouchers" />
        </KpiStrip>
      }
    >
      <FilterBar
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Need or department"
        selects={[{ key: "status", label: "Status", value: status, options: STATUSES, onChange: setStatus }]}
        clearable={status !== "approved" || Boolean(q)}
        onClear={() => setUrl({ status: null, q: null })}
      />
      <FiguresStrip
        label="Totals"
        loading={list.loading}
        groups={list.totals.map((t) => ({
          currency: t.currency,
          figures: [
            { label: "Target", amount_minor: t.target_minor },
            { label: "Raised", amount_minor: t.raised_minor, tone: "good" as const },
            { label: "Spent", amount_minor: t.spent_minor ?? 0 },
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
          empty={
            q
              ? "No needs match that search."
              : status === "approved"
                ? canDecide
                  ? "No approved needs yet. “New need” adds one for a department; approve it and it opens for giving and spending."
                  : "No approved needs yet."
                : "No needs with this status."
          }
          minWidth={1180}
          {...pagedTableProps(list)}
        />
      </SectionCard>

      <NewNeedDrawer
        open={creating}
        departments={departments.departments}
        canSeeDepartments={canReview}
        onClose={() => setCreating(false)}
        onCreated={(approved) => {
          setCreating(false);
          toast(approved ? "Need added and approved — it is open for giving and spending" : "Need added — it waits for approval");
          if (approved && status !== "approved") setUrl({ status: null });
          else if (!approved && status !== "pending") setUrl({ status: "pending" });
          list.reload();
        }}
      />
      <ConfirmDialog
        open={deciding !== null}
        title={
          deciding
            ? deciding.decision === "approve"
              ? `Approve “${deciding.need.title}”?`
              : deciding.decision === "reject"
                ? `Reject “${deciding.need.title}”?`
                : `Close “${deciding.need.title}”?`
            : ""
        }
        body={
          deciding
            ? deciding.decision === "approve"
              ? `${deciding.need.department_name} is told. Members can give toward ${formatMinor(deciding.need.target_minor, deciding.need.currency)}, and the office can record expenses against it.`
              : deciding.decision === "reject"
                ? "The person who submitted it is told why."
                : `Giving toward it stops. ${formatMinor(deciding.need.raised_minor, deciding.need.currency)} was raised and ${formatMinor(deciding.need.spent_minor ?? 0, deciding.need.currency)} spent; a late bill can still be recorded against it.`
            : null
        }
        reason={deciding?.decision === "reject" ? { label: "Why? (sent to the submitter)", min: 3, max: 300 } : undefined}
        confirmLabel={deciding?.decision === "approve" ? "Approve need" : deciding?.decision === "reject" ? "Reject need" : "Close need"}
        tone={deciding?.decision === "reject" ? "danger" : "default"}
        errorFallback="That did not go through."
        onConfirm={async (reason) => {
          if (!deciding) return;
          await DepartmentsApi.decideNeed(deciding.need.need_id, deciding.decision, reason);
          toast(deciding.decision === "approve" ? "Approved — open for giving and spending" : deciding.decision === "reject" ? "Rejected — the submitter is told" : "Closed");
          setDeciding(null);
          list.reload();
        }}
        onCancel={() => setDeciding(null)}
      />
    </FinancePage>
  );
}

/** "New need": a department, what and why, a target, an optional deadline —
 *  approved at once by default (the office is the approver). */
function NewNeedDrawer({
  open,
  departments,
  canSeeDepartments,
  onClose,
  onCreated,
}: {
  open: boolean;
  departments: readonly DepartmentOption[];
  canSeeDepartments: boolean;
  onClose: () => void;
  onCreated: (approved: boolean) => void;
}): ReactElement | null {
  const ids = useId();
  const navigate = useNavigate();
  const [department, setDepartment] = useState("");
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [amount, setAmount] = useState("");
  const [deadline, setDeadline] = useState("");
  const [approveNow, setApproveNow] = useState(true);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDepartment(departments.length === 1 ? departments[0]!.department_id : "");
    setTitle("");
    setWhy("");
    setAmount("");
    setDeadline("");
    setApproveNow(true);
    setTried(false);
    setError(null);
  }, [open, departments]);

  if (!open) return null;
  const parsed = parseMajorToMinor(amount, { max: FINANCE_LIMITS.amountMaxMinor });
  const errors = {
    department: department ? null : "Choose the department.",
    title: title.trim().length >= 3 && title.trim().length <= 120 ? null : "3–120 characters — what is needed.",
    why: why.trim().length >= 10 && why.trim().length <= 1500 ? null : "10–1,500 characters — why it matters.",
    deadline: deadline && deadline < todayEAT() ? "A deadline cannot be in the past." : null,
  };
  const valid = !errors.department && !errors.title && !errors.why && !errors.deadline && parsed.ok;

  const save = async (): Promise<void> => {
    setTried(true);
    if (!valid || !parsed.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await DepartmentsApi.createNeed(department, {
        title: title.trim(),
        why: why.trim(),
        target_minor: parsed.minor,
        currency: "KES",
        deadline: deadline || null,
      });
      if (approveNow) await DepartmentsApi.decideNeed(made.need_id, "approve", null);
      onCreated(approveNow);
    } catch (e) {
      setError(financeErrorMessage(e, "Could not add the need."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      title="New need"
      subtitle="Something a department needs the church to give toward."
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {approveNow ? "Add and approve" : "Add need"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {departments.length === 0 ? (
          <Notice tone="warn">
            There are no departments yet.{" "}
            {canSeeDepartments ? (
              <button type="button" onClick={() => navigate("/departments")} style={{ color: FIN.navy, textDecoration: "underline", background: "none", border: 0, padding: 0, cursor: "pointer" }}>
                Add one in Departments
              </button>
            ) : (
              "Ask someone with Departments access to add one."
            )}
          </Notice>
        ) : null}
        <Field label="Department" htmlFor={`${ids}-dept`} required error={tried ? errors.department : null}>
          <select id={`${ids}-dept`} data-autofocus value={department} onChange={(e) => setDepartment(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
            <option value="">Choose a department…</option>
            {departments.map((d) => (
              <option key={d.department_id} value={d.department_id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What is needed" htmlFor={`${ids}-title`} required error={tried ? errors.title : null}>
          <input id={`${ids}-title`} value={title} maxLength={120} placeholder="e.g. Camera kit for the live stream" onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Why it matters" htmlFor={`${ids}-why`} required error={tried ? errors.why : null} hint="Members read this when they give toward it.">
          <textarea id={`${ids}-why`} value={why} maxLength={1500} onChange={(e) => setWhy(e.target.value)} style={textareaStyle} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 12 }}>
          <Field label="Target" htmlFor={`${ids}-target`} required>
            <MoneyInput id={`${ids}-target`} value={amount} currency="KES" onChange={(t) => setAmount(t)} showError={tried} />
          </Field>
          <Field label="Deadline (optional)" htmlFor={`${ids}-deadline`} error={errors.deadline}>
            <input id={`${ids}-deadline`} type="date" value={deadline} min={todayEAT()} onChange={(e) => setDeadline(e.target.value)} style={{ ...inputStyle, fontFamily: FIN.mono }} />
          </Field>
        </div>
        <label className="flex items-start" style={{ gap: 10, fontSize: 13, color: FIN.navy, cursor: "pointer" }}>
          <input type="checkbox" checked={approveNow} onChange={(e) => setApproveNow(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            Approve it now
            <span style={{ display: "block", fontSize: 12, color: FIN.muted }}>
              It opens for giving at once, the department is told, and expenses can be recorded against it. Untick to leave it pending for someone else to approve.
            </span>
          </span>
        </label>
      </div>
    </Drawer>
  );
}
