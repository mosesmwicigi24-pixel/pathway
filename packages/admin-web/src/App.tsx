// Nuru Pathway Web Portal — router, rebuilt to the "Final Pathway Portal" Figma
// make (ZMEsnrOJCXXY7rHfTBautI). The shell (Layout) + nav are the real product
// structure; each inner page is rebuilt to the make and replaces its placeholder
// in a later phase (see docs / task list P4–P7).
import { type ReactElement } from "react";
import { createBrowserRouter, RouterProvider, Navigate, useLocation, useParams } from "react-router-dom";
import { useAppSelector } from "./store/hooks";
import { pathPermissions, superAdminOnlyPaths, pathAliases, legacyPartnersRedirect } from "./components/shell/nav";
import { Layout } from "./components/shell/Layout";
import { Login } from "./components/pages/Login";
import { ResetPassword } from "./components/pages/ResetPassword";
import { Dashboard } from "./components/pages/Dashboard";
import { CurriculumDashboard } from "./components/pages/CurriculumDashboard";
import { CurriculumWorkspace } from "./components/pages/CurriculumWorkspace";
import { QuizBuilder } from "./components/pages/QuizBuilder";
import { VideoLibrary } from "./components/pages/VideoLibrary";
import { GrowthContent } from "./components/pages/GrowthContent";
import { ModulePreview } from "./components/pages/ModulePreview";
import { CellEngagement } from "./components/pages/CellEngagement";
import { CellDetail } from "./components/pages/CellDetail";
import { Members } from "./components/pages/Members";
import { FollowUp } from "./components/pages/FollowUp";
import { WebsiteEnquiries } from "./components/pages/WebsiteEnquiries";
import { Services } from "./components/pages/Services";
import { ReflectionQueue } from "./components/pages/ReflectionQueue";
import { LevelReviews } from "./components/pages/LevelReviews";
import { DiscipleshipHub } from "./components/pages/DiscipleshipHub";
import { Chat } from "./components/pages/Chat";
import { Broadcast } from "./components/pages/Broadcast";
import { JoinService } from "./components/pages/JoinService";
import { EventsHub } from "./components/events/EventsHub";
import { SeriesCommandCenter } from "./components/events/SeriesCommandCenter";
import { Partners } from "./components/pages/Partners";
// Finance — the ERP module (docs/FINANCE_ERP.md §1). The old single Finance
// page (components/pages/Finance.tsx) is no longer routed.
import { FinanceOverview } from "./components/pages/finance/Overview";
import { FinanceTransactions } from "./components/pages/finance/Transactions";
import { FinancePledges } from "./components/pages/finance/Pledges";
import { FinanceClaims } from "./components/pages/finance/Claims";
import { FinanceRecurring } from "./components/pages/finance/Recurring";
import { FinanceCampaigns } from "./components/pages/finance/Campaigns";
import { FinanceNeeds } from "./components/pages/finance/Needs";
import { FinanceExpenses } from "./components/pages/finance/Expenses";
import { FinanceBudgets } from "./components/pages/finance/Budgets";
import { FinanceFunds } from "./components/pages/finance/Funds";
import { FinanceLedger } from "./components/pages/finance/Ledger";
import { FinanceReconciliation } from "./components/pages/finance/Reconciliation";
import { FinanceReports } from "./components/pages/finance/Reports";
import { FinanceStatements } from "./components/pages/finance/Statements";
import { FinanceAudit } from "./components/pages/finance/Audit";
import { FinanceSettings } from "./components/pages/finance/Settings";
import { Departments } from "./components/pages/Departments";
import { Certificates } from "./components/pages/Certificates";
import { Badges } from "./components/pages/Badges";
import { MemberProfile } from "./components/pages/MemberProfile";
import { Profile } from "./components/pages/Profile";
import { Notifications } from "./components/pages/Notifications";
import { MemberIntelligence } from "./components/pages/MemberIntelligence";
import { FlockBrief } from "./components/pages/FlockBrief";
import { Proximity } from "./components/pages/Proximity";
import { RadioStudio } from "./components/pages/RadioStudio";
import { MixerStudio } from "./components/pages/MixerStudio";
import { UploadsSessions } from "./components/pages/UploadsSessions";
import { Users } from "./components/pages/Users";
import { Roles } from "./components/pages/Roles";
import { Congregations } from "./components/pages/Congregations";
import { Countries } from "./components/pages/Countries";
import { Languages } from "./components/pages/Languages";
import { SmsCenter } from "./components/pages/SmsCenter";
import { NotificationsProvider } from "./components/notifications/NotificationsProvider";

/**
 * Route guard mirroring the sidebar filter (nav.tsx navItemVisible): a
 * permitted-but-limited user who types/bookmarks a path their permissions
 * don't grant is bounced to "/", the same as if the sidebar item were never
 * there. This is UX only — the server keeps enforcing every route regardless
 * (requirePermission on the corresponding endpoint), so a redirect here is a
 * courtesy, not the security boundary.
 *
 * Fails OPEN while permissions haven't loaded yet (null, right after a fresh
 * login/reload before GET /me resolves) — never bounce on a guess.
 */
function Guarded({ children }: { children: ReactElement }): ReactElement {
  const { role, permissions } = useAppSelector((s) => s.auth);
  const location = useLocation();
  const path = pathAliases[location.pathname] ?? location.pathname;
  if (superAdminOnlyPaths.includes(path) && role !== "SuperAdmin") return <Navigate to="/" replace />;
  const required = pathPermissions[path];
  if (required && permissions && !permissions.includes(required)) return <Navigate to="/" replace />;
  return children;
}

/** Old /partners links → Finance (nav.tsx legacyPartnersRedirect): the query
 *  string rides along (?partner=<id> still opens the drawer); ?tab=claims
 *  lands on the Claims page. */
function RedirectPartners(): ReactElement {
  const { search, hash } = useLocation();
  return <Navigate to={legacyPartnersRedirect(search, hash)} replace />;
}

/** Old deep link /cms/level/:id → the workspace's ?level=N deep link. */
function RedirectCmsLevel(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const n = id ? parseInt(id, 10) : NaN;
  return <Navigate to={Number.isFinite(n) ? `/curriculum/workspace?level=${n}` : "/curriculum/workspace"} replace />;
}

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  { path: "/reset-password", element: <ResetPassword /> },
  { path: "/preview/:moduleId", element: <ModulePreview /> },
  // Public: the printed standing QR lands here (see JoinService.tsx). No auth,
  // no shell — the person holding the phone may have walked in ten seconds ago.
  { path: "/jc/:code", element: <JoinService /> },
  {
    path: "/",
    element: <Layout />,
    children: [
      // Every child route is wrapped in <Guarded> — a no-op for paths with no
      // entry in nav.tsx's pathPermissions/superAdminOnlyPaths (e.g. detail
      // sub-pages and profile), a redirect to "/" otherwise.
      { index: true, element: <Guarded><Dashboard /></Guarded> },
      { path: "dashboard", element: <Guarded><Dashboard /></Guarded> },
      // The two curriculum workspaces (docs/CURRICULUM_ARCHITECTURE.md §5).
      { path: "curriculum", element: <Guarded><CurriculumDashboard /></Guarded> },
      { path: "curriculum/workspace", element: <Guarded><CurriculumWorkspace /></Guarded> },
      // Old five-page CMS routes REDIRECT into the two workspaces.
      { path: "curriculum-levels", element: <Navigate to="/curriculum" replace /> },
      { path: "cms", element: <Navigate to="/curriculum" replace /> },
      { path: "level-detail", element: <Navigate to="/curriculum/workspace" replace /> },
      { path: "cms/level/:id", element: <RedirectCmsLevel /> },
      // Kept as a context-aware editor (?level=N) — no sidebar entry.
      { path: "quiz-builder", element: <Guarded><QuizBuilder /></Guarded> },
      { path: "video-library", element: <Guarded><VideoLibrary /></Guarded> },
      { path: "content-studio", element: <Guarded><GrowthContent /></Guarded> },
      { path: "cell-engagement", element: <Guarded><CellEngagement /></Guarded> },
      { path: "cell-engagement/:cellId", element: <Guarded><CellDetail /></Guarded> },
      { path: "members", element: <Guarded><Members /></Guarded> },
      { path: "services", element: <Guarded><Services /></Guarded> },
      { path: "follow-up", element: <Guarded><FollowUp /></Guarded> },
      { path: "website/enquiries", element: <Guarded><WebsiteEnquiries /></Guarded> },
      { path: "member-profile", element: <Guarded><MemberProfile /></Guarded> },
      { path: "profile", element: <Profile /> },
      { path: "notifications", element: <Guarded><Notifications /></Guarded> },
      { path: "reflection-queue", element: <Guarded><ReflectionQueue /></Guarded> },
      { path: "level-reviews", element: <Guarded><LevelReviews /></Guarded> },
      { path: "discipleship-hub", element: <Guarded><DiscipleshipHub /></Guarded> },
      { path: "chat", element: <Guarded><Chat /></Guarded> },
      { path: "broadcast", element: <Guarded><Broadcast /></Guarded> },
      { path: "sms", element: <Guarded><SmsCenter /></Guarded> },
      // Events page family (EVENTS_ARCHITECTURE §9): the Operations Center hub
      // and the per-series Command Center.
      { path: "events", element: <Guarded><EventsHub /></Guarded> },
      { path: "events/series/:id", element: <Guarded><SeriesCommandCenter /></Guarded> },
      // Finance (docs/FINANCE_ERP.md §1): Overview at /finance and one route per
      // sub-page — every path is in nav.tsx's Finance group, so each is gated
      // finance:view by the same pathPermissions the sidebar uses.
      { path: "finance", element: <Guarded><FinanceOverview /></Guarded> },
      { path: "finance/transactions", element: <Guarded><FinanceTransactions /></Guarded> },
      { path: "finance/pledges", element: <Guarded><FinancePledges /></Guarded> },
      { path: "finance/partners", element: <Guarded><Partners /></Guarded> },
      { path: "finance/claims", element: <Guarded><FinanceClaims /></Guarded> },
      { path: "finance/recurring", element: <Guarded><FinanceRecurring /></Guarded> },
      { path: "finance/campaigns", element: <Guarded><FinanceCampaigns /></Guarded> },
      { path: "finance/needs", element: <Guarded><FinanceNeeds /></Guarded> },
      { path: "finance/expenses", element: <Guarded><FinanceExpenses /></Guarded> },
      { path: "finance/budgets", element: <Guarded><FinanceBudgets /></Guarded> },
      { path: "finance/funds", element: <Guarded><FinanceFunds /></Guarded> },
      { path: "finance/ledger", element: <Guarded><FinanceLedger /></Guarded> },
      { path: "finance/reconciliation", element: <Guarded><FinanceReconciliation /></Guarded> },
      { path: "finance/reports", element: <Guarded><FinanceReports /></Guarded> },
      { path: "finance/statements", element: <Guarded><FinanceStatements /></Guarded> },
      { path: "finance/audit", element: <Guarded><FinanceAudit /></Guarded> },
      { path: "finance/settings", element: <Guarded><FinanceSettings /></Guarded> },
      { path: "partners", element: <RedirectPartners /> },
      { path: "departments", element: <Guarded><Departments /></Guarded> },
      { path: "certificates", element: <Guarded><Certificates /></Guarded> },
      { path: "badges", element: <Guarded><Badges /></Guarded> },
      { path: "radio", element: <Guarded><RadioStudio /></Guarded> },
      { path: "mixer", element: <Guarded><MixerStudio /></Guarded> },
      { path: "uploads-sessions", element: <Guarded><UploadsSessions /></Guarded> },
      { path: "intelligence", element: <Guarded><MemberIntelligence /></Guarded> },
      { path: "flock-brief", element: <Guarded><FlockBrief /></Guarded> },
      { path: "proximity", element: <Guarded><Proximity /></Guarded> },
      { path: "users", element: <Guarded><Users /></Guarded> },
      { path: "roles", element: <Guarded><Roles /></Guarded> },
      { path: "congregations", element: <Guarded><Congregations /></Guarded> },
      { path: "countries", element: <Guarded><Countries /></Guarded> },
      { path: "languages", element: <Guarded><Languages /></Guarded> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App(): ReactElement {
  return (
    <NotificationsProvider>
      <RouterProvider router={router} />
    </NotificationsProvider>
  );
}
