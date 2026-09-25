// Finance → Recurring gifts (/finance/recurring) — docs/FINANCE_ERP.md §5.
// Stub: built on the Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinanceRecurring(): ReactElement {
  return (
    <FinancePage
      title="Recurring gifts"
      subtitle="Recurring gifts and how their collections are going — the ones needing attention first, failures and last errors, next run, and the monthly run-rate per currency."
    />
  );
}
