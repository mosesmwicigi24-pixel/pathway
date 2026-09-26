// Ledger → Journals (GET /admin/finance/journals): postings that are not
// giving transactions — expenses and their voids, fund transfers, opening
// balances, and reversals. Each row expands to its legs; ?journal=<id> opens
// one in a drawer (Reconciliation links here). Reverse (finance:approve) is
// for transfers and opening balances only, once; the consequence is stated
// first, and a reversal that would take a fund below zero asks again before
// resending with allow_negative.
import { Fragment, useState, type ReactElement } from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { FinanceApi, FINANCE_LIMITS, type BooksJournal, type JournalKind } from "../../../api/finance";
import {
  Button,
  ConfirmDialog,
  Drawer,
  EmptyState,
  ErrorState,
  FIN,
  FilterBar,
  MoneyText,
  Skeleton,
  StatusChip,
  TotalsStrip,
  useFinanceCaps,
  useFinanceToast,
  usePagedList,
  useUrlParam,
  type FilterOption,
} from "../kit";
import { formatMinor } from "../money";
import { fmtDateTimeEAT, fmtDay } from "../dates";
import { JOURNAL_KIND_LABELS, journalReversalConsequence, journalReversibility, negativeBalance } from "./helpers";
import { useAsync, usePatchParams, usePeriodParam } from "./hooks";
import { Explain, miniTd, miniTh } from "./ui";

const KINDS: readonly FilterOption[] = [
  { value: "", label: "All" },
  { value: "transfer", label: "Transfers" },
  { value: "opening", label: "Opening balances" },
  { value: "expense", label: "Expenses" },
  { value: "expense_void", label: "Expense voids" },
  { value: "reversal", label: "Reversals" },
];

const KIND_TONE: Readonly<Record<JournalKind, { bg: string; color: string }>> = {
  transfer: { bg: "#E6EDF5", color: "#1E4068" },
  opening: { bg: "#E2F4F1", color: "#0D7E73" },
  expense: { bg: "#FFF4DA", color: "#A87616" },
  expense_void: { bg: "#EEF0F3", color: "#6B7280" },
  reversal: { bg: "#F3EAFE", color: "#7C3AED" },
};

function KindChip({ kind }: { kind: JournalKind }): ReactElement {
  const t = KIND_TONE[kind];
  return <span style={{ background: t.bg, color: t.color, padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{JOURNAL_KIND_LABELS[kind]}</span>;
}

/** The legs of one journal, debit first. */
export function JournalLegs({ journal, label }: { journal: BooksJournal; label: (account: string) => string }): ReactElement {
  return (
    <div className="r-table-scroll" style={{ overflowX: "auto", border: `1px solid ${FIN.border}`, borderRadius: 10, background: FIN.card }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 440 }} aria-label="Journal legs">
        <thead>
          <tr style={{ background: FIN.surface }}>
            <th style={{ ...miniTh, textAlign: "left" }}>Account</th>
            <th style={{ ...miniTh, textAlign: "right" }}>Debit</th>
            <th style={{ ...miniTh, textAlign: "right" }}>Credit</th>
            <th style={{ ...miniTh, textAlign: "left" }}>Dated</th>
          </tr>
        </thead>
        <tbody>
          {journal.legs.map((l) => (
            <tr key={l.entry_id} style={{ borderTop: `1px solid ${FIN.border}` }}>
              <td style={miniTd}>
                <span style={{ fontWeight: 600 }}>{label(l.account)}</span> <span style={{ fontFamily: FIN.mono, fontSize: 11, color: FIN.muted }}>{l.account}</span>
              </td>
              <td style={{ ...miniTd, textAlign: "right" }}>{l.side === "debit" ? <MoneyText amount_minor={l.amount_minor} currency={l.currency} /> : ""}</td>
              <td style={{ ...miniTd, textAlign: "right" }}>{l.side === "credit" ? <MoneyText amount_minor={l.amount_minor} currency={l.currency} /> : ""}</td>
              <td style={{ ...miniTd, fontFamily: FIN.mono, whiteSpace: "nowrap" }}>{fmtDateTimeEAT(l.created_at).split(",")[0]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Reverse a transfer / opening journal: reason → (maybe) allow-negative → done. */
export function useJournalReverse(label: (account: string) => string, onDone: () => void): {
  ask: (j: BooksJournal) => void;
  dialogs: ReactElement;
} {
  const toast = useFinanceToast();
  const [target, setTarget] = useState<BooksJournal | null>(null);
  const [negative, setNegative] = useState<{ journal: BooksJournal; reason: string; after: number | null; currency: string | null } | null>(null);
  const run = async (j: BooksJournal, reason: string, allowNegative: boolean): Promise<void> => {
    const r = await FinanceApi.reverseJournal(j.journal_id, allowNegative ? { reason, allow_negative: true } : { reason });
    const money = r.totals.map((t) => formatMinor(t.amount_minor, t.currency)).join(" + ");
    toast(`${JOURNAL_KIND_LABELS[j.kind]} reversed — ${money} posted back.`);
    onDone();
  };
  const dialogs = (
    <>
      <ConfirmDialog
        open={target !== null}
        title={target ? `Reverse this ${JOURNAL_KIND_LABELS[target.kind].toLowerCase()}?` : "Reverse?"}
        tone="danger"
        confirmLabel="Reverse"
        body={target ? journalReversalConsequence(target, label) : null}
        reason={{ label: "Reason", placeholder: "e.g. Posted to the wrong fund", min: FINANCE_LIMITS.reason.min, max: FINANCE_LIMITS.reason.max }}
        errorFallback="The journal was not reversed."
        onCancel={() => setTarget(null)}
        onConfirm={async (reason) => {
          if (!target) return;
          try {
            await run(target, reason ?? "", false);
            setTarget(null);
          } catch (e) {
            const neg = negativeBalance(e);
            if (!neg) throw e;
            setNegative({ journal: target, reason: reason ?? "", after: neg.balance_after_minor, currency: target.totals[0]?.currency ?? null });
            setTarget(null);
          }
        }}
      />
      <ConfirmDialog
        open={negative !== null}
        title="Reverse anyway?"
        tone="danger"
        confirmLabel="Reverse anyway"
        body={
          negative
            ? `Reversing takes the fund it debits below zero${negative.after !== null && negative.currency ? ` — to ${formatMinor(negative.after, negative.currency)}` : ""}. The fund shows a negative balance until money comes in.`
            : null
        }
        errorFallback="The journal was not reversed."
        onCancel={() => setNegative(null)}
        onConfirm={async () => {
          if (!negative) return;
          await run(negative.journal, negative.reason, true);
          setNegative(null);
        }}
      />
    </>
  );
  return { ask: setTarget, dialogs };
}

function JournalMeta({ j }: { j: BooksJournal }): ReactElement {
  return (
    <div className="flex flex-wrap" style={{ gap: "4px 18px", fontSize: 12, color: FIN.muted }}>
      <span>
        Entered {fmtDateTimeEAT(j.created_at)}
        {j.created_by_name ? ` by ${j.created_by_name}` : ""}
      </span>
      <span style={{ fontFamily: FIN.mono }}>journal {j.journal_id.slice(0, 8)}</span>
      {j.reversal_of ? <span>Mirrors journal {j.reversal_of.slice(0, 8)}</span> : null}
      {j.reversed_by_journal_id ? <span>Reversed by journal {j.reversed_by_journal_id.slice(0, 8)}</span> : null}
    </div>
  );
}

/** ?journal=<id> — one journal in a drawer. */
export function JournalDrawer({ journalId, onClose, onChanged, label }: { journalId: string; onClose: () => void; onChanged: () => void; label: (account: string) => string }): ReactElement {
  const caps = useFinanceCaps();
  const one = useAsync(() => FinanceApi.journal(journalId), journalId, { errorFallback: "Could not load this journal." });
  const rev = useJournalReverse(label, () => {
    one.reload();
    onChanged();
  });
  const j = one.data;
  const r = j ? journalReversibility(j) : null;
  return (
    <>
      <Drawer
        open
        title={j ? `${JOURNAL_KIND_LABELS[j.kind]} · ${j.totals.map((t) => formatMinor(t.amount_minor, t.currency)).join(" + ")}` : "Journal"}
        subtitle={j ? `Dated ${fmtDay(j.occurred_on)}` : undefined}
        onClose={onClose}
        footer={
          <>
            {caps.approve && j && r?.ok ? (
              <Button variant="danger" icon={<RotateCcw size={13} />} onClick={() => rev.ask(j)}>
                Reverse
              </Button>
            ) : null}
            <Button onClick={onClose}>Close</Button>
          </>
        }
      >
        {one.error ? (
          <ErrorState message={one.error} onRetry={one.reload} />
        ) : !j ? (
          <Skeleton height={120} />
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
              <KindChip kind={j.kind} />
              {j.reversed_by_journal_id ? <StatusChip status="refunded" label="Reversed" /> : null}
            </div>
            {j.memo ? <div style={{ fontSize: 13.5, color: FIN.navy }}>{j.memo}</div> : null}
            <JournalMeta j={j} />
            <JournalLegs journal={j} label={label} />
            {caps.approve && r && !r.ok ? <Explain>{r.reason}</Explain> : null}
          </div>
        )}
      </Drawer>
      {rev.dialogs}
    </>
  );
}

/** The Journals tab. `bump` changes after a reversal elsewhere (reload);
 *  `onJournal` opens a journal's drawer (the page renders it). */
export function JournalsPanel({ label, bump = 0, onJournal }: { label: (account: string) => string; bump?: number | undefined; onJournal: (id: string) => void }): ReactElement {
  const caps = useFinanceCaps();
  const [period, setPeriod] = usePeriodParam("this_year", "j");
  const [kind, setKind] = useUrlParam("jkind");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const patchParams = usePatchParams();
  const filters = { from: period.from, to: period.to, kind: KINDS.some((k) => k.value === kind && kind) ? (kind as JournalKind) : null };
  const list = usePagedList((cursor) => FinanceApi.journals({ ...filters, cursor }), JSON.stringify({ ...filters, bump }), { errorFallback: "Could not load the journals." });
  const rev = useJournalReverse(label, list.reload);
  const toggle = (id: string): void =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <FilterBar
        period={period}
        onPeriodChange={setPeriod}
        selects={[{ key: "kind", label: "Kind", value: filters.kind ?? "", options: KINDS, onChange: setKind }]}
        clearable={Boolean(kind) || period.preset !== "this_year"}
        onClear={() => patchParams({ jkind: null, jperiod: null, jfrom: null, jto: null })}
      />
      <TotalsStrip totals={list.totals} loading={list.loading} label="Journals" noun={["journal", "journals"]} extra="Amount = the debit side of each journal, by its date" />
      <div className="rounded-2xl" style={{ background: FIN.card, border: `1px solid ${FIN.border}`, overflow: "hidden" }}>
        {list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.loading && list.rows.length === 0 ? (
          <div style={{ padding: 20, display: "grid", gap: 10 }}>
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : list.rows.length === 0 ? (
          <EmptyState title="No journals in this period">Transfers, opening balances, approved expenses and their voids appear here.</EmptyState>
        ) : (
          <div className="r-table-scroll" style={{ overflowX: "auto", opacity: list.loading ? 0.55 : 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }} aria-label="Journals">
              <thead>
                <tr style={{ background: FIN.surface }}>
                  <th style={{ ...miniTh, width: 28 }} aria-label="Expand" />
                  <th style={{ ...miniTh, textAlign: "left" }}>Date</th>
                  <th style={{ ...miniTh, textAlign: "left" }}>Kind</th>
                  <th style={{ ...miniTh, textAlign: "left" }}>Memo</th>
                  <th style={{ ...miniTh, textAlign: "right" }}>Amount</th>
                  <th style={{ ...miniTh, textAlign: "left" }}>Entered</th>
                  <th style={{ ...miniTh, textAlign: "left" }}>State</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((j) => {
                  const expanded = open.has(j.journal_id);
                  const r = journalReversibility(j);
                  return (
                    <Fragment key={j.journal_id}>
                      <tr
                        onClick={() => toggle(j.journal_id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggle(j.journal_id);
                          }
                        }}
                        tabIndex={0}
                        aria-expanded={expanded}
                        className="cursor-pointer transition-colors hover:bg-[var(--input-background)]"
                        style={{ borderTop: `1px solid ${FIN.border}`, background: expanded ? "#FDF5E5" : undefined }}
                      >
                        <td style={{ ...miniTd, color: FIN.muted }}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td style={{ ...miniTd, fontFamily: FIN.mono, whiteSpace: "nowrap" }}>{fmtDay(j.occurred_on)}</td>
                        <td style={miniTd}>
                          <KindChip kind={j.kind} />
                        </td>
                        <td style={{ ...miniTd, maxWidth: 320 }}>{j.memo ?? <span style={{ color: FIN.muted }}>—</span>}</td>
                        <td style={{ ...miniTd, textAlign: "right" }}>
                          {j.totals.map((t) => (
                            <div key={t.currency}>
                              <MoneyText amount_minor={t.amount_minor} currency={t.currency} strong />
                            </div>
                          ))}
                        </td>
                        <td style={{ ...miniTd, fontSize: 12, color: FIN.muted, whiteSpace: "nowrap" }}>
                          {fmtDateTimeEAT(j.created_at)}
                          {j.created_by_name ? <div>{j.created_by_name}</div> : null}
                        </td>
                        <td style={miniTd}>
                          <span className="inline-flex flex-wrap" style={{ gap: 4 }}>
                            {j.reversed_by_journal_id ? <StatusChip status="refunded" label="Reversed" /> : null}
                            {j.reversal_of ? <span style={{ color: FIN.muted, fontSize: 12 }}>Mirrors journal {j.reversal_of.slice(0, 8)}</span> : null}
                            {!j.reversed_by_journal_id && !j.reversal_of ? <span style={{ color: FIN.muted, fontSize: 12 }}>Posted</span> : null}
                          </span>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr style={{ background: "#FFFBF2" }}>
                          <td />
                          <td colSpan={6} style={{ padding: "10px 16px 16px" }}>
                            <div style={{ display: "grid", gap: 10 }}>
                              <JournalMeta j={j} />
                              <JournalLegs journal={j} label={label} />
                              <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
                                {caps.approve && r.ok ? (
                                  <Button size="sm" variant="danger" icon={<RotateCcw size={12} />} onClick={() => rev.ask(j)}>
                                    Reverse {JOURNAL_KIND_LABELS[j.kind].toLowerCase()}
                                  </Button>
                                ) : null}
                                {caps.approve && !r.ok ? <span style={{ fontSize: 12, color: FIN.muted }}>{r.reason}</span> : null}
                                {j.reversal_of ? (
                                  <Button size="sm" onClick={() => onJournal(j.reversal_of ?? "")}>
                                    Open the original
                                  </Button>
                                ) : null}
                                {j.reversed_by_journal_id ? (
                                  <Button size="sm" onClick={() => onJournal(j.reversed_by_journal_id ?? "")}>
                                    Open its reversal
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!list.error && (list.hasMore || list.moreError) ? (
          <div className="flex items-center justify-center flex-wrap" style={{ gap: 10, padding: 12, borderTop: `1px solid ${FIN.border}` }}>
            {list.moreError ? (
              <span role="alert" style={{ fontSize: 12, color: FIN.danger, fontWeight: 600 }}>
                {list.moreError}
              </span>
            ) : null}
            <Button onClick={list.loadMore} busy={list.loadingMore} disabled={list.loading}>
              {list.moreError ? "Try again" : "Load more"}
            </Button>
          </div>
        ) : null}
      </div>
      {rev.dialogs}
    </>
  );
}

