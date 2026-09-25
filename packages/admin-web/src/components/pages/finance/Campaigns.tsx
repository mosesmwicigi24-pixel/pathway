// Finance → Campaigns (/finance/campaigns) — docs/FINANCE_ERP.md §5. Stub: built
// on the Finance kit (components/finance/kit.tsx) and api/finance.ts.
import type { ReactElement } from "react";
import { FinancePage } from "../../finance/kit";

export function FinanceCampaigns(): ReactElement {
  return (
    <FinancePage
      title="Campaigns"
      subtitle="Giving campaigns — create and edit drafts, put one live, end it; money raised against the goal, and how far each invitation actually reached."
    />
  );
}
