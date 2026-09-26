// Finance → Ledger (/finance/ledger) — docs/FINANCE_ERP.md §5. The books
// themselves: Postings (every leg, gift and journal, by the day it counts on;
// CSV), Journals (transfers, opening balances, expenses and their voids,
// reversals — Reverse for transfers and opening balances, finance:approve), and
// the Trial balance with a plain Balanced / Not balanced verdict. The tab is in
// ?tab=; ?journal=<id> opens one journal from any tab (Reconciliation and a
// journal posting link there); ?account= filters Postings (Funds links there).
import { useCallback, useState, type ReactElement } from "react";
import { FinancePage, Tabs, useUrlParam, useUrlTab, type TabDef } from "../../finance/kit";
import { accountLabel } from "../../finance/a/helpers";
import { useFunds } from "../../finance/a/hooks";
import { JournalDrawer, JournalsPanel } from "../../finance/a/Journals";
import { PostingsPanel, TrialBalancePanel } from "../../finance/a/LedgerPanels";

type LedgerTab = "postings" | "journals" | "trial";
const TAB_KEYS: readonly LedgerTab[] = ["postings", "journals", "trial"];
const TABS: readonly TabDef<LedgerTab>[] = [
  { key: "postings", label: "Postings" },
  { key: "journals", label: "Journals" },
  { key: "trial", label: "Trial balance" },
];

export function FinanceLedger(): ReactElement {
  const [tab, setTab] = useUrlTab(TAB_KEYS, "postings");
  const [journal, setJournal] = useUrlParam("journal");
  const [bump, setBump] = useState(0);
  const funds = useFunds();
  const label = useCallback((account: string) => accountLabel(account, funds.nameOf), [funds.nameOf]);

  return (
    <FinancePage
      title="Ledger"
      subtitle="Double-entry books: every posting has a debit and a credit of the same amount and currency. Cash accounts (cash:…) are where money sits; fund accounts (fund:…) are what it is for. Nothing is deleted — mistakes are reversed."
      tabs={<Tabs tabs={TABS} value={tab} onChange={setTab} ariaLabel="Ledger views" />}
    >
      {tab === "postings" ? <PostingsPanel funds={funds.rows} nameOf={funds.nameOf} onJournal={setJournal} bump={bump} /> : null}
      {tab === "journals" ? <JournalsPanel label={label} bump={bump} onJournal={setJournal} /> : null}
      {tab === "trial" ? <TrialBalancePanel nameOf={funds.nameOf} /> : null}
      {journal ? <JournalDrawer journalId={journal} label={label} onClose={() => setJournal("")} onChanged={() => setBump((b) => b + 1)} /> : null}
    </FinancePage>
  );
}
