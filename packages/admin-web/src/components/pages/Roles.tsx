// Roles & Permissions — System page rebuilt to the make, wired to the real RBAC
// API (SystemApi.roles / createRole / updateRole / setRolePermissions / deleteRole).
// The permission grid is drawn from the server's own catalog
// (GET /admin/permissions/catalog — PERM_MODULES × CAPABILITIES), never from a
// list kept here: a save replaces the role's whole matrix, and the old
// hard-coded 6-capability grid silently stripped finance:manage and
// live:go/manage on every save (docs/FINANCE_ERP.md §6). The save plan
// (components/finance/a/permissionMatrix.ts) sends every ticked cell, leaves
// system-managed `proximity` grants to the server (it keeps them), and refuses
// to save if the role holds anything else the grid can't show. Built-in roles
// can't be deleted; Super Admin is always full and cannot be restricted.
import { useCallback, useEffect, useMemo, useState, Fragment, type ReactElement, type CSSProperties } from "react";
import {
  ChevronRight, Pencil, Plus, Shield, ShieldCheck, ShieldAlert, ShieldHalf, Trash2, Search,
  Globe, UsersRound, BookOpenCheck, HeartHandshake, X, Check, Lock, RotateCcw, Save, AlertTriangle, RefreshCw,
} from "lucide-react";
import { SystemApi, type SystemRole, type RolePermission } from "../../api/client";
import { financeErrorMessage } from "../../api/finance";
import { errorMessage } from "../../util/error";
import {
  ROLE_SERVER_KEPT_CAPABILITIES,
  describeGrants,
  initialChecked,
  planSave,
  sameKeys,
  type Grant,
  type MatrixModel,
} from "../finance/a/permissionMatrix";
import { usePermissionCatalog } from "../finance/a/usePermissionCatalog";

const roleChip: Record<SystemRole["role_type"], { bg: string; color: string }> = {
  system: { bg: "#FDECEC", color: "#A8281F" },
  staff: { bg: "#EEF1F8", color: "#1F3A6B" },
  field: { bg: "#E8F6EE", color: "#0F6B33" },
};
const typeIcon: Record<SystemRole["role_type"], { Icon: typeof Shield; tone: string; bg: string }> = {
  system: { Icon: ShieldAlert, tone: "#A8281F", bg: "#FDECEC" },
  staff: { Icon: BookOpenCheck, tone: "#8A6B1F", bg: "#FDF5E5" },
  field: { Icon: ShieldCheck, tone: "#0B7285", bg: "#E0F2F4" },
};
const KEY_ICONS: Record<string, { Icon: typeof Shield; tone: string; bg: string }> = {
  super_admin: { Icon: ShieldAlert, tone: "#A8281F", bg: "#FDECEC" },
  national_director: { Icon: Globe, tone: "#1F3A6B", bg: "#EEF1F8" },
  regional_coach: { Icon: UsersRound, tone: "#7C3AED", bg: "#F3E8FF" },
  curriculum_editor: { Icon: BookOpenCheck, tone: "#8A6B1F", bg: "#FDF5E5" },
  pastoral_reviewer: { Icon: HeartHandshake, tone: "#0F6B33", bg: "#E8F6EE" },
  discipler: { Icon: ShieldCheck, tone: "#0B7285", bg: "#E0F2F4" },
};

export function Roles(): ReactElement {
  const [list, setList] = useState<SystemRole[]>([]);
  const [query, setQuery] = useState("");
  const [openRole, setOpenRole] = useState<SystemRole | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editRole, setEditRole] = useState<SystemRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => { try { setList(await SystemApi.roles()); } catch (e) { setError(errorMessage(e, "Could not load roles.")); } }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => list.filter((r) => !query || `${r.name} ${r.role_key}`.toLowerCase().includes(query.toLowerCase())), [list, query]);
  const KEY_ORDER = ["super_admin", "national_director", "regional_coach", "curriculum_editor", "pastoral_reviewer", "discipler"];
  const keyRoles = useMemo(
    () => filtered.filter((r) => r.role_key in KEY_ICONS).sort((a, b) => (KEY_ORDER.indexOf(a.role_key) + 1 || 99) - (KEY_ORDER.indexOf(b.role_key) + 1 || 99)),
    [filtered],
  );
  const otherRoles = useMemo(() => filtered.filter((r) => !(r.role_key in KEY_ICONS)), [filtered]);

  async function deleteRole(role: SystemRole): Promise<void> {
    if (role.is_system) return;
    if (!window.confirm(`Delete the role "${role.name}"? This cannot be undone.`)) return;
    try { await SystemApi.deleteRole(role.role_key); await load(); } catch (e) { setError(errorMessage(e, "Delete failed.")); }
  }

  return (
    <div className="min-h-full" style={{ background: "var(--background)", minWidth: 0 }}>
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px, 4vw, 48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}><span>System</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Roles &amp; Permissions</span></div>
          <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Plus size={13} /> Create role</button>
        </div>
        <div className="mt-5">
          <p style={{ fontSize: 10.5, color: "#F5C77E", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 700, marginBottom: 8 }}>Access control</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, color: "#fff", fontSize: "clamp(24px, 4vw, 34px)", lineHeight: 1.05 }}>Roles &amp; Permissions</h1>
          <p style={{ fontSize: 13.5, color: "rgba(232,239,245,0.6)", marginTop: 8, maxWidth: 560, lineHeight: 1.5 }}>Define what each kind of user can do. Super Admin has full access; field and staff roles are scoped.</p>
        </div>
      </div>

      <div style={{ padding: "24px clamp(16px, 4vw, 48px) 48px" }}>
        {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}

        <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
          <div><div className="nuru-eyebrow nuru-eyebrow-gold" style={{ marginBottom: 4 }}>Access control</div><h2 className="type-section">Roles &amp; permissions</h2></div>
          <div className="flex items-center gap-2 rounded-lg" style={{ height: 38, background: "#fff", border: "1px solid var(--border)", padding: "0 12px", width: 240 }}><Search size={14} style={{ color: "var(--muted-foreground)" }} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search roles…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} /></div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl text-center py-12" style={{ border: "1px solid var(--border)", background: "var(--card)", fontSize: 14, color: "var(--muted-foreground)" }}>No roles match.</div>
        ) : (
          <div className="overflow-hidden rounded-2xl" style={{ border: "1px solid var(--border)", background: "var(--card)", boxShadow: "0 1px 3px rgba(11,31,51,0.05)" }}>
            {keyRoles.length > 0 && (
              <>
                <RoleGroupHeader title="Key roles" caption="Built-in access tiers" />
                {keyRoles.map((r, i) => <RoleRow key={r.role_key} role={r} divided={i > 0} onOpen={() => setOpenRole(r)} onEdit={() => setEditRole(r)} onDelete={() => deleteRole(r)} />)}
              </>
            )}
            {otherRoles.length > 0 && (
              <>
                <RoleGroupHeader title="Configured roles" caption={`${otherRoles.length} custom ${otherRoles.length === 1 ? "role" : "roles"}`} />
                {otherRoles.map((r, i) => <RoleRow key={r.role_key} role={r} divided={i > 0} onOpen={() => setOpenRole(r)} onEdit={() => setEditRole(r)} onDelete={() => deleteRole(r)} />)}
              </>
            )}
          </div>
        )}
      </div>

      {createOpen && <RoleModal roles={list} onClose={() => setCreateOpen(false)} onDone={async (key) => { setCreateOpen(false); await load(); const created = (await SystemApi.roles()).find((x) => x.role_key === key); if (created) setOpenRole(created); }} onError={setError} />}
      {editRole && <RoleModal roles={list} editRole={editRole} onClose={() => setEditRole(null)} onDone={async () => { setEditRole(null); await load(); }} onError={setError} />}
      {openRole && <PermissionsDrawer role={openRole} onClose={() => setOpenRole(null)} onSaved={async () => { setOpenRole(null); await load(); }} />}
    </div>
  );
}

const lbl: CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 };
const inp: CSSProperties = { width: "100%", height: 42, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "0 14px", color: "var(--foreground)", outline: "none" };

// Quiet section band that groups the one cohesive role list (iPad RoleGroupHeader).
function RoleGroupHeader({ title, caption }: { title: string; caption: string }): ReactElement {
  return (
    <div className="flex items-baseline gap-2" style={{ padding: "13px 16px 8px", background: "var(--secondary)", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "var(--nuru-gold)" }}>{title}</span>
      <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>{caption}</span>
    </div>
  );
}

// Members-style informative role row (iPad RoleRichRow): icon tile · name + mono key +
// type pill + description · perms / members metrics · status pill · right-aligned actions.
function RoleRow({ role, divided, onOpen, onEdit, onDelete }: { role: SystemRole; divided: boolean; onOpen: () => void; onEdit: () => void; onDelete: () => void }): ReactElement {
  const ic = KEY_ICONS[role.role_key] ?? typeIcon[role.role_type];
  const Icon = ic.Icon;
  const rc = roleChip[role.role_type];
  const active = role.status === "active";
  return (
    <div className="flex items-center gap-3" style={{ padding: "12px 16px", borderTop: divided ? "1px solid var(--border)" : "none" }}>
      <span className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 40, height: 40, background: ic.bg, color: ic.tone }}><Icon size={17} /></span>
      <div className="flex-1" style={{ minWidth: 0 }}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)" }}>{role.name}</span>
          <span className="inline-flex rounded-full px-2 py-0.5" style={{ background: rc.bg, color: rc.color, fontSize: 9.5, fontWeight: 700, textTransform: "capitalize" }}>{role.role_type}</span>
          {role.is_system && <span className="inline-flex rounded px-1.5 py-0.5" style={{ background: "rgba(200,155,60,0.12)", color: "var(--nuru-gold)", fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4 }}>BUILT-IN</span>}
        </div>
        <code style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted-foreground)" }}>{role.role_key}</code>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{role.description || "Scoped access tier."}</div>
        <div className="flex items-center gap-3" style={{ marginTop: 3 }}>
          <button onClick={onOpen} className="flex items-center gap-1" style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            <ShieldHalf size={11} style={{ color: "var(--nuru-gold)" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--nuru-navy)" }}>{role.permissions.length}</span>
            <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>perms</span>
          </button>
          <span className="flex items-center gap-1">
            <UsersRound size={11} style={{ color: "var(--muted-foreground)" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--nuru-navy)" }}>{role.user_count}</span>
            <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>{role.user_count === 1 ? "member" : "members"}</span>
          </span>
        </div>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 shrink-0" style={{ background: active ? "#E8F6EE" : "#F3F4F6", color: active ? "#0F6B33" : "#6B7280", fontSize: 11, fontWeight: 700, textTransform: "capitalize" }}><span style={{ width: 6, height: 6, borderRadius: 999, background: active ? "#0F6B33" : "#6B7280" }} /> {role.status}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={onEdit} title="Edit role" className="flex items-center justify-center rounded-lg" style={{ width: 32, height: 30, color: "var(--nuru-navy)", background: "rgba(11,31,51,0.06)", border: "none", cursor: "pointer" }}><Pencil size={13} /></button>
        <button onClick={onOpen} title="Permissions" className="flex items-center justify-center rounded-lg" style={{ width: 32, height: 30, color: "var(--nuru-navy)", background: "rgba(11,31,51,0.06)", border: "none", cursor: "pointer" }}><Shield size={13} /></button>
        <button onClick={onDelete} title={role.is_system ? "Built-in roles can't be deleted" : "Delete role"} disabled={role.is_system} className="flex items-center justify-center rounded-lg" style={{ width: 32, height: 30, color: role.is_system ? "var(--muted-foreground)" : "#DC2626", background: role.is_system ? "rgba(107,114,128,0.10)" : "rgba(220,38,38,0.10)", border: "none", cursor: role.is_system ? "not-allowed" : "pointer", opacity: role.is_system ? 0.6 : 1 }}><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

// One modal shell for both CREATE and EDIT (edit prefills from the role and
// PUTs via SystemApi.updateRole). In edit mode the copy-from picker is hidden
// (permissions live in the drawer) and built-in roles lock their type.
function RoleModal({ roles, editRole, onClose, onDone, onError }: { roles: SystemRole[]; editRole?: SystemRole; onClose: () => void; onDone: (key: string) => void; onError: (m: string) => void }): ReactElement {
  const editing = !!editRole;
  const typeLocked = !!editRole?.is_system;
  const [name, setName] = useState(editRole?.name ?? "");
  const [type, setType] = useState<SystemRole["role_type"]>(editRole?.role_type ?? "staff");
  const [description, setDescription] = useState(editRole?.description ?? "");
  const [copyFrom, setCopyFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const slug = editRole?.role_key ?? name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  async function submit(): Promise<void> {
    if (!name.trim()) { onError("Please enter a role name."); return; }
    setBusy(true);
    try {
      if (editRole) {
        await SystemApi.updateRole(editRole.role_key, { name: name.trim(), description: description.trim(), ...(typeLocked ? {} : { role_type: type }) });
        onDone(editRole.role_key);
      } else {
        const created = await SystemApi.createRole({ name: name.trim(), role_type: type, description: description.trim() || "Custom role.", ...(copyFrom ? { copy_from: copyFrom } : {}) });
        onDone(created.role_key);
      }
    } catch (e) { onError(errorMessage(e, editing ? "Update failed." : "Create failed.")); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "var(--card)", maxWidth: 540, maxHeight: "90vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}><Shield size={12} /> {editing ? "EDIT ROLE" : "NEW ROLE"}</div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 2 }}>{editing ? `Edit ${editRole?.name ?? "role"}` : "Create a role"}</h2>
            <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>{editing ? "Rename the role or update its type and description. Permissions are edited in the drawer." : "Name it, pick a starting permission set, then fine-tune the matrix."}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          <div><label style={lbl}>Role name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cell Coordinator" style={inp} />{slug && <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 5 }}>Key: <code style={{ fontFamily: "var(--font-mono)", color: "var(--nuru-navy)" }}>{slug}</code>{editing && " — fixed"}</div>}</div>
          <div>
            <label style={lbl}>Role type</label>
            <select value={type} onChange={(e) => setType(e.target.value as SystemRole["role_type"])} disabled={typeLocked} style={{ ...inp, fontWeight: 600, opacity: typeLocked ? 0.6 : 1, cursor: typeLocked ? "not-allowed" : undefined }}>
              {editRole?.role_type === "system" && <option value="system">System — platform owner</option>}
              <option value="staff">Staff — office / ministry</option>
              <option value="field">Field — front-line disciple-maker</option>
            </select>
            {typeLocked && <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 6 }}>Built-in role — its type is fixed.</div>}
          </div>
          <div><label style={lbl}>Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this role is responsible for…" style={{ ...inp, height: "auto", padding: "10px 14px", resize: "vertical", lineHeight: 1.5 }} /></div>
          {!editing && (
            <div><label style={lbl}>Starting permissions</label><select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} style={{ ...inp, fontWeight: 600 }}><option value="">Blank — no permissions</option>{roles.filter((r) => r.role_key !== "super_admin").map((r) => <option key={r.role_key} value={r.role_key}>Copy from: {r.name}</option>)}</select><div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 6 }}>You can adjust every capability in the next step.</div></div>
          )}
        </div>
        <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ borderTop: "1px solid var(--border)" }}><button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button><button onClick={() => void submit()} disabled={busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", opacity: busy ? 0.6 : 1 }}>{editing ? <><Save size={14} /> Save changes</> : <><Plus size={14} /> Create &amp; set permissions</>}</button></div>
      </div>
    </div>
  );
}

/** One grid cell: a ticked / unticked box, named for screen readers ("Finance — Manage"). */
function Box({ on, locked, label, onClick }: { on: boolean; locked: boolean; label: string; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className="flex items-center justify-center rounded-md mx-auto"
      style={{ width: 22, height: 22, border: `1.5px solid ${on ? "#16A34A" : "var(--border)"}`, background: on ? "#16A34A" : "var(--card)", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.7 : 1 }}
    >
      {on && <Check size={13} color="#fff" />}
    </button>
  );
}

/** The capabilities whose meaning isn't obvious, under the grid. */
function CapabilityLegend({ model }: { model: MatrixModel }): ReactElement | null {
  const hinted = model.capabilities.filter((c) => c.hint);
  if (hinted.length === 0) return null;
  return (
    <div style={{ marginTop: 14, display: "grid", gap: 4, fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
      {hinted.map((c) => (
        <div key={c.key}>
          <span style={{ fontWeight: 700, color: "var(--nuru-navy)" }}>{c.label}</span> — {c.hint}
        </div>
      ))}
    </div>
  );
}

function PermissionsDrawer({ role, onClose, onSaved }: { role: SystemRole; onClose: () => void; onSaved: () => void }): ReactElement {
  const locked = role.role_key === "super_admin";
  const catalog = usePermissionCatalog();
  const model = catalog.model;
  // The role's grants as they stand, widened: the client's Capability type
  // lags the server (go, manage, proximity arrive at runtime).
  const original = role.permissions as readonly Grant[];
  const initial = useMemo(() => (model ? initialChecked(original, model) : null), [model, original]);
  const [edits, setEdits] = useState<Set<string> | null>(null);
  const working = edits ?? initial;
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const plan = model && working ? planSave(original, working, model, ROLE_SERVER_KEPT_CAPABILITIES) : null;
  const dirty = Boolean(initial && working && !sameKeys(working, initial));
  const blocked = plan ? plan.blocked.length > 0 : false;
  const canSave = !locked && !busy && plan !== null && !blocked && dirty;

  const update = (fn: (s: Set<string>) => void): void => {
    if (locked || !working) return;
    const next = new Set(working);
    fn(next);
    setEdits(next);
  };
  const setCell = (key: string, val: boolean): void =>
    update((s) => {
      if (val) s.add(key);
      else s.delete(key);
    });
  const toggleRow = (modId: string): void =>
    update((s) => {
      if (!model) return;
      const keys = model.capabilities.map((c) => `${modId}:${c.key}`);
      const allOn = keys.every((k) => s.has(k));
      for (const k of keys) {
        if (allOn) s.delete(k);
        else s.add(k);
      }
    });
  const toggleColumn = (cap: string): void =>
    update((s) => {
      if (!model) return;
      const keys = model.modules.map((m) => `${m.id}:${cap}`);
      const allOn = keys.every((k) => s.has(k));
      for (const k of keys) {
        if (allOn) s.delete(k);
        else s.add(k);
      }
    });

  async function save(): Promise<void> {
    if (!canSave || !plan) return;
    setBusy(true);
    setSaveError(null);
    try {
      // Every ticked cell; `proximity` stays server-side (never in the body).
      await SystemApi.setRolePermissions(role.role_key, plan.grants as RolePermission[]);
      onSaved();
    } catch (e) {
      setSaveError(financeErrorMessage(e, "The permissions were not saved."));
    } finally {
      setBusy(false);
    }
  }

  const total = model ? model.modules.length * model.capabilities.length : 0;
  return (
    <div className="fixed inset-0 z-50 flex" style={{ background: "rgba(11,31,51,0.45)" }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Permissions — ${role.name}`} className="ml-auto flex flex-col" style={{ width: "min(820px, 100vw)", maxWidth: "100vw", height: "100%", background: "var(--card)", boxShadow: "-20px 0 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5" style={{ background: "var(--nuru-navy)", color: "#fff" }}>
          <div className="flex items-start justify-between gap-4">
            <div><div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}><Shield size={12} /> PERMISSIONS</div><h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, marginTop: 2 }}>{role.name}</h2><div style={{ fontSize: 12, color: "rgba(232,239,245,0.7)", marginTop: 4 }}><code style={{ fontFamily: "var(--font-mono)" }}>{role.role_key}</code> · {model && working ? `${working.size} of ${total} capabilities` : "loading the permission list…"}</div></div>
            <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5" style={{ background: "rgba(255,255,255,0.1)", border: "none" }}><X size={16} color="#fff" /></button>
          </div>
          {locked && <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5" style={{ background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11.5, fontWeight: 600 }}><Lock size={12} /> Super Admin always has full access and cannot be restricted.</div>}
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          {catalog.error ? (
            <div role="alert" className="rounded-xl" style={{ background: "#FDECEC", border: "1px solid #F5C2C0", color: "#B42318", padding: "12px 14px", fontSize: 13 }}>
              <div className="flex items-center gap-2" style={{ fontWeight: 700 }}><AlertTriangle size={14} /> {catalog.error}</div>
              <div style={{ color: "var(--nuru-navy)", marginTop: 6 }}>Without it this editor can&apos;t show every permission the server has, and saving a partial grid would remove the grants it can&apos;t see — so Save is off until the list loads.</div>
              <button onClick={catalog.retry} className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5" style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--nuru-navy)", fontSize: 12.5, fontWeight: 600 }}><RefreshCw size={12} /> Try again</button>
            </div>
          ) : !model || !working ? (
            <div className="text-center py-16" style={{ fontSize: 14, color: "var(--muted-foreground)" }}>Loading the permission list…</div>
          ) : (
            <>
              <table className="w-full border-collapse" style={{ minWidth: 200 + model.capabilities.length * 64 }}>
                <thead><tr>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted-foreground)" }}>Module</th>
                  {model.capabilities.map((c) => <th key={c.key} style={{ padding: "6px 4px", width: 64 }}><button onClick={() => toggleColumn(c.key)} disabled={locked} title={c.hint ?? `Toggle ${c.label} for every module`} style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: "var(--nuru-navy)", cursor: locked ? "default" : "pointer", background: "none", border: "none" }}>{c.label}</button></th>)}
                </tr></thead>
                <tbody>
                  {model.groups.map((g) => (
                    <Fragment key={g}>
                      <tr><td colSpan={model.capabilities.length + 1} style={{ padding: "12px 8px 5px" }}><span className="nuru-eyebrow nuru-eyebrow-gold">{g}</span></td></tr>
                      {model.modules.filter((m) => m.group === g).map((m) => (
                        <tr key={m.id} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={{ padding: "8px" }}><button onClick={() => toggleRow(m.id)} disabled={locked} className="text-left" title={m.label === m.id ? `${m.id} — a module this page has no label for yet` : `Toggle every capability for ${m.label}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)", cursor: locked ? "default" : "pointer", background: "none", border: "none" }}>{m.label}{m.label === m.id ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted-foreground)", marginLeft: 6 }}>(server module)</span> : null}</button></td>
                          {model.capabilities.map((c) => {
                            const key = `${m.id}:${c.key}`;
                            const on = working.has(key);
                            return <td key={c.key} style={{ padding: "6px 4px", textAlign: "center" }}><Box on={on} locked={locked} label={`${m.label} — ${c.label}`} onClick={() => setCell(key, !on)} /></td>;
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              <CapabilityLegend model={model} />
              {plan && plan.keptByServer.length > 0 ? (
                <div style={{ marginTop: 12, fontSize: 11.5, color: "var(--muted-foreground)" }}>
                  Also held, and kept by the server on every save (system-managed, not in this grid): <code style={{ fontFamily: "var(--font-mono)" }}>{describeGrants(plan.keptByServer)}</code>.
                </div>
              ) : null}
              {blocked && plan ? (
                <div role="alert" className="rounded-xl" style={{ marginTop: 12, background: "#FDECEC", border: "1px solid #F5C2C0", color: "#B42318", padding: "10px 12px", fontSize: 12.5 }}>
                  This role holds {plan.blocked.length === 1 ? "a grant" : "grants"} this editor can&apos;t show or save: <code style={{ fontFamily: "var(--font-mono)" }}>{describeGrants(plan.blocked)}</code>. Saving would remove {plan.blocked.length === 1 ? "it" : "them"}, so Save is off — ask a developer.
                </div>
              ) : null}
            </>
          )}
          {saveError ? <div role="alert" style={{ marginTop: 12, color: "#B42318", fontSize: 12.5, fontWeight: 600 }}>{saveError}</div> : null}
        </div>
        <div className="px-6 py-4 flex items-center justify-between gap-2" style={{ borderTop: "1px solid var(--border)", background: "var(--secondary)" }}>
          <button onClick={() => setEdits(null)} disabled={locked || !dirty} className="flex items-center gap-1.5" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted-foreground)", cursor: locked || !dirty ? "default" : "pointer", background: "none", border: "none", opacity: locked || !dirty ? 0.6 : 1 }}><RotateCcw size={13} /> Reset</button>
          <div className="flex items-center gap-2"><button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)", fontSize: 13, fontWeight: 600 }}>Cancel</button><button onClick={() => void save()} disabled={!canSave} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: canSave ? "var(--nuru-gold)" : "var(--muted)", color: canSave ? "#fff" : "var(--muted-foreground)", fontSize: 13, fontWeight: 600, border: "none", cursor: canSave ? "pointer" : "default", opacity: busy ? 0.6 : 1 }}><Save size={14} /> {busy ? "Saving…" : "Save changes"}</button></div>
        </div>
      </div>
    </div>
  );
}

