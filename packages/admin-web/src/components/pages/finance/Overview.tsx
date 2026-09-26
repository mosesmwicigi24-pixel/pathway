// Finance → Overview (/finance) — docs/FINANCE_ERP.md §5. Stub: built on the
// Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinanceOverview(): ReactElement {
  return (
    <FinancePage
      title="Overview"
      subtitle="Income, expenses and net per currency for the period, outstanding pledges and partners behind, twelve months of income against expenses, fund balances, and alerts that open the queue behind each number."
    />
  );
}
