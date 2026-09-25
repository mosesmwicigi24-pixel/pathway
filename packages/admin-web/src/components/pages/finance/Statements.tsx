// Finance → Statements (/finance/statements) — docs/FINANCE_ERP.md §5. Stub:
// built on the Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinanceStatements(): ReactElement {
  return (
    <FinancePage
      title="Statements"
      subtitle="Year-end givers with their totals per currency, and each member's giving statement and Partners statement as PDFs; CSV."
    />
  );
}
