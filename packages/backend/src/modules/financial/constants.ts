// Constants shared by the giving service and the Partners programme. A separate
// file (rather than an export from either module) so partners.ts never needs a
// runtime import of service.ts — it imports FinancialService as a type only,
// which is what lets service.ts import from partners.ts without a cycle.

/** The fund a pledge with no target of its own is booked to: the programme
 *  carries disciples. `FinancialService.pledgeFundCode` falls past it to the
 *  first active fund when this code is not an active fund. */
export const DEFAULT_PLEDGE_FUND = "discipleship";

/** The words a payment method shows — on the detail payload (`method_label`),
 *  the receipt and both statements, so the apps never keep their own copy of
 *  this map. `manual` is a pledge claim the office confirmed (partners.ts):
 *  cash or a bank transfer recorded by hand. An unknown provider falls
 *  through as-is so a new gateway never renders blank. Lives here (not in
 *  service.ts) so partners.ts can print it without a runtime cycle. */
export function methodLabel(method: string): string {
  return ({ mpesa: "M-Pesa", airtel: "Airtel Money", card: "Card", paypal: "PayPal", manual: "Manual" } as Record<string, string>)[method] ?? method;
}
