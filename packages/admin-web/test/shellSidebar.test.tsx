// @vitest-environment happy-dom
// The portal sidebar's Finance section (docs/FINANCE_ERP.md §1, owner request
// 2026-09-26): FINANCE is a plain title over three folding sub-menus — Giving
// & Income, Spending & Planning, Accounting & Reporting — with Settings kept
// apart at the bottom. Folded by default; the sub-menu holding the current
// page opens by itself (and is not remembered for it); a fold you make is.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { Layout } from "../src/components/shell/Layout";
import { renderPage, ALL_FINANCE } from "./financeBSetup";

vi.mock("../src/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/client")>();
  return {
    ...actual,
    // /me never answers: the sidebar filters on the store's permissions.
    MeApi: { ...actual.MeApi, me: vi.fn(() => new Promise(() => {})) },
    WebAuthnApi: { ...actual.WebAuthnApi, credentials: vi.fn(async () => []) },
  };
});
vi.mock("../src/components/notifications/NotificationsProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/components/notifications/NotificationsProvider")>();
  return {
    ...actual,
    useNotifications: () => ({
      notifications: [], unreadCount: 0, markRead: vi.fn(), markAllRead: vi.fn(), remove: vi.fn(), clearAll: vi.fn(),
    }),
  };
});

const KEY = (sub: string): string => `nuru.nav.finance.${sub}.open`;
const sidebar = (): HTMLElement => screen.getByRole("navigation");
const toggle = (label: string): HTMLElement => within(sidebar()).getByRole("button", { name: label });
const link = (label: string): HTMLElement | null => within(sidebar()).queryByRole("link", { name: label });

beforeEach(() => {
  localStorage.clear();
  // a desktop-width window, so the sidebar is the full one (not the drawer)
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Finance sidebar section", () => {
  it("reads FINANCE, then the three sub-menus folded, then Settings — away from Finance", () => {
    renderPage(<Layout />, { path: "/members", permissions: [...ALL_FINANCE, "members:view"] });
    const nav = sidebar();
    // a plain title like every other group — not a toggle
    expect(within(nav).getByText("Finance")).toBeTruthy();
    expect(within(nav).queryByRole("button", { name: "Finance" })).toBeNull();
    for (const label of ["Giving & Income", "Spending & Planning", "Accounting & Reporting"]) {
      expect(toggle(label).getAttribute("aria-expanded"), label).toBe("false");
    }
    // folded rows are out of the accessibility tree; Settings stands on its own
    for (const label of ["Overview", "Transactions", "Claims", "Ledger", "Audit"]) expect(link(label), label).toBeNull();
    expect(link("Settings")?.getAttribute("href")).toBe("/finance/settings");
    // the section's order: three sub-menus, then Settings
    const texts = Array.from(nav.querySelectorAll("button, a"))
      .map((el) => el.textContent?.trim() ?? "")
      .filter((t) => ["Giving & Income", "Spending & Planning", "Accounting & Reporting", "Settings"].includes(t));
    expect(texts).toEqual(["Giving & Income", "Spending & Planning", "Accounting & Reporting", "Settings"]);
  });

  it("opens the sub-menu holding the current page, without remembering that", () => {
    renderPage(<Layout />, { path: "/finance/ledger" });
    expect(toggle("Accounting & Reporting").getAttribute("aria-expanded")).toBe("true");
    expect(toggle("Giving & Income").getAttribute("aria-expanded")).toBe("false");
    expect(toggle("Spending & Planning").getAttribute("aria-expanded")).toBe("false");
    expect(link("Ledger")?.getAttribute("aria-current")).toBe("page");
    for (const label of ["Reconciliation", "Reports", "Statements", "Audit"]) expect(link(label), label).not.toBeNull();
    expect(link("Transactions")).toBeNull();
    expect(localStorage.getItem(KEY("accounting"))).toBeNull();
  });

  it("opens Giving & Income for the Overview, and a Partners sub-route too", () => {
    renderPage(<Layout />, { path: "/finance" });
    expect(toggle("Giving & Income").getAttribute("aria-expanded")).toBe("true");
    expect(link("Overview")?.getAttribute("aria-current")).toBe("page");
    cleanup();
    renderPage(<Layout />, { path: "/finance/partners/p-123" });
    expect(toggle("Giving & Income").getAttribute("aria-expanded")).toBe("true");
  });

  it("opens Giving & Income for Claims — money in", () => {
    renderPage(<Layout />, { path: "/finance/claims" });
    expect(toggle("Giving & Income").getAttribute("aria-expanded")).toBe("true");
    expect(toggle("Spending & Planning").getAttribute("aria-expanded")).toBe("false");
    expect(link("Claims")?.getAttribute("aria-current")).toBe("page");
  });

  it("opens no sub-menu for Settings, which is in none", () => {
    renderPage(<Layout />, { path: "/finance/settings" });
    for (const label of ["Giving & Income", "Spending & Planning", "Accounting & Reporting"]) {
      expect(toggle(label).getAttribute("aria-expanded"), label).toBe("false");
    }
    expect(link("Settings")?.getAttribute("aria-current")).toBe("page");
  });

  it("remembers a fold and an unfold you make, per sub-menu", () => {
    renderPage(<Layout />, { path: "/" });
    fireEvent.click(toggle("Spending & Planning"));
    expect(toggle("Spending & Planning").getAttribute("aria-expanded")).toBe("true");
    expect(localStorage.getItem(KEY("spending"))).toBe("1");
    expect(link("Budgets")?.getAttribute("href")).toBe("/finance/budgets");
    fireEvent.click(toggle("Spending & Planning"));
    expect(localStorage.getItem(KEY("spending"))).toBe("0");
    expect(link("Budgets")).toBeNull();
    // another sub-menu is untouched
    expect(localStorage.getItem(KEY("giving"))).toBeNull();
  });

  it("restores what you opened on the next visit", () => {
    localStorage.setItem(KEY("giving"), "1");
    renderPage(<Layout />, { path: "/" });
    expect(toggle("Giving & Income").getAttribute("aria-expanded")).toBe("true");
    expect(toggle("Accounting & Reporting").getAttribute("aria-expanded")).toBe("false");
  });

  it("lets you fold the sub-menu you are standing in, and marks it", () => {
    renderPage(<Layout />, { path: "/finance/expenses" });
    const spending = toggle("Spending & Planning");
    expect(spending.getAttribute("aria-expanded")).toBe("true");
    expect(spending.querySelector(".rounded-full")).toBeNull();
    fireEvent.click(spending);
    expect(toggle("Spending & Planning").getAttribute("aria-expanded")).toBe("false");
    expect(link("Expenses")).toBeNull();
    // the gold "you are in here" dot
    expect(toggle("Spending & Planning").querySelector(".rounded-full")).not.toBeNull();
  });

  it("shows no Finance section at all without finance:view", () => {
    renderPage(<Layout />, { path: "/members", permissions: ["members:view"] });
    const nav = sidebar();
    expect(within(nav).queryByText("Finance")).toBeNull();
    expect(within(nav).queryByRole("button", { name: "Giving & Income" })).toBeNull();
    expect(link("Settings")).toBeNull();
  });

  it("shows every Finance page's icon in the mini sidebar, folded or not", () => {
    renderPage(<Layout />, { path: "/" });
    fireEvent.click(screen.getByText("Collapse sidebar"));
    const nav = sidebar();
    expect(within(nav).queryByRole("button", { name: /Giving|Spending|Accounting/ })).toBeNull();
    const finance = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href")).filter((h) => h?.startsWith("/finance"));
    expect(finance).toEqual([
      "/finance", "/finance/transactions", "/finance/pledges", "/finance/partners", "/finance/claims", "/finance/recurring",
      "/finance/campaigns", "/finance/needs", "/finance/expenses", "/finance/budgets", "/finance/funds",
      "/finance/ledger", "/finance/reconciliation", "/finance/reports", "/finance/statements", "/finance/audit",
      "/finance/settings",
    ]);
  });
});
