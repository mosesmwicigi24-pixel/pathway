// Portal v2 nav model — structure + title resolution. Role-based gating returns
// with RBAC (P3); for now the shell shows the full nav and resolves page titles.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  navGroups, titleFor, breadcrumbFor, pathPermissions, pageTitles, isFinancePath, legacyPartnersRedirect,
  navLinkEnd, groupContainsPath, navGroupStorageKey, readNavGroupOpen, writeNavGroupOpen,
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

// docs/FINANCE_ERP.md §1 — the menu table, in the ERP order (money in →
// commitments → money out → planning → books → reporting → admin).
const FINANCE_SPEC: [path: string, label: string][] = [
  ["/finance", "Overview"],
  ["/finance/transactions", "Transactions"],
  ["/finance/pledges", "Pledges"],
  ["/finance/partners", "Partners"],
  ["/finance/claims", "Claims"],
  ["/finance/recurring", "Recurring gifts"],
  ["/finance/campaigns", "Campaigns"],
  ["/finance/needs", "Department needs"],
  ["/finance/expenses", "Expenses"],
  ["/finance/budgets", "Budgets"],
  ["/finance/funds", "Funds"],
  ["/finance/ledger", "Ledger"],
  ["/finance/reconciliation", "Reconciliation"],
  ["/finance/reports", "Reports"],
  ["/finance/statements", "Statements"],
  ["/finance/audit", "Audit"],
  ["/finance/settings", "Settings"],
];
const finance = navGroups.find((g) => g.label === "Finance");

describe("Finance section (docs/FINANCE_ERP.md §1)", () => {
  it("sits directly after Operations and is collapsible", () => {
    const labels = navGroups.map((g) => g.label);
    expect(labels.indexOf("Finance")).toBe(labels.indexOf("Operations") + 1);
    expect(finance?.collapsible).toBe(true);
    // No other group folds — they are unchanged.
    expect(navGroups.filter((g) => g.collapsible).map((g) => g.label)).toEqual(["Finance"]);
  });

  it("lists the 17 pages of the spec's menu table, in its order", () => {
    expect(finance?.items.map((i) => [i.path, i.label])).toEqual(FINANCE_SPEC);
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

describe("collapsible group state (localStorage nuru.nav.finance.open)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the agreed key", () => {
    expect(navGroupStorageKey("Finance")).toBe("nuru.nav.finance.open");
  });

  it("defaults to open when nothing is stored, or storage is missing", () => {
    // the node test environment has no localStorage at all
    expect(readNavGroupOpen("Finance")).toBe(true);
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    expect(readNavGroupOpen("Finance")).toBe(true);
  });

  it("remembers a fold and an unfold", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    writeNavGroupOpen("Finance", false);
    expect(store.get("nuru.nav.finance.open")).toBe("0");
    expect(readNavGroupOpen("Finance")).toBe(false);
    writeNavGroupOpen("Finance", true);
    expect(readNavGroupOpen("Finance")).toBe(true);
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
    expect(readNavGroupOpen("Finance")).toBe(true);
    expect(() => writeNavGroupOpen("Finance", false)).not.toThrow();
  });
});
