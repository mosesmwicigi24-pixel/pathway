// Finance → Department needs (/finance/needs) — docs/FINANCE_ERP.md §5. Stub:
// built on the Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinanceNeeds(): ReactElement {
  return (
    <FinancePage
      title="Department needs"
      subtitle="Approved and pending department needs — raised against target, gifts, and which fund the money is booked to. Approving a need stays with Departments."
    />
  );
}
