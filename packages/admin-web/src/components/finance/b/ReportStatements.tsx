// The two financial statements on Finance → Reports (docs/FINANCE_ERP.md §4):
// Income & expenditure for a period (income by fund, other income, expenses by
// category, surplus) and the statement of financial position as of a day
// (cash accounts = funds + other). Per currency, never summed across; each
// statement is checked to foot before it is shown as sound.
import type { CSSProperties, ReactElement } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import type { FinanceFinancialPosition, FinanceIncomeExpenditure, FinanceStatementLine } from "../../../api/finance";
import { Card, FIN, MoneyText, Notice } from "../kit";
import { formatMinor } from "../money";
import { fmtDay, fmtRange } from "../dates";
import { sumMinor } from "./logic";

const row: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "6px 0", fontSize: 13, color: FIN.navy };
const head: CSSProperties = { fontSize: 11, fontWeight: 700, color: FIN.muted, textTransform: "uppercase", letterSpacing: 0.6, margin: "14px 0 4px" };

function Lines({ lines, currency, empty }: { lines: readonly FinanceStatementLine[]; currency: string; empty: string }): ReactElement {
  if (lines.length === 0) return <div style={{ ...row, color: FIN.muted }}>{empty}</div>;
  return (
    <>
      {lines.map((l) => (
        <div key={l.key} style={{ ...row, borderBottom: `1px dashed ${FIN.border}` }}>
          <span>{l.label}</span>
          <MoneyText amount_minor={l.amount_minor} currency={currency} withCode={false} />
        </div>
      ))}
    </>
  );
}

function TotalLine({ label, amount, currency, strong = false, tone }: { label: string; amount: number; currency: string; strong?: boolean; tone?: string | undefined }): ReactElement {
  return (
    <div style={{ ...row, fontWeight: strong ? 800 : 700, borderTop: `1px solid ${FIN.border}`, marginTop: 2, color: tone ?? FIN.navy }}>
      <span>{label}</span>
      <MoneyText amount_minor={amount} currency={currency} strong style={tone ? { color: tone } : undefined} />
    </div>
  );
}

/** Where an income & expenditure block does not add up (empty = it foots). */
export function ieProblems(c: FinanceIncomeExpenditure["currencies"][number]): string[] {
  const t = c.totals;
  const cur = c.currency;
  const p: string[] = [];
  if (sumMinor(c.income.map((l) => l.amount_minor)) !== t.gifts_minor) p.push(`Gifts by fund add to ${formatMinor(sumMinor(c.income.map((l) => l.amount_minor)), cur)}, the total says ${formatMinor(t.gifts_minor, cur)}.`);
  if (sumMinor(c.other_income.map((l) => l.amount_minor)) !== t.other_income_minor) p.push("Other income lines do not add to their total.");
  if (t.gifts_minor + t.other_income_minor !== t.income_minor) p.push("Gifts + other income ≠ total income.");
  if (sumMinor(c.expenses.map((l) => l.amount_minor)) !== t.expenses_minor) p.push(`Expenses by category add to ${formatMinor(sumMinor(c.expenses.map((l) => l.amount_minor)), cur)}, the total says ${formatMinor(t.expenses_minor, cur)}.`);
  if (t.income_minor - t.expenses_minor !== t.surplus_minor) p.push("Income − expenses ≠ the surplus.");
  return p;
}

export function IncomeExpenditureView({ data }: { data: FinanceIncomeExpenditure }): ReactElement {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 16 }}>
      {data.currencies.map((c) => {
        const t = c.totals;
        const problems = ieProblems(c);
        const deficit = t.surplus_minor < 0;
        return (
          <Card key={c.currency} style={{ padding: "16px 20px" }}>
            <section aria-label={`Income and expenditure ${c.currency}`} data-currency-block={c.currency}>
              <div className="flex items-baseline justify-between" style={{ gap: 8 }}>
                <div style={{ fontFamily: FIN.display, fontSize: 18, color: FIN.navy }}>{c.currency}</div>
                <div style={{ fontSize: 12, color: FIN.muted }}>{fmtRange(data.period)}</div>
              </div>
              <div style={head}>Income — gifts by fund (net of reversals)</div>
              <Lines lines={c.income} currency={c.currency} empty="No gifts in this period." />
              <TotalLine label="Gifts" amount={t.gifts_minor} currency={c.currency} />
              {c.other_income.length > 0 || t.other_income_minor !== 0 ? (
                <>
                  <div style={head}>Other income</div>
                  <Lines lines={c.other_income} currency={c.currency} empty="None." />
                  <TotalLine label="Other income" amount={t.other_income_minor} currency={c.currency} />
                </>
              ) : null}
              <TotalLine label="Total income" amount={t.income_minor} currency={c.currency} strong />
              <div style={head}>Expenditure — approved expenses by category</div>
              <Lines lines={c.expenses} currency={c.currency} empty="No approved expenses in this period." />
              <TotalLine label="Total expenditure" amount={t.expenses_minor} currency={c.currency} strong />
              <TotalLine label={deficit ? "Deficit" : "Surplus"} amount={t.surplus_minor} currency={c.currency} strong tone={deficit ? FIN.danger : FIN.good} />
              {problems.length > 0 ? (
                <Notice tone="warn" style={{ marginTop: 10 }}>
                  This statement does not add up — do not rely on it; tell the developers. {problems.join(" ")}
                </Notice>
              ) : (
                <div style={{ fontSize: 11.5, color: FIN.muted, marginTop: 8 }}>✓ Lines add to their totals; income − expenditure = {deficit ? "deficit" : "surplus"}.</div>
              )}
            </section>
          </Card>
        );
      })}
    </div>
  );
}

/** Where a position block does not add up (empty = it foots). */
export function positionProblems(c: FinanceFinancialPosition["currencies"][number]): string[] {
  const t = c.totals;
  const p: string[] = [];
  if (sumMinor(c.assets.map((a) => a.balance_minor)) !== t.assets_minor) p.push("The cash accounts do not add to total assets.");
  if (sumMinor(c.funds.map((a) => a.balance_minor)) !== t.funds_minor) p.push("The funds do not add to total funds.");
  if (sumMinor(c.other.map((a) => a.balance_minor)) !== t.other_minor) p.push("The other accounts do not add to their total.");
  return p;
}

export function FinancialPositionView({ data }: { data: FinanceFinancialPosition }): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Notice tone={data.balanced ? "ok" : "error"}>
        {data.balanced
          ? `Balanced ✓ — in every currency, the cash the church holds equals its funds plus other accounts, as of ${fmtDay(data.as_of)}.`
          : `Not balanced — in at least one currency, cash ≠ funds + other as of ${fmtDay(data.as_of)}. Check Reconciliation for the postings that do not pair.`}
      </Notice>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 16 }}>
        {data.currencies.map((c) => {
          const t = c.totals;
          const problems = positionProblems(c);
          return (
            <Card key={c.currency} style={{ padding: "16px 20px" }}>
              <section aria-label={`Financial position ${c.currency}`} data-currency-block={c.currency}>
                <div className="flex items-center justify-between" style={{ gap: 8 }}>
                  <div style={{ fontFamily: FIN.display, fontSize: 18, color: FIN.navy }}>{c.currency}</div>
                  <span className="inline-flex items-center" style={{ gap: 5, fontSize: 12, fontWeight: 700, color: c.balanced ? FIN.good : FIN.danger }}>
                    {c.balanced ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {c.balanced ? "Balanced" : "Not balanced"}
                  </span>
                </div>
                <div style={head}>Assets — cash accounts</div>
                {c.assets.length === 0 ? (
                  <div style={{ ...row, color: FIN.muted }}>No cash accounts.</div>
                ) : (
                  c.assets.map((a) => (
                    <div key={a.account} style={{ ...row, borderBottom: `1px dashed ${FIN.border}` }}>
                      <span title={a.account}>{a.label}</span>
                      <MoneyText amount_minor={a.balance_minor} currency={c.currency} withCode={false} />
                    </div>
                  ))
                )}
                <TotalLine label="Total assets" amount={t.assets_minor} currency={c.currency} strong />
                <div style={head}>Funds</div>
                {c.funds.length === 0 ? (
                  <div style={{ ...row, color: FIN.muted }}>No fund balances.</div>
                ) : (
                  c.funds.map((f) => (
                    <div key={f.account} style={{ ...row, borderBottom: `1px dashed ${FIN.border}` }}>
                      <span title={f.account}>{f.label}</span>
                      <MoneyText amount_minor={f.balance_minor} currency={c.currency} withCode={false} />
                    </div>
                  ))
                )}
                <TotalLine label="Total funds" amount={t.funds_minor} currency={c.currency} />
                {c.other.length > 0 || t.other_minor !== 0 ? (
                  <>
                    <div style={head}>Other (media sales, …)</div>
                    {c.other.map((o) => (
                      <div key={o.account} style={{ ...row, borderBottom: `1px dashed ${FIN.border}` }}>
                        <span title={o.account}>{o.label}</span>
                        <MoneyText amount_minor={o.balance_minor} currency={c.currency} withCode={false} />
                      </div>
                    ))}
                    <TotalLine label="Total other" amount={t.other_minor} currency={c.currency} />
                  </>
                ) : null}
                <TotalLine label="Funds + other" amount={t.funds_minor + t.other_minor} currency={c.currency} strong tone={c.balanced ? undefined : FIN.danger} />
                {problems.length > 0 ? (
                  <Notice tone="warn" style={{ marginTop: 10 }}>
                    This statement does not add up — do not rely on it; tell the developers. {problems.join(" ")}
                  </Notice>
                ) : null}
              </section>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
