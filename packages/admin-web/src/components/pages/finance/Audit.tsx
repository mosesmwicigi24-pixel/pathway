// Finance → Audit (/finance/audit) — docs/FINANCE_ERP.md §5. Stub: built on the
// Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinanceAudit(): ReactElement {
  return (
    <FinancePage
      title="Audit"
      subtitle="The finance audit trail — who did what to the money and when; filter by action, person and date."
    />
  );
}
