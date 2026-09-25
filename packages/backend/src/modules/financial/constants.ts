// Constants shared by the giving service and the Partners programme. A separate
// file (rather than an export from either module) so partners.ts never needs a
// runtime import of service.ts — it imports FinancialService as a type only,
// which is what lets service.ts import from partners.ts without a cycle.

/** The fund a pledge with no target of its own is booked to: the programme
 *  carries disciples. `FinancialService.pledgeFundCode` falls past it to the
 *  first active fund when this code is not an active fund. */
export const DEFAULT_PLEDGE_FUND = "discipleship";
