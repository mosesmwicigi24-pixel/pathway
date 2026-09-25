// Finance → Reports (/finance/reports) — docs/FINANCE_ERP.md §5. Stub: built on
// the Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinanceReports(): ReactElement {
  return (
    <FinancePage
      title="Reports"
      subtitle="Income by fund, channel or source; expenses by category or fund; pledges month by month; and the two statements — Income & expenditure for a period and Financial position as of a date; CSV."
    />
  );
}
