"use client";

import { useState } from "react";
import { Icon } from "../icons.js";
import { useT } from "../../lib/i18n.js";
import {
  Avatar, PageHeading, SectionHead, Empty, Loading, Modal, Field, Select, Banner,
} from "../ui.js";

const fmt = (iso) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function Records({ loading, records, prescriptions, appointments, onAddRecord, onNavigate }) {
  const [adding, setAdding] = useState(false);
  const [openRx, setOpenRx] = useState(null);

  // One chronological stream: records, prescriptions and completed visits.
  const timeline = [
    ...records.map((r) => ({ kind: r.kind, at: r.createdAt, title: r.title, body: r.note, tag: r.kind === "lab" ? "Lab report" : "Note" })),
    ...prescriptions.map((p) => ({
      kind: "prescription", at: p.createdAt,
      title: `Prescription from ${p.doctor?.name ?? "your doctor"}`,
      body: p.diagnosis, tag: "Prescription", ref: p,
    })),
    ...appointments.filter((a) => a.status === "completed").map((a) => ({
      kind: "visit", at: a.startUtc,
      title: `Consultation with ${a.doctor?.name}`,
      body: a.reason, tag: a.doctor?.specialty,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <>
      <PageHeading
        title="Medical records"
        subtitle="Your health history, prescriptions and consultation notes in one secure timeline."
        actions={
          <>
            <button className="button ghost" onClick={() => window.print()}>
              <Icon name="download" size={14} />Export
            </button>
            <button className="button primary" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} />Add a record
            </button>
          </>
        }
      />

      <div className="records-grid">
        <section className="health-score card">
          <span className="eyebrow">Your care overview</span>
          <div className="score-row">
            <div className="score-circle"><strong>{timeline.length}</strong></div>
            <p>
              <strong>{timeline.length ? "Your history is building up" : "Nothing recorded yet"}</strong>
              <br />
              {timeline.length
                ? `${records.length} record${records.length === 1 ? "" : "s"}, ${prescriptions.length} prescription${prescriptions.length === 1 ? "" : "s"} and ${appointments.filter((a) => a.status === "completed").length} completed visit${appointments.filter((a) => a.status === "completed").length === 1 ? "" : "s"}.`
                : "Records from your consultations will collect here automatically."}
            </p>
          </div>
        </section>

        <section className="timeline card">
          <SectionHead title="Care timeline" note={`${timeline.length} entries`} />
          {loading ? <Loading /> : timeline.length ? (
            timeline.map((item, i) => (
              <div className="timeline-item" key={`${item.kind}-${i}`}>
                <div className="timeline-rail"><i className={`timeline-dot ${item.kind}`} /></div>
                <div className="timeline-content">
                  <header>
                    <strong>{item.title}</strong>
                    <time>{fmt(item.at)}</time>
                  </header>
                  {item.body && <p>{item.body}</p>}
                  <span className="pill">{item.tag}</span>
                  {item.ref && (
                    <button className="text-link" onClick={() => setOpenRx(item.ref)}>
                      View prescription
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <Empty icon="file" title="No records yet" hint="Complete a consultation, or add a record yourself." />
          )}
        </section>
      </div>

      <section className="prescription-card card">
        <SectionHead
          title="Prescriptions"
          note={`${prescriptions.length} total`}
          action={<button className="text-link" onClick={() => onNavigate("appointments")}>Book a follow-up</button>}
        />
        {prescriptions.length ? (
          prescriptions.map((p) => (
            <div className="prescription-row" key={p.id}>
              <div className="medicine-icon"><Icon name="pill" size={14} /></div>
              <main>
                <strong>{p.diagnosis || "Prescription"}</strong>
                <span>{p.doctor?.name} · {fmt(p.createdAt)} · {p.items.length} medicine{p.items.length === 1 ? "" : "s"}</span>
              </main>
              <button className="button ghost small" onClick={() => setOpenRx(p)}>
                <Icon name="file" size={12} />Open
              </button>
            </div>
          ))
        ) : (
          <Empty icon="pill" title="No prescriptions yet" hint="Prescriptions issued after a consultation appear here." />
        )}
      </section>

      <PrescriptionModal prescription={openRx} onClose={() => setOpenRx(null)} />

      <AddRecordModal
        open={adding}
        onClose={() => setAdding(false)}
        onSubmit={async (payload) => { await onAddRecord(payload); setAdding(false); }}
      />
    </>
  );
}

function PrescriptionModal({ prescription, onClose }) {
  const { t } = useT();
  if (!prescription) return null;
  return (
    <Modal open title={t("rx.title")} onClose={onClose} wide
      footer={<button className="button primary" onClick={() => window.print()}>
        <Icon name="download" size={14} />Download PDF
      </button>}
    >
      <div className="rx-sheet">
        <header className="rx-head">
          <div>
            <strong>{prescription.doctor?.name}</strong>
            <span>{prescription.doctor?.specialty} · {prescription.doctor?.degrees}</span>
            <span>{prescription.doctor?.facility}</span>
          </div>
          <div className="rx-brand">
            <div className="brand-mark"><Icon name="heart" size={16} strokeWidth={2.2} /></div>
            <time>{fmt(prescription.createdAt)}</time>
          </div>
        </header>

        {prescription.diagnosis && (
          <div className="rx-block">
            <span className="rx-label">{t("rx.diagnosis")}</span>
            <p>{prescription.diagnosis}</p>
          </div>
        )}

        <div className="rx-block">
          <span className="rx-label">℞ Medicines</span>
          <table className="rx-table">
            <thead><tr>
              <th>{t("rx.title")}</th>
              <th>{t("rx.dose")}</th>
              <th>{t("rx.frequency")}</th>
              <th>{t("rx.duration")}</th>
            </tr></thead>
            <tbody>
              {prescription.items.map((it, i) => (
                <tr key={i}>
                  <td><strong>{it.drug}</strong></td>
                  <td>{it.dose}</td>
                  <td>{it.frequency}</td>
                  <td>{it.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {prescription.notes && (
          <div className="rx-block">
            <span className="rx-label">{t("rx.advice")}</span>
            <p>{prescription.notes}</p>
          </div>
        )}

        {/*
          * How to take it, and what not to do with it. The medicine names and
          * the doctor's own words stay exactly as written — translating a
          * prescriber's instruction would be practising medicine. These are
          * Niramoy's standing advice, and they are translated.
          */}
        <div className="rx-block rx-guidance">
          <p>{t("rx.finishCourse")}</p>
          <p>{t("rx.notADiagnosis")}</p>
        </div>

        {prescription.aiSummary && (
          <div className="rx-block ai">
            <span className="rx-label"><Icon name="bot" size={12} /> AI visit summary — reviewed by the doctor</span>
            <p>{prescription.aiSummary}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function AddRecordModal({ open, onClose, onSubmit }) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState("note");

  return (
    <Modal
      open={open} title="Add a record" onClose={onClose}
      footer={
        <>
          <button className="button ghost" onClick={onClose}>Cancel</button>
          <button
            className="button primary"
            disabled={!title.trim()}
            onClick={() => { onSubmit({ title, note, kind }); setTitle(""); setNote(""); }}
          >
            Save record
          </button>
        </>
      }
    >
      <Field label="Type">
        <Select
          value={kind} onChange={setKind}
          options={[
            { value: "note", label: "Personal note" },
            { value: "lab", label: "Lab report" },
            { value: "imaging", label: "Imaging / X-ray" },
            { value: "vaccination", label: "Vaccination" },
          ]}
        />
      </Field>
      <Field label="Title">
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Blood sugar test" />
      </Field>
      <Field label="Details" hint="Values, dates, anything you want your doctor to see.">
        <textarea className="field textarea" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Banner tone="info" icon="shield">
        Records are visible only to you and to doctors you consult with.
      </Banner>
    </Modal>
  );
}

export function Family({ members, onAdd, onRemove, onNavigate }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", relation: "Child", age: "", gender: "Female" });

  return (
    <>
      <PageHeading
        title="Family members"
        subtitle="Book and manage appointments on behalf of a child, parent or spouse."
        actions={
          <button className="button primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} />Add member
          </button>
        }
      />

      <div className="card section-card">
        {members.length ? (
          members.map((m) => (
            <div className="appointment-row" key={m.id}>
              <Avatar person={m} />
              <div className="appt-main">
                <strong>{m.name}</strong>
                <span>{m.relation} · {m.age ? `${m.age} years` : "Age not set"} · {m.gender}</span>
              </div>
              <button className="button ghost small" onClick={() => onNavigate("doctors")}>
                Book for them
              </button>
              <button className="button ghost small danger" onClick={() => onRemove(m.id)}>
                Remove
              </button>
            </div>
          ))
        ) : (
          <Empty
            icon="users"
            title="No family members yet"
            hint="Add someone to book appointments on their behalf."
            action={<button className="button primary small" onClick={() => setAdding(true)}>Add a member</button>}
          />
        )}
      </div>

      <Modal
        open={adding} title="Add a family member" onClose={() => setAdding(false)}
        footer={
          <>
            <button className="button ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button
              className="button primary"
              disabled={!form.name.trim()}
              onClick={async () => {
                await onAdd(form);
                setForm({ name: "", relation: "Child", age: "", gender: "Female" });
                setAdding(false);
              }}
            >
              Add member
            </button>
          </>
        }
      >
        <Field label="Full name">
          <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ayaan Begum" />
        </Field>
        <Field label="Relationship">
          <Select
            value={form.relation}
            onChange={(v) => setForm({ ...form, relation: v })}
            options={["Child", "Parent", "Spouse", "Sibling", "Other"]}
          />
        </Field>
        <div className="field-row">
          <Field label="Age">
            <input className="field" type="number" min="0" max="120" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
          </Field>
          <Field label="Gender">
            <Select value={form.gender} onChange={(v) => setForm({ ...form, gender: v })} options={["Female", "Male", "Other"]} />
          </Field>
        </div>
      </Modal>
    </>
  );
}
