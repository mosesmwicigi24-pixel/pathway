// Funds → Opening balance (POST /admin/finance/opening-balances,
// finance:approve): what was already in the bank / cash box when the church
// started using Pathway — a journal kind opening (debit the cash account,
// credit the fund), dated as_of. One per (account, fund, currency); a wrong one
// is reversed from the Ledger and posted again. Idempotent: one key per opening
// of this drawer.
import { useId, useMemo, useState, type ReactElement } from "react";
import { FinanceApi, FINANCE_LIMITS, financeErrorCode, financeErrorMessage, type BooksJournalResult, type FinanceFundRow, type OfficeChannel, type WriteCurrency } from "../../../api/finance";
import { Button, Drawer, FIN, Field, MoneyInput, Notice, inputStyle, selectStyle, textareaStyle, useIdempotencyKey } from "../kit";
import { formatMinor, type ParsedAmount } from "../money";
import { fmtDay } from "../dates";
import { CASH_ACCOUNT_FOR, HOLDING_CHANNELS, accountLabel, backdateBounds, dayError, lengthError } from "./helpers";
import { Explain } from "./ui";

const CURRENCIES: readonly WriteCurrency[] = ["KES", "USD"];

export interface OpeningBalanceDrawerProps {
  /** Active funds. */
  funds: readonly FinanceFundRow[];
  defaultFund?: string | undefined;
  onClose: () => void;
  onPosted: (j: BooksJournalResult) => void;
  now?: Date | undefined;
}

export function OpeningBalanceDrawer({ funds, defaultFund, onClose, onPosted, now }: OpeningBalanceDrawerProps): ReactElement {
  const ids = { channel: useId(), fund: useId(), amount: useId(), date: useId(), memo: useId() };
  const [key] = useIdempotencyKey();
  const clock = useMemo(() => now ?? new Date(), [now]);
  const bounds = useMemo(() => backdateBounds(FINANCE_LIMITS.openingBackdateDays, clock), [clock]);
  const [channel, setChannel] = useState<OfficeChannel>("bank");
  const [fund, setFund] = useState(defaultFund && funds.some((f) => f.code === defaultFund) ? defaultFund : "");
  const [amountText, setAmountText] = useState("");
  const [amount, setAmount] = useState<ParsedAmount | null>(null);
  const [currency, setCurrency] = useState<WriteCurrency>("KES");
  const [asOf, setAsOf] = useState<string>(bounds.max);
  const [memo, setMemo] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountMinor = amount?.ok ? amount.minor : null;
  const errors = {
    fund: fund ? null : "Choose the fund the money belongs to.",
    amount: amountMinor === null ? "Enter the balance." : null,
    date: dayError(asOf, bounds, "balance date"),
    memo: lengthError(memo, FINANCE_LIMITS.memo, "a memo"),
  };
  const valid = Object.values(errors).every((e) => e === null);
  const shown: Partial<typeof errors> = attempted ? errors : {};
  const fundName = funds.find((f) => f.code === fund)?.name ?? null;

  const post = async (): Promise<void> => {
    setAttempted(true);
    if (!valid || busy || amountMinor === null) return;
    setBusy(true);
    setError(null);
    try {
      const j = await FinanceApi.postOpeningBalance({ idempotency_key: key, channel, fund, amount_minor: amountMinor, currency, as_of: asOf, memo: memo.trim() });
      onPosted(j);
    } catch (e) {
      if (financeErrorCode(e) === "INVALID_DATE") setError("The balance date must be today or within the last ten years.");
      else setError(financeErrorMessage(e, "The opening balance was not posted."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      title="Opening balance"
      subtitle="What was already in the bank or cash box when you started using Pathway."
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void post()}>
            {amountMinor !== null ? `Post ${formatMinor(amountMinor, currency)}` : "Post opening balance"}
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 16 }}>
        <Explain>
          Without opening balances every fund starts at zero and the first expenses drive it negative. Post one entry per place the money sits, per fund and currency — e.g. the bank account&apos;s building money,
          then the cash box&apos;s tithe. A wrong opening balance is reversed from the Ledger (Journals) and posted again.
        </Explain>
        <Field label="Where the money sits" htmlFor={ids.channel} required>
          <select id={ids.channel} data-autofocus value={channel} onChange={(e) => setChannel(e.target.value as OfficeChannel)} style={{ ...selectStyle, width: "100%" }}>
            {HOLDING_CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fund" htmlFor={ids.fund} required error={shown.fund} hint="Active funds only.">
          <select id={ids.fund} value={fund} onChange={(e) => setFund(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
            <option value="">Choose a fund…</option>
            {funds.map((f) => (
              <option key={f.code} value={f.code}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Balance" htmlFor={ids.amount} required error={shown.amount && amountText.trim() === "" ? shown.amount : undefined}>
          <MoneyInput
            id={ids.amount}
            value={amountText}
            currency={currency}
            currencies={CURRENCIES}
            onCurrencyChange={(c) => setCurrency(c === "USD" ? "USD" : "KES")}
            max={FINANCE_LIMITS.openingMaxMinor}
            showError={attempted}
            onChange={(text, parsed) => {
              setAmountText(text);
              setAmount(parsed);
            }}
          />
        </Field>
        <Field label="As of" htmlFor={ids.date} required error={shown.date} hint="The day this balance was true (East Africa Time) — usually the day before your first entries.">
          <input id={ids.date} type="date" value={asOf} min={bounds.min} max={bounds.max} onChange={(e) => setAsOf(e.target.value)} style={{ ...inputStyle, width: 190, fontFamily: FIN.mono }} />
        </Field>
        <Field label="Memo" htmlFor={ids.memo} required error={shown.memo} hint={`Where the figure comes from. ${memo.trim().length} / ${FINANCE_LIMITS.memo.max}`}>
          <textarea id={ids.memo} value={memo} maxLength={FINANCE_LIMITS.memo.max} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Bank statement balance at 31 Aug 2026" style={textareaStyle} />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {amountMinor !== null && fundName ? (
          <Explain style={{ borderTop: `1px dashed ${FIN.border}`, paddingTop: 12 }}>
            On <strong style={{ color: FIN.navy }}>Post</strong>: {formatMinor(amountMinor, currency)} is brought into {fundName}, held in {accountLabel(CASH_ACCOUNT_FOR[channel])}, as of {fmtDay(asOf)} (debit{" "}
            {CASH_ACCOUNT_FOR[channel]}, credit fund:{fund}). It is not income — Reports leave opening balances out.
          </Explain>
        ) : null}
      </div>
    </Drawer>
  );
}
