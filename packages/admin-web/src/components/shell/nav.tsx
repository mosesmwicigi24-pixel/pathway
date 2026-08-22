// Portal navigation model — the four sidebar groups + per-route page titles,
// rebuilt to the "Final Pathway Portal" Figma make. Routes drive react-router.
import {
  LayoutDashboard, Users, CalendarDays, Wallet, Award, Layers,
  TrendingUp, MessageSquare, MessagesSquare, Video, Star, AlignLeft, Bell,
  Shield, Globe, Languages as LanguagesIcon, UserCog, Church, Sparkles, Brain, MapPin,
  Radio, SlidersVertical, ListMusic, UserCheck, UserRoundCheck, HeartHandshake, HeartPulse, Megaphone, QrCode,
  Inbox,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  superAdminOnly?: boolean;
  /**
   * Required permission key ("module:capability") from the effective set
   * surfaced on /auth/login (scope=admin) and /me. Derived directly from the
   * requirePermission(module, capability) guard on that page's primary
   * data-fetch endpoint (see packages/backend/src/modules/*\/index.ts) — SAME
   * keys, no separate mapping to drift. Absent = "no sensible single-permission
   * mapping" (the endpoint is gated by a coarse requireRole(...) instead, or by
   * nothing at all) — the item stays visible to every console user; the server
   * keeps enforcing its own gate regardless of what the sidebar shows.
   */
  permission?: string;
}
export interface NavGroup { label: string; items: NavItem[] }

export const navGroups: NavGroup[] = [
  {
    label: "Portal",
    items: [
      { path: "/", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard:view" },
      // /admin/notifications is itself gated on dashboard:view (adminops).
      { path: "/notifications", label: "Notifications", icon: Bell, permission: "dashboard:view" },
    ],
  },
  {
    label: "Curriculum",
    items: [
      // The two workspaces (docs/CURRICULUM_ARCHITECTURE.md §5): the Dashboard
      // (health/attention/activity — one stats call) and the Levels & Modules
      // workspace (tree + sectioned module editor). Quiz Builder keeps its
      // route as a context-aware editor but has NO sidebar entry; the old
      // five-page routes redirect here (App.tsx).
      { path: "/curriculum", label: "Curriculum Dashboard", icon: AlignLeft, permission: "levels:view" },
      { path: "/curriculum/workspace", label: "Levels & Modules", icon: Layers, permission: "cms:view" },
      // growth-content admin routes are requireRole("Admin") — coarse, no RBAC
      // permission to key off; stays visible (the server still enforces Admin+).
      { path: "/content-studio", label: "Content Studio", icon: Sparkles },
    ],
  },
  {
    label: "Media",
    items: [
      { path: "/video-library", label: "Video Library", icon: Video, permission: "videos:view" },
      // Radio/mixer/uploads are gated on a "radio" permission that isn't one of
      // the 17 grantable RBAC modules (no role or direct grant can ever hold
      // it) — hiding on it would blank these for everyone below Admin. Visible.
      { path: "/radio", label: "Radio Studio", icon: Radio },
      { path: "/mixer", label: "Audio Mixer", icon: SlidersVertical },
      { path: "/uploads-sessions", label: "Uploads & Sessions", icon: ListMusic },
    ],
  },
  {
    label: "Operations",
    items: [
      // Cell Engagement's data (AdminApi.engagementReport) is gated on
      // dashboard:view, not a separate "cells" permission (§5.4 P3 migration gap).
      { path: "/cell-engagement", label: "Cell Engagement", icon: TrendingUp, permission: "dashboard:view" },
      // requireRole("Instructor") coarse gate — no RBAC permission. Visible.
      { path: "/discipleship-hub", label: "Discipleship Hub", icon: HeartHandshake },
      { path: "/members", label: "Members", icon: Users, permission: "members:view" },
      // Reflection Queue / Level reviews / Events are still requireRole(Instructor)
      // coarse gates (not yet migrated to fine RBAC) — no sensible permission
      // key to hide them on. Visible; the server keeps its own gate.
      { path: "/reflection-queue", label: "Reflection Queue", icon: MessageSquare },
      { path: "/level-reviews", label: "Level reviews", icon: UserCheck },
      { path: "/events", label: "Events", icon: CalendarDays },
      { path: "/finance", label: "Finance", icon: Wallet, permission: "finance:view" },
      { path: "/certificates", label: "Certificates", icon: Award, permission: "certificates:view" },
      { path: "/badges", label: "Badges", icon: Star, permission: "badges:view" },
    ],
  },
  {
    // Follow-up is its own section, not a row inside Operations (owner ruling,
    // 2026-08-17). It is a distinct pastoral job — a list of names, phone
    // numbers, missed services and what was said on the last call — and it is
    // gated on its own `followUp` module (migration 198) rather than on
    // members:view. The people who ring round on a Monday are often not the
    // people who administer the roll, and a follow_up_team role grants this
    // section and nothing else.
    label: "Follow-up",
    items: [
      { path: "/services", label: "Church Services", icon: QrCode, permission: "followUp:view" },
      { path: "/follow-up", label: "To call", icon: UserRoundCheck, permission: "followUp:view" },
    ],
  },
  {
    label: "Communication",
    items: [
      // Just `auth` server-side — no RBAC permission gate. Visible.
      { path: "/chat", label: "Chat", icon: MessagesSquare },
      // Between the shepherd and the flock — the item itself is hidden from
      // everyone below SuperAdmin (the server enforces it regardless).
      { path: "/broadcast", label: "Broadcast", icon: Megaphone, superAdminOnly: true },
    ],
  },
  {
    label: "System",
    items: [
      // Member Intelligence / Flock Brief are requireRole("Instructor"/"Admin")
      // coarse gates, not fine RBAC permissions. Visible.
      { path: "/intelligence", label: "Member Intelligence", icon: Brain },
      { path: "/flock-brief", label: "Flock Brief", icon: HeartPulse },
      { path: "/proximity", label: "Suggested Pairings", icon: MapPin, permission: "members:proximity" },
    ],
  },
  {
    // nuruplace.org is administered from here, not from a second CMS with its
    // own logins. Everything the public site shows lives under this one group,
    // and the `website` RBAC module gates all of it — so the person who runs
    // the site gets exactly the site, and not the membership roster or the
    // finance ledger (migration 198).
    label: "Website",
    items: [
      { path: "/website/enquiries", label: "Enquiries", icon: Inbox, permission: "website:view" },
    ],
  },
  {
    label: "Settings",
    items: [
      { path: "/users", label: "Users", icon: UserCog, permission: "users:view" },
      { path: "/roles", label: "Roles & Permissions", icon: Shield, permission: "rolesAdmin:view" },
      { path: "/congregations", label: "Congregations", icon: Church, permission: "congregations:view" },
      { path: "/countries", label: "Countries", icon: Globe, permission: "countries:view" },
      { path: "/languages", label: "Languages", icon: LanguagesIcon, permission: "languages:view" },
    ],
  },
];

/** True if the item should show for this role + permission set: superAdminOnly
 *  items need SuperAdmin; a permission-mapped item needs that key present;
 *  everything else (no mapping) defaults to visible (§ nav.tsx NavItem doc). */
export function navItemVisible(item: NavItem, role: string | null, permissions: string[] | null): boolean {
  if (item.superAdminOnly && role !== "SuperAdmin") return false;
  if (item.permission && permissions && !permissions.includes(item.permission)) return false;
  return true;
}

// ── Route guard support (App.tsx) ──
// Path → required permission key, flattened from the nav model above so the
// sidebar and the route guard can never disagree about what a path needs.
export const pathPermissions: Record<string, string> = {
  ...Object.fromEntries(
    navGroups.flatMap((g) => g.items).filter((i): i is NavItem & { permission: string } => !!i.permission)
      .map((i) => [i.path, i.permission]),
  ),
  // Quiz Builder kept its route (context-aware editor, no sidebar entry) and
  // its original gate — same key the exam endpoints enforce server-side.
  "/quiz-builder": "quiz:view",
};
export const superAdminOnlyPaths: string[] = navGroups.flatMap((g) => g.items).filter((i) => i.superAdminOnly).map((i) => i.path);
// Router aliases that don't have their own nav entry but share a nav item's gate.
export const pathAliases: Record<string, string> = {
  "/dashboard": "/",
};

export const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/curriculum": "Curriculum Dashboard",
  "/curriculum/workspace": "Levels & Modules",
  "/quiz-builder": "Level Quiz Builder",
  "/video-library": "Video Library",
  "/content-studio": "Content Studio",
  "/dashboard": "Dashboard",
  "/cell-engagement": "Cell Engagement",
  "/members": "Members",
  "/services": "Church Services",
  "/follow-up": "Attendance Follow-up",
  "/website/enquiries": "Website Enquiries",
  "/member-profile": "Member Profile",
  "/profile": "My Profile",
  "/notifications": "Notifications",
  "/reflection-queue": "Reflection Queue",
  "/level-reviews": "Level Reviews",
  "/discipleship-hub": "Discipleship Hub",
  "/chat": "Chat",
  "/broadcast": "Broadcast",
  "/events": "Events & Attendance",
  "/finance": "Finance",
  "/certificates": "Certificates & Badges",
  "/badges": "Badges Catalog",
  "/radio": "Radio Studio",
  "/mixer": "Audio Mixer",
  "/uploads-sessions": "Uploads & Sessions",
  "/intelligence": "Member Intelligence",
  "/flock-brief": "Flock Brief",
  "/proximity": "Suggested Pairings",
  "/users": "System Users",
  "/roles": "Roles & Permissions",
  "/congregations": "Congregations",
  "/countries": "Countries",
  "/languages": "Languages",
};

export function titleFor(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname] as string;
  if (pathname.startsWith("/cell-engagement/")) return "Cell Detail";
  if (pathname.startsWith("/cms/level/")) return "CMS — Level Detail";
  if (pathname.startsWith("/events/series/")) return "Event Command Center";
  return "Nuru Pathway";
}
