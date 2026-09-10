"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons.js";
import {
  Avatar, PageHeading, SectionHead, Empty, Loading, Modal, Field, Banner,
  StatusPill, DemoBadge, Rating, Select,
} from "./ui.js";

export function AdminWorkspace({ active, reference, api, notify, onRefresh }) {
  if (active === "approvals") return <Approvals api={api} notify={notify} />;
  if (active === "verification") return <Verification api={api} notify={notify} onRefresh={onRefresh} />;
  if (active === "directory") return <Directory api={api} reference={reference} />;
  if (active === "specialties") return <Specialties reference={reference} />;
  return <AdminHome reference={reference} api={api} />;
}

function AdminHome({ reference, api }) {
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    (async () => {
      const data = await api.verificationQueue();
      setQueue(data.applications ?? []);
    })();
  }, [api]);

  const stats = reference?.stats;
  const pending = queue.filter((q) => q.status === "pending");

  return (
    <>
      <PageHeading title="Admin overview" subtitle="A pulse check on the Niramoy care network." />

      <div className="admin-banner">
        <div>
          <h2>Care network is healthy</h2>
          <p>
            {stats
              ? `${stats.doctors} profiles live across ${stats.divisionsCovered} divisions and ${stats.districtsCovered} districts. ${pending.length} application${pending.length === 1 ? "" : "s"} awaiting verification.`
              : "Loading platform statistics…"}
          </p>
        </div>
        <span className="status confirmed">All systems operational</span>
      </div>

      <div className="admin-grid">
        <div className="admin-stat card">
          <span>Verified doctors</span>
          <strong>{stats?.doctors ?? "—"}</strong>
          <small>{stats ? `${stats.realDoctors} BM&DC-verified · ${stats.demoDoctors} demo` : ""}</small>
        </div>
        <div className="admin-stat card">
          <span>Districts covered</span>
          <strong>{stats?.districtsCovered ?? "—"}</strong>
          <small>of 64 nationwide</small>
        </div>
        <div className="admin-stat card">
          <span>Appointments</span>
          <strong>{stats?.appointments ?? "—"}</strong>
          <small>Booked all time</small>
        </div>
      </div>

      <Banner tone="warn" icon="info" title="Directory composition">
        {stats?.realDoctors === 0
          ? "Every profile in the directory is currently seeded demo data. Real profiles appear once doctors apply and an admin verifies their BM&DC registration — approve an application in the verification queue to see one."
          : `${stats?.realDoctors} profile(s) are BM&DC-verified; the remaining ${stats?.demoDoctors} are seeded demo data.`}
      </Banner>

      <div className="two-col">
        <section className="section-card card">
          <SectionHead title="Recent applications" note={`${pending.length} pending`} />
          {queue.length ? queue.slice(0, 5).map((v) => (
            <div className="verification-row" key={v.id}>
              <div className="avatar sm blue">
                {v.name?.replace(/^Dr\.?\s*/, "").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
              </div>
              <main>
                <strong>{v.name}</strong>
                <span>{v.specialty} · {v.bmdcNumber}</span>
              </main>
              <StatusPill status={v.status} />
            </div>
          )) : <Empty icon="shield" title="No applications yet" />}
        </section>

        <section className="section-card card">
          <SectionHead title="Coverage by division" />
          <div className="metric-list">
            {reference?.divisions?.map((d) => {
              const max = Math.max(...reference.divisions.map((x) => x.doctorCount), 1);
              return (
                <div key={d.id}>
                  <div className="metric">
                    <span className="metric-label">{d.name}</span>
                    <span className="metric-value">{d.doctorCount}</span>
                  </div>
                  <div className="progress"><i style={{ width: `${(d.doctorCount / max) * 100}%` }} /></div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Who may register as a doctor                                                */
/* -------------------------------------------------------------------------- */

const REGISTRATION_TYPES = [
  { value: "mbbs", label: "MBBS (Medical) — prefix A" },
  { value: "bds", label: "BDS (Dental) — prefix D" },
  { value: "mat", label: "Medical Assistant — prefix M" },
];

const EMPTY_APPROVAL = {
  registrationNumber: "",
  registrationType: "mbbs",
  phone: "",
  registerName: "",
  note: "",
};

/**
 * The gate in front of doctor sign-up.
 *
 * Nothing on this screen contacts the BM&DC register — there is no bulk feed
 * to query, and the public lookup is not something to scrape. The admin checks
 * the number themselves and records that they did. The form says so, because a
 * screen that implied the number had been checked automatically would be
 * claiming a check nobody performed.
 */
function Approvals({ api, notify }) {
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_APPROVAL);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [bmdcUrl, setBmdcUrl] = useState("https://verify.bmdc.org.bd/");

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const load = async () => {
    setLoading(true);
    const data = await api.doctorApprovals();
    setApprovals(data.approvals ?? []);
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
    api.verificationQueue().then((d) => d.bmdcVerifyUrl && setBmdcUrl(d.bmdcVerifyUrl));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);

    const result = await api.approveDoctorNumber(form);
    setBusy(false);

    if (!result.ok) {
      const details = result.error?.details ?? {};
      const perField = {};
      for (const [field, problems] of Object.entries(details)) {
        const problem = Array.isArray(problems) ? problems[0] : problems;
        if (problem) perField[field] = problem;
      }
      if (Object.keys(perField).length) setFieldErrors(perField);
      else setError(result.message ?? "That approval could not be recorded.");
      return;
    }

    setForm(EMPTY_APPROVAL);
    await load();
    notify?.("Approved — this doctor can now sign up");
  };

  const revoke = async (approval) => {
    const result = await api.revokeDoctorApproval(approval.id);
    if (!result.ok) {
      notify?.(result.message ?? "That approval could not be withdrawn");
      return;
    }
    await load();
    notify?.("Approval withdrawn");
  };

  const open = approvals.filter((a) => a.status === "open");
  const settled = approvals.filter((a) => a.status !== "open");

  return (
    <>
      <PageHeading
        title="Doctor sign-up approvals"
        subtitle="A doctor can only create an account against a registration number and mobile you have approved here."
      />

      <Banner tone="info" icon="shield" title="Check the register first">
        Niramoy does not look these numbers up for you. Open the BM&amp;DC verification service,
        confirm the number belongs to the person you are approving, then record it here with the
        mobile number they will sign up on. Both must match at sign-up.
        <br />
        <a className="text-link" href={bmdcUrl} target="_blank" rel="noreferrer noopener">
          <Icon name="arrow" size={12} /> Open verify.bmdc.org.bd
        </a>
      </Banner>

      <div className="section-card card">
        <SectionHead title="Approve a registration" />
        <form onSubmit={submit} noValidate>
          {error && (
            <div className="auth-error" role="alert">
              <Icon name="alert" size={14} /> {error}
            </div>
          )}

          <div className="field-row">
            <Field label="Registration type">
              <Select
                value={form.registrationType}
                onChange={(v) => set("registrationType", v)}
                options={REGISTRATION_TYPES}
              />
            </Field>
            <Field
              label="BM&DC registration number"
              hint="e.g. A-45312"
              error={fieldErrors.registrationNumber}
            >
              <input
                className="field"
                value={form.registrationNumber}
                onChange={(e) => set("registrationNumber", e.target.value)}
                placeholder="A-45312"
              />
            </Field>
          </div>

          <div className="field-row">
            <Field
              label="Mobile number"
              hint="The number this doctor will sign up with."
              error={fieldErrors.phone}
            >
              <input
                className="field"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                inputMode="tel"
                placeholder="01712 345678"
              />
            </Field>
            <Field label="Name on the register" hint="Optional — your own record of what you saw.">
              <input
                className="field"
                value={form.registerName}
                onChange={(e) => set("registerName", e.target.value)}
                placeholder="Dr. Ayesha Khan"
              />
            </Field>
          </div>

          <Field label="Note" hint="Optional.">
            <input
              className="field"
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder="Checked against the register on 7 Sep"
            />
          </Field>

          <button className="button primary" type="submit" disabled={busy}>
            {busy ? "Recording…" : "Approve this registration"} <Icon name="arrow" size={13} />
          </button>
        </form>
      </div>

      <div className="section-card card">
        <SectionHead title="Waiting to be used" note={`${open.length} open`} />
        {loading ? <Loading /> : open.length ? open.map((a) => (
          <div className="verification-row" key={a.id}>
            <div className="avatar md blue"><Icon name="shield" size={16} /></div>
            <main>
              <strong>{a.registerName || "Name not recorded"}</strong>
              <span className="mono-note">
                BM&amp;DC {a.registrationNumber} · {a.registrationType?.toUpperCase()} · {a.phone}
              </span>
              {a.note && <span>{a.note}</span>}
            </main>
            <button className="button ghost small" onClick={() => revoke(a)}>Withdraw</button>
          </div>
        )) : (
          <Empty
            icon="shield"
            title="No approvals waiting"
            hint="Nobody can sign up as a doctor until you approve a registration number here."
          />
        )}
      </div>

      {settled.length > 0 && (
        <div className="section-card card">
          <SectionHead title="Used and withdrawn" note={`${settled.length}`} />
          {settled.map((a) => (
            <div className="verification-row" key={a.id}>
              <div className="avatar md"><Icon name="shield" size={16} /></div>
              <main>
                <strong>{a.registerName || a.registrationNumber}</strong>
                <span className="mono-note">
                  BM&amp;DC {a.registrationNumber} · {a.phone}
                </span>
              </main>
              <StatusPill status={a.status} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Verification({ api, notify, onRefresh }) {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(null);
  const [bmdcUrl, setBmdcUrl] = useState("https://verify.bmdc.org.bd/");

  const load = async () => {
    setLoading(true);
    const data = await api.verificationQueue();
    setQueue(data.applications ?? []);
    setBmdcUrl(data.bmdcVerifyUrl ?? bmdcUrl);
    setLoading(false);
  };

  // Loads once on mount. `load` is redefined every render, so listing it would
  // re-fetch the queue on every keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const decide = async (approve) => {
    await api.decideApplication({ id: reviewing.id, approve, adminNote: approve ? "BM&DC register checked" : "Could not confirm registration" });
    setReviewing(null);
    await load();
    await onRefresh?.();
    notify?.(approve ? "Doctor verified and published to the directory" : "Application rejected");
  };

  const pending = queue.filter((q) => q.status === "pending");
  const decided = queue.filter((q) => q.status !== "pending");

  return (
    <>
      <PageHeading
        title="Doctor verification"
        subtitle="Confirm each applicant's BM&DC registration before their profile goes live."
      />

      <Banner tone="info" icon="shield" title="How to verify">
        Open the BM&amp;DC verification service, enter the applicant&apos;s registration number, and
        check the name matches. Approving publishes them to the public directory as a real,
        non-demo profile.
        <br />
        <a className="text-link" href={bmdcUrl} target="_blank" rel="noreferrer noopener">
          <Icon name="arrow" size={12} /> Open verify.bmdc.org.bd
        </a>
      </Banner>

      <div className="section-card card">
        <SectionHead title="Pending applications" note={`${pending.length} to review`} />
        {loading ? <Loading /> : pending.length ? pending.map((v) => (
          <div className="verification-row" key={v.id}>
            <div className="avatar md blue">
              {v.name?.replace(/^Dr\.?\s*/, "").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <main>
              <strong>{v.name}</strong>
              <span>{v.specialty} · {v.district}, {v.division}</span>
              <span className="mono-note">BM&amp;DC {v.bmdcNumber} · {v.registrationType?.toUpperCase()}</span>
            </main>
            <StatusPill status={v.status} />
            <button className="button secondary small" onClick={() => setReviewing(v)}>
              Review <Icon name="arrow" size={12} />
            </button>
          </div>
        )) : <Empty icon="check" title="Queue is clear" hint="No applications waiting for review." />}
      </div>

      {decided.length > 0 && (
        <div className="section-card card">
          <SectionHead title="Decided" note={`${decided.length}`} />
          {decided.map((v) => (
            <div className="verification-row" key={v.id}>
              <div className="avatar sm tan">
                {v.name?.replace(/^Dr\.?\s*/, "").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
              </div>
              <main>
                <strong>{v.name}</strong>
                <span>{v.adminNote}</span>
              </main>
              <StatusPill status={v.status} />
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(reviewing)}
        wide
        title="Review application"
        onClose={() => setReviewing(null)}
        footer={
          <>
            <button className="button ghost danger" onClick={() => decide(false)}>Reject</button>
            <button className="button primary" onClick={() => decide(true)}>
              <Icon name="check" size={14} />Approve &amp; publish
            </button>
          </>
        }
      >
        {reviewing && (
          <>
            <div className="review-grid">
              <div><span>Name</span><strong>{reviewing.name}</strong></div>
              <div><span>BM&amp;DC number</span><strong>{reviewing.bmdcNumber}</strong></div>
              <div><span>Registration type</span><strong>{reviewing.registrationType?.toUpperCase()}</strong></div>
              <div><span>Specialty</span><strong>{reviewing.specialty}</strong></div>
              <div><span>Qualifications</span><strong>{reviewing.degrees}</strong></div>
              <div><span>Experience</span><strong>{reviewing.experienceYears} years</strong></div>
              <div><span>Facility</span><strong>{reviewing.facility}</strong></div>
              <div><span>Location</span><strong>{reviewing.district}, {reviewing.division}</strong></div>
              <div><span>Fee</span><strong>৳ {reviewing.fee}</strong></div>
              <div><span>Email</span><strong>{reviewing.email}</strong></div>
            </div>

            {reviewing.bio && <p className="muted-note">{reviewing.bio}</p>}

            <Banner tone="warn" icon="alert" title="Check before approving">
              Open <a href={bmdcUrl} target="_blank" rel="noreferrer noopener">verify.bmdc.org.bd</a>,
              search <strong>{reviewing.bmdcNumber}</strong>, and confirm the registered name matches{" "}
              <strong>{reviewing.name}</strong> and the registration is current.
              {reviewing.lookup?.reason && (
                <>
                  <br /><em>System note: {reviewing.lookup.reason}</em>
                </>
              )}
            </Banner>
          </>
        )}
      </Modal>
    </>
  );
}

function Directory({ api, reference }) {
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await api.doctors({ perPage: 200 });
      setDoctors(data.doctors ?? []);
      setLoading(false);
    })();
  }, [api]);

  const shown = doctors.filter((d) =>
    filter === "all" ? true : filter === "real" ? !d.isDemoProfile : d.isDemoProfile
  );

  return (
    <>
      <PageHeading
        title="Directory"
        subtitle={`Every profile on Niramoy — ${reference?.stats?.realDoctors ?? 0} BM&DC-verified, ${reference?.stats?.demoDoctors ?? 0} seeded demo profiles.`}
      />

      <div className="appointment-tabs" role="tablist">
        {[["all", "All"], ["real", "BM&DC verified"], ["demo", "Demo profiles"]].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={filter === id} className={`tab ${filter === id ? "active" : ""}`} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="card section-card">
        {loading ? <Loading rows={5} /> : shown.length ? (
          <table className="directory-table">
            <thead>
              <tr><th>Doctor</th><th>Specialty</th><th>Location</th><th>BM&amp;DC</th><th>Fee</th><th>Rating</th><th>Source</th></tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div className="table-identity">
                      <Avatar person={d} size="sm" />
                      <div><strong>{d.name}</strong><span>{d.degrees}</span></div>
                    </div>
                  </td>
                  <td>{d.specialty}</td>
                  <td>{d.district}, {d.division}</td>
                  <td className="mono-note">{d.bmdcNumber}</td>
                  <td>{d.feeLabel}</td>
                  <td>{d.ratingCount ? <Rating value={d.rating} count={d.ratingCount} /> : <span className="muted-cell">No reviews</span>}</td>
                  <td>{d.isDemoProfile ? <DemoBadge compact /> : <span className="verified"><Icon name="check" size={10} /> Verified</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty icon="users" title="No profiles in this view" hint={filter === "real" ? "Approve an application in the verification queue to publish a real doctor." : undefined} />
        )}
      </div>
    </>
  );
}

function Specialties({ reference }) {
  return (
    <>
      <PageHeading
        title="Specialties"
        subtitle="Care categories patients can discover, mapped to the DGHS specialty taxonomy."
      />

      <Banner tone="info" icon="info" title="Where this taxonomy comes from">
        These categories are normalised from the 43 specialty labels in the DGHS &quot;Doctor
        Directory&quot; open dataset, so a future government or institutional import maps cleanly
        onto them. See <code>db/reference/dghs-doctor-directory.json</code>.
      </Banner>

      <div className="specialty-grid">
        {reference?.specialties?.map((s) => (
          <div className="section-card card specialty-card" key={s.id}>
            <div className="specialty-top">
              <div className="stat-icon"><Icon name={s.icon} size={17} /></div>
              <span className="specialty-count">{s.doctorCount}</span>
            </div>
            <h3>{s.name}</h3>
            <p className="specialty-bn">{s.bn}</p>
            <p className="specialty-blurb">{s.blurb}</p>
            {s.dghs?.length ? (
              <div className="specialty-map">Maps from: {s.dghs.join(", ")}</div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
