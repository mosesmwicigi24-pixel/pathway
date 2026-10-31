// Record an expense / correct one while it is still recorded (Finance →
// Expenses; finance:manage). Nothing posts on save: an expense is RECORDED
// here and posted only when a different person approves it (maker-checker,
// docs/FINANCE_ERP.md §2). Whoever edits an expense becomes one of its makers.
//
// 2026-10-31: an expense can be booked to a department and to one of its
// approved needs (what was raised for the need, and now what was spent on it).
// Choosing a department suggests its fund when none is chosen yet.
import { useEffect, useId, useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { FinanceApi, financeErrorMessage, FINANCE_LIMITS, type BooksExpense, type BooksExpenseCategory, type WriteCurrency } from "../../../api/finance";
import { Button, Drawer, FIN, Field, MoneyInput, Notice, inputStyle, selectStyle, textareaStyle, useFinanceToast } from "../kit";
import { formatMinor } from "../money";
import { fmtDay, todayEAT } from "../dates";
import { EXPENSE_CHANNELS, backdateWindow, expenseFormFrom, expensePatch, validateExpenseForm, type ExpenseFormErrors, type ExpenseFormValues } from "./logic";
import { useResource, type DepartmentOption, type FundOption } from "./hooks";

const CURRENCIES: readonly WriteCurrency[] = ["KES", "USD"];

const blank = (preset?: ExpensePreset | null): ExpenseFormValues => ({
  fund: "", category: "", payee: "", description: "", amount: "", currency: "KES", spent_on: todayEAT(), channel: "", reference: "",
  department_id: preset?.department_id ?? "", need_id: preset?.need_id ?? "",
});

/** Where a new expense starts (the Needs page's "Record an expense against it"). */
export interface ExpensePreset {
  department_id: string;
  need_id?: string | undefined;
}

export function ExpenseFormDrawer({
  open,
  expense,
  funds,
  categories,
  departments = [],
  preset = null,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = record a new one; otherwise edit this (recorded) expense. */
  expense: BooksExpense | null;
  funds: readonly FundOption[];
  categories: readonly BooksExpenseCategory[];
  departments?: readonly DepartmentOption[];
  /** A new expense's starting department / need. */
  preset?: ExpensePreset | null;
  onClose: () => void;
  onSaved: (saved: BooksExpense, mode: "recorded" | "edited") => void;
}): ReactElement | null {
  const toast = useFinanceToast();
  const ids = useId();
  const [form, setForm] = useState<ExpenseFormValues>(() => (expense ? expenseFormFrom(expense) : blank(preset)));
  const [errors, setErrors] = useState<ExpenseFormErrors>({});
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const start = expense ? expenseFormFrom(expense) : blank(preset);
    // A preset department suggests its fund.
    if (!expense && preset) {
      const d = departments.find((x) => x.department_id === preset.department_id);
      if (d?.fund_code && funds.some((f) => f.code === d.fund_code && f.is_active)) start.fund = d.fund_code;
    }
    setForm(start);
    setErrors({});
    setTried(false);
    setServerError(null);
    // departments / funds may arrive after opening; the preset's fund is a suggestion only
  }, [open, expense, preset]);

  // The approved needs of the chosen department (plus the expense's own need,
  // which may since have closed).
  const needs = useResource(
    () => (form.department_id ? FinanceApi.needs({ status: "all", department_id: form.department_id, limit: 100 }) : Promise.resolve(null)),
    `needs:${form.department_id}`,
    { enabled: open && form.department_id !== "", errorFallback: "Could not load this department's needs." },
  );
  const needChoices = useMemo(
    () => (needs.data?.data ?? []).filter((n) => n.status === "approved" || n.need_id === form.need_id || n.need_id === expense?.need?.need_id),
    [needs.data, form.need_id, expense],
  );

  const chooseDepartment = (id: string): void => {
    const next: ExpenseFormValues = { ...form, department_id: id, need_id: "" };
    const d = departments.find((x) => x.department_id === id);
    if (!form.fund && d?.fund_code && funds.some((f) => f.code === d.fund_code && f.is_active)) next.fund = d.fund_code;
    setForm(next);
    if (tried) setErrors(validateExpenseForm(next).errors);
  };

  const set = <K extends keyof ExpenseFormValues>(k: K, v: ExpenseFormValues[K]): void => {
    const next = { ...form, [k]: v };
    setForm(next);
    if (tried) setErrors(validateExpenseForm(next).errors);
  };

  const dateWindow = backdateWindow();
  const fundChoices = funds.filter((f) => f.is_active || f.code === expense?.fund.code);
  const categoryChoices = categories.filter((c) => c.is_active || c.code === expense?.category.code);
  const departmentChoices: DepartmentOption[] =
    expense?.department && !departments.some((d) => d.department_id === expense.department?.department_id)
      ? [...departments, { department_id: expense.department.department_id, name: `${expense.department.name} (archived)`, fund_code: null }]
      : [...departments];
  const v = validateExpenseForm(form);
  const patch = expense && v.body ? expensePatch(expense, v.body) : null;
  const nothingChanged = expense !== null && patch !== null && Object.keys(patch).length === 0;

  const save = async (): Promise<void> => {
    setTried(true);
    const check = validateExpenseForm(form);
    setErrors(check.errors);
    if (!check.body || busy) return;
    setBusy(true);
    setServerError(null);
    try {
      if (expense) {
        const p = expensePatch(expense, check.body);
        if (Object.keys(p).length === 0) return;
        const saved = await FinanceApi.updateExpense(expense.expense_id, p);
        toast("Saved — you edited it, so another person must approve it");
        onSaved(saved, "edited");
      } else {
        const saved = await FinanceApi.recordExpense(check.body);
        toast(`Recorded ${formatMinor(saved.amount_minor, saved.currency)} to ${saved.payee} — waiting for someone else to approve`);
        onSaved(saved, "recorded");
      }
    } catch (e) {
      setServerError(financeErrorMessage(e, expense ? "Could not save the expense." : "Could not record the expense."));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <Drawer
      open={open}
      title={expense ? "Edit expense" : "Record expense"}
      subtitle={expense ? `${expense.payee} · ${fmtDay(expense.spent_on)}` : "Money that has already been paid out."}
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()} disabledTip={nothingChanged ? "Nothing has changed" : undefined}>
            {expense ? "Save changes" : "Record expense"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Notice tone="info">
          {expense
            ? "Only a recorded expense can be corrected. Editing makes you one of its makers — another person must approve it. Nothing is posted until then."
            : "Nothing is posted until another person approves it. Recording puts it in the approval queue; approving takes it out of the fund."}
        </Notice>
        {serverError ? <Notice tone="error">{serverError}</Notice> : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 12 }}>
          <Field
            label="Department (optional)"
            htmlFor={`${ids}-department`}
            hint={departmentChoices.length === 0 ? <>No departments yet — <Link to="/departments">add one in Departments</Link>.</> : "Who the money was spent for. Leave empty for rent, utilities and the like."}
          >
            <select id={`${ids}-department`} data-autofocus value={form.department_id} onChange={(e) => chooseDepartment(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
              <option value="">Not tied to a department</option>
              {departmentChoices.map((d) => (
                <option key={d.department_id} value={d.department_id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Spent against a need (optional)"
            htmlFor={`${ids}-need`}
            error={needs.error ?? undefined}
            hint={
              !form.department_id
                ? "Choose a department to see its approved needs."
                : needs.loading
                  ? "Loading the department's needs…"
                  : needChoices.length === 0
                    ? "This department has no approved needs."
                    : "An approved need: the need then shows what was spent on it."
            }
          >
            <select
              id={`${ids}-need`}
              value={form.need_id}
              disabled={!form.department_id || needChoices.length === 0}
              onChange={(e) => set("need_id", e.target.value)}
              style={{ ...selectStyle, width: "100%" }}
            >
              <option value="">Not a specific need</option>
              {needChoices.map((n) => (
                <option key={n.need_id} value={n.need_id}>
                  {n.title} · target {formatMinor(n.target_minor, n.currency)}
                  {n.status === "approved" ? "" : ` (${n.status})`}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 12 }}>
          <Field label="Paid from fund" htmlFor={`${ids}-fund`} required error={errors.fund}>
            <select id={`${ids}-fund`} value={form.fund} onChange={(e) => set("fund", e.target.value)} style={{ ...selectStyle, width: "100%" }}>
              <option value="">Choose a fund…</option>
              {fundChoices.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.name}
                  {f.is_active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category" htmlFor={`${ids}-category`} required error={errors.category}>
            <select id={`${ids}-category`} value={form.category} onChange={(e) => set("category", e.target.value)} style={{ ...selectStyle, width: "100%" }}>
              <option value="">Choose a category…</option>
              {categoryChoices.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                  {c.is_active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Paid to" htmlFor={`${ids}-payee`} required error={errors.payee}>
          <input id={`${ids}-payee`} value={form.payee} maxLength={FINANCE_LIMITS.payee.max} placeholder="Who received the money" onChange={(e) => set("payee", e.target.value)} style={inputStyle} />
        </Field>
        <Field label="What for (optional)" htmlFor={`${ids}-description`} error={errors.description}>
          <textarea id={`${ids}-description`} value={form.description} maxLength={500} onChange={(e) => set("description", e.target.value)} style={textareaStyle} />
        </Field>
        <Field label="Amount" htmlFor={`${ids}-amount`} required>
          <MoneyInput id={`${ids}-amount`} value={form.amount} currency={form.currency} currencies={CURRENCIES} onCurrencyChange={(c) => set("currency", c as WriteCurrency)} onChange={(t) => set("amount", t)} showError={tried} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 12 }}>
          <Field label="Spent on" htmlFor={`${ids}-spent`} required error={errors.spent_on} hint={`The day the money left — ${fmtDay(dateWindow.min)} to today. Approval posts it on this date.`}>
            <input id={`${ids}-spent`} type="date" value={form.spent_on} min={dateWindow.min} max={dateWindow.max} onChange={(e) => set("spent_on", e.target.value)} style={{ ...inputStyle, fontFamily: FIN.mono }} />
          </Field>
          <Field label="Paid by" htmlFor={`${ids}-channel`} required error={errors.channel} hint="Decides the cash account the approval takes it from.">
            <select id={`${ids}-channel`} value={form.channel} onChange={(e) => set("channel", e.target.value as ExpenseFormValues["channel"])} style={{ ...selectStyle, width: "100%" }}>
              <option value="">Choose…</option>
              {EXPENSE_CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Reference (optional)"
          htmlFor={`${ids}-reference`}
          error={errors.reference}
          hint="Cheque number, bank reference or receipt number — or paste the whole M-Pesa confirmation message; the voucher shows its code."
        >
          <textarea
            id={`${ids}-reference`}
            value={form.reference}
            rows={2}
            maxLength={FINANCE_LIMITS.expenseReference.max}
            onChange={(e) => set("reference", e.target.value)}
            style={{ ...textareaStyle, fontFamily: FIN.mono, fontSize: 12.5, minHeight: 56 }}
          />
        </Field>
      </div>
    </Drawer>
  );
}
