// Transactions → one transaction (GET /admin/finance/transactions/:id): every
// field the office needs — who gave, where it went, how it came in, who
// recorded it — the reversal (if any), and every ledger leg it owns. Reverse is
// offered only for office gifts and confirmed claims (provider manual,
// succeeded) and only to finance:manage; the consequence is stated first.
import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, RotateCcw, Undo2 } from "lucide-react";
import { FinanceApi, FINANCE_LIMITS, type FinanceLedgerLeg, type FinanceTransactionDetail } from "../../../api/finance";
import {
  Button,
  ConfirmDialog,
  Drawer,
  ErrorState,
  FIN,
  MoneyText,
  Notice,
  Skeleton,
  StatusChip,
  channelLabel,
  useFinanceCaps,
  useFinanceToast,
} from "../kit";
import { formatMinor, sortTotals } from "../money";
import { fmtDateEAT, fmtDateTimeEAT } from "../dates";
import { accountLabel, giftReversalConsequence, giftReversible } from "./helpers";
import { useAsync } from "./hooks";

type Tx = FinanceTransactionDetail["transaction"];

export const SOURCE_LABELS: Readonly<Record<string, string>> = { app: "Member app", website: "Website", admin: "Office" };

/** Where an office row / a confirmed claim / a provider payment came from, in words. */
export function channelText(t: Pick<Tx, "channel" | "office_channel" | "source" | "provider">): string {
  if (t.office_channel) return `${channelLabel(t.office_channel)} — recorded by the office`;
  if (t.provider === "manual") return "Paid another way — a confirmed claim";
  return channelLabel(t.channel);
}

export const memberHref = (userId: string): string => `/member-profile?id=${encodeURIComponent(userId)}`;
/** The Partners page opens a partner's drawer from ?partner=<user_id> (Partners.tsx). */
export const partnerHref = (userId: string): string => `/finance/partners?member=${encodeURIComponent(userId)}`;
export const needHref = (needId: string): string => `/finance/needs?need=${encodeURIComponent(needId)}`;

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <>
      <dt style={{ fontSize: 11, fontWeight: 700, color: FIN.muted, textTransform: "uppercase", letterSpacing: 0.6, paddingTop: 2 }}>{label}</dt>
      <dd style={{ fontSize: 13, color: FIN.navy, margin: 0, minWidth: 0, overflowWrap: "anywhere" }}>{children}</dd>
    </>
  );
}

function Legs({ legs, fundName }: { legs: FinanceLedgerLeg[]; fundName: (code: string) => string | null }): ReactElement {
  const th = { fontSize: 10.5, fontWeight: 700, color: FIN.muted, textTransform: "uppercase" as const, letterSpacing: 0.6, padding: "8px 10px", whiteSpace: "nowrap" as const };
  const td = { padding: "8px 10px", fontSize: 12.5, color: FIN.navy };
  const byCurrency = new Map<string, { debit: number; credit: number }>();
  for (const l of legs) {
    const t = byCurrency.get(l.currency) ?? { debit: 0, credit: 0 };
    if (l.side === "debit") t.debit += l.amount_minor;
    else t.credit += l.amount_minor;
    byCurrency.set(l.currency, t);
  }
  const totals = sortTotals([...byCurrency.entries()].map(([currency, t]) => ({ currency, ...t })));
  if (legs.length === 0) {
    return <Notice tone="warn">This transaction owns no ledger postings — no fund shows its money. If it succeeded, Reconciliation lists it; tell the developer.</Notice>;
  }
  return (
    <div className="r-table-scroll" style={{ overflowX: "auto", border: `1px solid ${FIN.border}`, borderRadius: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }} aria-label="Ledger postings">
        <thead>
          <tr style={{ background: FIN.surface }}>
            <th style={{ ...th, textAlign: "left" }}>Account</th>
            <th style={{ ...th, textAlign: "right" }}>Debit</th>
            <th style={{ ...th, textAlign: "right" }}>Credit</th>
            <th style={{ ...th, textAlign: "left" }}>Dated</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((l) => (
            <tr key={l.entry_id} style={{ borderTop: `1px solid ${FIN.border}`, background: l.is_reversal ? "#FBF7FF" : undefined }}>
              <td style={td}>
                <span style={{ fontWeight: 600 }}>{accountLabel(l.account, fundName)}</span>{" "}
                <span style={{ fontFamily: FIN.mono, fontSize: 11, color: FIN.muted }}>{l.account}</span>
                {l.is_reversal ? (
                  <span style={{ marginLeft: 6 }}>
                    <StatusChip status="refunded" label="Reversal" />
                  </span>
                ) : null}
              </td>
              <td style={{ ...td, textAlign: "right" }}>{l.side === "debit" ? <MoneyText amount_minor={l.amount_minor} currency={l.currency} /> : ""}</td>
              <td style={{ ...td, textAlign: "right" }}>{l.side === "credit" ? <MoneyText amount_minor={l.amount_minor} currency={l.currency} /> : ""}</td>
              <td style={{ ...td, fontFamily: FIN.mono, fontSize: 12, whiteSpace: "nowrap" }}>{fmtDateEAT(l.created_at)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {totals.map((t) => (
            <tr key={t.currency} style={{ borderTop: `2px solid ${FIN.border}`, background: FIN.surface }}>
              <td style={{ ...td, fontWeight: 700 }}>
                {t.debit === t.credit ? (
                  <span style={{ color: FIN.good }}>Balanced ✓</span>
                ) : (
                  <span style={{ color: FIN.danger }}>Not balanced — tell the developer</span>
                )}
              </td>
              <td style={{ ...td, textAlign: "right" }}>
                <MoneyText amount_minor={t.debit} currency={t.currency} strong />
              </td>
              <td style={{ ...td, textAlign: "right" }}>
                <MoneyText amount_minor={t.credit} currency={t.currency} strong />
              </td>
              <td style={td} />
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}

function linkStyle(): CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: FIN.navy, textDecoration: "none", border: `1px solid ${FIN.border}`, borderRadius: 8, padding: "5px 10px", background: FIN.card };
}

function Body({ tx, legs }: { tx: Tx; legs: FinanceLedgerLeg[] }): ReactElement {
  const reversed = Boolean(tx.reversed_at);
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
        <StatusChip status={tx.status} label={reversed ? "Reversed" : undefined} />
        {tx.receipt_code ? <span style={{ fontFamily: FIN.mono, fontSize: 13, fontWeight: 600, color: FIN.navy }}>{tx.receipt_code}</span> : null}
        <span style={{ fontSize: 12, color: FIN.muted }}>{SOURCE_LABELS[tx.source] ?? tx.source}</span>
      </div>

      {reversed ? (
        <div style={{ border: "1px solid #E4D4FB", background: "#FBF7FF", borderRadius: 12, padding: "12px 14px" }}>
          <div className="flex items-center gap-2" style={{ fontSize: 13, fontWeight: 700, color: "#6D28D9" }}>
            <Undo2 size={14} /> Reversed {fmtDateTimeEAT(tx.reversed_at)}
            {tx.reversed_by_name ? ` by ${tx.reversed_by_name}` : ""}
          </div>
          {tx.reversal_reason ? <div style={{ fontSize: 13, color: FIN.navy, marginTop: 6 }}>“{tx.reversal_reason}”</div> : null}
          <div style={{ fontSize: 12, color: FIN.muted, marginTop: 6 }}>
            The mirror postings below take the money back out, dated at the gift&apos;s own day so every period nets to zero. The receipt number stays on this entry.
          </div>
        </div>
      ) : null}

      <dl style={{ display: "grid", gridTemplateColumns: "minmax(110px, 150px) minmax(0, 1fr)", gap: "10px 16px", margin: 0 }}>
        <Row label="Giver">
          <span style={{ fontWeight: 600 }}>{tx.display_name}</span>
          {!tx.user_id ? <span style={{ color: FIN.muted }}> · {tx.giver_name || tx.giver_phone ? "walk-in, no member account" : "anonymous"}</span> : null}
          {tx.member_phone || tx.giver_phone ? <div style={{ fontFamily: FIN.mono, fontSize: 12, color: FIN.muted }}>{tx.member_phone ?? tx.giver_phone}</div> : null}
          {tx.giver_email ? <div style={{ fontSize: 12, color: FIN.muted }}>{tx.giver_email}</div> : null}
        </Row>
        <Row label="Amount">
          <MoneyText amount_minor={tx.amount_minor} currency={tx.currency} strong />
        </Row>
        <Row label="Fund">
          {tx.fund_name ?? tx.fund ?? "— (a media purchase)"}
          {tx.fund ? <span style={{ fontFamily: FIN.mono, fontSize: 11, color: FIN.muted }}> fund:{tx.fund}</span> : null}
        </Row>
        <Row label="Channel">{channelText(tx)}</Row>
        {tx.office_reference ? (
          <Row label={tx.office_channel === "mpesa" ? "M-Pesa code" : tx.office_channel === "cheque" ? "Cheque number" : tx.office_channel === "bank" ? "Bank reference" : "Reference"}>
            <span style={{ fontFamily: FIN.mono }}>{tx.office_reference}</span>
          </Row>
        ) : null}
        {tx.provider_ref ? (
          <Row label="Provider ref">
            <span style={{ fontFamily: FIN.mono, fontSize: 12 }}>{tx.provider_ref}</span>
          </Row>
        ) : null}
        <Row label={tx.source === "admin" ? "Received" : "Started"}>{tx.source === "admin" ? fmtDateEAT(tx.created_at) : fmtDateTimeEAT(tx.created_at)}</Row>
        {tx.settled_at && tx.source !== "admin" ? <Row label="Settled">{fmtDateTimeEAT(tx.settled_at)}</Row> : null}
        {tx.pledge_title ? <Row label="Pledge">{tx.pledge_title}</Row> : null}
        {tx.need_title ? <Row label="Department need">{tx.need_title}</Row> : null}
        {tx.account_name ? <Row label="Note on receipt">{tx.account_name}</Row> : null}
        {tx.recorded_by_name || tx.recorded_by ? <Row label="Recorded by">{tx.recorded_by_name ?? "—"}</Row> : null}
        {tx.schedule_id ? <Row label="Recurring gift">Collected by a recurring schedule</Row> : null}
        {tx.stripe_payment_intent ? (
          <Row label="Stripe">
            <span style={{ fontFamily: FIN.mono, fontSize: 12 }}>{tx.stripe_payment_intent}</span>
          </Row>
        ) : null}
      </dl>

      {tx.user_id || tx.need_id ? (
        <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
          {tx.user_id ? (
            <Link to={memberHref(tx.user_id)} style={linkStyle()}>
              Member profile <ExternalLink size={12} />
            </Link>
          ) : null}
          {tx.user_id ? (
            <Link to={partnerHref(tx.user_id)} style={linkStyle()}>
              Partner record <ExternalLink size={12} />
            </Link>
          ) : null}
          {tx.need_id ? (
            <Link to={needHref(tx.need_id)} style={linkStyle()}>
              Department need <ExternalLink size={12} />
            </Link>
          ) : null}
        </div>
      ) : null}

      <div>
        <div className="nuru-section-title" style={{ marginBottom: 4 }}>
          Ledger postings
        </div>
        <div style={{ fontSize: 12, color: FIN.muted, marginBottom: 10 }}>
          Every posting this transaction owns: the cash account it came into is debited, its fund credited — and, once reversed, the mirror pair.
        </div>
        <Legs legs={legs} fundName={(code) => (code === tx.fund ? tx.fund_name : null)} />
      </div>
    </div>
  );
}

export function TransactionDrawer({ transactionId, onClose, onChanged }: { transactionId: string | null; onClose: () => void; onChanged?: (() => void) | undefined }): ReactElement | null {
  const caps = useFinanceCaps();
  const toast = useFinanceToast();
  const [confirming, setConfirming] = useState(false);
  const detail = useAsync(() => FinanceApi.transaction(transactionId ?? ""), transactionId ?? "", {
    enabled: Boolean(transactionId),
    errorFallback: "Could not load this transaction.",
  });
  if (!transactionId) return null;
  const tx = detail.data?.transaction ?? null;
  const canReverse = Boolean(tx && caps.manage && giftReversible(tx));
  const providerPayment = Boolean(tx && tx.provider !== "manual" && tx.status === "succeeded");

  const reverse = async (reason: string | null): Promise<void> => {
    if (!tx) return;
    await FinanceApi.reverseTransaction(tx.transaction_id, { reason: reason ?? "" });
    setConfirming(false);
    toast(`Reversed — ${formatMinor(tx.amount_minor, tx.currency)} taken back out of ${tx.fund_name ?? tx.fund ?? "its fund"}.`);
    detail.reload();
    onChanged?.();
  };

  return (
    <>
      <Drawer
        open
        title={tx ? formatMinor(tx.amount_minor, tx.currency) : "Transaction"}
        subtitle={tx ? `${tx.display_name} · ${tx.source === "admin" ? fmtDateEAT(tx.created_at) : fmtDateTimeEAT(tx.created_at)}` : undefined}
        onClose={onClose}
        footer={
          <>
            {canReverse ? (
              <Button variant="danger" icon={<RotateCcw size={13} />} onClick={() => setConfirming(true)}>
                Reverse
              </Button>
            ) : null}
            <Button onClick={onClose}>Close</Button>
          </>
        }
      >
        {detail.error ? (
          <ErrorState message={detail.error} onRetry={detail.reload} />
        ) : !tx ? (
          <div style={{ display: "grid", gap: 12 }}>
            <Skeleton width="40%" />
            <Skeleton height={120} />
            <Skeleton height={90} />
          </div>
        ) : (
          <div style={{ opacity: detail.loading ? 0.6 : 1, transition: "opacity 150ms" }}>
            <Body tx={tx} legs={detail.data?.ledger_entries ?? []} />
            {caps.manage && providerPayment ? (
              <div style={{ fontSize: 12, color: FIN.muted, marginTop: 16 }}>
                A {channelLabel(tx.channel)} payment is refunded at the provider, not reversed here — the books follow the provider&apos;s refund.
              </div>
            ) : null}
          </div>
        )}
      </Drawer>
      {tx ? (
        <ConfirmDialog
          open={confirming}
          title="Reverse this gift?"
          tone="danger"
          confirmLabel="Reverse gift"
          body={giftReversalConsequence(tx)}
          reason={{ label: "Reason", placeholder: "e.g. Entered twice — the same envelope", min: FINANCE_LIMITS.reason.min, max: FINANCE_LIMITS.reason.max }}
          errorFallback="The gift was not reversed."
          onConfirm={reverse}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}
