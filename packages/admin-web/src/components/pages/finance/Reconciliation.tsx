// Finance → Reconciliation (/finance/reconciliation) — docs/FINANCE_ERP.md §5.
// Stub: built on the Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinanceReconciliation(): ReactElement {
  return (
    <FinancePage
      title="Reconciliation"
      subtitle="Daily settlement per channel to match against the M-Pesa, bank and card statements, the exceptions that need a person, and the ledger's integrity per currency."
    />
  );
}
