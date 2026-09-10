"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons.js";

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

export function Avatar({ person, size = "md" }) {
  return (
    <div className={`avatar ${person?.avatar || "tan"} ${size}`}>
      {person?.initials || "NA"}
    </div>
  );
}

/**
 * The badge that keeps the demo directory honest. Every seeded profile carries
 * one — see the header comment in lib/data/doctors.js for why.
 */
export function DemoBadge({ compact = false }) {
  return (
    <span className="demo-badge" title="A sample profile, not a real physician. Real doctors join by BM&DC verification.">
      <Icon name="info" size={compact ? 10 : 11} />
      {compact ? "Demo" : "Demo profile"}
    </span>
  );
}

export function VerifiedBadge({ doctor }) {
  if (doctor?.isDemoProfile) return <DemoBadge />;
  return (
    <span className="verified" title="BM&DC registration confirmed by a Niramoy admin.">
      <Icon name="check" size={10} /> BM&amp;DC verified
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export function PageHeading({ title, subtitle, actions, back }) {
  return (
    <div className="page-heading">
      <div>
        {back && (
          <button className="text-link back-link" onClick={back.onClick}>
            <Icon name="back" size={13} /> {back.label}
          </button>
        )}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </div>
  );
}

export function SectionHead({ title, note, action }) {
  return (
    <div className="section-subhead">
      <h3>
        {title}
        {note && <span className="section-note">· {note}</span>}
      </h3>
      {action}
    </div>
  );
}

export function Stat({ icon, label, value, trend, tone }) {
  return (
    <div className="stat-card card">
      <div className={`stat-icon ${tone || ""}`}><Icon name={icon} size={17} /></div>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
        {trend && <span className="stat-trend">{trend}</span>}
      </div>
    </div>
  );
}

export function Empty({ icon = "search", title, hint, action }) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={26} />
      <div className="empty-title">{title}</div>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = "Loading…", rows = 3, slow = false, onRetry }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {slow && (
        <div className="loading-slow">
          <span>Still loading. This is taking longer than usual.</span>
          {onRetry && (
            <button className="text-link" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      )}
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skeleton-row" key={i}>
          <div className="skeleton circle" />
          <div className="skeleton-lines">
            <div className="skeleton line" style={{ width: `${60 - i * 8}%` }} />
            <div className="skeleton line short" style={{ width: `${38 - i * 5}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Network state                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Whether the browser thinks it has a connection.
 *
 * `navigator.onLine` is a weak signal — it reports the link, not whether
 * anything is reachable — so it is used to EXPLAIN a failure that already
 * happened, never to predict one. We do not block requests on it.
 */
export function useOnline() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return online;
}

/**
 * True once a load has been running longer than it should.
 *
 * A skeleton that animates forever is indistinguishable from a hang, and the
 * patient has no way to tell which they are looking at. After this fires the
 * skeleton says so and offers a way out.
 */
export function useSlowLoad(active, ms = 8000) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!active) {
      setSlow(false);
      return undefined;
    }
    const timer = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);

  return slow;
}

/**
 * A load that failed, with the way to try it again.
 *
 * Distinguishes "we could not reach the server" from "the server said no",
 * because the two call for different actions from the patient and conflating
 * them is how an offline phone becomes a support ticket.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  retrying = false,
  offline = false,
  compact = false,
}) {
  const heading = title ?? (offline ? "You appear to be offline" : "That didn't load");
  const body =
    message ??
    (offline
      ? "Niramoy needs a connection for this. Your place is saved — reconnect and try again."
      : "Something went wrong on our side. Nothing you entered has been lost.");

  return (
    <div className={`error-state${compact ? " compact" : ""}`} role="alert">
      <Icon name={offline ? "info" : "alert"} size={compact ? 18 : 24} />
      <div className="error-state-text">
        <strong>{heading}</strong>
        <p>{body}</p>
      </div>
      {onRetry && (
        <button className="button secondary small" onClick={onRetry} disabled={retrying}>
          <Icon name="refresh" size={12} />
          {retrying ? "Retrying…" : "Try again"}
        </button>
      )}
    </div>
  );
}

/** The persistent strip shown while the browser reports no connection. */
export function OfflineBar() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-bar" role="status" aria-live="polite">
      <Icon name="info" size={13} />
      You are offline. Niramoy will keep what you have typed; actions will fail
      until the connection is back.
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */

export function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.tone || ""}`} role="status" aria-live="polite">
      <Icon name={toast.tone === "error" ? "alert" : "check"} size={14} />
      {toast.message}
    </div>
  );
}

export function Banner({ tone = "info", icon = "info", title, children, action }) {
  return (
    <div className={`banner ${tone}`}>
      <Icon name={icon} size={17} />
      <div>
        {title && <strong>{title}</strong>}
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog: focuses on open, traps Tab, closes on Escape and backdrop
 * click, and puts focus back where it came from.
 *
 * The trap is the part that was missing. aria-modal tells a screen reader that
 * the rest of the page is inert; it does nothing for a sighted keyboard user,
 * who could Tab straight out of "Cancel this appointment?" into the page behind
 * it and press buttons they could no longer see.
 */
export function Modal({ open, title, onClose, children, footer, wide = false }) {
  const ref = useRef(null);
  /** Whatever had focus before we opened, so it can be handed back. */
  const restoreTo = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    restoreTo.current = document.activeElement;

    const onKey = (event) => {
      if (event.key === "Escape") {
        onClose?.();
        return;
      }
      if (event.key !== "Tab") return;

      const items = [...(ref.current?.querySelectorAll(FOCUSABLE) ?? [])].filter(
        (el) => el.offsetParent !== null,
      );
      if (!items.length) {
        event.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      // Wrap at both ends, and pull focus back in if it has already escaped.
      if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);

    // Prefer the first control over the dialog itself: a screen reader
    // announces the dialog's label either way, and this saves a Tab.
    const firstControl = ref.current?.querySelector(FOCUSABLE);
    (firstControl ?? ref.current)?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal card ${wide ? "wide" : ""}`}
        role="dialog" aria-modal="true" aria-label={title}
        tabIndex={-1} ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A tablist wired up the way assistive technology expects: each tab owns its
 * panel by id, only the selected tab is in the tab order, and the arrow keys
 * move between them. Without aria-controls a screen reader announces "tab" and
 * cannot say what it governs.
 */
export function Tabs({ tabs, value, onChange, idPrefix }) {
  const onKeyDown = (event) => {
    const index = tabs.findIndex((t) => t.id === value);
    let next = null;
    if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
    else if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
    else if (event.key === "Home") next = tabs[0];
    else if (event.key === "End") next = tabs[tabs.length - 1];
    if (!next) return;

    event.preventDefault();
    onChange(next.id);
    document.getElementById(`${idPrefix}-tab-${next.id}`)?.focus();
  };

  return (
    <div className="appointment-tabs" role="tablist" onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`${idPrefix}-tab-${tab.id}`}
          role="tab"
          type="button"
          aria-selected={value === tab.id}
          aria-controls={`${idPrefix}-panel-${tab.id}`}
          // Roving tabindex: one stop for the whole tablist, then arrows.
          tabIndex={value === tab.id ? 0 : -1}
          className={`tab ${value === tab.id ? "active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count > 0 && <em>({tab.count})</em>}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ idPrefix, id, children }) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      tabIndex={0}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Menus                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The secondary actions on a card, behind one button.
 *
 * A row of six equally-weighted buttons makes the patient read all six every
 * time to find the one they came for, and puts Cancel the same distance from
 * the thumb as Join. One primary action stays on the card; everything else
 * lives in here.
 *
 * Keyboard: Escape closes and returns focus to the trigger, arrows move
 * between items, and the menu closes on outside click or blur.
 */
export function ActionMenu({ label = "More actions", items = [], align = "end" }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const close = useCallback(
    (returnFocus = true) => {
      setOpen(false);
      if (returnFocus) triggerRef.current?.focus();
    },
    [],
  );

  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

      event.preventDefault();
      const focusable = [...(menuRef.current?.querySelectorAll("[role='menuitem']") ?? [])];
      if (!focusable.length) return;
      const index = focusable.indexOf(document.activeElement);
      const next =
        event.key === "ArrowDown"
          ? focusable[(index + 1) % focusable.length]
          : focusable[(index - 1 + focusable.length) % focusable.length];
      next?.focus();
    };

    const onPointer = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      if (triggerRef.current?.contains(event.target)) return;
      close(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    // Open onto the first item so the keyboard path is one key, not three.
    menuRef.current?.querySelector("[role='menuitem']")?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, close]);

  const usable = items.filter(Boolean);
  if (!usable.length) return null;

  return (
    <div className="action-menu">
      <button
        ref={triggerRef}
        type="button"
        className="button ghost small icon-only"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="more" size={15} />
      </button>

      {open && (
        <div className={`action-menu-list ${align}`} role="menu" ref={menuRef} aria-label={label}>
          {usable.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`action-menu-item${item.danger ? " danger" : ""}`}
              disabled={item.disabled}
              title={item.disabledHint && item.disabled ? item.disabledHint : undefined}
              onClick={() => {
                close(false);
                item.onClick?.();
              }}
            >
              {item.icon && <Icon name={item.icon} size={13} />}
              <span>{item.label}</span>
              {item.disabled && item.disabledHint && <em>{item.disabledHint}</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Forms                                                                       */
/* -------------------------------------------------------------------------- */

export function Field({ label, hint, error, children }) {
  return (
    <label className="field-group">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span>
       : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Select({ value, onChange, options, ...rest }) {
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {options.map((o) => {
        const val = typeof o === "string" ? o : o.value;
        const label = typeof o === "string" ? o : o.label;
        return <option key={val} value={val}>{label}</option>;
      })}
    </select>
  );
}

export function StatusPill({ status }) {
  const label = {
    confirmed: "Confirmed", pending: "Pending", completed: "Completed",
    cancelled: "Cancelled", no_show: "No-show", in_progress: "In progress",
    verified: "Verified", rejected: "Rejected",
    /*
     * A sign-up approval that has been spent. Deliberately NOT "Verified":
     * this says the number was used to open an account, and says nothing about
     * whether that doctor's application has been reviewed. Showing "Verified"
     * here read as "this doctor is live in the directory", which is a different
     * decision an admin has not made yet.
     */
    claimed: "Signed up", revoked: "Withdrawn", open: "Open",
  }[status] || status;
  return <span className={`status ${status}`}>{label}</span>;
}

export function Rating({ value, count }) {
  return (
    <span className="rating">
      <Icon name="star" size={11} strokeWidth={0} style={{ fill: "currentColor" }} />
      {Number(value).toFixed(1)}
      {count != null && <em>({count})</em>}
    </span>
  );
}
