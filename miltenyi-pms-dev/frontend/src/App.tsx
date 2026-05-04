import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Sidebar } from "./layouts/Sidebar";
import { Topbar } from "./layouts/Topbar";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { AnnualGoals } from "./pages/AnnualGoals";
import AdminPanel from "./pages/AdminPanel";
import { Profile } from "./pages/Profile";
import Unauthorized from "./pages/Unauthorized";
import { AnnualReviews } from "./pages/AnnualReviews";
import { ProjectReviews } from "./pages/ProjectReviews";
import { MyMentees } from "./pages/MyMentees";
import { MenteeDetail } from "./pages/MenteeDetail";
import { ChangePassword } from "./pages/ChangePassword";
import { ResetPassword } from "./pages/ResetPassword";
import { Feedback360 } from "./pages/Feedback360";
import { FeedbackGive } from "./pages/FeedbackGive";
import { PageTitleProvider } from "./contexts/PageTitleProvider";
import { SidebarProvider } from "./contexts/SidebarProvider";
import { useSidebar } from "./hooks/useSidebar";
import { useAuth } from "./hooks/useAuth";

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
      <Outlet />
    </main>
  );
}

/**
 * AppShell renders the persistent chrome (Sidebar + Topbar) around all
 * authenticated pages. <Outlet /> is where the matched child route renders.
 */
function AppShell() {
  return (
    <SidebarProvider>
      <PageTitleProvider>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar />
            <MainContent />
          </div>
        </div>
      </PageTitleProvider>
    </SidebarProvider>
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

export default function App() {
  return (
    <BrowserRouter>
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

            <Route element={<ProtectedRoute requiredFeature="goals" />}>
              <Route path="/annual-goals" element={<AnnualGoals />} />
            </Route>

            <Route
              element={<ProtectedRoute requiredFeature="annual_reviews" />}
            >
              <Route path="/annual-reviews" element={<AnnualReviews />} />
            </Route>

            <Route element={<ProtectedRoute requiredFeature="admin" requiredRole={["Admin"]}/>}>
              <Route path="/admin" element={<AdminPanel />} />
            </Route>

            <Route element={<ProtectedRoute requiredFeature="project_reviews" />}>
              <Route path="/project-reviews" element={<ProjectReviews />} />
            </Route>
            {/* Profile — always visible, no feature gate */}
            <Route path="/profile" element={<Profile />} />

            <Route element={<ProtectedRoute requiredFeature="mentoring" />}>
              <Route path="/my-mentees" element={<MyMentees />} />
              <Route path="/my-mentees/:id" element={<MenteeDetail />} />
            </Route>

            <Route element={<ProtectedRoute requiredFeature="feedback_360" />}>
              <Route path="/feedback" element={<Feedback360 />} />
              <Route path="/feedback/give/:id" element={<FeedbackGive />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
