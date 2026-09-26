// @vitest-environment happy-dom
// Roles & Users permission editors (docs/FINANCE_ERP.md §6): the grid comes
// from the server's catalog, and a save never strips a grant the editor did
// not show — the bug where every role save silently removed finance:manage and
// live:go / live:manage.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { matrixModel, planSave, initialChecked, grantKey, type Grant } from "../src/components/finance/a/permissionMatrix";

const mocks = vi.hoisted(() => ({
  roles: vi.fn(),
  setRolePermissions: vi.fn(),
  users: vi.fn(),
  userPermissions: vi.fn(),
  setUserPermissions: vi.fn(),
  permissionsCatalog: vi.fn(),
}));

vi.mock("../src/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/client")>();
  return {
    ...actual,
    SystemApi: {
      ...actual.SystemApi,
      roles: mocks.roles,
      setRolePermissions: mocks.setRolePermissions,
      users: mocks.users,
      userPermissions: mocks.userPermissions,
      setUserPermissions: mocks.setUserPermissions,
      countries: () => Promise.resolve([]),
      languages: () => Promise.resolve([]),
    },
  };
});
vi.mock("../src/api/finance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/finance")>();
  return { ...actual, permissionsCatalog: mocks.permissionsCatalog };
});

import { Roles } from "../src/components/pages/Roles";
import { Users } from "../src/components/pages/Users";

const CATALOG = {
  modules: ["dashboard", "members", "finance", "live", "departments", "followUp", "reports"],
  capabilities: ["view", "create", "edit", "delete", "approve", "export", "go", "manage"],
};

afterEach(cleanup);
beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

describe("the save plan (pure)", () => {
  const model = matrixModel(CATALOG);
  it("groups known modules, keeps unknown ones under Other with their id, labels go / manage", () => {
    expect(model.groups).toEqual(["Portal", "Media", "Operations", "Finance", "Follow-up", "Other"]);
    expect(model.modules.find((m) => m.id === "reports")).toEqual({ id: "reports", label: "reports", group: "Other" });
    expect(model.capabilities.map((c) => c.label)).toEqual(["View", "Create", "Edit", "Delete", "Approve", "Export", "Go live", "Manage"]);
    expect(matrixModel({ modules: ["x"], capabilities: ["teleport"] }).capabilities[0]).toEqual({ key: "teleport", label: "teleport", hint: null });
  });
  it("round-trips finance:manage, live:go and a grant on a module the portal has no label for", () => {
    const original: Grant[] = [
      { module_id: "finance", capability: "view" },
      { module_id: "finance", capability: "manage" },
      { module_id: "live", capability: "go" },
      { module_id: "reports", capability: "view" },
      { module_id: "members", capability: "proximity" },
    ];
    const checked = initialChecked(original, model);
    checked.add("dashboard:view");
    const plan = planSave(original, checked, model, ["proximity"]);
    expect(plan.grants.map(grantKey).sort()).toEqual(["dashboard:view", "finance:manage", "finance:view", "live:go", "reports:view"]);
    expect(plan.keptByServer).toEqual([{ module_id: "members", capability: "proximity" }]);
    expect(plan.blocked).toEqual([]);
  });
  it("blocks a save that would drop a grant the grid can't show", () => {
    const plan = planSave([{ module_id: "legacy", capability: "view" }], new Set(), model, ["proximity"]);
    expect(plan.blocked).toEqual([{ module_id: "legacy", capability: "view" }]);
    // For a user's direct layer nothing is kept server-side: proximity would be dropped too.
    expect(planSave([{ module_id: "members", capability: "proximity" }], new Set(), model).blocked).toHaveLength(1);
  });
});

function ui(el: ReactElement): ReactElement {
  return <MemoryRouter>{el}</MemoryRouter>;
}

const ROLE = {
  role_key: "finance_officer",
  name: "Finance officer",
  role_type: "staff" as const,
  description: "Keeps the books.",
  is_system: false,
  status: "active" as const,
  user_count: 2,
  permissions: [
    { module_id: "finance", capability: "view" },
    { module_id: "finance", capability: "manage" },
    { module_id: "live", capability: "go" },
    { module_id: "reports", capability: "view" },
    { module_id: "members", capability: "proximity" },
  ],
};

describe("Roles — permissions drawer", () => {
  it("renders the server's grid and saves every ticked cell without stripping manage / go / an unlabelled module", async () => {
    mocks.roles.mockResolvedValue([ROLE]);
    mocks.permissionsCatalog.mockResolvedValue(CATALOG);
    mocks.setRolePermissions.mockResolvedValue({ role_key: "finance_officer", count: 5 });
    render(ui(<Roles />));
    fireEvent.click(await screen.findByTitle("Permissions"));
    const manage = await screen.findByRole("button", { name: "Finance (gifts, books, reports) — Manage" });
    expect(manage.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Nuru Live (broadcast) — Go live" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "reports — View" }).getAttribute("aria-pressed")).toBe("true");
    // The server keeps proximity itself — the drawer says so and never sends it.
    expect(screen.getByText(/kept by the server on every save/)).toBeTruthy();
    const save = screen.getByRole("button", { name: /Save changes/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // nothing changed yet
    fireEvent.click(screen.getByRole("button", { name: "Dashboard & analytics — View" }));
    expect(save.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(mocks.setRolePermissions).toHaveBeenCalledTimes(1);
    const [key, sent] = mocks.setRolePermissions.mock.calls[0] as [string, Grant[]];
    expect(key).toBe("finance_officer");
    expect(sent.map(grantKey).sort()).toEqual(["dashboard:view", "finance:manage", "finance:view", "live:go", "reports:view"]);
  });

  it("keeps Save off, with a reason, when the catalog can't load", async () => {
    mocks.roles.mockResolvedValue([ROLE]);
    mocks.permissionsCatalog.mockRejectedValue(new Error("offline"));
    render(ui(<Roles />));
    fireEvent.click(await screen.findByTitle("Permissions"));
    expect(await screen.findByText(/Could not load the list of permissions from the server/)).toBeTruthy();
    expect(screen.getByText(/Save is off until the list loads/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Save changes/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.setRolePermissions).not.toHaveBeenCalled();
  });

  it("refuses to save a role holding a grant outside the catalog", async () => {
    mocks.roles.mockResolvedValue([{ ...ROLE, permissions: [...ROLE.permissions, { module_id: "legacy", capability: "view" }] }]);
    mocks.permissionsCatalog.mockResolvedValue(CATALOG);
    render(ui(<Roles />));
    fireEvent.click(await screen.findByTitle("Permissions"));
    fireEvent.click(await screen.findByRole("button", { name: "Dashboard & analytics — View" }));
    expect(screen.getByText(/can.t show or save/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Save changes/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Users — direct grants drawer", () => {
  it("shows go / manage and the modules the old grid lacked, and keeps every direct grant", async () => {
    mocks.users.mockResolvedValue([
      {
        user_id: "u1",
        full_name: "Achieng Otieno",
        email: "achieng@example.org",
        phone_number: "+254700000002",
        country_code: "KE",
        locale: "en",
        account_status: "active",
        require_2fa: false,
        is_staff: true,
        last_active: null,
        role_keys: [],
        discipler_message: null,
        avatar_url: null,
      },
    ]);
    mocks.roles.mockResolvedValue([]);
    mocks.permissionsCatalog.mockResolvedValue(CATALOG);
    mocks.userPermissions.mockResolvedValue({
      user_id: "u1",
      bridged: false,
      from_roles: [{ module_id: "members", capability: "view" }],
      direct: [
        { module_id: "finance", capability: "manage" },
        { module_id: "live", capability: "go" },
      ],
      effective: [],
    });
    mocks.setUserPermissions.mockResolvedValue({ user_id: "u1", count: 3 });
    render(ui(<Users />));
    fireEvent.click(await screen.findByTitle("Permissions"));
    const manage = await screen.findByRole("button", { name: "Finance (gifts, books, reports) — Manage" });
    expect(manage.getAttribute("aria-pressed")).toBe("true");
    // role-derived cells are locked, not buttons
    expect(screen.getByRole("img", { name: /Members — View: granted by a role/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Departments (serving, posts & needs) — Manage" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save direct grants/ }));
    });
    await waitFor(() => expect(mocks.setUserPermissions).toHaveBeenCalledTimes(1));
    const [id, sent] = mocks.setUserPermissions.mock.calls[0] as [string, Grant[]];
    expect(id).toBe("u1");
    expect(sent.map(grantKey).sort()).toEqual(["departments:manage", "finance:manage", "live:go"]);
  });
});
