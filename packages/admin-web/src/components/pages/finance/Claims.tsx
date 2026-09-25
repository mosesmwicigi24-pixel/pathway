// Finance → Claims (/finance/claims) — docs/FINANCE_ERP.md §5. Stub: built on
// the Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinanceClaims(): ReactElement {
  return (
    <FinancePage
      title="Claims"
      subtitle="“I paid another way” claims waiting for the office — confirm one to record the gift and send the receipt, or reject it and the member is told."
    />
  );
}
