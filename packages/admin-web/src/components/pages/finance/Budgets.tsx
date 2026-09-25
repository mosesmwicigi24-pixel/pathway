// Finance → Budgets (/finance/budgets) — docs/FINANCE_ERP.md §5. Stub: built on
// the Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinanceBudgets(): ReactElement {
  return (
    <FinancePage
      title="Budgets"
      subtitle="The year's budget in KES — twelve-month income and expense lines, approval, and budget against actual with the variance month by month."
    />
  );
}
