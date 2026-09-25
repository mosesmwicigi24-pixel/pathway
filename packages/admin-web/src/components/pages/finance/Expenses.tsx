// Finance → Expenses (/finance/expenses) — docs/FINANCE_ERP.md §5. Stub: built
// on the Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinanceExpenses(): ReactElement {
  return (
    <FinancePage
      title="Expenses"
      subtitle="What the church spent — record an expense, have a different person approve it before it posts, void a mistake; totals per currency; CSV."
    />
  );
}
