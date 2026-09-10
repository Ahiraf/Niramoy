"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons.js";
import {
  Avatar, PageHeading, Empty, ErrorState, Loading, Rating, VerifiedBadge, DemoBadge,
  useSlowLoad,
  Field, Select, Banner, SectionHead,
} from "../ui.js";

const SORTS = [
  { value: "best", label: "Best match" },
  { value: "rating", label: "Highest rated" },
  { value: "fee_low", label: "Fee: low to high" },
  { value: "fee_high", label: "Fee: high to low" },
  { value: "experience", label: "Most experienced" },
];

export function DoctorCard({ doctor, onOpen }) {
  return (
    <article className="doctor-card card">
      <div className="doctor-card-header">
        <Avatar person={doctor} size="lg" />
        <div className="doctor-detail">
          <h3>{doctor.name}</h3>
          <span className="specialty">{doctor.specialty}</span>
          <VerifiedBadge doctor={doctor} />
        </div>
      </div>

      <p className="doctor-degrees">{doctor.degrees}</p>

      <div className="doctor-place">
        <Icon name="building" size={12} />
        <span>{doctor.facility}</span>
      </div>
      <div className="doctor-place">
        <Icon name="pin" size={12} />
        <span>{placeLabel(doctor)}</span>
      </div>

      <div className="doctor-meta">
        <Rating value={doctor.rating} count={doctor.ratingCount} />
        <span>{doctor.experienceYears} yrs exp.</span>
        <span>{doctor.languages.slice(0, 2).join(", ")}</span>
      </div>

      <div className="doctor-card-footer">
        <div className="fee">{doctor.feeLabel}<span>/ session</span></div>
        <button className="button primary small" onClick={() => onOpen(doctor)}>
          View profile <Icon name="arrow" size={12} />
        </button>
      </div>
    </article>
  );
}

/**
 * "Chattogram, Chattogram" — or nothing at all.
 *
 * A doctor's district and division are optional on the profile, and joining
 * them blindly rendered the literal string "null, null" beside the specialty of
 * anyone who had not set them. Absent information should read as absent.
 */
function placeLabel(doctor, { withDivisionWord = false } = {}) {
  const parts = [doctor?.district, doctor?.division].filter(Boolean);
  if (!parts.length) return "";
  const text = parts.join(", ");
  return withDivisionWord && doctor?.division ? `${text} division` : text;
}

export function FindDoctors({ reference, initialSearch = "", onOpenDoctor, onNavigate, api }) {
  const [filters, setFilters] = useState({
    search: initialSearch,
    specialty: "All specialties",
    division: "All divisions",
    district: "All districts",
    language: "Any language",
    maxFee: "",
    minRating: "",
    sort: "best",
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [result, setResult] = useState({ doctors: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState(null);
  /** Bumping this re-runs the debounced search without touching the filters. */
  const [attempt, setAttempt] = useState(0);
  const slowSearch = useSlowLoad(loading);
  const stats = reference?.stats ?? null;

  useEffect(() => {
    setFilters((f) => ({ ...f, search: initialSearch }));
  }, [initialSearch]);

  // Debounced fetch so typing doesn't hammer the API.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const data = await api.doctors({ ...filters, perPage: 48 });
      if (cancelled) return;

      if (data.ok === false) {
        // Keep the filters and the last good result on screen. Clearing them
        // would make a failed request look like a search with no matches,
        // which is a different and much more discouraging message.
        setSearchError({ offline: data.reason === "network", message: data.message });
        setLoading(false);
        return;
      }

      setSearchError(null);
      setResult({ doctors: data.doctors ?? [], total: data.total ?? 0 });
      setLoading(false);
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [filters, api, attempt]);

  const districts = useMemo(() => {
    const division = reference?.divisions?.find((d) => d.name === filters.division);
    const names = division ? division.districts : reference?.divisions?.flatMap((d) => d.districts) ?? [];
    return ["All districts", ...names];
  }, [reference, filters.division]);

  const set = (key) => (value) =>
    setFilters((f) => ({
      ...f,
      [key]: value,
      // Changing division invalidates the chosen district.
      ...(key === "division" ? { district: "All districts" } : {}),
    }));

  const activeFilterCount = [
    filters.specialty !== "All specialties",
    filters.division !== "All divisions",
    filters.district !== "All districts",
    filters.language !== "Any language",
    Boolean(filters.maxFee),
    Boolean(filters.minRating),
  ].filter(Boolean).length;

  return (
    <>
      <PageHeading
        title="Find your doctor"
        subtitle={
          reference?.stats
            ? `${reference.stats.doctors} verified doctors · ${reference.stats.divisionsCovered} divisions · ${reference.stats.districtsCovered} districts`
            : "Trusted care from verified specialists."
        }
        actions={
          <button className="button primary" onClick={() => onNavigate("assistant")}>
            <Icon name="bot" size={14} />Help me choose
          </button>
        }
      />

      <div className="search-strip card">
        <div className="search-field">
          <Icon name="search" size={15} />
          <input
            value={filters.search}
            onChange={(e) => set("search")(e.target.value)}
            placeholder="Search by name, specialty, hospital or district"
            aria-label="Search doctors"
          />
          {filters.search && (
            <button className="clear-search" onClick={() => set("search")("")} aria-label="Clear search">
              <Icon name="x" size={13} />
            </button>
          )}
        </div>

        <Select
          value={filters.specialty}
          onChange={set("specialty")}
          aria-label="Specialty"
          options={["All specialties", ...(reference?.specialties?.map((s) => s.name) ?? [])]}
        />
        <Select
          value={filters.division}
          onChange={set("division")}
          aria-label="Division"
          options={["All divisions", ...(reference?.divisions?.map((d) => d.name) ?? [])]}
        />

        <button
          className={`filter-button ${activeFilterCount ? "has-filters" : ""}`}
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
        >
          <Icon name="filter" size={14} /> Filters
          {activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}
        </button>
      </div>

      {showAdvanced && (
        <div className="advanced-filters card">
          <Field label="District">
            <Select value={filters.district} onChange={set("district")} options={districts} />
          </Field>
          <Field label="Language">
            <Select
              value={filters.language}
              onChange={set("language")}
              options={["Any language", ...(reference?.languages ?? [])]}
            />
          </Field>
          <Field label="Maximum fee (৳)" hint="Leave blank for any">
            <input
              className="field" type="number" min="0" step="100" placeholder="e.g. 1000"
              value={filters.maxFee}
              onChange={(e) => set("maxFee")(e.target.value)}
            />
          </Field>
          <Field label="Minimum rating">
            <Select
              value={filters.minRating}
              onChange={set("minRating")}
              options={[
                { value: "", label: "Any rating" },
                { value: "4", label: "4.0 and above" },
                { value: "4.5", label: "4.5 and above" },
                { value: "4.8", label: "4.8 and above" },
              ]}
            />
          </Field>
          <Field label="Sort by">
            <Select value={filters.sort} onChange={set("sort")} options={SORTS} />
          </Field>
          <button
            className="button ghost small reset-filters"
            onClick={() =>
              setFilters((f) => ({
                ...f,
                specialty: "All specialties", division: "All divisions",
                district: "All districts", language: "Any language",
                maxFee: "", minRating: "", sort: "best",
              }))
            }
          >
            <Icon name="refresh" size={13} /> Reset
          </button>
        </div>
      )}

      <Banner tone="info" icon="info" title="About this directory">
        Profiles marked <DemoBadge compact /> are sample data built on Bangladesh&apos;s real
        districts, hospitals and specialties — Bangladesh has no public registry of doctors to import.
        Real doctors join by submitting their BM&amp;DC registration number for admin verification.
      </Banner>

      <SectionHead
        title={
          loading
            ? "Searching…"
            : `${result.total} doctor profile${result.total === 1 ? "" : "s"}`
        }
        note={SORTS.find((s) => s.value === filters.sort)?.label}
      />

      {/*
        * How many of the profiles below are real practitioners.
        *
        * The directory is mostly seeded sample data, and a patient cannot tell
        * that from a card alone — every card looks equally official. Saying it
        * once, above the grid, is what makes the per-card Demo badge legible
        * as a warning rather than decoration.
        */}
      {!loading && stats && (
        <p className="directory-provenance">
          <Icon name="shield" size={12} />
          {stats.realDoctors} BM&amp;DC-verified {stats.realDoctors === 1 ? "doctor" : "doctors"} in
          the directory · {stats.demoDoctors} demo {stats.demoDoctors === 1 ? "profile" : "profiles"},
          which are sample data and not bookable care.
        </p>
      )}

      {searchError && (
        <ErrorState
          compact
          offline={searchError.offline}
          title={searchError.offline ? "You appear to be offline" : "The search didn't run"}
          message={
            searchError.offline
              ? "Your filters are still here. Reconnect and try again."
              : (searchError.message ?? "We couldn't reach the directory just now. Your filters are unchanged.")
          }
          onRetry={() => setAttempt((n) => n + 1)}
          retrying={loading}
        />
      )}

      {loading ? (
        <Loading rows={4} slow={slowSearch} onRetry={() => setAttempt((n) => n + 1)} />
      ) : result.doctors.length ? (
        <div className="doctor-grid">
          {result.doctors.map((d) => (
            <DoctorCard key={d.id} doctor={d} onOpen={onOpenDoctor} />
          ))}
        </div>
      ) : (
        <Empty
          icon="search"
          title="No doctors match those filters"
          hint="Try widening the division, raising the fee limit, or clearing the search."
          action={
            <button
              className="button secondary small"
              onClick={() =>
                setFilters({
                  search: "", specialty: "All specialties", division: "All divisions",
                  district: "All districts", language: "Any language",
                  maxFee: "", minRating: "", sort: "best",
                })
              }
            >
              Clear all filters
            </button>
          }
        />
      )}
    </>
  );
}

export function DoctorProfile({ doctor, reviews = [], onBook, onBack, onNavigate }) {
  if (!doctor) return null;

  return (
    <>
      <PageHeading
        title={doctor.name}
        subtitle={[doctor.specialty, placeLabel(doctor)].filter(Boolean).join(" · ")}
        back={{ label: "Back to doctors", onClick: onBack }}
        actions={
          <button className="button primary" onClick={() => onBook(doctor)}>
            <Icon name="calendar" size={14} />Book appointment
          </button>
        }
      />

      <div className="profile-layout">
        <section className="card profile-main">
          <div className="profile-intro">
            <Avatar person={doctor} size="lg" />
            <div>
              <h2>{doctor.name}</h2>
              <p>{doctor.degrees}</p>
              <VerifiedBadge doctor={doctor} />
            </div>
          </div>

          {doctor.isDemoProfile && (
            <Banner tone="warn" icon="info" title="This is a sample profile">
              Not a real physician. It exists so the booking, scheduling and consultation flows can be
              demonstrated end-to-end. Real profiles appear here once a doctor&apos;s BM&amp;DC
              registration is verified by an admin.
            </Banner>
          )}

          <p className="profile-bio">{doctor.bio}</p>

          <div className="profile-facts">
            <div><span>Experience</span><strong>{doctor.experienceYears} years</strong></div>
            <div><span>Consultation fee</span><strong>{doctor.feeLabel}</strong></div>
            <div><span>Session length</span><strong>{doctor.consultationMinutes} min</strong></div>
            <div><span>Languages</span><strong>{doctor.languages.join(", ")}</strong></div>
            <div><span>BM&amp;DC no.</span><strong>{doctor.bmdcNumber}</strong></div>
            <div><span>Next available</span><strong>{doctor.nextAvailableHint}</strong></div>
          </div>

          <SectionHead title="Where they practise" />
          <div className="facility-row">
            <div className="stat-icon"><Icon name="building" size={17} /></div>
            <div>
              <strong>{doctor.facility}</strong>
              <span>{placeLabel(doctor, { withDivisionWord: true })}</span>
            </div>
          </div>

          <SectionHead title="Weekly availability" note="Bangladesh Standard Time" />
          {doctor.availability?.length ? (
            <table className="availability-table">
              <thead>
                <tr><th>Day</th><th>Hours</th><th>Slot length</th></tr>
              </thead>
              <tbody>
                {doctor.availability.map((rule, i) => (
                  <tr key={i}>
                    <td>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][rule.weekday]}</td>
                    <td>{rule.localStart} – {rule.localEnd}</td>
                    <td><span className="availability-chip">{rule.slotMinutes} min</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty icon="clock" title="No hours published yet" hint="This doctor hasn't set their availability." />
          )}

          <SectionHead title="Patient reviews" note={`${doctor.ratingCount} total`} />
          {reviews.length ? (
            reviews.slice(0, 5).map((r) => (
              <div className="review-row" key={r.id}>
                <Rating value={r.rating} />
                <p>{r.comment || <em>No written comment.</em>}</p>
                <time>{new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</time>
              </div>
            ))
          ) : (
            <p className="muted-note">
              No written reviews on Niramoy yet. The {doctor.rating} rating shown is seeded sample data.
            </p>
          )}
        </section>

        <aside className="profile-side card">
          <h3>Book with {doctor.name.split(" ").slice(0, 2).join(" ")}</h3>
          <div className="summary-line"><span>Fee</span><strong>{doctor.feeLabel}</strong></div>
          <div className="summary-line"><span>Format</span><strong>Video consultation</strong></div>
          <div className="summary-line"><span>Duration</span><strong>{doctor.consultationMinutes} minutes</strong></div>
          <div className="summary-line"><span>Follow-up</span><strong>{doctor.acceptsFollowUp ? "Included" : "Charged separately"}</strong></div>

          <button className="button primary" style={{ width: "100%" }} onClick={() => onBook(doctor)}>
            See available times <Icon name="arrow" size={14} />
          </button>

          <div className="secure-note">
            <Icon name="shield" size={15} />
            <span>
              Slots come from the doctor&apos;s real availability rules and are checked for conflicts
              at booking time. You can cancel up to an hour before the visit.
            </span>
          </div>

          <button className="text-link" style={{ marginTop: 12 }} onClick={() => onNavigate("assistant")}>
            <Icon name="bot" size={13} /> Not sure this is the right specialty?
          </button>
        </aside>
      </div>
    </>
  );
}
