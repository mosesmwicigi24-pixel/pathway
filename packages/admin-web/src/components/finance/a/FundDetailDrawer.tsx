// Funds → one fund: what it holds per currency, what moved through it this
// period and this year, its description, and its latest postings
// (GET /admin/finance/ledger?account=fund:<code>). "Open in Ledger" shows every
// posting; Edit / Transfer / Opening balance appear only with the capability.
import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftRight, BookOpen, Pencil, PiggyBank } from "lucide-react";
import { FinanceApi, type FinanceFundRow, type FinanceLedgerRow } from "../../../api/finance";
import { Button, Drawer, ErrorState, FIN, MoneyText, Skeleton, StatusChip, useFinanceCaps } from "../kit";
import { fmtDateTimeEAT, fmtDay, fmtRange } from "../dates";
import { JOURNAL_KIND_LABELS } from "./helpers";
import { useAsync } from "./hooks";
import { Detail, DetailList, Explain, MoneyLines, miniTd, miniTh } from "./ui";

const RECENT = 15;

/** A posting's owner in words: the receipt and giver, or the journal kind and memo. */
export function postingSource(r: Pick<FinanceLedgerRow, "kind" | "receipt_code" | "member_name" | "journal_kind" | "memo">): string {
  if (r.kind === "journal") {
    const kind = r.journal_kind ? JOURNAL_KIND_LABELS[r.journal_kind] : "Journal";
    return r.memo ? `${kind} — ${r.memo}` : kind;
  }
  return [r.receipt_code, r.member_name].filter(Boolean).join(" · ") || "Gift";
}

export function FundDetailDrawer({
  fund,
  period,
  onClose,
  onEdit,
  onTransfer,
  onOpening,
}: {
  fund: FinanceFundRow;
  period: { from: string; to: string };
  onClose: () => void;
  onEdit: () => void;
  onTransfer: () => void;
  onOpening: () => void;
}): ReactElement {
  const caps = useFinanceCaps();
  const navigate = useNavigate();
  const account = `fund:${fund.code}`;
  const recent = useAsync(() => FinanceApi.ledger({ account, limit: RECENT }), account, { errorFallback: "Could not load the fund's postings." });
  const rows = recent.data?.data ?? [];
  const balances = fund.balances.map((b) => ({ currency: b.currency, amount_minor: b.balance_minor }));

  return (
    <Drawer
      open
      title={fund.name}
      subtitle={
        <span className="inline-flex items-center gap-2">
          <span style={{ fontFamily: FIN.mono }}>{account}</span>
          <StatusChip status={fund.is_active ? "active" : "inactive"} />
        </span>
      }
      onClose={onClose}
      width={660}
      footer={
        <>
          {caps.manage ? (
            <Button icon={<Pencil size={13} />} onClick={onEdit}>
              Edit
            </Button>
          ) : null}
          {caps.approve ? (
            <Button icon={<ArrowLeftRight size={13} />} onClick={onTransfer}>
              Transfer from this fund
            </Button>
          ) : null}
          {caps.approve && fund.is_active ? (
            <Button icon={<PiggyBank size={13} />} onClick={onOpening}>
              Opening balance
            </Button>
          ) : null}
          <Button variant="primary" icon={<BookOpen size={13} />} onClick={() => navigate(`/finance/ledger?account=${encodeURIComponent(account)}`)}>
            Open in Ledger
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 18 }}>
        <div style={{ padding: "14px 16px", borderRadius: 14, background: FIN.surface, border: `1px solid ${FIN.border}` }}>
          <div className="nuru-eyebrow">Balance</div>
          <div style={{ fontFamily: FIN.display, fontSize: 22, color: FIN.navy, marginTop: 4 }}>
            <MoneyLines amounts={balances} align="left" empty="Nothing yet" />
          </div>
          <Explain style={{ marginTop: 6 }}>Everything credited to the fund (gifts, transfers in, opening balances) less everything taken out (approved expenses, transfers out, reversals), all time.</Explain>
        </div>
        <DetailList>
          <Detail label={`Income, ${fmtRange(period)}`}>
            <MoneyLines align="left" amounts={fund.income.map((i) => ({ currency: i.currency, amount_minor: i.period_minor }))} />
          </Detail>
          <Detail label="Income this year">
            <MoneyLines align="left" amounts={fund.income.map((i) => ({ currency: i.currency, amount_minor: i.ytd_minor }))} />
          </Detail>
          <Detail label="Expenses this year">
            <MoneyLines align="left" amounts={fund.expenses_ytd} />
          </Detail>
          <Detail label="Transfers in / out">
            <span className="inline-flex" style={{ gap: 12, flexWrap: "wrap" }}>
              <MoneyLines align="left" amounts={fund.transfers_in_ytd} />
              <span style={{ color: FIN.muted }}>/</span>
              <MoneyLines align="left" amounts={fund.transfers_out_ytd.map((t) => ({ currency: t.currency, amount_minor: -t.amount_minor }))} />
            </span>
          </Detail>
          <Detail label="Last activity">{fund.last_activity_at ? fmtDateTimeEAT(fund.last_activity_at) : "No postings yet"}</Detail>
          {fund.name_sw ? <Detail label="Swahili name">{fund.name_sw}</Detail> : null}
          <Detail label="Sort order">
            <span style={{ fontFamily: FIN.mono }}>{fund.sort}</span>
          </Detail>
          {fund.description ? <Detail label="Description">{fund.description}</Detail> : null}
        </DetailList>
        <div>
          <div className="nuru-section-title">Latest postings</div>
          <Explain style={{ marginBottom: 10 }}>The {RECENT} most recent, by the date they count on. Credits are money in; debits money out.</Explain>
          {recent.error ? (
            <ErrorState message={recent.error} onRetry={recent.reload} />
          ) : recent.loading && rows.length === 0 ? (
            <div style={{ display: "grid", gap: 8 }}>
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          ) : rows.length === 0 ? (
            <div style={{ fontSize: 13, color: FIN.muted }}>No postings on {account} yet.</div>
          ) : (
            <div className="r-table-scroll" style={{ overflowX: "auto", border: `1px solid ${FIN.border}`, borderRadius: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }} aria-label="Latest postings">
                <thead>
                  <tr style={{ background: FIN.surface }}>
                    <th style={{ ...miniTh, textAlign: "left" }}>Posted on</th>
                    <th style={{ ...miniTh, textAlign: "left" }}>Source</th>
                    <th style={{ ...miniTh, textAlign: "right" }}>Debit</th>
                    <th style={{ ...miniTh, textAlign: "right" }}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.entry_id} style={{ borderTop: `1px solid ${FIN.border}` }}>
                      <td style={{ ...miniTd, fontFamily: FIN.mono, whiteSpace: "nowrap" }}>{fmtDay(r.posted_on)}</td>
                      <td style={{ ...miniTd, maxWidth: 260 }}>{postingSource(r)}</td>
                      <td style={{ ...miniTd, textAlign: "right" }}>{r.side === "debit" ? <MoneyText amount_minor={r.amount_minor} currency={r.currency} /> : ""}</td>
                      <td style={{ ...miniTd, textAlign: "right" }}>{r.side === "credit" ? <MoneyText amount_minor={r.amount_minor} currency={r.currency} /> : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
