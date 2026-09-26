// Transactions → Record a gift (POST /admin/finance/gifts, finance:manage) —
// money the office received: cash, a bank payment, a cheque, or an M-Pesa
// payment made to the till and recorded by hand. It posts at once (debit the
// cash account, credit the fund) and takes the next gapless office receipt
// number OR-<year>-<5 digits>; mistakes are reversed, never deleted.
//
// Mount it only while open: each opening gets ONE idempotency key (a retry
// after a timeout replays instead of posting twice); "Record another" renews it.
import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { CheckCircle2, ExternalLink, Search, UserRound } from "lucide-react";
import {
  FinanceApi,
  FINANCE_LIMITS,
  financeErrorMessage,
  searchGivers,
  type BooksGiftResult,
  type FinanceFundRow,
  type FinanceGiver,
  type FinanceNeedRow,
  type FinanceTransactionRow,
  type OfficeChannel,
  type WriteCurrency,
} from "../../../api/finance";
import { Button, Drawer, FIN, Field, MoneyInput, MoneyText, Notice, giverDisplayName, inputStyle, selectStyle, useDebounced, useIdempotencyKey } from "../kit";
import { formatMinor, type ParsedAmount } from "../money";
import { fmtDay, todayEAT } from "../dates";
import {
  GIFT_CHANNELS,
  accountLabel,
  addDaysIso,
  backdateBounds,
  buildGiftInput,
  fundDecisionText,
  giftErrorView,
  giftFundDecision,
  normalizeReferenceInput,
  pendingForMember,
  pendingNoticeText,
  plural,
  referenceRule,
  validateGift,
  type GiftErrorView,
  type GiftForm,
  type GiverMode,
} from "./helpers";

const CURRENCIES: readonly WriteCurrency[] = ["KES", "USD"];
const MODES: readonly { key: GiverMode; label: string }[] = [
  { key: "member", label: "Member" },
  { key: "walkin", label: "Walk-in" },
  { key: "anonymous", label: "Anonymous" },
];
const CASH_ACCOUNT: Readonly<Record<OfficeChannel, string>> = { onhand: "cash:onhand", bank: "cash:bank", cheque: "cash:cheque", mpesa: "cash:mpesa", other: "cash:manual" };

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <div className="nuru-eyebrow nuru-eyebrow-gold">{title}</div>
      {children}
    </section>
  );
}

/* ---------- member search ---------- */

function GiverSearch({ onPick, error }: { onPick: (g: FinanceGiver) => void; error?: string | undefined }): ReactElement {
  const inputId = useId();
  const listId = useId();
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 250);
  const [state, setState] = useState<{ rows: FinanceGiver[]; loading: boolean; error: string | null; searched: string }>({ rows: [], loading: false, error: null, searched: "" });
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (q.length < 2) {
      setState({ rows: [], loading: false, error: null, searched: "" });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    searchGivers(q.slice(0, FINANCE_LIMITS.searchMax)).then(
      (rows) => {
        if (!alive) return;
        setState({ rows, loading: false, error: null, searched: q });
        setActive(0);
      },
      (e: unknown) => {
        if (alive) setState({ rows: [], loading: false, error: financeErrorMessage(e, "Could not search members."), searched: q });
      },
    );
    return () => {
      alive = false;
    };
  }, [q]);
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (state.rows.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, state.rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const g = state.rows[active];
      if (g) onPick(g);
    }
  };
  return (
    <Field label="Member" htmlFor={inputId} required error={error} hint="Type at least two letters of a name, a phone number or an email.">
      <div style={{ position: "relative" }}>
        <Search size={14} color="#6B7280" style={{ position: "absolute", left: 10, top: 11, pointerEvents: "none" }} />
        <input
          id={inputId}
          data-autofocus
          type="search"
          role="combobox"
          aria-expanded={state.rows.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search members…"
          style={{ ...inputStyle, paddingLeft: 30 }}
        />
      </div>
      {state.loading ? <div style={{ fontSize: 12, color: FIN.muted }}>Searching…</div> : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {!state.loading && !state.error && state.searched && state.rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: FIN.muted }}>No member matches “{state.searched}”. Record it as a walk-in if they have no account.</div>
      ) : null}
      {state.rows.length > 0 ? (
        <div id={listId} role="listbox" aria-label="Members" style={{ border: `1px solid ${FIN.border}`, borderRadius: 12, overflow: "hidden" }}>
          {state.rows.map((g, i) => (
            <button
              key={g.user_id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(g)}
              className="flex items-center gap-3 w-full text-left"
              style={{ padding: "9px 12px", background: i === active ? "#FDF5E5" : FIN.card, borderTop: i === 0 ? "none" : `1px solid ${FIN.border}`, borderLeft: "none", borderRight: "none", borderBottom: "none", cursor: "pointer" }}
            >
              <UserRound size={15} color="#6B7280" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: FIN.navy }}>{g.full_name}</span>
                <span style={{ display: "block", fontSize: 11.5, color: FIN.muted }}>
                  {[g.phone, g.email, g.congregation_name].filter(Boolean).join(" · ") || "No contact details"}
                </span>
              </span>
              {g.open_pledges.length > 0 ? <span style={{ fontSize: 11, color: FIN.warn, fontWeight: 700, whiteSpace: "nowrap" }}>{plural(g.open_pledges.length, "open pledge")}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </Field>
  );
}

/* ---------- the drawer ---------- */

export interface RecordGiftDrawerProps {
  /** Active funds (the picker offers only these). */
  funds: readonly FinanceFundRow[];
  fundsLoading?: boolean | undefined;
  onClose: () => void;
  /** After every successful recording (reload the register). */
  onRecorded: (r: BooksGiftResult) => void;
  /** Open a transaction's drawer — the new gift ("View", which also closes this
   *  form) or the entry a duplicate names (stacked over the still-filled form). */
  onView: (transactionId: string) => void;
  /** Tests pin the clock; the page leaves it to now. */
  now?: Date | undefined;
}

export function RecordGiftDrawer({ funds, fundsLoading = false, onClose, onRecorded, onView, now }: RecordGiftDrawerProps): ReactElement {
  const ids = { amount: useId(), channel: useId(), reference: useId(), date: useId(), pledge: useId(), need: useId(), fund: useId(), note: useId(), name: useId(), phone: useId() };
  const [key, renewKey] = useIdempotencyKey();
  const clock = useMemo(() => now ?? new Date(), [now]);
  const bounds = useMemo(() => backdateBounds(FINANCE_LIMITS.backdateDays, clock), [clock]);

  const [mode, setMode] = useState<GiverMode>("member");
  const [giver, setGiver] = useState<FinanceGiver | null>(null);
  const [walkinName, setWalkinName] = useState("");
  const [walkinPhone, setWalkinPhone] = useState("");
  const [amountText, setAmountText] = useState("");
  const [amount, setAmount] = useState<ParsedAmount | null>(null);
  const [currency, setCurrency] = useState<WriteCurrency>("KES");
  const [channel, setChannel] = useState<OfficeChannel>("onhand");
  const [reference, setReference] = useState("");
  const [receivedOn, setReceivedOn] = useState<string>(bounds.max);
  const [pledgeId, setPledgeId] = useState("");
  const [needId, setNeedId] = useState("");
  const [fund, setFund] = useState("");
  const [note, setNote] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<GiftErrorView | null>(null);
  const [result, setResult] = useState<BooksGiftResult | null>(null);

  // Approved department needs (a gift can be for one, in its currency).
  const [needs, setNeeds] = useState<FinanceNeedRow[]>([]);
  const [needsError, setNeedsError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    FinanceApi.needs({ status: "approved", limit: 200 }).then(
      (p) => {
        if (alive) setNeeds(p.data);
      },
      (e: unknown) => {
        if (alive) setNeedsError(financeErrorMessage(e, "Could not load the department needs — a gift can still be recorded without one."));
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  // Is one of this member's own payments still in flight? (The office may be
  // about to record the same M-Pesa payment by hand.)
  const [pending, setPending] = useState<FinanceTransactionRow[]>([]);
  const [pendingCheck, setPendingCheck] = useState<"idle" | "checking" | "failed">("idle");
  useEffect(() => {
    if (mode !== "member" || !giver) {
      setPending([]);
      setPendingCheck("idle");
      return;
    }
    let alive = true;
    const today = todayEAT(clock);
    setPendingCheck("checking");
    FinanceApi.transactions({ q: (giver.phone ?? giver.full_name).slice(0, FINANCE_LIMITS.searchMax), from: addDaysIso(today, -2), to: today, limit: 50 }).then(
      (p) => {
        if (!alive) return;
        setPending(pendingForMember(p.data, giver.user_id, clock));
        setPendingCheck("idle");
      },
      () => {
        if (!alive) return;
        setPending([]);
        setPendingCheck("failed");
      },
    );
    return () => {
      alive = false;
    };
  }, [mode, giver, clock]);

  const fundName = (code: string): string | null => funds.find((f) => f.code === code)?.name ?? null;
  const memberPledges = mode === "member" && giver ? giver.open_pledges : [];
  const pledgesHere = memberPledges.filter((p) => p.currency === currency);
  const pledgesElsewhere = memberPledges.filter((p) => p.currency !== currency);
  const pledge = pledgesHere.find((p) => p.pledge_id === pledgeId) ?? null;
  const needsHere = needs.filter((n) => n.currency === currency);
  const need = pledge ? null : (needsHere.find((n) => n.need_id === needId) ?? null);
  const decision = giftFundDecision(pledge, need, fundName);
  const form: GiftForm = {
    mode,
    memberId: giver?.user_id ?? null,
    walkinName,
    walkinPhone,
    amountMinor: amount?.ok ? amount.minor : null,
    currency,
    channel,
    reference,
    receivedOn,
    pledgeId: pledge?.pledge_id ?? "",
    needId: need?.need_id ?? "",
    fund,
    note,
  };
  const errors = validateGift(form, { bounds, fundDecided: decision.by !== null });
  const shown = attempted ? errors : {};
  const ref = referenceRule(channel);
  const bookedFund = decision.name ?? (fund ? fundName(fund) : null);

  const chooseMode = (m: GiverMode): void => {
    setMode(m);
    if (m !== "member") setPledgeId("");
    setFailure(null);
  };
  const chooseChannel = (c: OfficeChannel): void => {
    setChannel(c);
    setReference((r) => normalizeReferenceInput(c, r));
  };
  const chooseCurrency = (c: string): void => {
    const cur = c === "USD" ? "USD" : "KES";
    setCurrency(cur);
    setPledgeId("");
    setNeedId("");
  };

  const submit = async (): Promise<void> => {
    setAttempted(true);
    if (busy || Object.keys(errors).length > 0) return;
    setBusy(true);
    setFailure(null);
    try {
      const r = await FinanceApi.recordGift(buildGiftInput(form, key, decision));
      setResult(r);
      onRecorded(r);
    } catch (e) {
      setFailure(giftErrorView(e));
    } finally {
      setBusy(false);
    }
  };

  /** A fresh form for the next envelope: new key; channel, date, currency and giver mode stay. */
  const another = (): void => {
    renewKey();
    setResult(null);
    setFailure(null);
    setAttempted(false);
    setGiver(null);
    setWalkinName("");
    setWalkinPhone("");
    setAmountText("");
    setAmount(null);
    setReference("");
    setPledgeId("");
    setNeedId("");
    setFund("");
    setNote("");
  };

  if (result) {
    return (
      <Drawer
        open
        title="Gift recorded"
        subtitle="Posted to the books and numbered."
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Close</Button>
            <Button
              icon={<ExternalLink size={13} />}
              onClick={() => {
                onView(result.transaction_id);
                onClose();
              }}
            >
              View
            </Button>
            <Button variant="primary" onClick={another}>
              Record another
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: 16 }}>
          <div className="flex items-center gap-3" style={{ padding: "14px 16px", borderRadius: 14, background: "#E8F6EC", border: "1px solid #BFE3CB" }}>
            <CheckCircle2 size={22} color={FIN.good} />
            <div>
              <div style={{ fontSize: 12, color: FIN.good, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 }}>Office receipt</div>
              <div data-testid="receipt-number" style={{ fontFamily: FIN.mono, fontSize: 22, color: FIN.navy, fontWeight: 600 }}>
                {result.receipt_code ?? "—"}
              </div>
            </div>
          </div>
          {result.reused ? (
            <Notice tone="info">This gift had already been recorded — the same form reached the server twice. Nothing new was posted; this is the entry as it was booked.</Notice>
          ) : null}
          <dl style={{ display: "grid", gridTemplateColumns: "minmax(110px, 150px) minmax(0, 1fr)", gap: "8px 16px", margin: 0, fontSize: 13, color: FIN.navy }}>
            <dt style={{ color: FIN.muted }}>Amount</dt>
            <dd style={{ margin: 0 }}>
              <MoneyText amount_minor={result.amount_minor} currency={result.currency} strong />
            </dd>
            <dt style={{ color: FIN.muted }}>From</dt>
            <dd style={{ margin: 0 }}>{giverDisplayName(result)}</dd>
            <dt style={{ color: FIN.muted }}>Fund</dt>
            <dd style={{ margin: 0 }}>{result.fund?.name ?? "—"}</dd>
            <dt style={{ color: FIN.muted }}>Received</dt>
            <dd style={{ margin: 0 }}>
              {fmtDay(result.received_on)}
              {result.channel ? ` · ${GIFT_CHANNELS.find((c) => c.value === result.channel)?.label ?? result.channel}` : ""}
              {result.reference ? <span style={{ fontFamily: FIN.mono }}> {result.reference}</span> : null}
            </dd>
            {result.pledge ? (
              <>
                <dt style={{ color: FIN.muted }}>Pledge</dt>
                <dd style={{ margin: 0 }}>{result.pledge.title}</dd>
              </>
            ) : null}
            {result.need ? (
              <>
                <dt style={{ color: FIN.muted }}>Department need</dt>
                <dd style={{ margin: 0 }}>{result.need.title}</dd>
              </>
            ) : null}
            {result.note ? (
              <>
                <dt style={{ color: FIN.muted }}>On the receipt</dt>
                <dd style={{ margin: 0 }}>{result.note}</dd>
              </>
            ) : null}
          </dl>
          <div style={{ fontSize: 12.5, color: FIN.muted }}>
            {result.user_id ? "The member's usual giving receipt has been queued. " : ""}A mistake is corrected by reversing this entry — its receipt number is never reused.
          </div>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      open
      title="Record a gift"
      subtitle="Money the office received — cash, bank, cheque, or an M-Pesa payment to the till. It posts at once and takes the next office receipt number."
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {form.amountMinor !== null ? `Record ${formatMinor(form.amountMinor, currency)}` : "Record gift"}
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 22 }}>
        <Section title="Who gave">
          <div role="radiogroup" aria-label="Who gave" className="inline-flex" style={{ border: `1px solid ${FIN.border}`, borderRadius: 10, overflow: "hidden", alignSelf: "start", width: "fit-content" }}>
            {MODES.map((m) => {
              const on = m.key === mode;
              return (
                <button
                  key={m.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => chooseMode(m.key)}
                  style={{ padding: "7px 16px", fontSize: 12.5, fontWeight: 600, border: "none", background: on ? FIN.navy : FIN.card, color: on ? "#fff" : FIN.navy, cursor: "pointer" }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          {mode === "member" ? (
            giver ? (
              <div className="flex items-center gap-3" style={{ padding: "10px 12px", border: `1px solid ${FIN.border}`, borderRadius: 12, background: FIN.surface }}>
                <UserRound size={16} color={FIN.navy} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: FIN.navy }}>{giver.full_name}</div>
                  <div style={{ fontSize: 12, color: FIN.muted }}>{[giver.phone, giver.email, giver.congregation_name].filter(Boolean).join(" · ") || "No contact details"}</div>
                </div>
                <Button size="sm" onClick={() => { setGiver(null); setPledgeId(""); }}>
                  Change
                </Button>
              </div>
            ) : (
              <GiverSearch
                onPick={(g) => {
                  setGiver(g);
                  setPledgeId("");
                }}
                error={shown.giver}
              />
            )
          ) : mode === "walkin" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 12 }}>
              <Field label="Name" htmlFor={ids.name} required error={shown.walkinName}>
                <input id={ids.name} value={walkinName} maxLength={FINANCE_LIMITS.giverName.max} onChange={(e) => setWalkinName(e.target.value)} placeholder="As they gave it" style={inputStyle} />
              </Field>
              <Field label="Phone" htmlFor={ids.phone} error={shown.walkinPhone} hint="Optional — printed nowhere; helps find the gift later.">
                <input id={ids.phone} type="tel" value={walkinPhone} maxLength={FINANCE_LIMITS.giverPhone.max} onChange={(e) => setWalkinPhone(e.target.value)} placeholder="+2547…" style={{ ...inputStyle, fontFamily: FIN.mono }} />
              </Field>
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: FIN.muted }}>A loose offering — no name, no phone. It is in the books and the fund, but on no one&apos;s statement.</div>
          )}
          {mode === "member" && giver && pending.length > 0 ? (
            <Notice
              tone="warn"
              action={
                <a href={`/finance/transactions?tx=${encodeURIComponent(pending[0]?.transaction_id ?? "")}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700, color: "inherit" }}>
                  Open
                </a>
              }
            >
              {pending[0] ? pendingNoticeText(pending[0], clock) : null}
              {pending.length > 1 ? ` (${plural(pending.length - 1, "other")} too.)` : ""}
            </Notice>
          ) : null}
          {mode === "member" && giver && pendingCheck === "failed" ? (
            <div style={{ fontSize: 12, color: FIN.muted }}>Couldn&apos;t check whether one of {giver.full_name}&apos;s payments is still processing — look at Transactions before recording an M-Pesa payment.</div>
          ) : null}
        </Section>

        <Section title="The money">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 12 }}>
            <Field label="Amount" htmlFor={ids.amount} required error={shown.amount && amountText.trim() === "" ? shown.amount : undefined}>
              <MoneyInput
                id={ids.amount}
                value={amountText}
                currency={currency}
                currencies={CURRENCIES}
                onCurrencyChange={chooseCurrency}
                showError={attempted}
                onChange={(text, parsed) => {
                  setAmountText(text);
                  setAmount(parsed);
                }}
              />
            </Field>
            <Field label="Received on" htmlFor={ids.date} required error={shown.receivedOn} hint={`Today or up to ${FINANCE_LIMITS.backdateDays} days back (East Africa Time).`}>
              <input id={ids.date} type="date" value={receivedOn} min={bounds.min} max={bounds.max} onChange={(e) => setReceivedOn(e.target.value)} style={{ ...inputStyle, fontFamily: FIN.mono }} />
            </Field>
            <Field label="Channel" htmlFor={ids.channel} required>
              <select id={ids.channel} value={channel} onChange={(e) => chooseChannel(e.target.value as OfficeChannel)} style={{ ...selectStyle, width: "100%" }}>
                {GIFT_CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={ref.label} htmlFor={ids.reference} required={ref.required} error={shown.reference} hint={ref.hint}>
              <input
                id={ids.reference}
                value={reference}
                maxLength={FINANCE_LIMITS.reference.max}
                autoComplete="off"
                spellCheck={false}
                placeholder={ref.placeholder}
                onChange={(e) => setReference(normalizeReferenceInput(channel, e.target.value))}
                style={{ ...inputStyle, fontFamily: FIN.mono }}
              />
            </Field>
          </div>
        </Section>

        <Section title="Where it goes">
          {mode === "member" && giver ? (
            <Field
              label="Pledge"
              htmlFor={ids.pledge}
              hint={
                pledgesElsewhere.length > 0
                  ? `${plural(pledgesElsewhere.length, "open pledge")} in ${Array.from(new Set(pledgesElsewhere.map((p) => p.currency))).join(", ")} — switch the currency to pay toward ${pledgesElsewhere.length === 1 ? "it" : "them"}.`
                  : pledgesHere.length === 0
                    ? `${giver.full_name} has no open pledge in ${currency}.`
                    : "Optional — the gift then counts toward this pledge's instalments."
              }
            >
              <select id={ids.pledge} value={pledge?.pledge_id ?? ""} onChange={(e) => setPledgeId(e.target.value)} disabled={pledgesHere.length === 0} style={{ ...selectStyle, width: "100%" }}>
                <option value="">No pledge</option>
                {pledgesHere.map((p) => (
                  <option key={p.pledge_id} value={p.pledge_id}>
                    {p.title} —{" "}
                    {p.shape === "monthly" ? `${formatMinor(p.amount_minor, p.currency)} a month` : `target ${formatMinor(p.target_minor, p.currency)}`}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {pledge ? (
            <div style={{ fontSize: 12.5, color: FIN.muted }}>A gift toward a pledge goes where the pledge goes, so no department need is asked for.</div>
          ) : (
            <Field
              label="Department need"
              htmlFor={ids.need}
              hint={
                needsError
                  ? needsError
                  : need && !need.fund_code
                    ? "This department has no fund of its own — the gift goes to the fund you choose below."
                    : needsHere.length === 0
                      ? `No approved need in ${currency}.`
                      : "Optional — counts toward the need's target."
              }
            >
              <select id={ids.need} value={need?.need_id ?? ""} onChange={(e) => setNeedId(e.target.value)} disabled={needsHere.length === 0} style={{ ...selectStyle, width: "100%" }}>
                <option value="">No department need</option>
                {needsHere.map((n) => (
                  <option key={n.need_id} value={n.need_id}>
                    {n.title} · {n.department_name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {decision.by ? (
            <div data-testid="fund-decided" style={{ fontSize: 13, color: FIN.navy, padding: "9px 12px", borderRadius: 10, background: FIN.surface, border: `1px solid ${FIN.border}` }}>
              {fundDecisionText(decision)}
            </div>
          ) : (
            <Field label="Fund" htmlFor={ids.fund} required error={shown.fund} hint={fundsLoading ? "Loading funds…" : "Active funds only."}>
              <select id={ids.fund} value={fund} onChange={(e) => setFund(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                <option value="">Choose a fund…</option>
                {funds.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Note" htmlFor={ids.note} error={shown.note} hint={`Optional — printed on the receipt as the gift's name. ${note.trim().length} / ${FINANCE_LIMITS.note.max}`}>
            <input id={ids.note} value={note} maxLength={FINANCE_LIMITS.note.max} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Thanksgiving — Kamau family" style={inputStyle} />
          </Field>
        </Section>

        {failure ? (
          <Notice
            tone="error"
            action={
              failure.duplicateTransactionId ? (
                <Button size="sm" onClick={() => onView(failure.duplicateTransactionId ?? "")}>
                  Open the existing entry
                </Button>
              ) : undefined
            }
          >
            {failure.message}
          </Notice>
        ) : null}

        {form.amountMinor !== null ? (
          <div style={{ fontSize: 12.5, color: FIN.muted, lineHeight: 1.55, borderTop: `1px dashed ${FIN.border}`, paddingTop: 12 }}>
            On <strong style={{ color: FIN.navy }}>Record</strong>: {formatMinor(form.amountMinor, currency)} from{" "}
            {mode === "member" ? (giver?.full_name ?? "the member") : mode === "walkin" ? walkinName.trim() || "the walk-in giver" : "an anonymous giver"} is posted to{" "}
            {bookedFund ?? "the fund"} as received {fmtDay(receivedOn)} — debit {accountLabel(CASH_ACCOUNT[channel])}, credit the fund — and takes the next office receipt number (OR-
            {receivedOn.slice(0, 4) || "year"}-…). Corrections are reversals, never deletions.
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
