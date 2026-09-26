// Finance → Ledger (/finance/ledger) — docs/FINANCE_ERP.md §5. Stub: built on
// the Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinanceLedger(): ReactElement {
  return (
    <FinancePage
      title="Ledger"
      subtitle="The books themselves — Postings (every debit and credit), Journals (expenses, transfers, opening balances; reverse a transfer or an opening balance) and the Trial balance; CSV."
    />
  );
}
