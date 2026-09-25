// Finance → Pledges (/finance/pledges) — docs/FINANCE_ERP.md §5. Stub: built on
// the Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinancePledges(): ReactElement {
  return (
    <FinancePage
      title="Pledges"
      subtitle="The pledge register from the instalment ledger — standing, instalments kept of due, overdue since, and pledged, paid and remaining per currency; CSV."
    />
  );
}
