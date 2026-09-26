// The draft budget's lines editor (Finance → Budgets; docs/FINANCE_ERP.md §3).
// One row per line: income lines name the fund the money comes into; expense
// lines name a category (and, optionally, a fund — else church-wide). Twelve
// monthly KES amounts per line with the row total, per-month totals per kind,
// and a helper that spreads a yearly amount evenly (the remainder on December,
// so the months always add back to the year). Saving replaces ALL lines
// (PUT, finance:manage); the books' rules are checked first so the grid can
// point at the cell. Read-only for anyone without finance:manage.
import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { Plus, Save, Trash2, Wand2 } from "lucide-react";
import { FinanceApi, financeErrorMessage, FINANCE_LIMITS, type BooksBudgetDetail, type BooksExpenseCategory, type BudgetLineKind } from "../../../api/finance";
import { Button, FIN, Notice, inputStyle, selectStyle, useFinanceToast } from "../kit";
import { formatMinor, parseMajorToMinor } from "../money";
import { MONTH_LABELS, draftFromLine, lineMonthsMinor, lineTotalMinor, parseBudgetCell, sameLines, spreadAnnual, spreadAnnualTexts, sumMinor, validateBudgetLines, type DraftLine, type LineIssues } from "./logic";
import type { FundOption } from "./hooks";

let localSeq = 0;
const newKey = (): string => `new-${++localSeq}`;
const emptyLine = (kind: BudgetLineKind): DraftLine => ({ key: newKey(), kind, fund: "", category: "", label: "", months: Array.from({ length: 12 }, () => "") });

const cellInput: CSSProperties = { ...inputStyle, height: 30, width: 92, padding: "0 8px", fontFamily: FIN.mono, fontSize: 12, textAlign: "right" };
const th: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: FIN.muted, textTransform: "uppercase", letterSpacing: 0.6, padding: "8px 6px", whiteSpace: "nowrap", borderBottom: `1px solid ${FIN.border}`, background: FIN.surface };
const td: CSSProperties = { padding: "6px", verticalAlign: "top", fontSize: 12.5, color: FIN.navy };

/** Keep income lines first, then expense — the order the books return them. */
const ordered = (lines: readonly DraftLine[]): DraftLine[] => [...lines.filter((l) => l.kind === "income"), ...lines.filter((l) => l.kind === "expense")];

export function BudgetEditor({
  budget,
  canEdit,
  funds,
  categories,
  onSaved,
  onDirtyChange,
}: {
  budget: BooksBudgetDetail;
  canEdit: boolean;
  funds: readonly FundOption[];
  categories: readonly BooksExpenseCategory[];
  onSaved: (detail: BooksBudgetDetail) => void;
  onDirtyChange: (dirty: boolean) => void;
}): ReactElement {
  const toast = useFinanceToast();
  const ids = useId();
  const saved = useMemo(() => ordered(budget.lines.map(draftFromLine)), [budget]);
  const [lines, setLines] = useState<DraftLine[]>(saved);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [spreadFor, setSpreadFor] = useState<string | null>(null);
  const [annual, setAnnual] = useState("");

  useEffect(() => {
    setLines(saved);
    setTried(false);
    setServerError(null);
  }, [saved]);

  const dirty = !sameLines(lines, saved);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const validation = validateBudgetLines(lines);
  const issues: Record<string, LineIssues> = tried ? validation.issues : {};
  const cellIssue = (key: string, m: number): string | null => {
    const live = parseBudgetCell(lines.find((l) => l.key === key)?.months[m] ?? "");
    if (!live.ok) return live.error; // a cell that cannot be read is flagged at once
    return issues[key]?.months[m] ?? null;
  };

  const update = (key: string, patch: Partial<DraftLine>): void => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const setMonth = (key: string, m: number, text: string): void =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, months: l.months.map((t, i) => (i === m ? text : t)) } : l)));
  const add = (kind: BudgetLineKind): void => setLines((ls) => ordered([...ls, emptyLine(kind)]));
  const remove = (key: string): void => setLines((ls) => ls.filter((l) => l.key !== key));

  const annualParsed = parseMajorToMinor(annual, { max: FINANCE_LIMITS.budgetMonthMaxMinor * 12 });
  const applySpread = (key: string): void => {
    if (!annualParsed.ok) return;
    update(key, { months: spreadAnnualTexts(annualParsed.minor) });
    setSpreadFor(null);
    setAnnual("");
  };

  const save = async (): Promise<void> => {
    setTried(true);
    const v = validateBudgetLines(lines);
    if (!v.payload || busy) return;
    setBusy(true);
    setServerError(null);
    try {
      const detail = await FinanceApi.replaceBudgetLines(budget.budget_id, { lines: v.payload });
      toast(`Saved ${detail.lines.length} ${detail.lines.length === 1 ? "line" : "lines"} — income ${formatMinor(detail.income_total_minor, "KES")}, expenses ${formatMinor(detail.expense_total_minor, "KES")}`);
      onSaved(detail);
    } catch (e) {
      setServerError(financeErrorMessage(e, "Could not save the lines."));
    } finally {
      setBusy(false);
    }
  };

  const monthTotals = (kind: BudgetLineKind): number[] => Array.from({ length: 12 }, (_, m) => sumMinor(lines.filter((l) => l.kind === kind).map((l) => lineMonthsMinor(l)[m] ?? 0)));
  const incomeMonths = monthTotals("income");
  const expenseMonths = monthTotals("expense");
  const incomeTotal = sumMinor(incomeMonths);
  const expenseTotal = sumMinor(expenseMonths);

  const fundName = (code: string): string => funds.find((f) => f.code === code)?.name ?? code;
  const categoryName = (code: string): string => categories.find((c) => c.code === code)?.name ?? code;
  const fundChoices = (current: string): FundOption[] => funds.filter((f) => f.is_active || f.code === current);
  const categoryChoices = (current: string): BooksExpenseCategory[] => categories.filter((c) => c.is_active || c.code === current);

  const renderLine = (l: DraftLine): ReactElement => {
    const li = issues[l.key];
    const lineError = li ? (li.overlap ?? li.label ?? li.fund ?? li.category) : null;
    const total = lineTotalMinor(l);
    return (
      <tbody key={l.key}>
        <tr style={{ borderTop: `1px solid ${FIN.border}` }}>
          <td style={{ ...td, minWidth: 250, position: "sticky", left: 0, background: FIN.card, zIndex: 1 }}>
            {canEdit ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="flex" style={{ gap: 6 }}>
                  <select
                    aria-label="Kind"
                    value={l.kind}
                    onChange={(e) => {
                      const kind = e.target.value as BudgetLineKind;
                      update(l.key, kind === "income" ? { kind, category: "" } : { kind });
                    }}
                    style={{ ...selectStyle, height: 30, fontSize: 12 }}
                  >
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                  </select>
                  {l.kind === "expense" ? (
                    <select aria-label="Category" value={l.category} onChange={(e) => update(l.key, { category: e.target.value })} style={{ ...selectStyle, height: 30, fontSize: 12, flex: 1, borderColor: li?.category ? "#F5C2C0" : FIN.border }}>
                      <option value="">Category…</option>
                      {categoryChoices(l.category).map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <select aria-label="Fund" value={l.fund} onChange={(e) => update(l.key, { fund: e.target.value })} style={{ ...selectStyle, height: 30, fontSize: 12, flex: 1, borderColor: li?.fund ? "#F5C2C0" : FIN.border }}>
                    <option value="">{l.kind === "income" ? "Fund…" : "Church-wide"}</option>
                    {fundChoices(l.fund).map((f) => (
                      <option key={f.code} value={f.code}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  aria-label="Label"
                  value={l.label}
                  maxLength={FINANCE_LIMITS.budgetLabel.max}
                  placeholder="Label, e.g. Sunday tithes"
                  onChange={(e) => update(l.key, { label: e.target.value })}
                  style={{ ...inputStyle, height: 30, fontSize: 12.5, borderColor: li?.label ? "#F5C2C0" : FIN.border }}
                />
              </div>
            ) : (
              <div>
                <div style={{ fontWeight: 700 }}>{l.label}</div>
                <div style={{ fontSize: 11.5, color: FIN.muted }}>
                  {l.kind === "income" ? `Income · ${fundName(l.fund)}` : `Expense · ${categoryName(l.category)}${l.fund ? ` · ${fundName(l.fund)}` : " · church-wide"}`}
                </div>
              </div>
            )}
          </td>
          {l.months.map((text, m) => {
            const err = canEdit ? cellIssue(l.key, m) : null;
            return (
              <td key={m} style={{ ...td, padding: "6px 3px" }}>
                {canEdit ? (
                  <input
                    aria-label={`${l.label || "Line"} ${MONTH_LABELS[m]}`}
                    aria-invalid={err ? "true" : undefined}
                    title={err ?? undefined}
                    value={text}
                    inputMode="decimal"
                    placeholder="0"
                    onChange={(e) => setMonth(l.key, m, e.target.value)}
                    style={{ ...cellInput, borderColor: err ? "#F5C2C0" : FIN.border, background: err ? "#FDECEC" : cellInput.background }}
                  />
                ) : (
                  <span style={{ display: "block", textAlign: "right", fontFamily: FIN.mono, fontSize: 12, padding: "6px 3px" }}>{formatMinor(lineMonthsMinor(l)[m] ?? 0, null)}</span>
                )}
              </td>
            );
          })}
          <td style={{ ...td, textAlign: "right", fontFamily: FIN.mono, fontWeight: 700, whiteSpace: "nowrap", paddingTop: 12 }} data-testid={`line-total-${l.key}`}>
            {formatMinor(total, null)}
          </td>
          {canEdit ? (
            <td style={{ ...td, whiteSpace: "nowrap" }}>
              <div className="flex" style={{ gap: 4 }}>
                <Button size="sm" variant="ghost" icon={<Wand2 size={12} />} ariaLabel="Spread an annual amount evenly" title="Spread an annual amount evenly" onClick={() => setSpreadFor(spreadFor === l.key ? null : l.key)} />
                <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} ariaLabel="Remove line" title="Remove line" onClick={() => remove(l.key)} />
              </div>
            </td>
          ) : null}
        </tr>
        {spreadFor === l.key ? (
          <tr>
            <td colSpan={canEdit ? 15 : 14} style={{ ...td, background: FIN.surface }}>
              <div className="flex items-center flex-wrap" style={{ gap: 8, position: "sticky", left: 0 }}>
                <label htmlFor={`${ids}-annual-${l.key}`} style={{ fontSize: 12, color: FIN.navy, fontWeight: 600 }}>
                  Spread a yearly amount evenly (KES)
                </label>
                <input
                  id={`${ids}-annual-${l.key}`}
                  data-autofocus
                  value={annual}
                  inputMode="decimal"
                  placeholder="e.g. 1,200,000"
                  onChange={(e) => setAnnual(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applySpread(l.key);
                  }}
                  style={{ ...inputStyle, width: 160, height: 30, fontFamily: FIN.mono }}
                />
                <Button size="sm" variant="primary" disabled={!annualParsed.ok} onClick={() => applySpread(l.key)}>
                  Spread
                </Button>
                <span style={{ fontSize: 11.5, color: annual && !annualParsed.ok ? FIN.danger : FIN.muted }}>
                  {annual && !annualParsed.ok
                    ? annualParsed.error
                    : annualParsed.ok
                      ? `${formatMinor(spreadAnnual(annualParsed.minor)[0] ?? 0, "KES")} a month; December takes the remainder so the months add back to exactly ${formatMinor(annualParsed.minor, "KES")}.`
                      : "Each month gets an equal share; December takes the remainder."}
                </span>
              </div>
            </td>
          </tr>
        ) : null}
        {lineError ? (
          <tr>
            <td colSpan={canEdit ? 15 : 14} style={{ ...td, paddingTop: 0 }}>
              <span role="alert" style={{ fontSize: 11.5, color: FIN.danger, fontWeight: 600, position: "sticky", left: 6 }}>
                {lineError}
              </span>
            </td>
          </tr>
        ) : null}
      </tbody>
    );
  };

  const totalsRow = (label: string, months: number[], total: number, tone?: string): ReactElement => (
    <tr style={{ borderTop: `1px solid ${FIN.border}`, background: FIN.surface }}>
      <td style={{ ...td, fontWeight: 700, position: "sticky", left: 0, background: FIN.surface, zIndex: 1 }}>{label}</td>
      {months.map((v, m) => (
        <td key={m} style={{ ...td, textAlign: "right", fontFamily: FIN.mono, fontSize: 12, color: tone ?? (v < 0 ? FIN.danger : FIN.navy) }}>
          {formatMinor(v, null)}
        </td>
      ))}
      <td style={{ ...td, textAlign: "right", fontFamily: FIN.mono, fontWeight: 700, color: tone ?? (total < 0 ? FIN.danger : FIN.navy) }}>{formatMinor(total, null)}</td>
      {canEdit ? <td style={td} /> : null}
    </tr>
  );

  const income = lines.filter((l) => l.kind === "income");
  const expense = lines.filter((l) => l.kind === "expense");
  const net = incomeMonths.map((v, m) => v - (expenseMonths[m] ?? 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {serverError ? <Notice tone="error">{serverError}</Notice> : null}
      {tried && !validation.ok ? <Notice tone="error">{validation.summary ?? "Some lines need fixing before they can be saved — see the highlighted cells and the notes under the lines."}</Notice> : null}
      <div style={{ overflowX: "auto", border: `1px solid ${FIN.border}`, borderRadius: 12 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1500 }} aria-label="Budget lines">
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, zIndex: 2 }}>Line (KES)</th>
              {MONTH_LABELS.map((m) => (
                <th key={m} style={{ ...th, textAlign: "right" }}>
                  {m}
                </th>
              ))}
              <th style={{ ...th, textAlign: "right" }}>Year</th>
              {canEdit ? <th style={th} /> : null}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={canEdit ? 15 : 14} style={{ ...td, fontWeight: 700, color: FIN.good, paddingTop: 12 }}>
                Income {income.length === 0 ? <span style={{ fontWeight: 400, color: FIN.muted }}>— no income lines yet</span> : null}
              </td>
            </tr>
          </tbody>
          {income.map(renderLine)}
          <tbody>{totalsRow("Total income", incomeMonths, incomeTotal)}</tbody>
          <tbody>
            <tr>
              <td colSpan={canEdit ? 15 : 14} style={{ ...td, fontWeight: 700, color: FIN.warn, paddingTop: 16 }}>
                Expenses {expense.length === 0 ? <span style={{ fontWeight: 400, color: FIN.muted }}>— no expense lines yet</span> : null}
              </td>
            </tr>
          </tbody>
          {expense.map(renderLine)}
          <tbody>
            {totalsRow("Total expenses", expenseMonths, expenseTotal)}
            {totalsRow("Budgeted surplus", net, incomeTotal - expenseTotal)}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
          <Button icon={<Plus size={13} />} onClick={() => add("income")}>
            Income line
          </Button>
          <Button icon={<Plus size={13} />} onClick={() => add("expense")}>
            Expense line
          </Button>
          <span style={{ fontSize: 12, color: FIN.muted }}>
            {lines.length} of {FINANCE_LIMITS.budgetLines.max} lines · one income line per fund; an expense category is budgeted church-wide or per fund, not both.
          </span>
          <span style={{ marginLeft: "auto" }} className="inline-flex items-center" >
            {dirty ? <span style={{ fontSize: 12, color: FIN.warn, fontWeight: 700, marginRight: 10 }}>Unsaved changes</span> : null}
            <Button variant="primary" icon={<Save size={13} />} busy={busy} disabledTip={!dirty ? "Nothing to save" : undefined} onClick={() => void save()}>
              Save lines
            </Button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
