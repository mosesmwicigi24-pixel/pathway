// Constants shared by the giving service and the Partners programme. A separate
// file (rather than an export from either module) so partners.ts never needs a
// runtime import of service.ts — it imports FinancialService as a type only,
// which is what lets service.ts import from partners.ts without a cycle.

/** The fund a pledge with no target of its own is booked to: the programme
 *  carries disciples. The pledge fund rule (below) falls past it to the first
 *  active fund when this code is not an active fund. */
export const DEFAULT_PLEDGE_FUND = "discipleship";

// ── where a pledge's money is booked — ONE rule, as SQL ─────────────────────
// `FinancialService.pledgeFundCode` (which routes every gift, schedule and
// confirmed claim made from a pledge) and every pledge object's `pays_to`
// read these same fragments, so what the apps show a pledge "pays to" can
// never differ from the fund its money actually lands in. The rule: the
// pledge's own fund, else its campaign's fund, else its need's department's
// fund when that is active, else DEFAULT_PLEDGE_FUND when active, else the
// first active fund by code. Append PLEDGE_PAYS_TO_JOINS to a FROM clause
// whose pledges row is aliased `p`; the aliases it adds all start `pt_`.
const DEFAULT_PLEDGE_FUND_SQL = `'${DEFAULT_PLEDGE_FUND.replace(/'/g, "''")}'`;
export const PLEDGE_PAYS_TO_JOINS = `
      LEFT JOIN funds pt_own ON pt_own.fund_id = p.fund_id
      LEFT JOIN campaigns pt_c ON pt_c.campaign_id = p.campaign_id
      LEFT JOIN funds pt_cf ON pt_cf.fund_id = pt_c.fund_id
      LEFT JOIN department_needs pt_n ON pt_n.need_id = p.need_id
      LEFT JOIN departments pt_d ON pt_d.department_id = pt_n.department_id
      LEFT JOIN funds pt_nf ON pt_nf.code = pt_d.fund_code AND pt_nf.is_active
      LEFT JOIN (SELECT code, name FROM funds WHERE is_active
                  ORDER BY (code = ${DEFAULT_PLEDGE_FUND_SQL}) DESC, code LIMIT 1) pt_def ON TRUE`;
/** The booked fund's code; NULL only when no fund is active at all. */
export const PLEDGE_PAYS_TO_CODE = `COALESCE(pt_own.code, pt_cf.code, pt_nf.code, pt_def.code)`;
/** That fund's display name. */
export const PLEDGE_PAYS_TO_NAME = `CASE WHEN pt_own.code IS NOT NULL THEN pt_own.name
              WHEN pt_cf.code IS NOT NULL THEN pt_cf.name
              WHEN pt_nf.code IS NOT NULL THEN pt_nf.name
              ELSE pt_def.name END`;

/** The words a payment method shows — on the detail payload (`method_label`),
 *  the receipt and both statements, so the apps never keep their own copy of
 *  this map. `manual` is a pledge claim the office confirmed (partners.ts):
 *  cash or a bank transfer recorded by hand. An unknown provider falls
 *  through as-is so a new gateway never renders blank. Lives here (not in
 *  service.ts) so partners.ts can print it without a runtime cycle. */
export function methodLabel(method: string): string {
  return ({ mpesa: "M-Pesa", airtel: "Airtel Money", card: "Card", paypal: "PayPal", manual: "Manual" } as Record<string, string>)[method] ?? method;
}

/** A gift the office RECORDED (Finance → Record a gift; transactions.office_channel
 *  set) reads by how the member paid — cash at the office, a bank transfer, a
 *  cheque, M-Pesa to the till — never the bare "Manual" a confirmed pledge
 *  claim shows. Everything else falls back to methodLabel. The wire `method`
 *  stays "manual" either way; only the words change. */
export function giftMethodLabel(method: string, officeChannel: string | null | undefined): string {
  if (officeChannel) {
    const words = ({ onhand: "Cash (at the office)", bank: "Bank transfer", cheque: "Cheque", mpesa: "M-Pesa", other: "Recorded by the office" } as Record<string, string>)[officeChannel];
    if (words) return words;
  }
  return methodLabel(method);
}
