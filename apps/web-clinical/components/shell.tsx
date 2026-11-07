"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert } from "@pulse/ui";
import { ApiError, createStaffWebApi } from "@pulse/api-client";
import type { PublicSession } from "../lib/session.js";
import { DashboardIcon, MenuIcon, PatientsIcon, AppointmentsIcon, NursingIcon, ClinicalIcon, LaboratoryIcon, ImagingIcon, BellIcon } from "./nav-icons.js";
import { FacilityDialog } from "./facility-dialog.js";
import { FacilityPicker } from "./facility-picker.js";
import { usePathname, useSearchParams } from "next/navigation";
import {workspaceNavigation,worklistTabs} from "../lib/workspace-navigation.mjs";
import { WorkspaceSearch } from "./workspace-search.js";
import { NotificationCentre } from "./notification-centre.js";
import {CriticalIndicator} from './critical-followup.js';
import { SignoutConfirmation } from "./signout-confirmation.js";
const api = createStaffWebApi();
export function Shell({
  children,
  session,
}: {
  children: ReactNode;
  session: PublicSession;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const privileges = session.facility?.privileges ?? [];
  const navigation = workspaceNavigation(privileges);
  const queues = worklistTabs(privileges);
  const activeQueue = queues.find(q=>q.id===searchParams.get("queue"))?.id ?? queues[0]?.id;
  const icons = {dashboard:DashboardIcon,patients:PatientsIcon,appointments:AppointmentsIcon,nursing:NursingIcon,clinical:ClinicalIcon,laboratory:LaboratoryIcon,imaging:ImagingIcon,notifications:BellIcon};
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmSignout, setConfirmSignout] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facilityOpen, setFacilityOpen] = useState(!session.facility);
  const [switchingFacility, setSwitchingFacility] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("chooseFacility")) {
      setFacilityOpen(true);
      url.searchParams.delete("chooseFacility");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, []);
  async function switchFacility(facilityId: string) {
    if (!facilityId || switchingFacility || signingOut) return;
    setSwitchingFacility(true);
    setError(null);
    try {
      await api.selectFacility(facilityId);
      window.location.assign("/");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401)
        window.location.assign("/login");
      else
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not switch facility. Please try again.",
        );
    } finally {
      setSwitchingFacility(false);
    }
  }
  const drawer = useRef<HTMLElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const initials = session.loginId
    .split(/[.\s_-]+/)
    .map((s) => s.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");
  useEffect(() => {
    const controller = new AbortController();
    async function verify() {
      try {
        const live = await api.session(controller.signal);
        if (
          live.facility?.facilityId !== session.facility?.facilityId ||
          JSON.stringify(live.facility) !== JSON.stringify(session.facility) ||
          JSON.stringify(live.facilities) !== JSON.stringify(session.facilities)
        )
          window.location.reload();
        else setError(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401)
          window.location.assign("/login");
        else if (!controller.signal.aborted)
          setError(
            "Could not verify your session. Check your connection or retry when the service recovers.",
          );
      }
    }
    const expiry = setTimeout(
      () => window.location.assign("/login"),
      Math.max(0, session.expiresAt - Date.now()),
    );
    const interval = setInterval(() => {
      void verify();
    }, 60_000);
    window.addEventListener("focus", verify);
    return () => {
      controller.abort();
      clearTimeout(expiry);
      clearInterval(interval);
      window.removeEventListener("focus", verify);
    };
  }, [session.expiresAt, session.facility]);
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    if (main.current) main.current.inert = true;
    drawer.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawerOpen(false);
      }
      if (event.key !== "Tab") return;
      const elements = drawer.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href]",
      );
      if (!elements?.length) return;
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    function resized() {
      if (window.innerWidth > 768) setDrawerOpen(false);
    }
    document.addEventListener("keydown", keyboard);
    window.addEventListener("resize", resized);
    return () => {
      if (main.current) main.current.inert = false;
      document.removeEventListener("keydown", keyboard);
      window.removeEventListener("resize", resized);
      (previous ?? opener.current)?.focus();
    };
  }, [drawerOpen]);
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      await api.logout();
      window.location.assign("/login");
    } catch {
      setError("Could not reach Pulse to sign out. Try again.");
    } finally {
      setSigningOut(false);
    }
  }
  return (
    <div className={collapsed ? "shell shell--collapsed" : "shell"}>
      <a className="pulse-skip-link" href="#main-content">
        Skip to main content
      </a>
      {drawerOpen ? (
        <button
          type="button"
          className="shell__scrim"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}
      <aside
        ref={drawer}
        id="workspace-sidebar"
        className={drawerOpen ? "sidebar sidebar--open" : "sidebar"}
        role={drawerOpen ? "dialog" : undefined}
        aria-modal={drawerOpen || undefined}
        aria-label="Primary navigation"
      >
        <div className="sidebar__brand">
          <img src="/brand/emblem.png" alt="" width={36} height={36} />
          <div>
            <span className="sidebar__wordmark">Pulse</span>
            <span className="sidebar__tagline">Connected Care</span>
          </div>
          <button
            type="button"
            className="sidebar__collapse"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            aria-controls="workspace-sidebar"
            onClick={() => setCollapsed((value) => !value)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="3"
                y="4"
                width="18"
                height="16"
                rx="3"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d={collapsed ? "m12 9 3 3-3 3" : "m15 9-3 3 3 3"}
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M8 4v16" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
          <button
            type="button"
            className="sidebar__close"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          >
            <MenuIcon size={20} />
          </button>
        </div>
        <nav>
          <ul className="sidebar__nav">
            {navigation.map(item => {
              const Icon = icons[item.icon as keyof typeof icons];
              const active = item.href.startsWith('/worklists') ? pathname==='/worklists' && activeQueue===item.id : item.href==='/' ? pathname==='/' : pathname===item.href || pathname.startsWith(item.href+'/');
              return <li key={item.id}><a href={item.href} title={item.label} className={active?'sidebar__link sidebar__link--active':'sidebar__link'} aria-current={active?'page':undefined} onClick={()=>setDrawerOpen(false)}><span className="sidebar__icon"><Icon size={18}/></span><span className="sidebar__label">{item.label}</span></a></li>;
            })}
          </ul>
        </nav>
        <nav className="sidebar__utilities" aria-label="Workspace settings">
          <ul className="sidebar__nav">
            <li hidden={session.facilities.length < 2}>
              <button
                title="Change facility"
                type="button"
                className="sidebar__link sidebar__facility"
                onClick={() => {
                  setDrawerOpen(false);
                  setFacilityOpen(true);
                }}
              >
                <svg
                  className="sidebar__utility-icon"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="sidebar__label">Change facility</span>
              </button>
            </li>
            <li>
              <a
                href="/account/security"
                title="Account security"
                className={
                  pathname === "/account/security"
                    ? "sidebar__link sidebar__link--active"
                    : "sidebar__link"
                }
                aria-current={
                  pathname === "/account/security" ? "page" : undefined
                }
              >
                <svg
                  className="sidebar__utility-icon"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                  <path
                    d="m8 12 3 3 5-6"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                </svg>
                <span className="sidebar__label">Account security</span>
              </a>
            </li>
          </ul>
        </nav>
      </aside>
      <div ref={main} className="main">
        <header className="topbar">
          <button
            ref={opener}
            type="button"
            className="topbar__menu"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon size={20} />
          </button>
          <WorkspaceSearch
            canOpenCharts={
              !!session.facility?.privileges.some((p) =>
                ["observation:read", "entry:read"].includes(p),
              )
            }
            canUseWorklists={queues.length > 0}
            navigation={navigation}
            canSearchPatients={
              session.facility?.privileges.includes("patient:read") ?? false
            }
            facilityId={session.facility?.facilityId}
            canSwitch={session.facilities.length > 1}
            onChooseFacility={() => setFacilityOpen(true)}
          />
          <div className="topbar__right">
            <div className="topbar__facility">
              {session.facilities.length > 1 ? (
                <FacilityPicker
                  id="header-facility"
                  compact
                  value={session.facility?.facilityId ?? ""}
                  facilities={session.facilities}
                  disabled={
                    !ready ||
                    switchingFacility ||
                    signingOut ||
                    !session.facilities.length
                  }
                  onChange={(value) => {
                    void switchFacility(value);
                  }}
                />
              ) : (
                <span className="topbar__facility-name">
                  {session.facility?.facilityName ??
                    session.facilities[0]?.facilityName ??
                    "No facility access"}
                </span>
              )}
              <span className="topbar__facility-sub">
                {switchingFacility
                  ? "Switching workspace..."
                  : session.facility?.organizationName}
              </span>
            </div>
            {session.facility ? (
              <CriticalIndicator key={`critical-${session.facility.facilityId}`} facilityId={session.facility.facilityId} privileges={session.facility.privileges}/>
            ) : null}
            {session.facility ? (
              <NotificationCentre
                key={session.facility.facilityId}
                facilityId={session.facility.facilityId}
              />
            ) : null}
            <details
              className="profile-menu"
              onBlur={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  event.currentTarget.open = false;
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}
            >
              <summary className="topbar__user" aria-label="Open profile menu">
                <span className="topbar__avatar" aria-hidden="true">
                  {initials}
                </span>
                <span className="topbar__user-meta">
                  <span className="topbar__user-name">{session.loginId}</span>
                  <span className="topbar__user-role">
                    {session.facility?.roles.join(", ") || "Staff member"}
                  </span>
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="m6 9 6 6 6-6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                </svg>
              </summary>
              <div className="profile-menu__panel">
                <p>
                  <strong>{session.loginId}</strong>
                  <span>
                    {session.facility?.roles.join(", ") || "Staff member"}
                  </span>
                </p>
                <a href="/account/security">Account security</a>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setConfirmSignout(true);
                  }}
                  disabled={signingOut}
                  aria-busy={signingOut || undefined}
                >
                  {signingOut ? "Signing out..." : "Sign out"}
                </button>
              </div>
            </details>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="content">
          {error ? <Alert tone="error">{error}</Alert> : null}
          {children}
        </main>
      </div>
      {confirmSignout ? (
        <SignoutConfirmation
          busy={signingOut}
          error={error}
          onCancel={() => setConfirmSignout(false)}
          onConfirm={() => {
            void signOut();
          }}
        />
      ) : null}
      <FacilityDialog
        open={facilityOpen}
        session={session}
        onClose={() => setFacilityOpen(false)}
      />
    </div>
  );
}
