import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useLogout } from "../hooks/useLogout";
import { useAuthContext } from "../context/AuthContext";
import { can, isAdmin, getRole, getDashboardRoute } from "../utils/permissions";
import { commerceApi } from "../services/api";
import {
  ERP_NAV_GROUPS,
  ERP_TOP_LEVEL_ITEMS,
  EMPLOYEE_SELF_SERVICE_ITEMS,
  comingSoonHref,
} from "../config/erpNav";
import CommandPalette from "./ui/CommandPalette";
import "../Styles/admin-premium.css";
import "../Styles/ui-kit.css";

const ROLE_LABELS = {
  super_admin: "Super Admin", admin: "Admin", manager: "Manager",
  HR: "HR", accountant: "Accountant", operations: "Operations",
  designer: "Designer", employee: "Employee",
};

const SIDEBAR_COLLAPSED_KEY = "tuahAdminSidebarCollapsed";
const OPEN_GROUPS_KEY = "tuahAdminNavOpenGroups";

/** Coming-soon (roadmap) nav items are only shown to admin/manager — see erpNav.js. */
const showFullERPNav = (user) => isAdmin(user) || getRole(user) === "manager";

const readJSON = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

/** Finds which nav group/item the current route belongs to, for breadcrumbs + auto-expand. */
const findActiveNavContext = (pathname, user) => {
  const overviewHref = getDashboardRoute(user);
  if (pathname === overviewHref) return { groupKey: null, groupLabel: null, itemLabel: "Overview" };

  let best = null;
  const consider = (groupKey, groupLabel, item) => {
    if (!item.href) return;
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.href.length) {
        best = { groupKey, groupLabel, itemLabel: item.label, href: item.href };
      }
    }
  };
  ERP_NAV_GROUPS.forEach((group) => group.items.forEach((item) => consider(group.key, group.label, item)));
  ERP_TOP_LEVEL_ITEMS.forEach((item) => consider(null, null, item));
  EMPLOYEE_SELF_SERVICE_ITEMS.forEach((item) => consider(null, null, item));
  return best;
};

/** Flattens real (non-roadmap), permitted nav destinations for the command palette. */
const buildCommandItems = (user) => {
  const items = [
    { id: "overview", label: "Overview", group: null, href: getDashboardRoute(user), icon: "dashboard" },
  ];
  ERP_NAV_GROUPS.forEach((group) => {
    group.items.forEach((item) => {
      if (item.comingSoon || !item.href) return;
      if (item.permission && !can(user, item.permission)) return;
      items.push({ id: item.href, label: item.label, group: group.label, href: item.href, icon: item.icon });
    });
  });
  ERP_TOP_LEVEL_ITEMS.forEach((item) => {
    if (item.requireAdmin && !isAdmin(user)) return;
    if (item.permission && !can(user, item.permission)) return;
    items.push({ id: item.href, label: item.label, group: null, href: item.href, icon: item.icon });
  });
  return items;
};

/** Single nav link — handles both real routes and honest "coming soon" placeholders. */
const NavItemLink = ({ item, groupLabel, onNavigate }) => {
  if (item.comingSoon) {
    return (
      <NavLink
        to={comingSoonHref(groupLabel || "Tuah OS", item.label)}
        onClick={onNavigate}
        className="admin-premium-nav-link coming-soon"
      >
        <span className="material-symbols-outlined">{item.icon}</span>
        <span>{item.label}</span>
        <span className="admin-nav-soon-tag">Soon</span>
      </NavLink>
    );
  }
  return (
    <NavLink
      to={item.href}
      onClick={onNavigate}
      className={({ isActive }) => `admin-premium-nav-link${isActive ? " active" : ""}`}
    >
      <span className="material-symbols-outlined">{item.icon}</span>
      <span>{item.label}</span>
    </NavLink>
  );
};

/** Shared nav content used by both the desktop sidebar and mobile drawer. */
const AdminNav = ({ user, onNavigate, openGroups, onToggleGroup }) => {
  const overviewHref = getDashboardRoute(user);
  const fullNav = showFullERPNav(user);

  const visibleEmployeeItems = EMPLOYEE_SELF_SERVICE_ITEMS.filter(
    (item) => can(user, item.permission) && !can(user, item.excludeIfHas)
  );

  return (
    <nav className="admin-premium-nav" aria-label="Admin navigation">
      <NavLink
        to={overviewHref}
        onClick={onNavigate}
        className={({ isActive }) => `admin-premium-nav-link${isActive ? " active" : ""}`}
      >
        <span className="material-symbols-outlined">dashboard</span>
        <span>Overview</span>
      </NavLink>

      {visibleEmployeeItems.map((item) => (
        <NavItemLink key={item.label} item={item} onNavigate={onNavigate} />
      ))}

      {ERP_NAV_GROUPS.map((group) => {
        const visibleItems = group.items.filter((item) =>
          item.comingSoon
            ? fullNav
            : item.requireAdmin
              ? isAdmin(user)
              : item.permission
                ? can(user, item.permission)
                : true
        );
        if (visibleItems.length === 0) return null;

        const isOpen = openGroups.includes(group.key);

        return (
          <div className={`admin-nav-group${isOpen ? " admin-nav-group--open" : ""}`} key={group.key}>
            <button
              type="button"
              className="admin-nav-group-header"
              onClick={() => onToggleGroup(group.key)}
              aria-expanded={isOpen}
            >
              <span className="material-symbols-outlined">{group.icon}</span>
              <span className="admin-nav-group-label">{group.label}</span>
              <span className="material-symbols-outlined admin-nav-group-chevron">expand_more</span>
            </button>
            {isOpen && (
              <div className="admin-nav-group-items">
                {visibleItems.map((item) => (
                  <NavItemLink key={item.label} item={item} groupLabel={group.label} onNavigate={onNavigate} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {ERP_TOP_LEVEL_ITEMS.filter((item) =>
        item.requireAdmin ? isAdmin(user) : item.permission ? can(user, item.permission) : true
      ).map((item) => (
        <NavItemLink key={item.label} item={item} onNavigate={onNavigate} />
      ))}
    </nav>
  );
};

/** Shared profile + logout footer used by sidebar and drawer. */
const AdminProfileFooter = ({ user, onLogout, loggingOut }) => {
  const displayName = user
    ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.username || "Staff"
    : "Staff";
  const roleLabel = user ? (ROLE_LABELS[user.role] || user.role || "Staff") : "Staff";
  const avatarUrl = user?.profilePhotoUrl || null;

  return (
    <div className="admin-premium-sidebar-footer">
      <div className="admin-premium-profile">
        {avatarUrl ? (
          <img src={avatarUrl} alt={`${displayName} profile`} />
        ) : (
          <div className="admin-premium-profile-initials" aria-label={`${displayName} avatar`}>
            {displayName.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase()}
          </div>
        )}
        <div>
          <strong>{displayName}</strong>
          <span>{roleLabel}</span>
        </div>
      </div>
      <div className="admin-premium-profile-divider" />
      <button
        type="button"
        className="admin-premium-logout"
        onClick={onLogout}
        disabled={loggingOut}
        aria-label="Logout"
      >
        <span className="material-symbols-outlined">logout</span>
        <span>{loggingOut ? "Signing Out…" : "Logout"}</span>
      </button>
    </div>
  );
};

export const AdminSidebar = ({ active = "Overview" }) => {
  const navigate = useNavigate();
  const { logout } = useLogout();
  const { state } = useAuthContext();
  const user = state.user;
  const location = useLocation();
  const [loggingOut, setLoggingOut] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readJSON(SIDEBAR_COLLAPSED_KEY, false));
  const [openGroups, setOpenGroups] = useState(() => readJSON(OPEN_GROUPS_KEY, []));

  // Auto-expand the group containing the current route (in addition to whatever the user already opened)
  useEffect(() => {
    const context = findActiveNavContext(location.pathname, user);
    if (context?.groupKey && !openGroups.includes(context.groupKey)) {
      setOpenGroups((prev) => [...prev, context.groupKey]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    window.localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(openGroups));
  }, [openGroups]);

  const toggleGroup = useCallback((key) => {
    setOpenGroups((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, JSON.stringify(!prev));
      return !prev;
    });
  }, []);

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Close drawer on Escape key
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setDrawerOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [drawerOpen]);

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    await logout();
    navigate("/Login", { replace: true });
  }, [loggingOut, logout, navigate]);

  const roleLabel = user ? (ROLE_LABELS[user.role] || user.role || "Staff") : "Staff";

  return (
    <>
      {/* ── Desktop sidebar (hidden ≤1024px) ─────────────────────────────── */}
      <aside className={`admin-premium-sidebar${collapsed ? " admin-premium-sidebar--collapsed" : ""}`}>
        <button
          type="button"
          className="admin-sidebar-collapse-btn"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <span className="material-symbols-outlined">
            {collapsed ? "chevron_right" : "chevron_left"}
          </span>
        </button>

        <div className="admin-premium-brand">
          <h1>Tuah OS</h1>
          <p>{roleLabel} Console</p>
        </div>

        {/* Organization/branch context — architecture placeholder for future multi-branch support */}
        <div className="admin-org-chip">
          <span className="material-symbols-outlined">storefront</span>
          <div>
            <strong>Tuah Furniture</strong>
            <span>Main Branch</span>
          </div>
        </div>

        <AdminNav user={user} openGroups={openGroups} onToggleGroup={toggleGroup} />
        <AdminProfileFooter user={user} onLogout={handleLogout} loggingOut={loggingOut} />
      </aside>

      {/* ── Mobile top bar (visible ≤1024px) ─────────────────────────────── */}
      <div className="admin-mobile-topbar" aria-label="Mobile admin navigation">
        <button
          type="button"
          className="admin-mobile-hamburger"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={drawerOpen}
        >
          <span className="material-symbols-outlined">menu</span>
        </button>
        <span className="admin-mobile-brand">Tuah OS</span>
        <button
          type="button"
          className="admin-mobile-logout-btn"
          onClick={handleLogout}
          disabled={loggingOut}
          aria-label="Logout"
        >
          <span className="material-symbols-outlined">logout</span>
        </button>
      </div>

      {/* ── Mobile drawer overlay ─────────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="admin-drawer-overlay"
          role="button"
          tabIndex={-1}
          aria-label="Close navigation menu"
          onClick={() => setDrawerOpen(false)}
          onKeyDown={(e) => e.key === "Enter" && setDrawerOpen(false)}
        />
      )}

      <aside
        className={`admin-drawer${drawerOpen ? " admin-drawer--open" : ""}`}
        aria-hidden={!drawerOpen}
        aria-label="Mobile navigation drawer"
      >
        <div className="admin-drawer-header">
          <div className="admin-premium-brand" style={{ padding: "0 0 12px" }}>
            <h1>Tuah OS</h1>
            <p>{roleLabel} Console</p>
          </div>
          <button
            type="button"
            className="admin-drawer-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation menu"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <AdminNav
          user={user}
          openGroups={openGroups}
          onToggleGroup={toggleGroup}
          onNavigate={() => setDrawerOpen(false)}
        />
        <AdminProfileFooter user={user} onLogout={handleLogout} loggingOut={loggingOut} />
      </aside>
    </>
  );
};

export const AdminFooter = () => (
  <footer className="admin-premium-footer">
    <div>
      <p>&copy; 2025 Tuah Commerce OS. All rights reserved.</p>
      <nav aria-label="Admin footer links">
        <Link to="/privacy">Privacy Policy</Link>
        <Link to="/terms">Terms of Service</Link>
        <Link to="/shipping">Shipping &amp; Returns</Link>
        <Link to="/sustainability">Sustainability</Link>
      </nav>
    </div>
  </footer>
);

/** Bell icon + popover — wired to the real GET /api/notifications endpoint. */
const NotificationsMenu = () => {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    commerceApi.getNotifications()
      .then((list) => setNotifications(Array.isArray(list) ? list : []))
      .catch(() => setNotifications([]))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="admin-topbar-popover-wrap" ref={ref}>
      <button
        type="button"
        className="admin-topbar-icon-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${notifications.length ? ` (${notifications.length})` : ""}`}
        aria-expanded={open}
      >
        <span className="material-symbols-outlined">notifications</span>
        {notifications.length > 0 && <span className="ui-notification-dot" />}
      </button>
      {open && (
        <div className="admin-notifications-panel" role="dialog" aria-label="Notifications">
          <div className="admin-notifications-panel-header">Notifications</div>
          {!loaded ? (
            <div className="admin-notifications-empty">Loading…</div>
          ) : notifications.length === 0 ? (
            <div className="admin-notifications-empty">You're all caught up.</div>
          ) : (
            notifications.slice(0, 10).map((n) => (
              <div className="admin-notification-item" key={n.id}>
                <span className="material-symbols-outlined">notifications</span>
                <div>
                  <strong>{n.tag || "Update"}</strong>
                  <p>{n.name ? `${n.name} — ${n.desc || ""}` : n.desc}</p>
                  {n.createdAt && <time>{new Date(n.createdAt).toLocaleString()}</time>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

/** Avatar + name → dropdown menu (Settings shortcut + logout). */
const ProfileMenu = ({ user, onLogout, loggingOut }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const displayName = user
    ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.username || "Staff"
    : "Staff";
  const roleLabel = user ? (ROLE_LABELS[user.role] || user.role || "Staff") : "Staff";

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="admin-topbar-popover-wrap" ref={ref}>
      <button
        type="button"
        className="admin-topbar-icon-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
      >
        {user?.profilePhotoUrl ? (
          <img
            src={user.profilePhotoUrl}
            alt=""
            style={{ width: 28, height: 28, borderRadius: "999px", objectFit: "cover" }}
          />
        ) : (
          <span className="material-symbols-outlined">account_circle</span>
        )}
      </button>
      {open && (
        <div className="admin-profile-menu-panel" role="menu" aria-label="Account menu">
          <div className="admin-profile-menu-header">
            <strong>{displayName}</strong>
            <span>{roleLabel}</span>
          </div>
          {isAdmin(user) && (
            <Link to="/admin/settings" className="admin-profile-menu-item" role="menuitem" onClick={() => setOpen(false)}>
              <span className="material-symbols-outlined">settings</span>
              Settings
            </Link>
          )}
          <button
            type="button"
            className="admin-profile-menu-item danger"
            role="menuitem"
            onClick={onLogout}
            disabled={loggingOut}
          >
            <span className="material-symbols-outlined">logout</span>
            {loggingOut ? "Signing Out…" : "Logout"}
          </button>
        </div>
      )}
    </div>
  );
};

export const AdminShell = ({ active, title, subtitle, actions, breadcrumbs, children }) => {
  const { state } = useAuthContext();
  const { logout } = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const user = state.user;
  const [loggingOut, setLoggingOut] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    await logout();
    navigate("/Login", { replace: true });
  }, [loggingOut, logout, navigate]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const commandItems = useMemo(() => buildCommandItems(user), [user]);

  const resolvedBreadcrumbs = useMemo(() => {
    if (breadcrumbs) return breadcrumbs;
    const context = findActiveNavContext(location.pathname, user);
    const crumbs = [{ label: "Tuah OS", href: getDashboardRoute(user) }];
    if (context?.groupLabel) crumbs.push({ label: context.groupLabel });
    crumbs.push({ label: context?.itemLabel || title || active || "" });
    return crumbs;
  }, [breadcrumbs, location.pathname, user, title, active]);

  return (
    <div className="admin-premium-page">
      <AdminSidebar active={active} />
      <main className="admin-premium-main">
        <header className="admin-premium-topbar">
          <div className="admin-premium-topbar-left">
            <nav className="ui-breadcrumbs" aria-label="Breadcrumb">
              <ol>
                {resolvedBreadcrumbs.map((crumb, index) => {
                  const isLast = index === resolvedBreadcrumbs.length - 1;
                  return (
                    <li key={`${crumb.label}-${index}`}>
                      {!isLast && crumb.href ? (
                        <Link to={crumb.href}>{crumb.label}</Link>
                      ) : (
                        <span aria-current={isLast ? "page" : undefined}>{crumb.label}</span>
                      )}
                      {!isLast && <span className="ui-breadcrumbs-sep" aria-hidden="true">/</span>}
                    </li>
                  );
                })}
              </ol>
            </nav>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>

          <div className="admin-premium-actions">
            {actions}

            <div className="admin-topbar-cluster">
              {actions && <div className="admin-topbar-divider" />}
              <button
                type="button"
                className="admin-topbar-search-trigger"
                onClick={() => setPaletteOpen(true)}
              >
                <span className="material-symbols-outlined">search</span>
                <span>Search or jump to…</span>
                <kbd>Ctrl K</kbd>
              </button>
              <NotificationsMenu />
              <ProfileMenu user={user} onLogout={handleLogout} loggingOut={loggingOut} />
            </div>
          </div>
        </header>
        <div className="admin-premium-content">{children}</div>
        <AdminFooter />
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={commandItems} />
    </div>
  );
};
