// The partner drawer's faithfulness strip (docs/FINANCE_ERP.md §5 "Partners"):
// for a chosen year, the member's standing, instalments kept of those due, the
// date they have been overdue since, and pledged / paid / remaining per
// currency — each pledge's figures straight from the pledge register (GET
// /admin/finance/pledges, the member statement's own rule) — plus that year's
// Partner and Giving statement PDFs.
import { useState, type ReactElement } from "react";
import { FinanceApi, type FinancePledgeRow } from "../../../api/finance";
import { ErrorState, FIN, MoneyText, Skeleton, StatusChip } from "../kit";
import { currentYearEAT, fmtDay } from "../dates";
import { useResource } from "./hooks";
import { faithfulnessSummary, keptOfDue } from "./logic";
import { StatementPdfButton, SubHead, YearSelect } from "./ui";

/** Every register row for one member in `year`, by the register's exact
 *  user_id filter (a name search could catch a namesake). The rows are still
 *  kept by user_id as a belt-and-braces check. `fullName` is unused now and
 *  kept for the call sites. Pages are followed (at most five of 200). */
export async function memberPledgeRows(userId: string, _fullName: string, year: number): Promise<FinancePledgeRow[]> {
  const out: FinancePledgeRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 5; page++) {
    const p = await FinanceApi.pledges({ user_id: userId, year, cursor, limit: 200 });
    out.push(...p.data.filter((r) => r.user_id === userId));
    if (!p.next_cursor) break;
    cursor = p.next_cursor;
  }
  return out;
}

const th = { fontSize: 10.5, fontWeight: 700, color: FIN.muted, textTransform: "uppercase" as const, letterSpacing: 0.6, padding: "8px 12px", textAlign: "left" as const, whiteSpace: "nowrap" as const };
const td = { padding: "8px 12px", fontSize: 12.5, color: FIN.navy, verticalAlign: "top" as const };

export function PartnerFaithfulness({ userId, fullName }: { userId: string; fullName: string }): ReactElement {
  const thisYear = currentYearEAT();
  const [year, setYear] = useState(thisYear);
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);
  const res = useResource(() => memberPledgeRows(userId, fullName, year), `${userId}:${year}`, { errorFallback: "Could not load this partner's pledge register." });
  const rows = res.data ?? [];
  const s = faithfulnessSummary(rows);
  const inYear = year === thisYear ? "this year" : `in ${year}`;

  return (
    <section aria-label="Faithfulness">
      <SubHead aside="From the pledge register — the member statement's own rule">Faithfulness</SubHead>
      <div className="flex items-center flex-wrap" style={{ gap: 8, marginBottom: 12 }}>
        <YearSelect value={year} years={years} onChange={setYear} />
        <StatementPdfButton userId={userId} year={year} kind="partners" memberName={fullName} label="Partner statement PDF" />
        <StatementPdfButton userId={userId} year={year} kind="giving" memberName={fullName} label="Giving statement PDF" />
      </div>

      {res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : res.loading && !res.data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton width="70%" height={14} />
          <Skeleton width="50%" height={14} />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl text-center" style={{ border: `1px dashed ${FIN.border}`, padding: "16px 12px", fontSize: 12.5, color: FIN.muted }}>
          No pledge on the register {inYear}.
        </div>
      ) : (
        <>
          <div className="rounded-xl" style={{ border: `1px solid ${FIN.border}`, padding: "12px 14px", background: s.standing === "behind" ? "#FFFBF0" : FIN.card }}>
            <div className="flex items-center flex-wrap" style={{ gap: "6px 14px" }}>
              {s.standing !== "none" ? <StatusChip status={s.standing} /> : null}
              {s.monthly > 0 ? (
                <span style={{ fontSize: 13, color: FIN.navy }} title="Monthly pledges: instalments paid in full (on time or late) of those due so far in the year.">
                  Kept{" "}
                  <strong style={{ fontFamily: FIN.mono }}>
                    {s.kept} of {s.due}
                  </strong>{" "}
                  {s.due === 1 ? "instalment" : "instalments"} due {inYear}
                </span>
              ) : (
                <span style={{ fontSize: 13, color: FIN.muted }}>No monthly instalments — total pledges only.</span>
              )}
              {s.overdueSince ? (
                <span style={{ fontSize: 12.5, color: FIN.warn, fontWeight: 700 }}>Overdue since {fmtDay(s.overdueSince)}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap" style={{ gap: "6px 22px", marginTop: 10 }}>
              {s.totals.map((t) => (
                <div key={t.currency} data-currency={t.currency} className="flex items-baseline flex-wrap" style={{ gap: "4px 14px", fontSize: 12 }}>
                  <span style={{ color: FIN.muted }}>
                    Pledged <MoneyText amount_minor={t.pledged_minor} currency={t.currency} strong />
                  </span>
                  <span style={{ color: FIN.muted }} title="Paid toward this year's promises. Pledged = paid toward + remaining.">
                    Paid toward it <MoneyText amount_minor={t.paid_toward_minor} currency={t.currency} strong style={{ color: FIN.good }} />
                  </span>
                  <span style={{ color: FIN.muted }}>
                    Remaining <MoneyText amount_minor={t.remaining_minor} currency={t.currency} strong style={t.remaining_minor > 0 ? { color: FIN.warn } : undefined} />
                  </span>
                  {t.paid_beyond_minor > 0 ? (
                    <span style={{ color: FIN.muted }} title="Paid above this year's promise — to a pledge since cancelled, or paid ahead.">
                      Also paid <MoneyText amount_minor={t.paid_beyond_minor} currency={t.currency} strong /> beyond this year's promises (a cancelled pledge, or paid ahead)
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <div style={{ border: `1px solid ${FIN.border}`, borderRadius: 10, overflowX: "auto", marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }} aria-label={`Pledges ${inYear}`}>
              <thead>
                <tr style={{ background: FIN.surface }}>
                  <th style={th}>Pledge</th>
                  <th style={th}>Standing</th>
                  <th style={{ ...th, textAlign: "center" }}>Kept / due</th>
                  <th style={th}>Next due</th>
                  <th style={{ ...th, textAlign: "right" }}>Paid {inYear}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.pledge_id} style={{ borderTop: `1px solid ${FIN.border}` }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{r.title}</div>
                      <div style={{ fontSize: 11.5, color: FIN.muted }}>{r.pays_to ? `Pays to ${r.pays_to.name}` : r.shape === "monthly" ? "Monthly" : "Total"}</div>
                    </td>
                    <td style={td}>
                      {r.status === "cancelled" ? <StatusChip status="cancelled" /> : <StatusChip status={r.standing} />}
                      {r.overdue_since && r.status !== "cancelled" ? (
                        <div style={{ fontSize: 11, color: FIN.warn, fontWeight: 600, marginTop: 3, whiteSpace: "nowrap" }}>Overdue since {fmtDay(r.overdue_since)}</div>
                      ) : null}
                    </td>
                    <td style={{ ...td, fontFamily: FIN.mono, textAlign: "center" }}>{keptOfDue(r)}</td>
                    <td style={{ ...td, fontFamily: FIN.mono, whiteSpace: "nowrap" }}>{fmtDay(r.next_due)}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <MoneyText amount_minor={r.paid_year_minor} currency={r.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
