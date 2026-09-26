// Finance → Expenses (/finance/expenses) — docs/FINANCE_ERP.md §5 "Expenses".
// The expense register with maker-checker: an expense is RECORDED (nothing
// posts) by someone with finance:manage and APPROVED — which posts it out of
// its fund, dated the day it was spent — by a different person with
// finance:approve (a SuperAdmin may approve their own). Voiding needs a reason;
// voiding an approved expense posts the reversing entry. Filters (status —
// several at once — fund, category, when it was spent, search) live in the URL;
// the totals cover the whole filtered set, per currency and per status.
import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Plus, ReceiptText } from "lucide-react";
import { FINANCE_CSV, FinanceApi, type BooksExpense, type ExpenseStatus, type ExpensesFilters } from "../../../api/finance";
import {
  Button,
  DataTable,
  ExportButton,
  FIN,
  FilterBar,
  FinancePage,
  KpiStrip,
  KpiTile,
  MoneyText,
  PerCurrency,
  SectionCard,
  StatusChip,
  TotalsStrip,
  channelLabel,
  inputStyle,
  pagedTableProps,
  useFinanceCaps,
  usePagedList,
  useUrlParam,
  type Column,
} from "../../finance/kit";
import { sortTotals } from "../../finance/money";
import { DATE_PRESETS, fmtDateTimeEAT, fmtDay, fmtRange, presetRange, rangeError, type DatePreset } from "../../finance/dates";
import { useExpenseCategories, useFunds } from "../../finance/b/hooks";
import { ExpenseDrawer } from "../../finance/b/ExpenseDrawer";
import { ExpenseFormDrawer } from "../../finance/b/ExpenseForm";
import { Stacked, ToggleChips } from "../../finance/b/ui";

const STATUS_OPTIONS: readonly { key: ExpenseStatus; label: string; hint: string }[] = [
  { key: "recorded", label: "Awaiting approval", hint: "Recorded — nothing posted yet" },
  { key: "approved", label: "Approved", hint: "Posted out of the fund" },
  { key: "void", label: "Void", hint: "Voided — reversed if it had been approved" },
];
const DEFAULT_STATUS = "recorded,approved";

/** "Spent" scope: any date, a preset, or a custom range. */
type SpentScope = "any" | DatePreset;
const SPENT_OPTIONS: readonly { value: SpentScope; label: string }[] = [{ value: "any", label: "Any date" }, ...DATE_PRESETS.map((p) => ({ value: p.key, label: p.key === "custom" ? "Custom range" : p.label }))];

const dateInput: CSSProperties = { ...inputStyle, width: 150, fontFamily: FIN.mono, fontSize: 12.5 };

export function FinanceExpenses(): ReactElement {
  const caps = useFinanceCaps();
  const funds = useFunds();
  const categories = useExpenseCategories();
  const [params] = useSearchParams();
  const [statusRaw, setStatusRaw] = useUrlParam("status", DEFAULT_STATUS);
  const [fund, setFund] = useUrlParam("fund", "");
  const [category, setCategory] = useUrlParam("category", "");
  const [q, setQ] = useUrlParam("q", "");
  const [spentRaw, setSpent] = useUrlParam("spent", "this_year");
  const [fromRaw, setFrom] = useUrlParam("from", "");
  const [toRaw, setTo] = useUrlParam("to", "");
  const [openId, setOpenId] = useUrlParam("expense", "");

  // The approval queue (Overview → "expenses to approve" opens ?status=recorded)
  // is about every expense waiting, whenever it was spent: arriving there with
  // no date scope of its own, the page widens to any date — once, in the URL,
  // so changing the status afterwards does not shrink the dates under you.
  useEffect(() => {
    if (params.get("status") === "recorded" && !params.has("spent")) setSpent("any");
    // on arrival only — deliberately not re-run when the URL changes
  }, []);

  const statuses = useMemo(() => {
    const keys = statusRaw.split(",").map((s) => s.trim()) as ExpenseStatus[];
    const valid = STATUS_OPTIONS.map((o) => o.key).filter((k) => keys.includes(k));
    return valid.length > 0 ? valid : (["recorded", "approved"] as ExpenseStatus[]);
  }, [statusRaw]);
  const spent: SpentScope = SPENT_OPTIONS.some((o) => o.value === spentRaw) ? (spentRaw as SpentScope) : "this_year";
  const customError = spent === "custom" ? rangeError({ from: fromRaw, to: toRaw }) : null;
  const period: { from: string | null; to: string | null } =
    spent === "any" ? { from: null, to: null } : spent === "custom" ? (customError ? { from: null, to: null } : { from: fromRaw, to: toRaw }) : presetRange(spent);

  const filters: ExpensesFilters = useMemo(
    () => ({ status: statuses, fund: fund || null, category: category || null, q: q || null, from: period.from, to: period.to }),
    [statuses, fund, category, q, period.from, period.to],
  );
  const list = usePagedList((cursor) => FinanceApi.expenses({ ...filters, cursor, limit: 100 }), JSON.stringify(filters), { errorFallback: "Could not load the expenses." });
  const byStatus = list.page?.totals_by_status ?? [];
  const firstLoad = list.loading && !list.page;

  const [recordOpen, setRecordOpen] = useState(false);
  const [editing, setEditing] = useState<BooksExpense | null>(null);
  const [editedByMe, setEditedByMe] = useState<Set<string>>(() => new Set());
  const [version, setVersion] = useState(0);

  const statusText = statuses.length === 3 ? "every status" : statuses.map((s) => STATUS_OPTIONS.find((o) => o.key === s)?.label.toLowerCase()).join(" + ");
  const periodText = spent === "any" ? "any date" : spent === "custom" ? (customError ? "any date" : fmtRange({ from: fromRaw, to: toRaw })) : fmtRange(presetRange(spent));
  const clearable = statusRaw !== DEFAULT_STATUS || Boolean(fund || category || q) || spent !== "this_year";

  const columns: Column<BooksExpense>[] = [
    { key: "spent", header: "Spent on", cell: (e) => fmtDay(e.spent_on), mono: true },
    { key: "payee", header: "Paid to", cell: (e) => <Stacked primary={e.payee} secondary={e.description ?? undefined} strong />, width: 240 },
    { key: "category", header: "Category", cell: (e) => e.category.name },
    { key: "fund", header: "Fund", cell: (e) => e.fund.name },
    { key: "channel", header: "Paid by", cell: (e) => <Stacked primary={channelLabel(e.channel)} secondary={e.reference ? <span style={{ fontFamily: FIN.mono }}>{e.reference}</span> : undefined} /> },
    { key: "amount", header: "Amount", cell: (e) => <MoneyText amount_minor={e.amount_minor} currency={e.currency} strong style={e.status === "void" ? { textDecoration: "line-through", color: FIN.muted } : undefined} />, align: "right" },
    { key: "status", header: "Status", cell: (e) => <StatusChip status={e.status} /> },
    { key: "recorded", header: "Recorded by", cell: (e) => <Stacked primary={e.recorded_by_name ?? "—"} secondary={fmtDateTimeEAT(e.recorded_at)} /> },
    {
      key: "approved",
      header: "Approved by",
      cell: (e) => (e.approved_at ? <Stacked primary={e.approved_by_name ?? "—"} secondary={fmtDateTimeEAT(e.approved_at)} /> : <span style={{ color: FIN.muted }}>{e.status === "recorded" ? "waiting" : "—"}</span>),
    },
  ];

  const recordedTotals = byStatus.filter((t) => t.status === "recorded");
  const approvedTotals = byStatus.filter((t) => t.status === "approved");

  return (
    <FinancePage
      title="Expenses"
      subtitle="Money paid out of the church's funds. Recording posts nothing; a different person approves, which posts it out of the fund on the day it was spent."
      actions={
        <>
          <ExportButton onDark path={FINANCE_CSV.expenses} params={filters} filename="expenses" />
          {caps.manage ? (
            <Button onDark variant="primary" icon={<Plus size={13} />} onClick={() => setRecordOpen(true)}>
              Record expense
            </Button>
          ) : null}
        </>
      }
      hero={
        <KpiStrip>
          <KpiTile label="Approved" icon={<CheckCircle2 size={12} />} value={<PerCurrency amounts={approvedTotals} />} loading={firstLoad} hint={statuses.includes("approved") ? `spent · ${periodText}` : "not in this selection"} />
          <KpiTile
            label="Awaiting approval"
            icon={<AlertTriangle size={12} />}
            tone={recordedTotals.length > 0 ? "warn" : "default"}
            value={<PerCurrency amounts={recordedTotals} empty="None" />}
            loading={firstLoad}
            hint={`${recordedTotals.reduce((n, t) => n + t.count, 0)} recorded · ${periodText}`}
            onClick={
              statusRaw === "recorded"
                ? undefined
                : () => {
                    setStatusRaw("recorded");
                    setSpent("any");
                  }
            }
          />
          <KpiTile label="Expenses" icon={<ReceiptText size={12} />} value={firstLoad ? "…" : list.totals.reduce((n, t) => n + t.count, 0).toLocaleString()} hint={statusText} />
        </KpiStrip>
      }
    >
      <FilterBar
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Payee, description or reference"
        selects={[
          { key: "spent", label: "Spent", value: spent, options: SPENT_OPTIONS, onChange: setSpent },
          { key: "fund", label: "Fund", value: fund, options: [{ value: "", label: "All" }, ...funds.funds.map((f) => ({ value: f.code, label: f.name }))], onChange: setFund },
          { key: "category", label: "Category", value: category, options: [{ value: "", label: "All" }, ...categories.categories.map((c) => ({ value: c.code, label: c.name }))], onChange: setCategory },
        ]}
        clearable={clearable}
        onClear={() => {
          setStatusRaw(DEFAULT_STATUS);
          setFund("");
          setCategory("");
          setQ("");
          setSpent("this_year");
          setFrom("");
          setTo("");
        }}
        trailing={<ToggleChips ariaLabel="Status" options={STATUS_OPTIONS} value={statuses} onChange={(next) => setStatusRaw(next.join(","))} />}
      />
      {spent === "custom" ? (
        <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
          <span className="nuru-eyebrow">Spent between</span>
          <input type="date" aria-label="Spent from" value={fromRaw} max={toRaw || undefined} onChange={(e) => setFrom(e.target.value)} style={dateInput} />
          <span style={{ color: FIN.muted }}>–</span>
          <input type="date" aria-label="Spent to" value={toRaw} min={fromRaw || undefined} onChange={(e) => setTo(e.target.value)} style={dateInput} />
          {customError ? (
            <span role="alert" style={{ fontSize: 11.5, color: FIN.danger, fontWeight: 600 }}>
              {customError} Showing any date until then.
            </span>
          ) : null}
        </div>
      ) : null}
      <TotalsStrip
        totals={list.totals}
        loading={list.loading}
        label="Total"
        noun={["expense", "expenses"]}
        extra={
          byStatus.length > 0 ? (
            <span className="inline-flex flex-wrap items-center" style={{ gap: "4px 12px" }}>
              {STATUS_OPTIONS.flatMap((o) =>
                sortTotals(byStatus.filter((t) => t.status === o.key)).map((t) => (
                  <span key={`${o.key}-${t.currency}`} className="inline-flex items-center" style={{ gap: 5 }}>
                    <StatusChip status={o.key} label={o.label} />
                    <MoneyText amount_minor={t.amount_minor} currency={t.currency} style={{ fontSize: 12 }} />
                    <span style={{ fontSize: 11 }}>({t.count})</span>
                  </span>
                )),
              )}
            </span>
          ) : (
            `${statusText} · ${periodText}`
          )
        }
      />
      <SectionCard title="Expense register" subtitle={`Newest spending first · ${statusText} · ${periodText}. Open one for its trail and actions.`} flush>
        <DataTable
          ariaLabel="Expenses"
          columns={columns}
          rowKey={(e) => e.expense_id}
          onRowClick={(e) => setOpenId(e.expense_id)}
          selectedKey={openId || null}
          empty={clearable ? "No expenses match these filters." : caps.manage ? "No expenses this year yet — “Record expense” adds one; someone else approves it." : "No expenses this year yet."}
          minWidth={1260}
          {...pagedTableProps(list)}
        />
      </SectionCard>

      <ExpenseDrawer
        expenseId={openId || null}
        initial={list.rows.find((e) => e.expense_id === openId) ?? null}
        editedByMe={editedByMe.has(openId)}
        version={version}
        onClose={() => setOpenId("")}
        onChanged={() => list.reload()}
        onEdit={(e) => setEditing(e)}
      />
      <ExpenseFormDrawer
        open={recordOpen || editing !== null}
        expense={editing}
        funds={funds.funds}
        categories={categories.categories}
        onClose={() => {
          setRecordOpen(false);
          setEditing(null);
        }}
        onSaved={(saved, mode) => {
          setRecordOpen(false);
          setEditing(null);
          if (mode === "edited") setEditedByMe((s) => new Set(s).add(saved.expense_id));
          setVersion((v) => v + 1);
          setOpenId(saved.expense_id);
          list.reload();
        }}
      />
    </FinancePage>
  );
}
