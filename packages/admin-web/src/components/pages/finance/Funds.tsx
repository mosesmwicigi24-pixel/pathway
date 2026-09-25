// Finance → Funds (/finance/funds) — docs/FINANCE_ERP.md §5. Stub: built on the
// Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinanceFunds(): ReactElement {
  return (
    <FinancePage
      title="Funds"
      subtitle="Every fund's balance per currency and its activity this year — create, rename or deactivate a fund, transfer between funds, and post an opening balance brought in from before the system."
    />
  );
}
