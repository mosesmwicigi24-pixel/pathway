// Authentication & authorization middleware (spec §1.4, §5.3, §5.4).
//
// In production the gateway validates the JWT signature and forwards signed
// internal identity headers (§1.4); services trust those. For the monolith we
// support both: if a trusted gateway header is present we use it, otherwise we
// validate the Bearer JWT ourselves. Either way the principal is attached to the
// request. RBAC role checks and leader_assignments scoping build on top.
import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@nuru/shared";
import type { Env } from "../config/env.js";
import { ApiError } from "./errors.js";
import { verifyAccessToken } from "../modules/identity/tokens.js";
import { many, type Queryable } from "../db/db.js";
import type { Principal } from "./http.js";

const ROLE_RANK: Record<UserRole, number> = {
  Student: 0,
  Instructor: 1,
  Admin: 2,
  SuperAdmin: 3,
};

/** Build the authenticate middleware. Populates req.principal or 401s. */
export function authenticate(env: Env) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const header = req.header("Authorization");
      if (!header?.startsWith("Bearer ")) {
        throw new ApiError("AUTH_REQUIRED", "Missing bearer token");
      }
      const claims = verifyAccessToken(env, header.slice("Bearer ".length).trim());
      req.principal = {
        userId: claims.sub,
        role: claims.role,
        congregationId: claims.cong,
        ...(claims.mfa === true ? { mfa: true } : {}),
        ...(typeof claims.mfa_at === "number" ? { mfaAt: claims.mfa_at } : {}),
        ...(typeof claims.pwd_at === "number" ? { pwdAt: claims.pwd_at } : {}),
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Require a minimum role (coarse RBAC, §5.4). */
export function requireRole(min: UserRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const p = req.principal;
    if (!p) return next(new ApiError("AUTH_REQUIRED", "Authentication required"));
    if (ROLE_RANK[p.role] < ROLE_RANK[min]) {
      return next(new ApiError("FORBIDDEN_SCOPE", "Insufficient role"));
    }
    next();
  };
}

/**
 * Fixed RBAC dimensions (module × capability) mirrored in the web client
 * (systemData) and the System ▸ Roles & Permissions matrix. Canonical home for
 * both arrays — system/index.ts imports them rather than redeclaring, so the
 * matrix UI, the effective-permission computation below, and the scope=admin
 * login gate can never drift apart.
 */
export const PERM_MODULES = [
  "dashboard", "levels", "cms", "quiz", "videos", "cells", "members",
  "reflections", "events", "finance", "certificates", "badges",
  "users", "rolesAdmin", "countries", "languages", "congregations", "live",
  // followUp: migration 198. Forgetting a new module HERE is how the Follow-up
  // section shipped invisible to the SuperAdmin on 2026-08-20: the DB grants
  // were right, the endpoints bridged SuperAdmin past every check, but /me
  // builds the SuperAdmin/Admin permission array from THIS list — and the
  // sidebars trust /me. A module that exists only in rbac_role_permissions is
  // a module the top role cannot see.
  "followUp",
  // The public website (nuruplace.org). Its own module so a communications
  // volunteer can be given the site WITHOUT members, finance or curriculum —
  // which is the whole reason the portal is the admin point for it. Listed
  // here for the reason above: a module missing from this array is invisible
  // to SuperAdmin no matter what the database says.
  "website",
] as const;
// `go`/`manage` are Nuru Live's (module `live`) capability pair — broadcast
// start vs. end-anyone's-stream oversight (docs/LIVE_STREAMING.md). They ride
// the same fixed CAPABILITIES dimension as every other module (mirrored 1:1 in
// the web client's systemData) rather than a hidden carve-out, per the
// module's registration instructions — unused for the other 17 modules,
// exactly like several of the generic 6 already are for some of them.
export const CAPABILITIES = ["view", "create", "edit", "delete", "approve", "export", "go", "manage"] as const;

export interface EffectivePermission {
  module_id: string;
  capability: string;
}

/** SuperAdmin/Admin are bridged past every requirePermission() check below, so
 *  their effective grant is "everything" — the full module × capability grid,
 *  rather than an empty (and misleading) array. */
function fullPermissionGrid(): EffectivePermission[] {
  const all: EffectivePermission[] = [];
  for (const m of PERM_MODULES) for (const c of CAPABILITIES) all.push({ module_id: m, capability: c });
  return all;
}

/**
 * The caller's effective (module, capability) grants (§5.4): the legacy
 * SuperAdmin/Admin bridge gets the full grid; everyone else gets the UNION of
 * their assigned roles' grants (rbac_role_permissions via rbac_user_roles) and
 * any direct per-user grant (rbac_user_permissions) — the same shape as
 * GET /admin/users/:id/permissions' "effective" field. This is the single
 * source of truth for (a) the scope=admin login refusal below — an account
 * with an EMPTY effective set has no reason to be in the console — and (b) the
 * `permissions` array surfaced on the login response and GET /me, which the
 * web/iPad shells use to show only the sidebar items a user can actually use.
 */
export async function effectivePermissions(
  q: Queryable,
  userId: string,
  role: string,
): Promise<EffectivePermission[]> {
  if (role === "SuperAdmin" || role === "Admin") return fullPermissionGrid();
  return many<EffectivePermission>(
    q,
    `SELECT DISTINCT rp.module_id, rp.capability
       FROM rbac_user_roles ur
       JOIN rbac_roles r ON r.role_key = ur.role_key AND r.status = 'active'
       JOIN rbac_role_permissions rp ON rp.role_key = ur.role_key
      WHERE ur.user_id = $1
     UNION
     SELECT module_id, capability FROM rbac_user_permissions WHERE user_id = $1`,
    [userId],
  );
}

/** "module:capability" keys, deduped + sorted — the wire shape clients see. */
export function permissionKeys(perms: EffectivePermission[]): string[] {
  return Array.from(new Set(perms.map((p) => `${p.module_id}:${p.capability}`))).sort();
}

/**
 * Fine-grained permission gate (§5.4). A caller holds a (module_id, capability)
 * cell if EITHER an assigned *active* role grants it (rbac_role_permissions) OR
 * the user has a direct per-user grant (rbac_user_permissions). Effective
 * permission is the UNION of the two — direct grants let an admin hand an
 * individual (e.g. an elevated member) a precise capability without a whole role.
 *
 * Legacy bridge: the coarse portal admins (SuperAdmin, Admin) always pass — these
 * endpoints were Admin-gated before RBAC, so their access is unchanged. Granular
 * RBAC roles (assigned via rbac_user_roles) extend access to non-admin accounts.
 * Returns a middleware bound to the given read pool.
 */
export function requirePermission(q: Queryable) {
  return (moduleId: string, capability: string) =>
    async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
      const p = req.principal;
      if (!p) return next(new ApiError("AUTH_REQUIRED", "Authentication required"));
      if (p.role === "SuperAdmin" || p.role === "Admin") return next();
      try {
        const rows = await many<{ ok: number }>(
          q,
          `SELECT 1 AS ok
             FROM rbac_user_roles ur
             JOIN rbac_roles r ON r.role_key = ur.role_key AND r.status = 'active'
             JOIN rbac_role_permissions rp ON rp.role_key = ur.role_key
            WHERE ur.user_id = $1 AND rp.module_id = $2 AND rp.capability = $3
           UNION ALL
           SELECT 1 AS ok
             FROM rbac_user_permissions up
            WHERE up.user_id = $1 AND up.module_id = $2 AND up.capability = $3
            LIMIT 1`,
          [p.userId, moduleId, capability],
        );
        if (rows.length > 0) return next();
        next(new ApiError("FORBIDDEN_SCOPE", "Missing permission for this action"));
      } catch (err) {
        next(err);
      }
    };
}

/**
 * Step-up MFA gate (§5.3): the presenting access token must carry a verified
 * second factor that is still fresh. Compose with requireRole for SuperAdmin /
 * financial-config actions, e.g. `r.post(path, auth, requireRole("SuperAdmin"),
 * requireStepUp(), handler(...))`. The freshness window forces a re-prompt for
 * sensitive operations even within an otherwise-valid session.
 */
export function requireStepUp(maxAgeSeconds = 900) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const p = req.principal;
    if (!p) return next(new ApiError("AUTH_REQUIRED", "Authentication required"));
    const now = Math.floor(Date.now() / 1000);
    if (p.mfa !== true || typeof p.mfaAt !== "number" || now - p.mfaAt > maxAgeSeconds) {
      return next(
        new ApiError("FORBIDDEN_SCOPE", "Step-up MFA required for this action", {
          mfa_required: true,
        }),
      );
    }
    next();
  };
}

/**
 * Step-up PASSWORD gate (§5.3): the presenting access token must carry a recent
 * password re-confirmation (POST /auth/confirm-password re-mints it with pwd_at).
 *
 * Distinct from requireStepUp, which asks for a second FACTOR. This asks for the
 * thing only the account owner knows, and it answers a different question: an
 * unlocked, logged-in phone left on a desk is already past `auth` and past
 * `requireRole`. Before it opens sixty members' private answers to a broadcast,
 * the person holding it should have to prove they are the pastor.
 *
 * Compose after the role check:
 *   r.get(path, auth, requireRole("Instructor"), requirePasswordStepUp(), handler)
 *
 * Clients get 403 + details.password_required, which is their cue to prompt and
 * retry with the re-minted token — the same shape as mfa_required.
 */
export function requirePasswordStepUp(maxAgeSeconds = 900) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const p = req.principal;
    if (!p) return next(new ApiError("AUTH_REQUIRED", "Authentication required"));
    const now = Math.floor(Date.now() / 1000);
    if (typeof p.pwdAt !== "number" || now - p.pwdAt > maxAgeSeconds) {
      return next(
        new ApiError("FORBIDDEN_SCOPE", "Confirm your password to open this", {
          password_required: true,
          max_age_seconds: maxAgeSeconds,
        }),
      );
    }
    next();
  };
}

/**
 * Fine-grained scoping (§5.4): assert the caller may act on a given cell group.
 * SuperAdmin/Admin pass; an Instructor/Multiplier must have a leader_assignments
 * row for that cell. Enforced in the query layer — out-of-scope ids 403.
 */
export async function assertCellInScope(q: Queryable, principal: Principal, cellGroupId: string): Promise<void> {
  if (principal.role === "SuperAdmin" || principal.role === "Admin") return;
  const rows = await many<{ cell_group_id: string }>(
    q,
    `SELECT cell_group_id FROM leader_assignments WHERE leader_user_id = $1 AND cell_group_id = $2`,
    [principal.userId, cellGroupId],
  );
  if (rows.length === 0) {
    throw new ApiError("FORBIDDEN_SCOPE", "Cell group outside your assignments");
  }
}
