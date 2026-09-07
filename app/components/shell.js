"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons.js";
import { Avatar } from "./ui.js";
import { LANGUAGES, useT } from "../lib/i18n.js";

export const NAV = {
  patient: [
    { id: "dashboard", label: "Dashboard", icon: "grid" },
    { id: "doctors", label: "Find a doctor", icon: "search" },
    { id: "appointments", label: "My appointments", icon: "calendar", badge: "appointments" },
    { id: "records", label: "Medical records", icon: "file" },
    { id: "assistant", label: "AI health assistant", icon: "bot" },
  ],
  doctor: [
    { id: "doctor-home", label: "Overview", icon: "grid" },
    { id: "doctor-schedule", label: "Appointments", icon: "calendar" },
    { id: "availability", label: "Availability", icon: "clock" },
    { id: "earnings", label: "Earnings", icon: "trend" },
  ],
  admin: [
    { id: "admin-home", label: "Overview", icon: "grid" },
    { id: "verification", label: "Doctor verification", icon: "shield", badge: "pending" },
    { id: "directory", label: "Directory", icon: "users" },
    { id: "specialties", label: "Specialties", icon: "heart" },
  ],
};

const ROLE_LABEL = {
  patient: "role.patient",
  doctor: "role.doctor",
  admin: "role.admin",
};

const TITLES = {
  dashboard: ["Dashboard", "Your care at a glance"],
  doctors: ["Find a doctor", "Search the doctor directory"],
  "doctor-profile": ["Doctor profile", "Credentials, reviews and availability"],
  booking: ["Book an appointment", "Pick a time that works for you"],
  appointments: ["My appointments", "Upcoming, past and cancelled"],
  records: ["Medical records", "Your health history"],
  assistant: ["AI health assistant", "Symptom guidance and doctor matching"],
  consultation: ["Video consultation", "Your secure room"],
  family: ["Family members", "Book on behalf of others"],
  profile: ["Settings", "Profile and preferences"],
  "join-as-doctor": ["Join as a doctor", "BM&DC verification"],
  "doctor-home": ["Doctor overview", "Your day"],
  "doctor-schedule": ["Appointments", "Your consultation schedule"],
  availability: ["Availability", "Recurring hours and exceptions"],
  earnings: ["Earnings", "Completed consultations"],
  "admin-home": ["Admin overview", "Platform health"],
  verification: ["Doctor verification", "BM&DC application queue"],
  directory: ["Directory", "Every profile on Niramoy"],
  specialties: ["Specialties", "Care categories"],
};

export function Sidebar({ active, onNavigate, role, user, onSignOut, counts, open, onClose }) {
  const { t } = useT();

  return (
    <>
      <div className={`sidebar-scrim ${open ? "show" : ""}`} onClick={onClose} />
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Icon name="heart" size={20} strokeWidth={2.2} /></div>
          <div className="brand-name">nira<span>moy</span></div>
        </div>

        <div className="nav-label">Workspace</div>
        <nav className="nav-list">
          {NAV[role].map((item) => {
            const count = item.badge ? counts?.[item.badge] : null;
            return (
              <button
                key={item.id}
                className={`nav-item ${active === item.id ? "active" : ""}`}
                onClick={() => { onNavigate(item.id); onClose?.(); }}
                aria-current={active === item.id ? "page" : undefined}
              >
                <Icon name={item.icon} size={17} />
                <span>{t(`nav.${item.id}`)}</span>
                {count > 0 && <span className="nav-count">{count}</span>}
              </button>
            );
          })}
        </nav>

        <div className="nav-label">Account</div>
        <nav className="nav-list">
          {role === "patient" && (
            <button className={`nav-item ${active === "family" ? "active" : ""}`} onClick={() => { onNavigate("family"); onClose?.(); }}>
              <Icon name="users" size={17} /><span>{t("nav.family")}</span>
            </button>
          )}
          <button className={`nav-item ${active === "profile" ? "active" : ""}`} onClick={() => { onNavigate("profile"); onClose?.(); }}>
            <Icon name="settings" size={17} /><span>{t("nav.profile")}</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="user-mini">
            <Avatar person={user} />
            <div className="user-mini-text">
              <strong>{user?.name ?? "Signed in"}</strong>
              <span>{t(ROLE_LABEL[role])}</span>
            </div>
            <button className="icon-button" onClick={onSignOut} aria-label={t("nav.signout")} title={t("nav.signout")}>
              <Icon name="logout" size={15} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

/**
 * The language switch.
 *
 * In the topbar rather than buried in settings: a patient who cannot read the
 * interface cannot navigate to the page where they would change it.
 */
export function LanguageSwitch() {
  const { lang, setLang, t } = useT();
  return (
    <div className="lang-switch" role="group" aria-label={t("common.language")}>
      {LANGUAGES.map((option) => (
        <button
          key={option.id}
          type="button"
          className={lang === option.id ? "active" : ""}
          aria-pressed={lang === option.id}
          lang={option.id}
          onClick={() => setLang(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Topbar({ active, notifications, unread, onReadNotifications, onSearch, onMenu }) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [term, setTerm] = useState("");
  const popRef = useRef(null);
  const [title, subtitle] = TITLES[active] ?? ["Niramoy", ""];

  useEffect(() => {
    const onClickAway = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) setShowNotifications(false);
    };
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  const toggle = () => {
    setShowNotifications((v) => {
      if (!v && unread > 0) onReadNotifications?.();
      return !v;
    });
  };

  return (
    <header className="topbar">
      <button className="icon-button menu-button" onClick={onMenu} aria-label="Open menu">
        <Icon name="grid" size={17} />
      </button>

      <div className="topbar-heading">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>

      <form
        className="topbar-search"
        onSubmit={(e) => { e.preventDefault(); onSearch?.(term); }}
      >
        <Icon name="search" size={15} />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search doctors, specialties or districts"
          aria-label="Search"
        />
      </form>

      <div className="topbar-actions">
        <div style={{ position: "relative" }} ref={popRef}>
          <LanguageSwitch />

          <button className="icon-button" aria-label={`Notifications, ${unread} unread`} onClick={toggle}>
            <Icon name="bell" size={17} />
            {unread > 0 && <i className="notification-dot" />}
          </button>

          {showNotifications && (
            <div className="notification-popover">
              <h3>Notifications {unread > 0 && <span>· {unread} new</span>}</h3>
              {notifications.length === 0 && <p className="notification-empty">Nothing yet.</p>}
              {notifications.map((n) => (
                <div className={`notification ${n.read ? "" : "unread"}`} key={n.id}>
                  <i />
                  <p>
                    <strong>{n.payload?.title}</strong>
                    <br />
                    {n.payload?.body}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
