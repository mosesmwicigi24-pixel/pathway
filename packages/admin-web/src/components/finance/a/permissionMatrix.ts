// Role and user permission editors (pages/Roles.tsx, pages/Users.tsx) —
// module × capability rendered from the server's own catalog
// (GET /admin/permissions/catalog, docs/FINANCE_ERP.md §6), so saving never
// strips a grant the editor did not show.
//
// The bug this replaces: both editors hard-coded six capabilities (view …
// export) and a module list that had drifted from the server's. A role save
// sends the WHOLE matrix and the server replaces the role's grants with it, so
// every save silently removed finance:manage, live:go and live:manage (and the
// user editor could never show departments, followUp or live at all).
//
// What the server does with a save (backend system/index.ts, verified):
// - PUT /admin/roles/:key/permissions deletes the role's grants EXCEPT those
//   with capability `proximity` (a system-managed capability outside the grid)
//   and inserts the body; PUT /admin/users/:id/permissions deletes every
//   direct grant and inserts the body.
// - Both validate the body against PERM_MODULES × CAPABILITIES — the catalog —
//   so a grant outside the catalog can't be sent: it would fail the whole save.
// Hence the save plan: send every ticked cell; leave `proximity` (roles) to the
// server, which keeps it; and if an original grant is neither in the grid nor
// kept by the server, refuse to save rather than drop it.
import type { PermissionCatalog } from "../../../api/finance";

export interface Grant {
  module_id: string;
  capability: string;
}
export interface MatrixModule {
  id: string;
  label: string;
  group: string;
}
export interface MatrixCapability {
  key: string;
  label: string;
  /** What the capability lets a person do, where that is not obvious. */
  hint: string | null;
}
export interface MatrixModel {
  /** Grouped (GROUP_ORDER), server order inside a group. */
  modules: MatrixModule[];
  /** Server order. */
  capabilities: MatrixCapability[];
  groups: string[];
}

/** Labels and groups for the modules the portal knows; anything else the
 *  server lists still renders (label = its id, group "Other"). */
export const MODULE_LABELS: Readonly<Record<string, { label: string; group: string }>> = {
  dashboard: { label: "Dashboard & analytics", group: "Portal" },
  levels: { label: "Curriculum Levels", group: "Curriculum" },
  cms: { label: "Modules (CMS)", group: "Curriculum" },
  quiz: { label: "Quiz Builder", group: "Curriculum" },
  videos: { label: "Video Library", group: "Curriculum" },
  live: { label: "Nuru Live (broadcast)", group: "Media" },
  cells: { label: "Cell Engagement", group: "Operations" },
  members: { label: "Members", group: "Operations" },
  reflections: { label: "Reflection Queue", group: "Operations" },
  events: { label: "Events & Attendance", group: "Operations" },
  certificates: { label: "Certificates", group: "Operations" },
  badges: { label: "Badges", group: "Operations" },
  departments: { label: "Departments (serving, posts & needs)", group: "Operations" },
  finance: { label: "Finance (gifts, books, reports)", group: "Finance" },
  followUp: { label: "Follow-up (call list & services)", group: "Follow-up" },
  website: { label: "Website (nuruplace.org)", group: "Website" },
  users: { label: "Users", group: "System" },
  rolesAdmin: { label: "Roles & Permissions", group: "System" },
  countries: { label: "Countries", group: "System" },
  languages: { label: "Languages", group: "System" },
  congregations: { label: "Congregations", group: "System" },
};

export const GROUP_ORDER: readonly string[] = ["Portal", "Curriculum", "Media", "Operations", "Finance", "Follow-up", "Website", "System", "Other"];

export const CAPABILITY_LABELS: Readonly<Record<string, { label: string; hint: string | null }>> = {
  view: { label: "View", hint: null },
  create: { label: "Create", hint: null },
  edit: { label: "Edit", hint: null },
  delete: { label: "Delete", hint: null },
  approve: { label: "Approve", hint: "Finance: approve expenses and budgets, post fund transfers and opening balances, reverse journals." },
  export: { label: "Export", hint: "CSV downloads." },
  go: { label: "Go live", hint: "Live: start a broadcast." },
  manage: {
    label: "Manage",
    hint: "Finance: record and reverse gifts, funds, expense categories, expenses, draft budgets, campaigns, claims and reminders. Live: end anyone's stream. Departments: act on posts, needs and serving.",
  },
};

/** Capabilities the server keeps on a ROLE save by itself (and refuses in the body). */
export const ROLE_SERVER_KEPT_CAPABILITIES: readonly string[] = ["proximity"];

const unique = (xs: readonly string[]): string[] => Array.from(new Set(xs.filter((x) => typeof x === "string" && x.length > 0)));

/** The grid to draw, from the server's catalog. */
export function matrixModel(catalog: PermissionCatalog): MatrixModel {
  const modules: MatrixModule[] = unique(catalog.modules).map((id) => {
    const known = MODULE_LABELS[id];
    return { id, label: known?.label ?? id, group: known?.group ?? "Other" };
  });
  const groups = GROUP_ORDER.filter((g) => modules.some((m) => m.group === g));
  const ordered = groups.flatMap((g) => modules.filter((m) => m.group === g));
  const capabilities: MatrixCapability[] = unique(catalog.capabilities).map((key) => {
    const known = CAPABILITY_LABELS[key];
    return { key, label: known?.label ?? key, hint: known?.hint ?? null };
  });
  return { modules: ordered, capabilities, groups };
}

export const grantKey = (g: Grant): string => `${g.module_id}:${g.capability}`;

export function parseGrantKey(key: string): Grant {
  const i = key.indexOf(":");
  return i < 0 ? { module_id: key, capability: "" } : { module_id: key.slice(0, i), capability: key.slice(i + 1) };
}

/** True when the grid has a cell for this grant. */
export function isRendered(g: Grant, model: MatrixModel): boolean {
  return model.modules.some((m) => m.id === g.module_id) && model.capabilities.some((c) => c.key === g.capability);
}

/** The ticked cells a grid starts with: the original grants it can show. */
export function initialChecked(original: readonly Grant[], model: MatrixModel): Set<string> {
  return new Set(original.filter((g) => isRendered(g, model)).map(grantKey));
}

export interface SavePlan {
  /** The body to send — every ticked cell, in grid order. */
  grants: Grant[];
  /** Original grants the grid doesn't show that the server keeps by itself (not sent). */
  keptByServer: Grant[];
  /** Original grants the grid doesn't show and the server would drop — saving must not run. */
  blocked: Grant[];
}

/**
 * What a save sends. `checked` is the grid's ticked cells (keys); `original` is
 * every grant the role (or the user's direct layer) holds now; `serverKeeps`
 * lists capabilities the endpoint preserves on its own (roles: proximity).
 */
export function planSave(original: readonly Grant[], checked: ReadonlySet<string>, model: MatrixModel, serverKeeps: readonly string[] = []): SavePlan {
  const grants: Grant[] = [];
  for (const m of model.modules) {
    for (const c of model.capabilities) {
      if (checked.has(`${m.id}:${c.key}`)) grants.push({ module_id: m.id, capability: c.key });
    }
  }
  const keptByServer: Grant[] = [];
  const blocked: Grant[] = [];
  const seen = new Set<string>();
  for (const g of original) {
    const k = grantKey(g);
    if (seen.has(k) || isRendered(g, model)) continue;
    seen.add(k);
    if (serverKeeps.includes(g.capability)) keptByServer.push({ module_id: g.module_id, capability: g.capability });
    else blocked.push({ module_id: g.module_id, capability: g.capability });
  }
  return { grants, keptByServer, blocked };
}

/** Same ticked cells? (Save is offered only when something changed.) */
export function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

/** "members:proximity, legacy:view" — for the notes under the grid. */
export function describeGrants(gs: readonly Grant[]): string {
  return gs.map(grantKey).join(", ");
}
