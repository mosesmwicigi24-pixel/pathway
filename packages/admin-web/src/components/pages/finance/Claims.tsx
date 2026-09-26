// Finance → Claims (/finance/claims) — docs/FINANCE_ERP.md §5 "Claims".
// "I paid another way": a member says they paid a pledge outside the app
// (cash at the office, a bank transfer, an M-Pesa payment to the till) and the
// office decides. Confirming records a succeeded manual gift toward the pledge
// — booked to the fund the pledge pays to, posted to the ledger, with a
// receipt — and rejecting tells the member. Both need finance:manage and ask
// first, stating the consequence. The queue is oldest first; a claim decided
// meanwhile by someone else (422) just drops out on reload.
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Ban, BadgeCheck, Check, Clock, Wallet } from "lucide-react";
import type { PartnerPledge } from "../../../api/client";
import { FinanceApi, financeErrorMessage, type PledgeClaimRow } from "../../../api/finance";
import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FIN,
  FinancePage,
  KpiStrip,
  KpiTile,
  MoneyText,
  PerCurrency,
  SectionCard,
  useFinanceCaps,
  useFinanceToast,
  type Column,
} from "../../finance/kit";
import { formatMinor, totalsByCurrency } from "../../finance/money";
import { fmtDateTimeEAT, fmtDay } from "../../finance/dates";
import { useResource } from "../../finance/b/hooks";
import { ageSince, claimConfirmConsequence, claimRejectConsequence } from "../../finance/b/logic";
import { Stacked } from "../../finance/b/ui";

type Decision = { claim: PledgeClaimRow; decision: "confirm" | "reject" };
/** The wire pledge carries `pays_to` (the fund its money is booked to) beyond client.ts's type. */
type PledgeWithPaysTo = PartnerPledge & { pays_to?: { code: string; name: string } | null | undefined };

const isAlreadyDecided = (e: unknown): boolean => axios.isAxiosError(e) && e.response?.status === 422;

export function FinanceClaims(): ReactElement {
  const caps = useFinanceCaps();
  const toast = useFinanceToast();
  const navigate = useNavigate();
  const res = useResource(() => FinanceApi.claims(), "claims", { errorFallback: "Could not load the claims." });
  const claims = res.data ?? [];
  const [decision, setDecision] = useState<Decision | null>(null);
  // The fund a confirmed claim is booked to — the pledge's `pays_to` (the one
  // routing rule every pledge gift follows), read from the partner record
  // BEFORE the dialog opens, so the consequence is stated in full. null = it
  // could not be looked up (the dialog then says "the fund the pledge pays to").
  const [fundName, setFundName] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const askConfirm = async (c: PledgeClaimRow): Promise<void> => {
    setLookingUp(c.claim_id);
    let name: string | null = null;
    try {
      const d = await FinanceApi.partner(c.user_id);
      const p = d.pledges.find((x) => x.pledge_id === c.pledge_id) as PledgeWithPaysTo | undefined;
      name = p?.pays_to?.name ?? p?.fund?.name ?? null;
    } catch {
      name = null;
    }
    if (!alive.current) return;
    setLookingUp(null);
    setFundName(name);
    setDecision({ claim: c, decision: "confirm" });
  };

  const decide = async (): Promise<void> => {
    if (!decision) return;
    const { claim } = decision;
    const amount = formatMinor(claim.amount_minor, claim.currency);
    try {
      if (decision.decision === "confirm") await FinanceApi.confirmClaim(claim.claim_id);
      else await FinanceApi.rejectClaim(claim.claim_id);
    } catch (e) {
      if (isAlreadyDecided(e)) {
        // Someone else decided it first — nothing to retry; the queue catches up.
        setDecision(null);
        toast(financeErrorMessage(e, "That claim was already decided."), "warn");
        res.reload();
        return;
      }
      throw e; // the dialog shows the server's own words and stays open
    }
    setDecision(null);
    toast(decision.decision === "confirm" ? `Recorded ${amount} from ${claim.full_name} — receipt on its way` : `Rejected ${claim.full_name}'s claim of ${amount}`);
    res.reload();
  };

  const totals = totalsByCurrency(claims.map((c) => ({ amount_minor: Number(c.amount_minor), currency: c.currency })));
  const oldest = claims.reduce<string | null>((o, c) => (o === null || c.created_at < o ? c.created_at : o), null);

  const columns: Column<PledgeClaimRow>[] = [
    {
      key: "member",
      header: "Member",
      cell: (c) => (
        <button
          type="button"
          onClick={() => navigate(`/finance/partners?member=${encodeURIComponent(c.user_id)}`)}
          title="Open this partner's record"
          style={{ background: "transparent", border: "none", padding: 0, font: "inherit", color: FIN.navy, fontWeight: 700, cursor: "pointer", textAlign: "left" }}
        >
          {c.full_name}
        </button>
      ),
    },
    { key: "pledge", header: "Pledge", cell: (c) => c.pledge_title },
    { key: "amount", header: "Amount", cell: (c) => <MoneyText amount_minor={c.amount_minor} currency={c.currency} strong />, align: "right" },
    { key: "paid_on", header: <span title="The day the member says they paid.">Paid on</span>, cell: (c) => fmtDay(c.paid_on), mono: true },
    {
      key: "note",
      header: <span title="The member's own words — usually how they paid (cash, a bank reference, an M-Pesa code). Claims carry no separate method or reference field.">Note (how they paid)</span>,
      cell: (c) =>
        c.note ? (
          <span title={c.note} style={{ display: "inline-block", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
            {c.note}
          </span>
        ) : (
          <span style={{ color: FIN.muted }}>—</span>
        ),
    },
    { key: "claimed", header: "Claimed", cell: (c) => <Stacked primary={fmtDateTimeEAT(c.created_at)} secondary={`${ageSince(c.created_at)} waiting`} />, nowrap: true },
    {
      key: "actions",
      header: "Decision",
      align: "right",
      hidden: !caps.manage,
      cell: (c) => (
        <div className="inline-flex" style={{ gap: 6 }}>
          <Button size="sm" variant="primary" icon={<Check size={12} />} busy={lookingUp === c.claim_id} disabled={lookingUp !== null && lookingUp !== c.claim_id} onClick={() => void askConfirm(c)}>
            Confirm
          </Button>
          <Button size="sm" variant="danger" icon={<Ban size={12} />} disabled={lookingUp !== null} onClick={() => setDecision({ claim: c, decision: "reject" })}>
            Reject
          </Button>
        </div>
      ),
    },
  ];

  return (
    <FinancePage
      title="Claims"
      subtitle="“I paid another way” — members who paid a pledge outside the app. Confirming records the gift toward their pledge (ledger + receipt); rejecting tells them the office could not confirm it."
      hero={
        <KpiStrip>
          <KpiTile label="Waiting" icon={<BadgeCheck size={12} />} value={res.loading && !res.data ? "…" : claims.length.toLocaleString()} tone={claims.length > 0 ? "warn" : "default"} hint="claims to decide" />
          <KpiTile label="Amount claimed" icon={<Wallet size={12} />} value={<PerCurrency amounts={totals} />} loading={res.loading && !res.data} hint="per currency — never added" />
          <KpiTile label="Oldest" icon={<Clock size={12} />} value={oldest ? ageSince(oldest) : "—"} loading={res.loading && !res.data} hint={oldest ? `claimed ${fmtDateTimeEAT(oldest)}` : "nothing waiting"} />
        </KpiStrip>
      }
    >
      <SectionCard
        title="Claims to decide"
        subtitle={caps.manage ? "Oldest first. Check the note against the bank statement, till or cash book before confirming." : "Oldest first. Deciding a claim needs finance:manage."}
        flush
      >
        {!res.error && !res.loading && claims.length === 0 ? (
          <EmptyState title="No claims waiting" icon={<BadgeCheck size={22} />}>
            When a member pays a pledge outside the app — cash at the office, a bank transfer, an M-Pesa payment to the till — they can say so from their pledge (“I paid another way”). The claim waits here until the office checks it: confirming records it as a gift toward the pledge with a receipt; rejecting tells them it could not be confirmed.
          </EmptyState>
        ) : (
          <DataTable
            ariaLabel="Claims"
            columns={columns}
            rows={claims}
            rowKey={(c) => c.claim_id}
            loading={res.loading}
            error={res.error}
            onRetry={res.reload}
            minWidth={980}
          />
        )}
      </SectionCard>

      <ConfirmDialog
        open={decision !== null}
        title={decision?.decision === "confirm" ? "Confirm this claim?" : "Reject this claim?"}
        body={
          decision ? (
            decision.decision === "confirm" ? (
              claimConfirmConsequence(decision.claim, fundName)
            ) : (
              claimRejectConsequence(decision.claim)
            )
          ) : null
        }
        confirmLabel={decision?.decision === "confirm" ? `Confirm ${decision ? formatMinor(decision.claim.amount_minor, decision.claim.currency) : ""}` : "Reject claim"}
        tone={decision?.decision === "reject" ? "danger" : "default"}
        errorFallback={decision?.decision === "confirm" ? "Could not confirm the claim." : "Could not reject the claim."}
        onConfirm={decide}
        onCancel={() => setDecision(null)}
      />
    </FinancePage>
  );
}
