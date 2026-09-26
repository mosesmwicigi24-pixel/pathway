// Funds → Transfer between funds (POST /admin/finance/transfers,
// finance:approve): a journal kind transfer — debit fund:<from>, credit
// fund:<to> — dated occurred_on. The from-fund may not go below zero in that
// currency unless the person says so: the books answer 422 with details.reason
// NEGATIVE_BALANCE, the drawer shows the balance and offers "Post anyway",
// which asks once more and resends with allow_negative: true (same key).
import { useId, useMemo, useState, type ReactElement } from "react";
import { ArrowRight } from "lucide-react";
import { FinanceApi, FINANCE_LIMITS, financeErrorCode, financeErrorMessage, type BooksTransfer, type FinanceFundRow, type WriteCurrency } from "../../../api/finance";
import { Button, ConfirmDialog, Drawer, FIN, Field, MoneyInput, MoneyText, Notice, inputStyle, selectStyle, textareaStyle, useIdempotencyKey } from "../kit";
import { formatMinor, type ParsedAmount } from "../money";
import { fmtDay } from "../dates";
import { backdateBounds, dayError, lengthError, negativeBalance } from "./helpers";
import { Explain } from "./ui";

const CURRENCIES: readonly WriteCurrency[] = ["KES", "USD"];

export interface TransferDrawerProps {
  /** Every fund (a retired fund can still be emptied); `to` offers active ones only. */
  funds: readonly FinanceFundRow[];
  defaultFrom?: string | undefined;
  onClose: () => void;
  onPosted: (t: BooksTransfer) => void;
  now?: Date | undefined;
}

export function TransferDrawer({ funds, defaultFrom, onClose, onPosted, now }: TransferDrawerProps): ReactElement {
  const ids = { from: useId(), to: useId(), amount: useId(), date: useId(), memo: useId() };
  const [key] = useIdempotencyKey();
  const clock = useMemo(() => now ?? new Date(), [now]);
  const bounds = useMemo(() => backdateBounds(FINANCE_LIMITS.backdateDays, clock), [clock]);
  const [from, setFrom] = useState(defaultFrom ?? "");
  const [to, setTo] = useState("");
  const [amountText, setAmountText] = useState("");
  const [amount, setAmount] = useState<ParsedAmount | null>(null);
  const [currency, setCurrency] = useState<WriteCurrency>("KES");
  const [occurredOn, setOccurredOn] = useState<string>(bounds.max);
  const [memo, setMemo] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [negative, setNegative] = useState<{ balance_minor: number | null; balance_after_minor: number | null } | null>(null);
  const [askAnyway, setAskAnyway] = useState(false);

  const fromFund = funds.find((f) => f.code === from) ?? null;
  const toFund = funds.find((f) => f.code === to) ?? null;
  const toOptions = funds.filter((f) => f.is_active && f.code !== from);
  const fromBalance = fromFund ? (fromFund.balances.find((b) => b.currency === currency)?.balance_minor ?? 0) : null;
  const amountMinor = amount?.ok ? amount.minor : null;
  const afterMinor = fromBalance !== null && amountMinor !== null ? fromBalance - amountMinor : null;

  const errors = {
    from: from ? null : "Choose the fund the money leaves.",
    to: !to ? "Choose the fund the money goes to." : to === from ? "Pick two different funds." : null,
    amount: amountMinor === null ? "Enter the amount to move." : null,
    date: dayError(occurredOn, bounds, "date of the transfer"),
    memo: lengthError(memo, FINANCE_LIMITS.memo, "a memo"),
  };
  const valid = Object.values(errors).every((e) => e === null);
  const shown: Partial<typeof errors> = attempted ? errors : {};

  const post = async (allowNegative: boolean): Promise<void> => {
    setAttempted(true);
    if (!valid || busy || amountMinor === null) return;
    setBusy(true);
    setError(null);
    try {
      const t = await FinanceApi.transferFunds({
        from_fund: from,
        to_fund: to,
        amount_minor: amountMinor,
        currency,
        occurred_on: occurredOn,
        memo: memo.trim(),
        idempotency_key: key,
        ...(allowNegative ? { allow_negative: true } : {}),
      });
      onPosted(t);
    } catch (e) {
      const neg = negativeBalance(e);
      if (neg) setNegative(neg);
      else if (financeErrorCode(e) === "INVALID_DATE") setError("The date must be today or within the last 366 days.");
      else setError(financeErrorMessage(e, "The transfer was not posted."));
    } finally {
      setBusy(false);
    }
  };

  const fromName = fromFund?.name ?? "the from-fund";
  const negAfter = negative?.balance_after_minor ?? afterMinor;
  const negBefore = negative?.balance_minor ?? fromBalance;
  return (
    <>
      <Drawer
        open
        title="Transfer between funds"
        subtitle="Moves money from one fund to another inside the books — no cash moves. Posted as a journal on the date you give."
        onClose={onClose}
        width={560}
        footer={
          <>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" busy={busy} disabled={Boolean(negative)} onClick={() => void post(false)}>
              {amountMinor !== null ? `Post ${formatMinor(amountMinor, currency)}` : "Post transfer"}
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", gap: 10, alignItems: "end" }}>
            <Field label="From" htmlFor={ids.from} required error={shown.from}>
              <select
                id={ids.from}
                data-autofocus
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setNegative(null);
                }}
                style={{ ...selectStyle, width: "100%" }}
              >
                <option value="">Choose…</option>
                {funds.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.is_active ? f.name : `${f.name} (inactive)`}
                  </option>
                ))}
              </select>
            </Field>
            <ArrowRight size={16} color="#6B7280" style={{ marginBottom: 10 }} />
            <Field label="To" htmlFor={ids.to} required error={shown.to}>
              <select id={ids.to} value={to} onChange={(e) => setTo(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                <option value="">Choose…</option>
                {toOptions.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Amount" htmlFor={ids.amount} required error={shown.amount && amountText.trim() === "" ? shown.amount : undefined}>
            <MoneyInput
              id={ids.amount}
              value={amountText}
              currency={currency}
              currencies={CURRENCIES}
              onCurrencyChange={(c) => {
                setCurrency(c === "USD" ? "USD" : "KES");
                setNegative(null);
              }}
              showError={attempted}
              onChange={(text, parsed) => {
                setAmountText(text);
                setAmount(parsed);
                setNegative(null);
              }}
            />
          </Field>
          {fromFund ? (
            <div data-testid="from-balance" style={{ fontSize: 12.5, color: FIN.navy, padding: "9px 12px", borderRadius: 10, background: FIN.surface, border: `1px solid ${FIN.border}` }}>
              {fromFund.name} holds <MoneyText amount_minor={fromBalance ?? 0} currency={currency} strong /> in {currency}
              {afterMinor !== null ? (
                <>
                  {" "}
                  — after this transfer: <MoneyText amount_minor={afterMinor} currency={currency} strong />
                </>
              ) : null}
              .{afterMinor !== null && afterMinor < 0 && !negative ? <span style={{ color: FIN.warn }}> That is below zero; the books will ask you to confirm.</span> : null}
            </div>
          ) : null}
          <Field label="Date" htmlFor={ids.date} required error={shown.date} hint="The day the move takes effect in the books (East Africa Time).">
            <input id={ids.date} type="date" value={occurredOn} min={bounds.min} max={bounds.max} onChange={(e) => setOccurredOn(e.target.value)} style={{ ...inputStyle, width: 190, fontFamily: FIN.mono }} />
          </Field>
          <Field label="Memo" htmlFor={ids.memo} required error={shown.memo} hint={`Why the money moves — kept on the journal. ${memo.trim().length} / ${FINANCE_LIMITS.memo.max}`}>
            <textarea id={ids.memo} value={memo} maxLength={FINANCE_LIMITS.memo.max} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Board resolution 14/2026 — seed the Missions fund" style={textareaStyle} />
          </Field>
          {negative ? (
            <Notice
              tone="warn"
              action={
                <span className="flex items-center gap-2">
                  <Button size="sm" onClick={() => setNegative(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setAskAnyway(true)}>
                    Post anyway
                  </Button>
                </span>
              }
            >
              {fromName} has {negBefore !== null ? formatMinor(negBefore, currency) : "too little"} in {currency}; this transfer would leave it at{" "}
              {negAfter !== null ? formatMinor(negAfter, currency) : "below zero"}.
            </Notice>
          ) : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          {amountMinor !== null && fromFund && toFund ? (
            <Explain style={{ borderTop: `1px dashed ${FIN.border}`, paddingTop: 12 }}>
              On <strong style={{ color: FIN.navy }}>Post</strong>: {formatMinor(amountMinor, currency)} leaves {fromFund.name} and arrives in {toFund.name}, dated {fmtDay(occurredOn)} (debit fund:
              {fromFund.code}, credit fund:{toFund.code}). A wrong transfer is corrected by reversing it from the Ledger.
            </Explain>
          ) : null}
        </div>
      </Drawer>
      <ConfirmDialog
        open={askAnyway}
        title="Post the transfer anyway?"
        tone="danger"
        confirmLabel="Post anyway"
        body={`${fromName} will show a negative balance${negAfter !== null ? ` of ${formatMinor(negAfter, currency)}` : ""} until money comes in. The transfer is recorded exactly as entered and can be reversed later from the Ledger.`}
        onCancel={() => setAskAnyway(false)}
        onConfirm={async () => {
          setAskAnyway(false);
          setNegative(null);
          await post(true);
        }}
      />
    </>
  );
}
