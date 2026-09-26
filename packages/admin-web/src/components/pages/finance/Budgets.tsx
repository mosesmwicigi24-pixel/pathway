// Finance → Budgets (/finance/budgets) — docs/FINANCE_ERP.md §5 "Budgets".
// One budget per year, in KES. No budget yet → "Start the <year> budget"
// (finance:manage). A draft is edited line by line — income per fund, expenses
// per category (church-wide or per fund), twelve months each — and saved
// (finance:manage), then approved (finance:approve), which locks the lines.
// An approved budget shows budget vs actual: per line and month, year-to-date
// and the year, with the variance coloured where it needs attention.
import { useCallback, useState, type ReactElement } from "react";
import { CheckCircle2, Lock, PencilLine, Plus, Scale } from "lucide-react";
import { FinanceApi, FINANCE_LIMITS, type BooksBudget, type BooksBudgetDetail } from "../../../api/finance";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FinancePage,
  KpiStrip,
  KpiTile,
  MoneyText,
  Notice,
  SectionCard,
  Skeleton,
  StatusChip,
  useFinanceCaps,
  useFinanceToast,
  useUrlParam,
} from "../../finance/kit";
import { formatMinor } from "../../finance/money";
import { currentYearEAT, fmtDateTimeEAT } from "../../finance/dates";
import { useExpenseCategories, useFunds, useResource } from "../../finance/b/hooks";
import { parseYear, planningYears } from "../../finance/b/logic";
import { BudgetEditor } from "../../finance/b/BudgetEditor";
import { BudgetActuals } from "../../finance/b/BudgetActuals";
import { YearSelect } from "../../finance/b/ui";

type Ask = { kind: "start" } | { kind: "approve"; budget: BooksBudgetDetail } | { kind: "rename"; budget: BooksBudgetDetail } | { kind: "leave"; year: number };

export function FinanceBudgets(): ReactElement {
  const caps = useFinanceCaps();
  const toast = useFinanceToast();
  const funds = useFunds();
  const categories = useExpenseCategories();
  const thisYear = currentYearEAT();
  const [yearRaw, setYearRaw] = useUrlParam("year", "");
  const year = parseYear(yearRaw, thisYear);
  const setYear = (y: number): void => setYearRaw(y === thisYear ? "" : String(y));

  const list = useResource(() => FinanceApi.budgets(), "budgets", { errorFallback: "Could not load the budgets." });
  const summary: BooksBudget | null = list.data?.find((b) => b.year === year) ?? null;
  const [version, setVersion] = useState(0);
  const detail = useResource(() => FinanceApi.budget(summary?.budget_id ?? ""), `${summary?.budget_id ?? "none"}:${version}`, { enabled: summary !== null, errorFallback: "Could not load this budget." });
  const budget = detail.data && detail.data.budget_id === summary?.budget_id ? detail.data : null;

  const [dirty, setDirty] = useState(false);
  const onDirtyChange = useCallback((d: boolean) => setDirty(d), []);
  const [ask, setAsk] = useState<Ask | null>(null);
  const years = planningYears(new Date(), 4, (list.data ?? []).map((b) => b.year));

  const chooseYear = (y: number): void => {
    if (y === year) return;
    if (dirty) setAsk({ kind: "leave", year: y });
    else setYear(y);
  };

  const refresh = (d?: BooksBudgetDetail): void => {
    if (d) detail.setData(() => d);
    list.reload();
  };

  const confirm = async (reason: string | null): Promise<void> => {
    if (!ask) return;
    if (ask.kind === "start") {
      const d = await FinanceApi.createBudget({ year, name: `${year} budget` });
      setAsk(null);
      toast(`Started the ${year} budget as a draft — add its lines, save, then approve`);
      setVersion((v) => v + 1);
      refresh(d);
    } else if (ask.kind === "approve") {
      const d = await FinanceApi.approveBudget(ask.budget.budget_id);
      setAsk(null);
      toast(`Approved the ${d.year} budget — its lines are locked`);
      refresh(d);
    } else if (ask.kind === "rename") {
      const d = await FinanceApi.updateBudget(ask.budget.budget_id, { name: reason ?? ask.budget.name });
      setAsk(null);
      toast(`Renamed to “${d.name}”`);
      refresh(d);
    } else {
      setAsk(null);
      setDirty(false);
      setYear(ask.year);
    }
  };

  const heroValue = (v: number | undefined): ReactElement | string => (v === undefined ? "—" : <MoneyText amount_minor={v} currency="KES" />);
  const draft = budget?.status === "draft";
  const loadingBudget = list.loading && !list.data;

  let body: ReactElement;
  if (list.error) {
    body = <ErrorState message={list.error} onRetry={list.reload} />;
  } else if (loadingBudget || (summary && !budget && !detail.error)) {
    body = <Skeleton width="100%" height={160} />;
  } else if (detail.error) {
    body = <ErrorState message={detail.error} onRetry={detail.reload} />;
  } else if (!summary || !budget) {
    body = (
      <EmptyState title={`No budget for ${year} yet`} icon={<Scale size={22} />}>
        <p style={{ margin: "0 0 12px" }}>
          A budget sets what the church expects to receive into each fund and to spend in each category, month by month, in KES. Once approved, this page compares it with what actually came in and went out.
        </p>
        {caps.manage ? (
          <Button variant="primary" icon={<Plus size={13} />} onClick={() => setAsk({ kind: "start" })}>
            Start the {year} budget
          </Button>
        ) : (
          <span>Starting a budget needs finance:manage.</span>
        )}
      </EmptyState>
    );
  } else if (draft) {
    body = (
      <SectionCard
        title={budget.name}
        subtitle={`Draft · ${budget.line_count} saved ${budget.line_count === 1 ? "line" : "lines"} · started by ${budget.created_by_name ?? "someone"} ${fmtDateTimeEAT(budget.created_at)}`}
        icon={<PencilLine size={15} />}
        actions={
          <>
            {caps.manage ? (
              <Button size="sm" onClick={() => setAsk({ kind: "rename", budget })}>
                Rename
              </Button>
            ) : null}
            {caps.approve ? (
              <Button
                size="sm"
                variant="primary"
                icon={<CheckCircle2 size={12} />}
                disabledTip={dirty ? "Save the lines first" : budget.line_count === 0 ? "Add and save at least one line" : undefined}
                onClick={() => setAsk({ kind: "approve", budget })}
              >
                Approve
              </Button>
            ) : null}
          </>
        }
      >
        {!caps.manage ? <Notice tone="info" style={{ marginBottom: 12 }}>A draft — shown read-only. Editing lines needs finance:manage.</Notice> : null}
        <BudgetEditor budget={budget} canEdit={caps.manage} funds={funds.funds} categories={categories.categories} onSaved={(d) => refresh(d)} onDirtyChange={onDirtyChange} />
      </SectionCard>
    );
  } else {
    body = (
      <>
        <SectionCard title={`${budget.name} — budget vs actual`} subtitle={`Approved by ${budget.approved_by_name ?? "someone"} ${fmtDateTimeEAT(budget.approved_at)} · actuals: succeeded KES gifts to each income line's fund, approved KES expenses in each expense line's category`} icon={<Scale size={15} />}>
          <BudgetActuals budgetId={budget.budget_id} year={budget.year} />
        </SectionCard>
        <SectionCard title="Approved lines" subtitle="Locked — an approved budget cannot change." icon={<Lock size={15} />}>
          <BudgetEditor budget={budget} canEdit={false} funds={funds.funds} categories={categories.categories} onSaved={() => undefined} onDirtyChange={onDirtyChange} />
        </SectionCard>
      </>
    );
  }

  return (
    <FinancePage
      title="Budgets"
      subtitle="The year's plan in KES — income per fund and spending per category, month by month — and, once approved, how the year is tracking against it."
      actions={<YearSelect value={year} years={years} onChange={chooseYear} />}
      hero={
        <KpiStrip>
          <KpiTile label={`${year} budget`} value={summary ? <StatusChip status={summary.status} /> : loadingBudget ? "…" : "None yet"} hint={summary ? `${summary.line_count} ${summary.line_count === 1 ? "line" : "lines"}` : "one budget per year"} />
          <KpiTile label="Income budgeted" tone="good" value={heroValue(summary?.income_total_minor)} loading={loadingBudget} hint="saved lines, KES" />
          <KpiTile label="Spending budgeted" tone="warn" value={heroValue(summary?.expense_total_minor)} loading={loadingBudget} hint="saved lines, KES" />
          <KpiTile
            label="Budgeted surplus"
            value={summary ? <MoneyText amount_minor={summary.income_total_minor - summary.expense_total_minor} currency="KES" /> : "—"}
            loading={loadingBudget}
            hint="income − spending"
          />
        </KpiStrip>
      }
    >
      {dirty ? <Notice tone="warn">Unsaved changes to the lines — save them before approving or leaving this year.</Notice> : null}
      {body}

      <ConfirmDialog
        open={ask !== null}
        title={
          ask?.kind === "start"
            ? `Start the ${year} budget?`
            : ask?.kind === "approve"
              ? `Approve the ${ask.budget.year} budget?`
              : ask?.kind === "rename"
                ? "Rename the budget"
                : "Leave without saving?"
        }
        body={
          ask?.kind === "start" ? (
            `Creates a draft budget for ${year} in KES, named “${year} budget”. Nothing is locked until it is approved.`
          ) : ask?.kind === "approve" ? (
            <>
              Locks the lines — an approved budget cannot be edited. Budgeted income {formatMinor(ask.budget.income_total_minor, "KES")}, spending {formatMinor(ask.budget.expense_total_minor, "KES")} across {ask.budget.line_count}{" "}
              {ask.budget.line_count === 1 ? "line" : "lines"}. From then on this page compares it with what actually came in and went out.
            </>
          ) : ask?.kind === "rename" ? (
            `Currently “${ask.budget.name}”.`
          ) : (
            "The unsaved changes to this budget's lines will be lost."
          )
        }
        reason={ask?.kind === "rename" ? { label: "New name", placeholder: `${ask.budget.year} budget`, min: FINANCE_LIMITS.budgetName.min, max: FINANCE_LIMITS.budgetName.max } : undefined}
        confirmLabel={ask?.kind === "start" ? "Start draft" : ask?.kind === "approve" ? "Approve and lock" : ask?.kind === "rename" ? "Rename" : "Discard changes"}
        tone={ask?.kind === "leave" ? "danger" : "default"}
        errorFallback="That did not go through."
        onConfirm={confirm}
        onCancel={() => setAsk(null)}
      />
    </FinancePage>
  );
}
