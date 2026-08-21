"use client";

import { useEffect, useRef } from "react";
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

export function Loading({ label = "Loading…", rows = 3 }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
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

/** Accessible modal: focuses on open, closes on Escape and backdrop click. */
export function Modal({ open, title, onClose, children, footer, wide = false }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
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
