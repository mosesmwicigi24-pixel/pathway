// Finance → Transactions (/finance/transactions) — docs/FINANCE_ERP.md §5.
// Stub: built on the Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinanceTransactions(): ReactElement {
  return (
    <FinancePage
      title="Transactions"
      subtitle="Every gift and payment — filter by date, fund, status, channel, source, pledge or need; totals per currency; CSV; the ledger legs behind each one; record a gift the office received, and reverse a manual entry."
    />
  );
}
