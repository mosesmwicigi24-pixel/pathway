// One expense as a payment voucher (Finance → Expenses; redesigned 2026-10-31):
// the voucher card first — status, PV number, the amount in figures and in
// words, who was paid, when and how — then Download / Print / Share the PDF
// voucher (for accountability: a pastor, the payee, an auditor), then where the
// money went (department, need, fund, category), the payment details (an
// M-Pesa code lifted out of a pasted confirmation message), the purpose, and
// the accountability trail.
//
// The trail (Finance → Expenses): recorded → edited →
// approved → voided, who and when, with the actions the person may take —
// Edit (recorded only, finance:manage), Approve (finance:approve; never by a
// maker unless SuperAdmin — maker-checker, §2) and Void (finance:manage, with a
// reason). Approving and voiding state their consequence first, including what
// it does to the fund's balance (an approval may overdraw a fund — the money
// has already left — so that is a warning, never a block).
import { useState, type ReactElement, type ReactNode } from "react";
import { Ban, CheckCircle2, Download, Pencil, Printer, Share2 } from "lucide-react";
import { FinanceApi, financeErrorCode, financeErrorMessage, FINANCE_LIMITS, saveBlob, type BooksExpense, type FinanceAuditRow } from "../../../api/finance";
import { Button, ConfirmDialog, Drawer, FIN, MoneyText, Notice, Skeleton, StatusChip, channelLabel, useFinanceCaps, useFinanceToast } from "../kit";
import { formatMinor } from "../money";
import { fmtDateTimeEAT, fmtDay } from "../dates";
import { useMyIdentity, useResource } from "./hooks";
import { SAME_PERSON_SENTENCE, amountInWords, approveConsequence, approveGate, eatDayOf, fundBalanceIn, fundImpact, mpesaCodeOf, voidConsequence, type FundImpact } from "./logic";
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
        subtitle={[expense.voucher_no, expense.department?.name ?? expense.category.name, `paid ${fmtDay(expense.spent_on)}`].filter(Boolean).join(" · ")}
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
        <VoucherCard expense={expense} />
        {expense.voucher_no ? <VoucherActions expense={expense} /> : null}
        {blocked ? (
          <Notice tone="warn" style={{ marginTop: 14 }}>
            {blocked}
          </Notice>
        ) : null}
        {expense.status === "recorded" && !blocked ? (
          <Notice tone="info" style={{ marginTop: 14 }}>
            Awaiting approval: nothing is posted until a second person approves it. Its voucher prints “Awaiting approval” until then.
          </Notice>
        ) : null}
        {expense.status === "void" ? (
          <Notice tone="error" style={{ marginTop: 14 }}>
            Void{expense.voided_by_name ? ` — ${expense.voided_by_name}` : ""}: “{expense.void_reason ?? ""}”. The voucher keeps its number and prints VOID.
          </Notice>
        ) : null}
        {res.error ? (
          <Notice tone="error" style={{ marginTop: 14 }}>
            {res.error}
          </Notice>
        ) : null}

        <SubHead>Where the money went</SubHead>
        <KeyValues
          items={[
            {
              label: "Department",
              value: expense.department ? expense.department.name : <span style={{ color: FIN.muted }}>Not tied to a department</span>,
            },
            {
              label: "Department need",
              value: expense.need ? (
                <>
                  {expense.need.title}
                  <span style={{ display: "block", fontSize: 11.5, color: FIN.muted, marginTop: 2 }}>Target {formatMinor(expense.need.target_minor, expense.need.currency)}</span>
                </>
              ) : (
                <span style={{ color: FIN.muted }}>—</span>
              ),
            },
            { label: "Paid from fund", value: expense.fund.name },
            { label: "Category", value: expense.category.name },
          ]}
        />

        <SubHead>Payment</SubHead>
        <PaymentDetails expense={expense} />

        <SubHead>Purpose</SubHead>
        {expense.description ? (
          <blockquote style={{ margin: 0, padding: "10px 14px", borderLeft: `3px solid ${FIN.gold}`, background: FIN.input, borderRadius: "0 10px 10px 0", fontSize: 13.5, color: FIN.navy, lineHeight: 1.55 }}>
            {expense.description}
          </blockquote>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: FIN.muted }}>No description was given{canEdit ? " — Edit to add what it was for; the voucher prints it." : "."}</p>
        )}

        <SubHead aside={trail.data?.more ? "Older edits may not be listed — see Audit" : trail.error ? "Edits could not be read" : "Maker and checker are always two people"}>Accountability trail</SubHead>
        <Trail steps={steps} />
        {expense.journal_id || expense.void_journal_id ? (
          <p style={{ fontSize: 11.5, color: FIN.muted, marginTop: 14, fontFamily: FIN.mono }}>
            {expense.journal_id ? `Ledger journal ${expense.journal_id.slice(0, 8)}` : ""}
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

/** The top of the drawer: the voucher as it prints — status and number, the
 *  amount in figures and words, and who was paid, when and how. */
function VoucherCard({ expense }: { expense: BooksExpense }): ReactElement {
  return (
    <section
      aria-label="Voucher"
      style={{ position: "relative", padding: "16px 18px 18px", borderRadius: 14, background: "#FBF7EC", border: `1px solid #EFE3C4`, borderLeft: `4px solid ${FIN.gold}` }}
    >
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 8 }}>
        <StatusChip status={expense.status} />
        {expense.voucher_no ? (
          <span style={{ fontFamily: FIN.mono, fontSize: 12.5, fontWeight: 700, color: FIN.navy, letterSpacing: 0.4 }} title="Payment voucher number">
            {expense.voucher_no}
          </span>
        ) : null}
      </div>
      <div style={{ marginTop: 12, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "#A87F2E" }}>Amount paid</div>
      <MoneyText
        amount_minor={expense.amount_minor}
        currency={expense.currency}
        strong
        style={{ display: "block", fontFamily: FIN.display, fontSize: 30, lineHeight: 1.15, color: FIN.navy, textDecoration: expense.status === "void" ? "line-through" : undefined }}
      />
      <div style={{ fontSize: 12.5, fontStyle: "italic", color: FIN.navy, opacity: 0.8, marginTop: 2 }}>{amountInWords(expense.amount_minor, expense.currency)}</div>
      <div className="flex flex-wrap" style={{ gap: "6px 18px", marginTop: 12, fontSize: 13, color: FIN.navy }}>
        <span>
          <span style={{ color: FIN.muted }}>Paid to </span>
          <strong>{expense.payee}</strong>
        </span>
        <span>
          <span style={{ color: FIN.muted }}>on </span>
          <span style={{ fontFamily: FIN.mono }}>{fmtDay(expense.spent_on)}</span>
        </span>
        <span>
          <span style={{ color: FIN.muted }}>by </span>
          {channelLabel(expense.channel)}
        </span>
      </div>
    </section>
  );
}

/** Paid by, the code or reference, and the whole pasted message beneath. */
function PaymentDetails({ expense }: { expense: BooksExpense }): ReactElement {
  const code = mpesaCodeOf(expense.channel, expense.reference);
  const rest = code && expense.reference ? expense.reference.trim().slice(code.length).trim() : null;
  const items: { label: string; value: ReactNode; title?: string }[] = [
    { label: "Paid by", value: channelLabel(expense.channel) },
    code
      ? { label: "M-Pesa code", value: <span style={{ fontFamily: FIN.mono, fontWeight: 700, letterSpacing: 0.5 }}>{code}</span> }
      : { label: "Reference", value: expense.reference ? <span style={{ fontFamily: FIN.mono }}>{expense.reference}</span> : <span style={{ color: FIN.muted }}>—</span> },
    { label: "Spent on", value: <span style={{ fontFamily: FIN.mono }}>{fmtDay(expense.spent_on)}</span>, title: "The economic date — approval posts on this day" },
    { label: "Amount", value: <MoneyText amount_minor={expense.amount_minor} currency={expense.currency} strong /> },
  ];
  return (
    <>
      <KeyValues items={items} />
      {rest ? (
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, border: `1px dashed ${FIN.border}`, fontSize: 12, color: FIN.muted, lineHeight: 1.5, overflowWrap: "anywhere" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", display: "block", marginBottom: 3 }}>M-Pesa message</span>
          {rest}
        </div>
      ) : null}
    </>
  );
}

/** Whether this browser can hand a PDF to the share sheet (phones, mostly). */
function canSharePdf(): boolean {
  try {
    if (typeof navigator === "undefined" || typeof navigator.canShare !== "function" || typeof File === "undefined") return false;
    return navigator.canShare({ files: [new File([new Blob(["%PDF-"])], "v.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

/** Download, print or share the voucher PDF — the accountability record. */
function VoucherActions({ expense }: { expense: BooksExpense }): ReactElement {
  const toast = useFinanceToast();
  const [busy, setBusy] = useState<"download" | "print" | "share" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filename = `${expense.voucher_no ?? "voucher"}.pdf`;
  const shareable = canSharePdf();

  const run = async (kind: "download" | "print" | "share"): Promise<void> => {
    if (busy) return;
    setError(null);
    // A print tab must open inside the click, before any await, or it is blocked.
    const tab = kind === "print" ? window.open("", "_blank") : null;
    setBusy(kind);
    try {
      if (kind === "download") {
        await FinanceApi.expenseVoucherPdf(expense.expense_id, filename);
        toast(`Saved ${filename}`);
        return;
      }
      const blob = await FinanceApi.expenseVoucherBlob(expense.expense_id);
      const pdf = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
      if (kind === "print") {
        if (!tab) {
          saveBlob(pdf, filename);
          toast("Your browser blocked the print tab — the voucher was downloaded instead", "warn");
          return;
        }
        const url = URL.createObjectURL(pdf);
        tab.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }
      const file = new File([pdf], filename, { type: "application/pdf" });
      await navigator.share({
        files: [file],
        title: `Payment voucher ${expense.voucher_no ?? ""}`.trim(),
        text: `${formatMinor(expense.amount_minor, expense.currency)} paid to ${expense.payee} on ${fmtDay(expense.spent_on)}`,
      });
    } catch (e) {
      tab?.close();
      if (e instanceof DOMException && e.name === "AbortError") return; // the share sheet was closed
      setError(financeErrorMessage(e, "Could not get the voucher."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
        <Button icon={<Download size={13} />} busy={busy === "download"} onClick={() => void run("download")}>
          Download voucher
        </Button>
        <Button icon={<Printer size={13} />} busy={busy === "print"} onClick={() => void run("print")}>
          Print
        </Button>
        {shareable ? (
          <Button icon={<Share2 size={13} />} busy={busy === "share"} onClick={() => void run("share")}>
            Share
          </Button>
        ) : null}
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 11.5, color: FIN.muted }}>A one-page PDF with the amount in words, who prepared and approved it, and a line for the person paid to sign.</p>
      {error ? (
        <Notice tone="error" style={{ marginTop: 8 }}>
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
