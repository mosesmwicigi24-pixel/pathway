// One expense and its whole trail (Finance → Expenses): recorded → edited →
// approved → voided, who and when, with the actions the person may take —
// Edit (recorded only, finance:manage), Approve (finance:approve; never by a
// maker unless SuperAdmin — maker-checker, §2) and Void (finance:manage, with a
// reason). Approving and voiding state their consequence first, including what
// it does to the fund's balance (an approval may overdraw a fund — the money
// has already left — so that is a warning, never a block).
import { useState, type ReactElement } from "react";
import { Ban, CheckCircle2, Pencil } from "lucide-react";
import { FinanceApi, financeErrorCode, FINANCE_LIMITS, type BooksExpense, type FinanceAuditRow } from "../../../api/finance";
import { Button, ConfirmDialog, Drawer, FIN, MoneyText, Notice, Skeleton, StatusChip, channelLabel, useFinanceCaps, useFinanceToast } from "../kit";
import { formatMinor } from "../money";
import { fmtDateTimeEAT, fmtDay } from "../dates";
import { useMyIdentity, useResource } from "./hooks";
import { SAME_PERSON_SENTENCE, approveConsequence, approveGate, eatDayOf, fundBalanceIn, fundImpact, voidConsequence, type FundImpact } from "./logic";
import { KeyValues, SubHead, Trail, type TrailStep } from "./ui";

/** The "expense.updated" audit rows for one expense — who edited it while it
 *  was recorded (each is one of its makers). The audit has no entity filter,
 *  so the finance slice is read from the day it was recorded and kept by
 *  entity_id. `more` = there were more rows than one page held. */
async function loadEdits(e: BooksExpense): Promise<{ edits: FinanceAuditRow[]; more: boolean }> {
  const page = await FinanceApi.audit({ action_prefix: "expense.updated", from: eatDayOf(e.recorded_at), limit: 200 });
  const edits = page.data.filter((r) => r.entity_id === e.expense_id).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  return { edits, more: page.next_cursor !== null };
}

/** What approving / voiding does to the fund, read from GET /admin/finance/funds
 *  (null = the balance could not be read; the action still works). */
async function readImpact(e: BooksExpense, action: "approve" | "void"): Promise<FundImpact | null> {
  try {
    const page = await FinanceApi.funds();
    const row = page.data.find((f) => f.code === e.fund.code);
    if (!row) return null;
    return fundImpact({ fundName: e.fund.name, currency: e.currency, balance_minor: fundBalanceIn(row.balances, e.currency), amount_minor: e.amount_minor, action });
  } catch {
    return null;
  }
}

function ImpactLines({ impact, fundName }: { impact: FundImpact | null; fundName: string }): ReactElement {
  if (!impact) return <p style={{ margin: "8px 0 0", color: FIN.muted }}>Could not read {fundName}'s balance just now — this still goes through.</p>;
  return (
    <>
      <p style={{ margin: "8px 0 0", fontFamily: FIN.mono, fontSize: 12.5 }}>{impact.sentence}</p>
      {impact.warning ? (
        <Notice tone="warn" style={{ marginTop: 10 }}>
          {impact.warning}
        </Notice>
      ) : null}
    </>
  );
}

export function ExpenseDrawer({
  expenseId,
  initial,
  editedByMe,
  version,
  onClose,
  onChanged,
  onEdit,
}: {
  expenseId: string | null;
  /** The register's row, shown at once while the fresh copy loads. */
  initial: BooksExpense | null;
  /** I edited this expense in this session (I am one of its makers). */
  editedByMe: boolean;
  /** Bumped by the page after an edit, to re-read the trail. */
  version: number;
  onClose: () => void;
  onChanged: (updated: BooksExpense) => void;
  onEdit: (e: BooksExpense) => void;
}): ReactElement | null {
  const caps = useFinanceCaps();
  const me = useMyIdentity();
  const toast = useFinanceToast();
  const res = useResource(() => FinanceApi.expense(expenseId ?? ""), `${expenseId ?? "none"}:${version}`, { enabled: expenseId !== null, errorFallback: "Could not load this expense." });
  const fresh = res.data && res.data.expense_id === expenseId ? res.data : null;
  const expense = fresh ?? (initial && initial.expense_id === expenseId ? initial : null);
  const trail = useResource(() => (expense ? loadEdits(expense) : Promise.resolve({ edits: [], more: false })), `${expense?.expense_id ?? "none"}:${version}`, { enabled: expense !== null });

  const [checking, setChecking] = useState<"approve" | "void" | null>(null);
  const [impact, setImpact] = useState<FundImpact | null>(null);
  const [dialog, setDialog] = useState<"approve" | "void" | null>(null);
  const [samePerson, setSamePerson] = useState(false);

  if (!expenseId) return null;
  if (!expense) {
    return (
      <Drawer open title="Expense" onClose={onClose}>
        {res.error ? <Notice tone="error">{res.error}</Notice> : <Skeleton width="70%" height={16} />}
      </Drawer>
    );
  }

  const editors = (trail.data?.edits ?? []).map((r) => r.actor_id);
  if (editedByMe && me.userId) editors.push(me.userId);
  const gate = approveGate({ expense, canApprove: caps.approve, me: me.userId, isSuperAdmin: me.isSuperAdmin, editors });
  const showApprove = gate.show && !samePerson;
  const blocked = samePerson && caps.approve && expense.status === "recorded" ? SAME_PERSON_SENTENCE : gate.blocked;
  const canEdit = caps.manage && expense.status === "recorded";
  const canVoid = caps.manage && expense.status !== "void";
  const amount = formatMinor(expense.amount_minor, expense.currency);

  const open = async (action: "approve" | "void"): Promise<void> => {
    // A recorded expense was never posted — voiding it moves no money.
    if (action === "void" && expense.status !== "approved") {
      setImpact(null);
      setDialog("void");
      return;
    }
    setChecking(action);
    const i = await readImpact(expense, action);
    setChecking(null);
    setImpact(i);
    setDialog(action);
  };

  const approve = async (): Promise<void> => {
    try {
      const updated = await FinanceApi.approveExpense(expense.expense_id);
      setDialog(null);
      res.setData(() => updated);
      onChanged(updated);
      toast(`Approved — ${amount} posted out of ${expense.fund.name}`);
    } catch (e) {
      if (financeErrorCode(e) === "SAME_PERSON") {
        // The server knows a maker the page did not (e.g. an edit it could not see).
        setDialog(null);
        setSamePerson(true);
        toast(SAME_PERSON_SENTENCE, "warn");
        return;
      }
      res.reload(); // it may have been approved or voided meanwhile
      throw e;
    }
  };

  const voidIt = async (reason: string | null): Promise<void> => {
    try {
      const updated = await FinanceApi.voidExpense(expense.expense_id, { reason: reason ?? "" });
      setDialog(null);
      res.setData(() => updated);
      onChanged(updated);
      toast(expense.status === "approved" ? `Voided — ${expense.fund.name} gets ${amount} back` : "Voided — nothing had been posted");
    } catch (e) {
      res.reload();
      throw e;
    }
  };

  const steps: TrailStep[] = [
    { label: "Recorded", who: expense.recorded_by_name ?? "someone", when: fmtDateTimeEAT(expense.recorded_at), note: `Spent ${fmtDay(expense.spent_on)} — recording posts nothing.`, tone: "info" },
    ...(trail.data?.edits ?? []).map<TrailStep>((r) => ({ label: "Edited", who: r.actor_name ?? "someone", when: fmtDateTimeEAT(r.occurred_at), note: "An editor is one of its makers — they cannot approve it.", tone: "info" })),
  ];
  if (expense.approved_at) {
    steps.push({ label: "Approved", who: expense.approved_by_name ?? "someone", when: fmtDateTimeEAT(expense.approved_at), note: `Posted ${amount} out of ${expense.fund.name} via ${channelLabel(expense.channel)}, dated ${fmtDay(expense.spent_on)}.`, tone: "ok" });
  }
  if (expense.voided_at) {
    steps.push({
      label: "Voided",
      who: expense.voided_by_name ?? "someone",
      when: fmtDateTimeEAT(expense.voided_at),
      note: (
        <>
          “{expense.void_reason ?? ""}”{expense.void_journal_id ? ` — reversing entry posted: ${expense.fund.name} got ${amount} back.` : " — nothing had been posted."}
        </>
      ),
      tone: "muted",
    });
  }
  if (expense.status === "recorded") steps.push({ label: "Waiting for approval", who: null, when: null, note: "Another person with finance:approve approves it; that posts it.", tone: "warn" });

  return (
    <>
      <Drawer
        open
        title={expense.payee}
        subtitle={`${amount} · ${expense.category.name} · spent ${fmtDay(expense.spent_on)}`}
        onClose={onClose}
        footer={
          <>
            {canEdit ? (
              <Button icon={<Pencil size={13} />} onClick={() => onEdit(expense)}>
                Edit
              </Button>
            ) : null}
            {canVoid ? (
              <Button variant="danger" icon={<Ban size={13} />} busy={checking === "void"} onClick={() => void open("void")}>
                Void
              </Button>
            ) : null}
            {showApprove ? (
              <Button variant="primary" icon={<CheckCircle2 size={13} />} busy={checking === "approve"} onClick={() => void open("approve")}>
                Approve
              </Button>
            ) : null}
          </>
        }
      >
        <div className="flex items-center flex-wrap" style={{ gap: 8, marginBottom: 14 }}>
          <StatusChip status={expense.status} />
          <MoneyText amount_minor={expense.amount_minor} currency={expense.currency} strong style={{ fontSize: 18, color: FIN.navy }} />
        </div>
        {blocked ? (
          <Notice tone="warn" style={{ marginBottom: 14 }}>
            {blocked}
          </Notice>
        ) : null}
        {res.error ? (
          <Notice tone="error" style={{ marginBottom: 14 }}>
            {res.error}
          </Notice>
        ) : null}
        <KeyValues
          items={[
            { label: "Paid from", value: expense.fund.name },
            { label: "Category", value: expense.category.name },
            { label: "Paid by", value: channelLabel(expense.channel) },
            { label: "Reference", value: expense.reference ? <span style={{ fontFamily: FIN.mono }}>{expense.reference}</span> : "—" },
            { label: "Spent on", value: <span style={{ fontFamily: FIN.mono }}>{fmtDay(expense.spent_on)}</span>, title: "The economic date — approval posts on this day" },
            { label: "Amount", value: <MoneyText amount_minor={expense.amount_minor} currency={expense.currency} strong /> },
          ]}
        />
        {expense.description ? <p style={{ fontSize: 13, color: FIN.navy, marginTop: 12, lineHeight: 1.5 }}>{expense.description}</p> : null}
        <SubHead aside={trail.data?.more ? "Older edits may not be listed — see Audit" : trail.error ? "Edits could not be read" : undefined}>Trail</SubHead>
        <Trail steps={steps} />
        {expense.journal_id || expense.void_journal_id ? (
          <p style={{ fontSize: 11.5, color: FIN.muted, marginTop: 14, fontFamily: FIN.mono }}>
            {expense.journal_id ? `Journal ${expense.journal_id.slice(0, 8)}` : ""}
            {expense.void_journal_id ? ` · reversal ${expense.void_journal_id.slice(0, 8)}` : ""}
          </p>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={dialog === "approve"}
        title={`Approve ${amount} to ${expense.payee}?`}
        body={
          <>
            {approveConsequence(expense, channelLabel(expense.channel))}
            <ImpactLines impact={impact} fundName={expense.fund.name} />
          </>
        }
        confirmLabel="Approve and post"
        errorFallback="Could not approve the expense."
        onConfirm={approve}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "void"}
        title={`Void this ${expense.status === "approved" ? "approved " : ""}expense?`}
        body={
          <>
            {voidConsequence(expense)}
            {expense.status === "approved" ? <ImpactLines impact={impact} fundName={expense.fund.name} /> : null}
          </>
        }
        reason={{ label: "Why is it being voided?", placeholder: "e.g. Recorded twice — the same receipt is on 12 Sep", min: FINANCE_LIMITS.reason.min, max: FINANCE_LIMITS.reason.max }}
        confirmLabel="Void expense"
        tone="danger"
        errorFallback="Could not void the expense."
        onConfirm={voidIt}
        onCancel={() => setDialog(null)}
      />
    </>
  );
}
