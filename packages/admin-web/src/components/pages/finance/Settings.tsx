// Finance → Settings (/finance/settings) — docs/FINANCE_ERP.md §5–§6.
// - Expense categories (GET/POST/PATCH /admin/finance/expense-categories): add,
//   rename, reorder, activate / deactivate (finance:manage). Codes are
//   permanent slugs; categories are never deleted.
// - Read-only (GET /admin/finance/settings): which payment providers are
//   configured (the env var NAMES they read — never a value), the next office
//   receipt number, the giving tiers and the reminder policy.
// - Who can do what: the four Finance capabilities and what each allows.
import { useId, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Bell, Check, CreditCard, Hash, KeyRound, Pencil, Plus, ShieldCheck, Tags, X } from "lucide-react";
import { FinanceApi, FINANCE_LIMITS, financeErrorCode, financeErrorMessage, type BooksExpenseCategory, type FinanceSettings as Settings } from "../../../api/finance";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FIN,
  Field,
  FinancePage,
  MoneyText,
  Notice,
  SectionCard,
  Skeleton,
  StatusChip,
  inputStyle,
  useFinanceCaps,
  useFinanceToast,
} from "../../finance/kit";
import { codeError, lengthError, plural, reorderPlan, suggestCode } from "../../finance/a/helpers";
import { useAsync } from "../../finance/a/hooks";
import { Explain, miniTd, miniTh } from "../../finance/a/ui";

/** The four Finance capabilities (docs/FINANCE_ERP.md §6), in the words the office uses. */
export const FINANCE_CAPABILITIES: readonly { key: "view" | "export" | "manage" | "approve"; permission: string; allows: string }[] = [
  { key: "view", permission: "finance:view", allows: "See every Finance page — registers, the ledger, reconciliation, reports, statements and this page." },
  { key: "export", permission: "finance:export", allows: "Download the CSV exports of registers and reports." },
  {
    key: "manage",
    permission: "finance:manage",
    allows: "Record and reverse office gifts; create and edit funds and expense categories; record and void expenses; draft budgets; run campaigns; confirm or reject claims; send reminders.",
  },
  {
    key: "approve",
    permission: "finance:approve",
    allows: "Approve expenses (never one they recorded or edited — maker-checker) and budgets; post fund transfers and opening balances; reverse journals.",
  },
];

function Categories(): ReactElement {
  const caps = useFinanceCaps();
  const toast = useFinanceToast();
  const ids = { name: useId(), code: useId() };
  const cats = useAsync(() => FinanceApi.expenseCategories(), "categories", { errorFallback: "Could not load the expense categories." });
  const list = cats.data ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState<{ name: string; code: string; codeTouched: boolean; attempted: boolean } | null>(null);
  const [deactivate, setDeactivate] = useState<BooksExpenseCategory | null>(null);

  const run = async (key: string, work: () => Promise<void>, fallback: string): Promise<boolean> => {
    setBusy(key);
    setError(null);
    try {
      await work();
      return true;
    } catch (e) {
      setError(financeErrorMessage(e, fallback));
      return false;
    } finally {
      setBusy(null);
      cats.reload();
    }
  };

  const move = (index: number, dir: -1 | 1): void => {
    const plan = reorderPlan(list, index, dir);
    if (plan.length === 0) return;
    void run(
      "reorder",
      async () => {
        for (const p of plan) await FinanceApi.updateExpenseCategory(p.category_id, { sort: p.sort });
      },
      "Not all of the new order was saved — the list below is as it stands now; try the move again.",
    );
  };

  const addErrors = adding
    ? { name: lengthError(adding.name, FINANCE_LIMITS.categoryName, "a name"), code: codeError(adding.code) }
    : { name: null, code: null };
  const add = async (): Promise<void> => {
    if (!adding) return;
    setAdding({ ...adding, attempted: true });
    if (addErrors.name || addErrors.code) return;
    const nextSort = list.reduce((m, c) => Math.max(m, c.sort), 0) + 10;
    setBusy("add");
    setError(null);
    try {
      const c = await FinanceApi.createExpenseCategory({ code: adding.code, name: adding.name.trim(), sort: nextSort });
      toast(`Category added — ${c.name} (${c.code}).`);
      setAdding(null);
    } catch (e) {
      setError(financeErrorCode(e) === "CONFLICT" ? `A category with the code “${adding.code}” already exists — codes are permanent, so pick another.` : financeErrorMessage(e, "The category was not added."));
    } finally {
      setBusy(null);
      cats.reload();
    }
  };

  return (
    <SectionCard
      flush
      title="Expense categories"
      icon={<Tags size={15} />}
      subtitle="What money is spent on — used by expenses, budgets and the expense reports. Codes are permanent; a category is deactivated, never deleted."
      actions={
        caps.manage && !adding ? (
          <Button size="sm" icon={<Plus size={12} />} onClick={() => setAdding({ name: "", code: "", codeTouched: false, attempted: false })}>
            Add category
          </Button>
        ) : null
      }
    >
      {adding ? (
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${FIN.border}`, background: FIN.surface, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 12 }}>
            <Field label="Name" htmlFor={ids.name} required error={adding.attempted ? addErrors.name : null}>
              <input
                id={ids.name}
                autoFocus
                value={adding.name}
                maxLength={FINANCE_LIMITS.categoryName.max}
                onChange={(e) => setAdding({ ...adding, name: e.target.value, code: adding.codeTouched ? adding.code : suggestCode(e.target.value) })}
                placeholder="e.g. Youth ministry"
                style={inputStyle}
              />
            </Field>
            <Field label="Code" htmlFor={ids.code} required error={adding.attempted || adding.codeTouched ? addErrors.code : null} hint="Permanent: lowercase letters, digits, hyphens.">
              <input
                id={ids.code}
                value={adding.code}
                maxLength={40}
                onChange={(e) => setAdding({ ...adding, code: e.target.value.toLowerCase(), codeTouched: true })}
                style={{ ...inputStyle, fontFamily: FIN.mono }}
              />
            </Field>
          </div>
          <div className="flex items-center" style={{ gap: 8 }}>
            <Button variant="primary" size="sm" busy={busy === "add"} onClick={() => void add()}>
              Add
            </Button>
            <Button size="sm" onClick={() => setAdding(null)}>
              Cancel
            </Button>
            <span style={{ fontSize: 12, color: FIN.muted }}>It goes to the end of the list; move it after.</span>
          </div>
        </div>
      ) : null}
      {error ? (
        <div style={{ padding: "12px 20px 0" }}>
          <Notice tone="error" onDismiss={() => setError(null)}>
            {error}
          </Notice>
        </div>
      ) : null}
      {cats.error ? (
        <ErrorState message={cats.error} onRetry={cats.reload} />
      ) : cats.loading && list.length === 0 ? (
        <div style={{ padding: 20, display: "grid", gap: 8 }}>
          <Skeleton />
          <Skeleton />
        </div>
      ) : list.length === 0 ? (
        <EmptyState title="No categories yet">{caps.manage ? "Add the first with Add category." : "Someone with finance:manage can add them."}</EmptyState>
      ) : (
        <div className="r-table-scroll" style={{ overflowX: "auto", opacity: busy === "reorder" ? 0.55 : 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }} aria-label="Expense categories">
            <thead>
              <tr style={{ background: FIN.surface }}>
                {caps.manage ? <th style={{ ...miniTh, padding: "9px 12px", width: 70 }}>Order</th> : null}
                <th style={{ ...miniTh, padding: "9px 16px", textAlign: "left" }}>Name</th>
                <th style={{ ...miniTh, padding: "9px 16px", textAlign: "left" }}>Code</th>
                <th style={{ ...miniTh, padding: "9px 16px", textAlign: "left" }}>Status</th>
                {caps.manage ? <th style={{ ...miniTh, padding: "9px 16px", textAlign: "right" }} /> : null}
              </tr>
            </thead>
            <tbody>
              {list.map((c, i) => (
                <tr key={c.category_id} style={{ borderTop: `1px solid ${FIN.border}` }}>
                  {caps.manage ? (
                    <td style={{ ...miniTd, padding: "6px 12px", whiteSpace: "nowrap" }}>
                      <button type="button" aria-label={`Move ${c.name} up`} disabled={i === 0 || busy !== null} onClick={() => move(i, -1)} style={{ background: "none", border: "none", padding: 3, cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.3 : 1, color: FIN.navy }}>
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${c.name} down`}
                        disabled={i === list.length - 1 || busy !== null}
                        onClick={() => move(i, 1)}
                        style={{ background: "none", border: "none", padding: 3, cursor: i === list.length - 1 ? "default" : "pointer", opacity: i === list.length - 1 ? 0.3 : 1, color: FIN.navy }}
                      >
                        <ArrowDown size={14} />
                      </button>
                    </td>
                  ) : null}
                  <td style={{ ...miniTd, padding: "8px 16px" }}>
                    {rename?.id === c.category_id ? (
                      <span className="flex items-center" style={{ gap: 6 }}>
                        <input
                          aria-label={`New name for ${c.name}`}
                          autoFocus
                          value={rename.name}
                          maxLength={FINANCE_LIMITS.categoryName.max}
                          onChange={(e) => setRename({ id: c.category_id, name: e.target.value })}
                          style={{ ...inputStyle, height: 30, maxWidth: 260 }}
                        />
                        <Button
                          size="sm"
                          variant="primary"
                          ariaLabel="Save name"
                          icon={<Check size={12} />}
                          busy={busy === c.category_id}
                          disabled={Boolean(lengthError(rename.name, FINANCE_LIMITS.categoryName, "a name")) || rename.name.trim() === c.name}
                          onClick={() =>
                            void run(c.category_id, async () => {
                              await FinanceApi.updateExpenseCategory(c.category_id, { name: rename.name.trim() });
                              setRename(null);
                              toast("Category renamed.");
                            }, "The new name was not saved.")
                          }
                        />
                        <Button size="sm" ariaLabel="Cancel rename" icon={<X size={12} />} onClick={() => setRename(null)} />
                      </span>
                    ) : (
                      <span style={{ fontWeight: 600, color: c.is_active ? FIN.navy : FIN.muted }}>{c.name}</span>
                    )}
                  </td>
                  <td style={{ ...miniTd, padding: "8px 16px", fontFamily: FIN.mono, fontSize: 12, color: FIN.muted }}>{c.code}</td>
                  <td style={{ ...miniTd, padding: "8px 16px" }}>
                    <StatusChip status={c.is_active ? "active" : "inactive"} />
                  </td>
                  {caps.manage ? (
                    <td style={{ ...miniTd, padding: "8px 16px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <span className="inline-flex" style={{ gap: 6 }}>
                        {rename?.id !== c.category_id ? (
                          <Button size="sm" icon={<Pencil size={12} />} onClick={() => setRename({ id: c.category_id, name: c.name })}>
                            Rename
                          </Button>
                        ) : null}
                        {c.is_active ? (
                          <Button size="sm" onClick={() => setDeactivate(c)} disabled={busy !== null}>
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            busy={busy === `act-${c.category_id}`}
                            disabled={busy !== null && busy !== `act-${c.category_id}`}
                            onClick={() =>
                              void run(`act-${c.category_id}`, async () => {
                                await FinanceApi.updateExpenseCategory(c.category_id, { is_active: true });
                                toast(`${c.name} is active again.`);
                              }, "The category was not activated.")
                            }
                          >
                            Activate
                          </Button>
                        )}
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={deactivate !== null}
        title={deactivate ? `Deactivate ${deactivate.name}?` : "Deactivate?"}
        confirmLabel="Deactivate"
        body="It disappears from the pickers for new expenses and budget lines. Expenses already recorded keep it, and the reports still show them. You can activate it again at any time."
        errorFallback="The category was not deactivated."
        onCancel={() => setDeactivate(null)}
        onConfirm={async () => {
          if (!deactivate) return;
          await FinanceApi.updateExpenseCategory(deactivate.category_id, { is_active: false });
          toast(`${deactivate.name} deactivated.`);
          setDeactivate(null);
          cats.reload();
        }}
      />
    </SectionCard>
  );
}

function Providers({ s }: { s: Settings }): ReactElement {
  return (
    <SectionCard flush title="Payment providers" icon={<CreditCard size={15} />} subtitle="Whether each online channel is set up on the server. Keys live on the server only — this page never shows a value.">
      <div>
        {s.providers.map((p, i) => (
          <div key={p.key} className="flex items-center flex-wrap" style={{ gap: 12, padding: "12px 20px", borderTop: i === 0 ? "none" : `1px solid ${FIN.border}` }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: FIN.navy, minWidth: 140 }}>{p.label}</span>
            {p.configured ? <StatusChip status="active" label="Configured" /> : <StatusChip status="inactive" label="Not configured" />}
            <span style={{ fontSize: 11.5, color: FIN.muted }}>
              {p.env.length > 0 ? (
                <>
                  Reads <span style={{ fontFamily: FIN.mono }}>{p.env.join(", ")}</span>
                </>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function Numbering({ s }: { s: Settings }): ReactElement {
  return (
    <SectionCard title="Office receipt numbers" icon={<Hash size={15} />} subtitle="Every gift the office records gets the next number — one sequence per year, no gaps, never reused.">
      <div className="flex items-center flex-wrap" style={{ gap: 16 }}>
        <div>
          <div className="nuru-eyebrow">Next receipt</div>
          <div style={{ fontFamily: FIN.mono, fontSize: 24, color: FIN.navy, fontWeight: 600 }}>{s.receipt_counter.next_receipt}</div>
        </div>
        <Explain style={{ maxWidth: 520 }}>
          {s.receipt_counter.next > 1 ? `${plural(s.receipt_counter.next - 1, "office receipt")} issued in ${s.receipt_counter.year} so far. ` : `None issued in ${s.receipt_counter.year} yet. `}A reversed gift keeps its number; an M-Pesa code, cheque number or bank reference is kept beside it, never used as the receipt.
        </Explain>
      </div>
    </SectionCard>
  );
}

function TiersAndReminders({ s }: { s: Settings }): ReactElement {
  const p = s.reminder_policy;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 16 }}>
      <SectionCard flush title="Giving tiers" icon={<KeyRound size={15} />} subtitle={s.cost_per_disciple_minor > 0 ? undefined : "Read-only."}>
        {s.cost_per_disciple_minor > 0 ? (
          <div style={{ padding: "12px 20px 0", fontSize: 12.5, color: FIN.muted }}>
            Carrying one disciple through a level costs <MoneyText amount_minor={s.cost_per_disciple_minor} currency={s.giving_tiers[0]?.currency ?? "KES"} strong style={{ color: FIN.navy }} />; every tier&apos;s wording derives from it.
          </div>
        ) : null}
        {s.giving_tiers.length === 0 ? (
          <EmptyState>No tiers configured.</EmptyState>
        ) : (
          <div className="r-table-scroll" style={{ overflowX: "auto", paddingTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }} aria-label="Giving tiers">
              <thead>
                <tr style={{ background: FIN.surface }}>
                  <th style={{ ...miniTh, padding: "9px 16px", textAlign: "right" }}>Monthly gift</th>
                  <th style={{ ...miniTh, padding: "9px 16px", textAlign: "right" }}>Disciples a year</th>
                  <th style={{ ...miniTh, padding: "9px 16px", textAlign: "left" }}>What it means</th>
                </tr>
              </thead>
              <tbody>
                {s.giving_tiers.map((t) => (
                  <tr key={`${t.currency}-${t.amount_minor}`} style={{ borderTop: `1px solid ${FIN.border}` }}>
                    <td style={{ ...miniTd, padding: "8px 16px", textAlign: "right" }}>
                      <MoneyText amount_minor={t.amount_minor} currency={t.currency} strong />
                    </td>
                    <td style={{ ...miniTd, padding: "8px 16px", textAlign: "right", fontFamily: FIN.mono }}>{t.disciples_per_year}</td>
                    <td style={{ ...miniTd, padding: "8px 16px" }}>{t.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
      <SectionCard title="Pledge reminders" icon={<Bell size={15} />} subtitle="How partners are reminded about their instalments. Read-only.">
        <div className="flex flex-wrap" style={{ gap: "10px 22px", marginBottom: 12 }}>
          {[
            ["Due soon", `${p.due_soon_days} ${p.due_soon_days === 1 ? "day" : "days"} before`],
            ["Due window", `${p.due_window_days} ${p.due_window_days === 1 ? "day" : "days"}`],
            ["Follow-ups", `${p.follow_ups} × every ${p.follow_up_hours} h`],
            ["Payment in flight", `${p.in_flight_minutes} min`],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="nuru-eyebrow">{k}</div>
              <div style={{ fontFamily: FIN.mono, fontSize: 13.5, color: FIN.navy, fontWeight: 600 }}>{v}</div>
            </div>
          ))}
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: 12.5, color: FIN.navy, lineHeight: 1.5 }}>
          {p.text.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

function WhoCanDoWhat(): ReactElement {
  const caps = useFinanceCaps();
  return (
    <SectionCard
      flush
      title="Who can do what"
      icon={<ShieldCheck size={15} />}
      subtitle="Four Finance capabilities, given to a role (or one person) in Roles & Permissions. Admin and SuperAdmin can do everything."
      actions={
        <Link to="/roles" style={{ fontSize: 12.5, fontWeight: 600, color: FIN.navy }}>
          Roles & Permissions →
        </Link>
      }
    >
      <div className="r-table-scroll" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }} aria-label="Finance capabilities">
          <thead>
            <tr style={{ background: FIN.surface }}>
              <th style={{ ...miniTh, padding: "9px 16px", textAlign: "left" }}>Capability</th>
              <th style={{ ...miniTh, padding: "9px 16px", textAlign: "left" }}>Allows</th>
              <th style={{ ...miniTh, padding: "9px 16px", textAlign: "center" }}>You</th>
            </tr>
          </thead>
          <tbody>
            {FINANCE_CAPABILITIES.map((c) => (
              <tr key={c.key} style={{ borderTop: `1px solid ${FIN.border}` }}>
                <td style={{ ...miniTd, padding: "10px 16px", fontFamily: FIN.mono, fontWeight: 600, whiteSpace: "nowrap" }}>{c.permission}</td>
                <td style={{ ...miniTd, padding: "10px 16px" }}>{c.allows}</td>
                <td style={{ ...miniTd, padding: "10px 16px", textAlign: "center" }}>
                  {caps.loading ? <span style={{ color: FIN.muted }}>…</span> : caps[c.key] ? <Check size={15} color={FIN.good} aria-label="You have this" /> : <span style={{ color: FIN.muted }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

export function FinanceSettings(): ReactElement {
  const settings = useAsync(() => FinanceApi.settings(), "settings", { errorFallback: "Could not load the Finance settings." });
  const s = settings.data;
  return (
    <FinancePage title="Settings" subtitle="Expense categories you can change; how payments, receipt numbers, tiers and reminders are set up; and which capability allows what.">
      <Categories />
      {settings.error ? (
        <SectionCard title="Providers, receipts, tiers and reminders">
          <ErrorState message={settings.error} onRetry={settings.reload} />
        </SectionCard>
      ) : !s ? (
        <SectionCard title="Providers, receipts, tiers and reminders">
          <div style={{ display: "grid", gap: 8 }}>
            <Skeleton />
            <Skeleton />
          </div>
        </SectionCard>
      ) : (
        <>
          <Providers s={s} />
          <Numbering s={s} />
          <TiersAndReminders s={s} />
        </>
      )}
      <WhoCanDoWhat />
    </FinancePage>
  );
}
