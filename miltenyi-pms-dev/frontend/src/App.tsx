import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Sidebar } from "@/layouts/Sidebar";
import { Topbar } from "@/layouts/Topbar";
// Login stays eager. It's the very first thing an unauthenticated user
// sees — making it lazy would force the user to wait for a chunk before
// even seeing the form. Every other route is code-split below.
import { Login } from "@/pages/Login";
import { PageTitleProvider } from "@/contexts/PageTitleProvider";
import { SidebarProvider } from "@/contexts/SidebarProvider";
import { useSidebar } from "@/hooks/useSidebar";
import { useAuth } from "@/hooks/useAuth";
import { useSystemSettings } from "@/hooks/useSystemSettings";

// ── Code-split routes ──────────────────────────────────────────────
// Each `lazy(() => import(...))` tells Vite to emit a separate JS chunk
// for that page. The chunk is fetched the first time the user navigates
// to its route, then cached by the browser for the rest of the session.
//
// Our pages use named exports (`export function Dashboard()`), but
// React.lazy expects `export default`. The `.then(m => ({ default: m.X }))`
// adapter bridges that without touching the page files. The default-export
// pages (AdminPanel, Unauthorized) skip the adapter.
const Dashboard = lazy(() =>
  import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const AnnualGoals = lazy(() =>
  import("@/pages/AnnualGoals").then((m) => ({ default: m.AnnualGoals })),
);
const AdminPanel = lazy(() => import("@/pages/AdminPanel"));
const Profile = lazy(() =>
  import("@/pages/Profile").then((m) => ({ default: m.Profile })),
);
const Unauthorized = lazy(() => import("@/pages/Unauthorized"));
const AnnualReviews = lazy(() =>
  import("@/pages/AnnualReviews").then((m) => ({ default: m.AnnualReviews })),
);
const ManagementReview = lazy(() =>
  import("@/pages/ManagementReview").then((m) => ({
    default: m.ManagementReview,
  })),
);
const ProjectReviews = lazy(() =>
  import("@/pages/ProjectReviews").then((m) => ({
    default: m.ProjectReviews,
  })),
);
const MyMentees = lazy(() =>
  import("@/pages/MyMentees").then((m) => ({ default: m.MyMentees })),
);
const MenteeDetail = lazy(() =>
  import("@/pages/MenteeDetail").then((m) => ({ default: m.MenteeDetail })),
);
const ChangePassword = lazy(() =>
  import("@/pages/ChangePassword").then((m) => ({
    default: m.ChangePassword,
  })),
);
const ResetPassword = lazy(() =>
  import("@/pages/ResetPassword").then((m) => ({ default: m.ResetPassword })),
);

/**
 * Wraps the route content. Reads `rightInsetPx` from the layout context so
 * an open right-side drawer (e.g. EvalDrawer) actually claims horizontal
 * space — the page reflows narrower instead of having content hidden under
 * the drawer. Drawer is still `position: fixed`; this is just the gutter.
 */
function MainContent() {
  const { rightInsetPx } = useSidebar();
  return (
    <main
      className="flex-1 overflow-y-auto bg-background p-6 transition-[padding] duration-200"
      style={{
        paddingRight: rightInsetPx ? rightInsetPx + 24 : undefined,
        // Extra one-notch zoom-out applied only to the main content
        // area. Sidebar stays at its current size. Layered on top of
        // the global 87.5% root font-size in index.css.
        zoom: 0.9,
      }}
    >
      {/* Inner Suspense boundary: catches lazy-loaded protected pages so
          only the content area shows the spinner while the next page's
          chunk downloads. The sidebar + topbar stay mounted, avoiding a
          full-screen flash on navigation. */}
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </main>
  );
}

/**
 * AppShell renders the persistent chrome (Sidebar + Topbar) around all
 * authenticated pages. <Outlet /> is where the matched child route renders.
 *
 * Hosts the simulated-today banner: when HR (or QA) has pinned a fake
 * "today" for cycle/window decisions, a thin amber stripe across the top
 * makes the override impossible to miss — no engineer or stakeholder
 * should be confused by mysteriously-shifted cycles.
 */
function AppShell() {
  return (
    <SidebarProvider>
      <PageTitleProvider>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <SimulatedTodayBanner />
            <Topbar />
            <MainContent />
          </div>
        </div>
      </PageTitleProvider>
    </SidebarProvider>
  );
}

function SimulatedTodayBanner() {
  const { settings } = useSystemSettings();
  if (!settings?.simulated_today) return null;
  return (
    <div
      role="status"
      className="shrink-0 bg-amber-100 px-4 py-1.5 text-center text-xs font-semibold text-amber-900"
    >
      Date simulation active — system is treating today as
      {" "}
      <span className="tabular-nums">{settings.simulated_today}</span>.
      Cycle text, review windows, and goal gates use the simulated date.
    </div>
  );
}

/**
 * Auth wrapper for /change-password — kept out of ProtectedRoute so it
 * doesn't trigger the must_change_password redirect loop. We still require
 * authentication: unauthenticated users get bounced to /login.
 */
function RequireAuth({ children }: Readonly<{ children: React.ReactNode }>) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

/**
 * Suspense fallback shown while a lazy-loaded page chunk is downloading.
 * Centred subtle spinner — sized to fill the content area without
 * looking like an error. Used by both Suspense boundaries in this file.
 */
function PageLoader() {
  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center">
      <div
        role="status"
        aria-label="Loading page"
        className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500"
      />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      {/* Outer Suspense boundary: catches lazy public routes
          (Unauthorized, ResetPassword, ChangePassword) that don't sit
          inside AppShell. The inner Suspense inside MainContent
          handles protected pages so the sidebar/topbar stay mounted
          across navigations. Nested boundaries are fine — React picks
          the nearest one. */}
      <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<Login />} />
        <Route path="/unauthorized" element={<Unauthorized />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/*
          Forced change-password screen. Authenticated but deliberately OUTSIDE
          ProtectedRoute so the must_change_password redirect doesn't loop.
        */}
        <Route
          path="/change-password"
          element={
            <RequireAuth>
              <ChangePassword />
            </RequireAuth>
          }
        />

        {/* Stage 1 — must be authenticated */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route element={<ProtectedRoute requiredFeature="dashboard" />}>
              <Route path="/dashboard" element={<Dashboard />} />
            </Route>

            <Route
              element={
                <ProtectedRoute
                  requiredFeature="goals"
                  requiredRole={["Employee", "Mentor", "HR_MyOrg"]}
                />
              }
            >
              <Route path="/annual-goals" element={<AnnualGoals />} />
            </Route>

            <Route
              element={
                <ProtectedRoute
                  requiredFeature="annual_reviews"
                  requiredRole={["Employee", "Mentor", "HR_MyOrg"]}
                />
              }
            >
              <Route path="/annual-reviews" element={<AnnualReviews />} />
            </Route>

            <Route element={<ProtectedRoute requiredFeature="admin" requiredRole={["HR_MyOrg", "HR_Miltenyi"]}/>}>
              <Route path="/admin" element={<AdminPanel />} />
            </Route>

            <Route element={<ProtectedRoute requiredRole={["HR_MyOrg"]}/>}>
              <Route path="/management-review" element={<ManagementReview />} />
            </Route>

            <Route
              element={
                <ProtectedRoute
                  requiredFeature="project_reviews"
                  requiredRole={["Employee", "PM", "Mentor", "HR_Miltenyi", "HR_MyOrg"]}
                />
              }
            >
              <Route path="/project-reviews" element={<ProjectReviews />} />
            </Route>
            {/* Profile — always visible, no feature gate */}
            <Route path="/profile" element={<Profile />} />

            <Route
              element={
                <ProtectedRoute
                  requiredFeature="mentoring"
                  requiredRole={["Mentor", "HR_MyOrg"]}
                />
              }
            >
              <Route path="/my-mentees" element={<MyMentees />} />
              <Route path="/my-mentees/:id" element={<MenteeDetail />} />
            </Route>

          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
