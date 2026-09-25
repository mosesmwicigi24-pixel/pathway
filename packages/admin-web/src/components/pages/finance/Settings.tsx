// Finance → Settings (/finance/settings) — docs/FINANCE_ERP.md §5. Stub: built
// on the Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinanceSettings(): ReactElement {
  return (
    <FinancePage
      title="Settings"
      subtitle="Expense categories, which payment providers are configured, the next office receipt number, the giving tiers, and what each finance capability lets a person do."
    />
  );
}
