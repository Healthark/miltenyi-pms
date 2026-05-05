import {
  LayoutDashboard,
  Briefcase,
  Target,
  Users,
  FileText,
  MessagesSquare,
  User,
  HelpCircle,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useSidebar } from "../hooks/useSidebar";

interface NavItemData {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly feature?: string;
  readonly requiredRole?: readonly string[];
}

const ORG_ASSETS: Record<number, { logo: string; logoSmall: string; displayName: string; logoClass: string }> = {
  1: {
    logo: "/healtharklogov2.png",
    logoSmall: "/healtharklogo-small.png",
    displayName: "Healthark Insights",
    logoClass: "h-7 w-auto object-contain shrink-0 max-w-[140px]", 
  },
  2: {
    logo: "/miltenyi-biotec-logo.svg",
    logoSmall: "/miltenyi-biotech-small.svg", 
    displayName: "Miltenyi Biotec",
    logoClass: "h-10 w-auto object-contain shrink-0 max-w-[180px]", 
  },
};

const NavItem = ({
  item,
  isCollapsed,
}: {
  readonly item: NavItemData;
  readonly isCollapsed: boolean;
}) => {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.path}
      title={isCollapsed ? item.label : undefined}
      className={({ isActive }) =>
        `w-full flex items-center rounded-lg transition-all duration-200 ${
          isCollapsed ? "justify-center py-2.5 px-0" : "px-3 py-2 gap-2.5"
        } ${
          isActive
            ? "bg-brand-light text-brand font-semibold border-l-2 border-accent"
            : "text-text-muted hover:bg-slate-50 hover:text-text-main font-medium border-l-2 border-transparent"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={`w-4 h-4 shrink-0 transition-colors ${
              isActive ? "text-brand" : "text-text-muted"
            }`}
          />
          {!isCollapsed && (
            <span className="text-sm whitespace-nowrap overflow-hidden">
              {item.label}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
};

const MAIN_NAV: NavItemData[] = [
  { id: "dashboard", path: "/dashboard", label: "Dashboard", icon: LayoutDashboard, feature: "dashboard" },
  { id: "project-reviews", path: "/project-reviews", label: "Project Reviews", icon: Briefcase, feature: "project_reviews" },
  { id: "annual-goals", path: "/annual-goals", label: "Annual Goals", icon: Target, feature: "goals" },
  { id: "annual-reviews", path: "/annual-reviews", label: "Annual Reviews", icon: FileText, feature: "annual_reviews" },
  { id: "my-mentees", path: "/my-mentees", label: "My Mentees", icon: Users, feature: "mentoring" },
  { id: "feedback", path: "/feedback", label: "360 Feedback", icon: MessagesSquare, feature: "feedback_360" },
  { id: "admin", path: "/admin", label: "Admin Panel", icon: Settings, feature: "admin", requiredRole: ["Admin"] },
];

const BOTTOM_NAV: NavItemData[] = [
  { id: "profile", path: "/profile", label: "Profile", icon: User },
  { id: "support", path: "/support", label: "Support", icon: HelpCircle },
];

export function Sidebar() {
  // Lifted to context so other surfaces (e.g. EvalDrawer) can collapse the
  // sidebar on demand and restore it on close.
  const { collapsed: isCollapsed, setCollapsed } = useSidebar();
  const navigate = useNavigate();
  const { logout, hasFeature, user } = useAuth();

  // Safely grab the org_id, default to 1 (Healthark) if something goes wrong
  const currentOrgId = user?.org_id || 1; 
  const activeAssets = ORG_ASSETS[currentOrgId] || ORG_ASSETS[1];
  // ----------------------

  const handleLogout = (): void => {
    logout();
    navigate("/login", { replace: true });
  };

  const isVisible = (item: NavItemData): boolean => {
    if (item.feature && !hasFeature(item.feature)) return false;
    if (item.requiredRole && !item.requiredRole.includes(user?.role ?? "")) {
      return false;
    }
    return true;
  };

  const visibleMainNav = MAIN_NAV.filter(isVisible);

  return (
    <aside
      className={`${
        isCollapsed ? "w-16" : "w-56"
      } h-screen shrink-0 bg-surface border-r border-border flex flex-col transition-all duration-300 relative`}
    >
      <button
        onClick={() => setCollapsed(!isCollapsed)}
        className="absolute -right-3.5 top-6 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-text-muted hover:text-brand shadow-sm z-50 transition-colors"
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </button>

      {/* --- DYNAMIC LOGO RENDER HERE --- */}
      <div
        className={`h-14 flex items-center border-b border-border transition-all duration-300 ${
          isCollapsed ? "justify-center px-0" : "px-4"
        }`}
      >
        {isCollapsed ? (
          <img
            src={activeAssets.logoSmall}
            alt={activeAssets.displayName}
            className="h-8 w-8 object-contain shrink-0"
          />
        ) : (
          <>
            <img
              src={activeAssets.logo}
              alt={activeAssets.displayName}
              className={activeAssets.logoClass} 
            />
            {/* Removed the org_id check so PMS shows for everyone */}
            <span className="text-text-muted font-normal text-sm ml-2 shrink-0 whitespace-nowrap mt-4">
              PMS
            </span>
          </>
        )}
      </div>
      {/* -------------------------------- */}

      <nav
        aria-label="Main menu"
        className="flex-1 px-2.5 py-4 flex flex-col gap-1 overflow-y-auto overflow-x-hidden"
      >
        {visibleMainNav.map((item) => (
          <NavItem key={item.id} item={item} isCollapsed={isCollapsed} />
        ))}
      </nav>

      <div className="p-2.5 border-t border-border flex flex-col gap-1 overflow-x-hidden">
        {BOTTOM_NAV.map((item) => (
          <NavItem key={item.id} item={item} isCollapsed={isCollapsed} />
        ))}

        <button
          onClick={handleLogout}
          title={isCollapsed ? "Logout" : undefined}
          className={`w-full flex items-center rounded-lg text-red-600 hover:bg-red-50 font-medium transition-colors mt-1.5 ${
            isCollapsed ? "justify-center py-2.5 px-0" : "px-3 py-2 gap-2.5"
          }`}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!isCollapsed && (
            <span className="text-sm whitespace-nowrap">Logout</span>
          )}
        </button>
      </div>
    </aside>
  );
}