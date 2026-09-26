// Portal v2 nav model — structure + title resolution. Role-based gating returns
// with RBAC (P3); for now the shell shows the full nav and resolves page titles.
import { describe, it, expect, afterEach, vi } from "vitest";
import { Gift, Wallet, Library, Settings2, BookOpen } from "lucide-react";
import {
  navGroups, titleFor, breadcrumbFor, pathPermissions, pageTitles, isFinancePath, legacyPartnersRedirect,
  navLinkEnd, groupContainsPath, itemsContainPath, sidebarEntries, navSubgroupStorageKey, readNavSubgroupOpen,
  writeNavSubgroupOpen, superAdminOnlyPaths, type NavGroup,
} from "../src/components/shell/nav";

describe("portal nav model", () => {
  it("has the ten sidebar groups in order", () => {
    // Follow-up became its own group on 2026-08-17 (owner ruling), sitting
    // between Operations and Communication. It was previously two rows inside
    // Operations gated on members:view.
    //
    // Website joined on 2026-08-22, before Settings: the portal is now the
    // administration point for nuruplace.org, and the whole group is gated on
    // the `website` module so running the site does not require Admin over
    // members, finance and curriculum.
    //
    // Finance joined on 2026-09-26 directly after Operations (owner request:
    // "make Finance a menu title like Media, with sub-menus under it" —
    // docs/FINANCE_ERP.md §1).
    expect(navGroups.map((g) => g.label)).toEqual([
      "Portal", "Curriculum", "Media", "Operations", "Finance", "Follow-up", "Communication", "System",
      "Website", "Settings",
    ]);
  });

  it("gates the Website group on its own module, so the site can be run without the roll", () => {
    const website = navGroups.find((g) => g.label === "Website");
    expect(website?.items.map((i) => i.path)).toEqual(["/website/enquiries"]);
    // Same principle as Follow-up: editing the church website and reading the
    // membership roster are different jobs, usually done by different people.
    expect(website?.items.every((i) => i.permission === "website:view")).toBe(true);
  });

  it("gates the Follow-up group on its own module, not on members:view", () => {
    const followUp = navGroups.find((g) => g.label === "Follow-up");
    expect(followUp?.items.map((i) => i.path)).toEqual(["/services", "/follow-up"]);
    // The whole point of migration 198: reading the member roll and working the
    // call list are different jobs, often done by different people.
    expect(followUp?.items.every((i) => i.permission === "followUp:view")).toBe(true);
  });

  it("no longer carries Services or Follow-up inside Operations", () => {
    const ops = navGroups.find((g) => g.label === "Operations");
    expect(ops?.items.some((i) => i.path === "/services" || i.path === "/follow-up")).toBe(false);
  });

  it("exposes the Media section (Video Library, Radio Studio, Audio Mixer, Uploads & Sessions)", () => {
    const media = navGroups.find((g) => g.label === "Media");
    expect(media?.items.map((i) => i.path)).toEqual(["/video-library", "/radio", "/mixer", "/uploads-sessions"]);
    expect(titleFor("/uploads-sessions")).toBe("Uploads & Sessions");
  });

  it("exposes Communication (Chat, Broadcast, SMS Center) and Settings (Users, Roles, Congregations, Countries, Languages)", () => {
    const comms = navGroups.find((g) => g.label === "Communication");
    // SMS Center joined on 2026-08-23: bulk campaigns with per-person delivery
    // truth. Coarse Admin+ gate server-side, so no permission key here.
    expect(comms?.items.map((i) => i.path)).toEqual(["/chat", "/broadcast", "/sms"]);
    expect(titleFor("/sms")).toBe("SMS Center");
    const settings = navGroups.find((g) => g.label === "Settings");
    expect(settings?.items.map((i) => i.path)).toEqual(["/users", "/roles", "/congregations", "/countries", "/languages"]);
  });

  it("exposes the System section (Member Intelligence, Flock Brief, Suggested Pairings)", () => {
    const system = navGroups.find((g) => g.label === "System");
    expect(system?.items.map((i) => i.path)).toEqual(["/intelligence", "/flock-brief", "/proximity"]);
  });

  it("every nav item has a unique path", () => {
    const paths = navGroups.flatMap((g) => g.items.map((i) => i.path));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("resolves static and param-route titles", () => {
    expect(titleFor("/")).toBe("Dashboard");
    expect(titleFor("/cell-engagement")).toBe("Cell Engagement");
    expect(titleFor("/cell-engagement/abc")).toBe("Cell Detail");
    expect(titleFor("/cms/level/3")).toBe("CMS — Level Detail");
  });

  it("falls back to the brand name for unknown routes", () => {
    expect(titleFor("/totally-unknown")).toBe("Nuru Pathway");
  });
});

// docs/FINANCE_ERP.md §1 — the menu table: the owner's three sub-menus
// (2026-09-26), in the owner's order, with Settings apart at the bottom.
// Labels and routes are the ones the pages already had.
const FINANCE_SPEC: [path: string, label: string, subgroup: string | null][] = [
  ["/finance", "Overview", "giving"],
  ["/finance/transactions", "Transactions", "giving"],
  ["/finance/pledges", "Pledges", "giving"],
  ["/finance/partners", "Partners", "giving"],
  // money in — moved here from Spending & Planning (owner, 2026-09-26)
  ["/finance/claims", "Claims", "giving"],
  ["/finance/recurring", "Recurring gifts", "giving"],
  ["/finance/campaigns", "Campaigns", "giving"],
  ["/finance/needs", "Department needs", "spending"],
  ["/finance/expenses", "Expenses", "spending"],
  ["/finance/budgets", "Budgets", "spending"],
  ["/finance/funds", "Funds", "spending"],
  ["/finance/ledger", "Ledger", "accounting"],
  ["/finance/reconciliation", "Reconciliation", "accounting"],
  ["/finance/reports", "Reports", "accounting"],
  ["/finance/statements", "Statements", "accounting"],
  ["/finance/audit", "Audit", "accounting"],
  ["/finance/settings", "Settings", null],
];
const finance = navGroups.find((g) => g.label === "Finance");

describe("Finance section (docs/FINANCE_ERP.md §1)", () => {
  it("sits directly after Operations, and is the only group with sub-menus", () => {
    const labels = navGroups.map((g) => g.label);
    expect(labels.indexOf("Finance")).toBe(labels.indexOf("Operations") + 1);
    // No other group changes shape.
    expect(navGroups.filter((g) => (g.subgroups ?? []).length > 0).map((g) => g.label)).toEqual(["Finance"]);
    expect(navGroups.filter((g) => g !== finance).every((g) => g.items.every((i) => i.subgroup === undefined))).toBe(true);
  });

  it("lists the 17 pages of the spec's menu table, in its order, each in its sub-menu", () => {
    expect(finance?.items.map((i) => [i.path, i.label, i.subgroup ?? null])).toEqual(FINANCE_SPEC);
  });

  it("reads as the three owner-named sub-menus, then Settings on its own", () => {
    expect(finance?.subgroups?.map((s) => [s.key, s.label])).toEqual([
      ["giving", "Giving & Income"],
      ["spending", "Spending & Planning"],
      ["accounting", "Accounting & Reporting"],
    ]);
    const entries = finance ? sidebarEntries(finance) : [];
    expect(entries.map((e) => (e.kind === "item" ? e.item.label : `${e.subgroup.label} (${e.items.length})`))).toEqual([
      "Giving & Income (7)", "Spending & Planning (4)", "Accounting & Reporting (5)", "Settings",
    ]);
    const rows = (key: string): string[] =>
      entries.flatMap((e) => (e.kind === "subgroup" && e.subgroup.key === key ? e.items.map((i) => i.label) : []));
    expect(rows("giving")).toEqual(["Overview", "Transactions", "Pledges", "Partners", "Claims", "Recurring gifts", "Campaigns"]);
    expect(rows("spending")).toEqual(["Department needs", "Expenses", "Budgets", "Funds"]);
    expect(rows("accounting")).toEqual(["Ledger", "Reconciliation", "Reports", "Statements", "Audit"]);
  });

  it("gives each sub-menu header its own glyph, shared with no page row", () => {
    expect(finance?.subgroups?.map((s) => s.icon)).toEqual([Gift, Wallet, Library]);
    const rowIcons = new Set(navGroups.flatMap((g) => g.items.map((i) => i.icon)));
    for (const s of finance?.subgroups ?? []) expect(rowIcons.has(s.icon), s.label).toBe(false);
  });

  it("gates every Finance page on finance:view, with a title and a 'Finance · <page>' breadcrumb", () => {
    for (const [path, label] of FINANCE_SPEC) {
      const item = finance?.items.find((i) => i.path === path);
      expect(item?.permission, path).toBe("finance:view");
      // pathPermissions is flattened from the nav, so the route guard agrees.
      expect(pathPermissions[path], path).toBe("finance:view");
      expect(pageTitles[path], path).toBe(label);
      expect(titleFor(path)).toBe(label);
      expect(breadcrumbFor(path)).toEqual({ section: "Finance", title: label });
    }
  });

  it("gives every Finance page its own icon, shared with no other sidebar row", () => {
    const financeIcons = finance?.items.map((i) => i.icon) ?? [];
    expect(new Set(financeIcons).size).toBe(FINANCE_SPEC.length);
    const elsewhere = new Set(navGroups.filter((g) => g !== finance).flatMap((g) => g.items.map((i) => i.icon)));
    for (const icon of financeIcons) expect(elsewhere.has(icon)).toBe(false);
  });

  it("keeps every sub-menu page in the route guard (the flat list still holds them all)", () => {
    for (const [path] of FINANCE_SPEC) expect(pathPermissions[path], path).toBe("finance:view");
    expect(Object.keys(pathPermissions).filter((p) => isFinancePath(p))).toHaveLength(FINANCE_SPEC.length);
    expect(superAdminOnlyPaths.some((p) => isFinancePath(p))).toBe(false);
  });

  it("takes Finance and Partners out of Operations, and leaves Departments there", () => {
    const ops = navGroups.find((g) => g.label === "Operations");
    const paths = ops?.items.map((i) => i.path) ?? [];
    expect(paths).not.toContain("/finance");
    expect(paths).not.toContain("/partners");
    expect(paths.some((p) => p.startsWith("/finance"))).toBe(false);
    expect(paths).toContain("/departments");
    expect(pathPermissions["/departments"]).toBe("departments:view");
  });

  it("keeps the old /partners path out of the nav (it is a redirect now)", () => {
    expect(pathPermissions["/partners"]).toBeUndefined();
    expect(navGroups.some((g) => g.items.some((i) => i.path === "/partners"))).toBe(false);
  });

  it("leaves every other route's top bar unchanged — a title, no section", () => {
    expect(breadcrumbFor("/")).toEqual({ section: null, title: "Dashboard" });
    expect(breadcrumbFor("/members")).toEqual({ section: null, title: "Members" });
    expect(breadcrumbFor("/departments")).toEqual({ section: null, title: "Departments" });
    expect(breadcrumbFor("/cell-engagement/abc")).toEqual({ section: null, title: "Cell Detail" });
  });

  it("recognises Finance paths by segment, not by prefix text", () => {
    expect(isFinancePath("/finance")).toBe(true);
    expect(isFinancePath("/finance/ledger")).toBe(true);
    expect(isFinancePath("/financial")).toBe(false);
    expect(isFinancePath("/finances/x")).toBe(false);
    expect(breadcrumbFor("/financial").section).toBeNull();
    expect(finance && groupContainsPath(finance, "/finance/ledger")).toBe(true);
    expect(finance && groupContainsPath(finance, "/financial")).toBe(false);
    expect(finance && groupContainsPath(finance, "/members")).toBe(false);
    const accounting = (finance ? sidebarEntries(finance) : []).find((e) => e.kind === "subgroup" && e.subgroup.key === "accounting");
    const rows = accounting?.kind === "subgroup" ? accounting.items : [];
    expect(itemsContainPath(rows, "/finance/ledger")).toBe(true);
    expect(itemsContainPath(rows, "/finance/ledger/abc")).toBe(true);
    expect(itemsContainPath(rows, "/finance/ledgers")).toBe(false);
    expect(itemsContainPath(rows, "/finance/transactions")).toBe(false);
    // Settings is in no sub-menu, so no sub-menu opens for it
    expect(itemsContainPath(rows, "/finance/settings")).toBe(false);
    // Overview ("/finance") prefixes every Finance route, but claims only itself —
    // otherwise Giving & Income would open on the Ledger page
    const giving = (finance ? sidebarEntries(finance) : []).find((e) => e.kind === "subgroup" && e.subgroup.key === "giving");
    const givingRows = giving?.kind === "subgroup" ? giving.items : [];
    expect(itemsContainPath(givingRows, "/finance")).toBe(true);
    expect(itemsContainPath(givingRows, "/finance/partners/p-1")).toBe(true);
    for (const [path, , sub] of FINANCE_SPEC) expect(itemsContainPath(givingRows, path), path).toBe(sub === "giving");
    // the same rule every other group lives by: "/" claims only the Dashboard
    const portal = navGroups.find((g) => g.label === "Portal");
    expect(portal && groupContainsPath(portal, "/")).toBe(true);
    expect(portal && groupContainsPath(portal, "/members")).toBe(false);
  });

  it("lights Overview only on /finance itself (NavLink end), not on every Finance page", () => {
    expect(navLinkEnd("/finance")).toBe(true);
    expect(navLinkEnd("/finance/transactions")).toBe(false);
    // the two exact-match items that existed before are unchanged
    expect(navLinkEnd("/")).toBe(true);
    expect(navLinkEnd("/curriculum")).toBe(true);
    // a page with detail sub-routes still lights on them
    expect(navLinkEnd("/cell-engagement")).toBe(false);
    expect(navLinkEnd("/events")).toBe(false);
  });
});

describe("sub-menus (nav.tsx NavGroup.subgroups)", () => {
  it("every row names a sub-menu its group declares, and each sub-menu's rows are contiguous", () => {
    for (const g of navGroups) {
      const keys = (g.subgroups ?? []).map((s) => s.key);
      expect(new Set(keys).size, g.label).toBe(keys.length);
      for (const i of g.items) if (i.subgroup !== undefined) expect(keys, `${g.label} ${i.path}`).toContain(i.subgroup);
      // contiguous: the sidebar order is exactly the flat order
      const flat = sidebarEntries(g).flatMap((e) => (e.kind === "item" ? [e.item] : e.items));
      expect(flat.map((i) => i.path), g.label).toEqual(g.items.map((i) => i.path));
      // no declared sub-menu without a row
      for (const k of keys) expect(g.items.some((i) => i.subgroup === k), `${g.label} ${k}`).toBe(true);
    }
  });

  const icon = BookOpen;
  const group: NavGroup = {
    label: "Test",
    subgroups: [{ key: "a", label: "A", icon: Gift }, { key: "b", label: "B", icon: Wallet }],
    items: [
      { path: "/t/1", label: "One", icon, subgroup: "a" },
      { path: "/t/2", label: "Two", icon, subgroup: "a" },
      { path: "/t/3", label: "Three", icon, subgroup: "b" },
      { path: "/t/4", label: "Four", icon, subgroup: "typo" },
      { path: "/t/5", label: "Five", icon: Settings2 },
    ],
  };

  it("leaves out a sub-menu with no row to show, header and all", () => {
    const visible = group.items.filter((i) => i.subgroup !== "b");
    const entries = sidebarEntries(group, visible);
    expect(entries.some((e) => e.kind === "subgroup" && e.subgroup.key === "b")).toBe(false);
    expect(entries.map((e) => (e.kind === "item" ? e.item.path : e.subgroup.key))).toEqual(["a", "/t/4", "/t/5"]);
  });

  it("shows a row whose sub-menu is undeclared as a plain row — a typo never hides a page", () => {
    const entries = sidebarEntries(group);
    expect(entries.map((e) => (e.kind === "item" ? e.item.path : `${e.subgroup.key}:${e.items.length}`))).toEqual([
      "a:2", "b:1", "/t/4", "/t/5",
    ]);
  });

  it("returns nothing for a person who may see none of the rows", () => {
    expect(sidebarEntries(group, [])).toEqual([]);
  });
});

describe("/partners → Finance redirect", () => {
  it("lands on /finance/partners and keeps the query string", () => {
    expect(legacyPartnersRedirect("")).toBe("/finance/partners");
    expect(legacyPartnersRedirect("?partner=3f2a")).toBe("/finance/partners?partner=3f2a");
    expect(legacyPartnersRedirect("?partner=3f2a&x=1")).toBe("/finance/partners?partner=3f2a&x=1");
    expect(legacyPartnersRedirect("?tab=partners")).toBe("/finance/partners?tab=partners");
    expect(legacyPartnersRedirect("partner=3f2a")).toBe("/finance/partners?partner=3f2a");
  });

  it("sends the claims queue to its own page, other params riding along", () => {
    expect(legacyPartnersRedirect("?tab=claims")).toBe("/finance/claims");
    expect(legacyPartnersRedirect("?tab=claims&partner=3f2a")).toBe("/finance/claims?partner=3f2a");
    expect(legacyPartnersRedirect("?partner=3f2a&tab=claims")).toBe("/finance/claims?partner=3f2a");
  });

  it("keeps the hash", () => {
    expect(legacyPartnersRedirect("?partner=3f2a", "#pledges")).toBe("/finance/partners?partner=3f2a#pledges");
    expect(legacyPartnersRedirect("?tab=claims", "#top")).toBe("/finance/claims#top");
  });
});

describe("sub-menu fold state (localStorage nuru.nav.finance.<sub-menu>.open)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const memoryStorage = (): Map<string, string> => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    return store;
  };

  it("uses one key per sub-menu, from its stable key", () => {
    expect(navSubgroupStorageKey("Finance", "giving")).toBe("nuru.nav.finance.giving.open");
    expect(navSubgroupStorageKey("Finance", "spending")).toBe("nuru.nav.finance.spending.open");
    expect(navSubgroupStorageKey("Finance", "accounting")).toBe("nuru.nav.finance.accounting.open");
    // never the old whole-group key, which is simply ignored now
    expect(navSubgroupStorageKey("Finance", "giving")).not.toBe("nuru.nav.finance.open");
  });

  it("defaults to folded when nothing is stored, or storage is missing", () => {
    // the node test environment has no localStorage at all
    expect(readNavSubgroupOpen("Finance", "giving")).toBe(false);
    const store = memoryStorage();
    expect(readNavSubgroupOpen("Finance", "giving")).toBe(false);
    // junk reads as folded too
    store.set("nuru.nav.finance.giving.open", "yes");
    expect(readNavSubgroupOpen("Finance", "giving")).toBe(false);
  });

  it("remembers an unfold and a fold, per sub-menu", () => {
    const store = memoryStorage();
    writeNavSubgroupOpen("Finance", "giving", true);
    expect(store.get("nuru.nav.finance.giving.open")).toBe("1");
    expect(readNavSubgroupOpen("Finance", "giving")).toBe(true);
    expect(readNavSubgroupOpen("Finance", "spending")).toBe(false);
    writeNavSubgroupOpen("Finance", "giving", false);
    expect(store.get("nuru.nav.finance.giving.open")).toBe("0");
    expect(readNavSubgroupOpen("Finance", "giving")).toBe(false);
  });

  it("never throws when storage is blocked (private mode)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(readNavSubgroupOpen("Finance", "giving")).toBe(false);
    expect(() => writeNavSubgroupOpen("Finance", "giving", true)).not.toThrow();
  });
});
