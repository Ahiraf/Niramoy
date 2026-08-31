"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./lib/api.js";
import { Sidebar, Topbar } from "./components/shell.js";
import { ErrorState, OfflineBar, Toast, useOnline } from "./components/ui.js";
import { Dashboard } from "./components/patient/dashboard.js";
import { FindDoctors, DoctorProfile } from "./components/patient/find-doctors.js";
import { Booking } from "./components/patient/booking.js";
import { BkashCheckout } from "./components/patient/bkash-checkout.js";
import { Appointments, Consultation } from "./components/patient/appointments.js";
import { Booked } from "./components/patient/booked.js";
import { Assistant } from "./components/patient/assistant.js";
import { Records, Family } from "./components/patient/records.js";
import { Settings } from "./components/settings.js";
import { JoinAsDoctor, DoctorPending } from "./components/join-as-doctor.js";
import { Icon } from "./components/icons.js";
import { DoctorWorkspace, useDoctorSelf } from "./components/doctor-workspace.js";
import { AdminWorkspace } from "./components/admin-workspace.js";
import { Landing } from "./components/landing.js";
import { AuthPage } from "./components/auth-page.js";

const HOME = { patient: "dashboard", doctor: "doctor-home", admin: "admin-home" };

export default function Home() {
  // Screens: booting → landing / auth (signed out) → app (signed in).
  const [user, setUser] = useState(null);
  const [screen, setScreen] = useState("booting");
  const [auth, setAuth] = useState({ mode: "signin", role: "patient" });
  const [doctorDraft, setDoctorDraft] = useState(null);

  const role = user?.role ?? "patient";
  const [active, setActive] = useState("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);

  // Server-backed state.
  const [reference, setReference] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [topDoctors, setTopDoctors] = useState([]);
  const [records, setRecords] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [family, setFamily] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [loading, setLoading] = useState(true);
  /**
   * A load that did not complete. Held separately from `loading` because the
   * two are not opposites: a failed load finishes, and showing an empty
   * dashboard afterwards tells the patient they have no appointments when what
   * actually happened is that we could not ask.
   */
  const [loadError, setLoadError] = useState(null);
  const [retrying, setRetrying] = useState(false);

  // Navigation payloads.
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [doctorReviews, setDoctorReviews] = useState([]);
  const [activeCall, setActiveCall] = useState(null);
  const [rescheduling, setRescheduling] = useState(null);
  /** A started bKash payment awaiting the payer's confirmation. */
  const [pendingPayment, setPendingPayment] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  /** The appointment just booked, shown on the confirmation screen. */
  const [justBooked, setJustBooked] = useState(null);

  const doctorSelf = useDoctorSelf(user, api);
  const online = useOnline();

  const showToast = useCallback((message, tone = "success") => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 3200);
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Data loading                                                            */
  /* ---------------------------------------------------------------------- */

  /*
   * Each of these reports whether it worked, and writes nothing when it did
   * not. Overwriting good data with the empty fallback of a failed request is
   * how a network blip turns into "your prescriptions are gone".
   */

  const refreshAppointments = useCallback(async () => {
    const data = await api.appointments();
    if (data.ok === false) return false;
    setAppointments(data.appointments ?? []);
    return true;
  }, []);

  const refreshNotifications = useCallback(async () => {
    const data = await api.notifications();
    if (data.ok === false) return false;
    setNotifications(data.notifications ?? []);
    setUnread(data.unread ?? 0);
    return true;
  }, []);

  const refreshReference = useCallback(async () => {
    const data = await api.reference();
    if (data.ok === false) return false;
    setReference(data);
    return true;
  }, []);

  const refreshRecords = useCallback(async () => {
    const data = await api.records();
    if (data.ok === false) return false;
    setRecords(data.records ?? []);
    setPrescriptions(data.prescriptions ?? []);
    return true;
  }, []);

  /**
   * Session first: the landing page needs the reference stats either way, but
   * nothing personal is fetched until we know who is asking.
   */
  const boot = useCallback(async () => {
    setLoadError(null);
    // allSettled, not all: a rejection here used to leave the app on the boot
    // splash forever, with no way forward but a manual refresh.
    const [sessionResult] = await Promise.allSettled([api.session(), refreshReference()]);

    const session = sessionResult.status === "fulfilled" ? sessionResult.value : null;
    if (!session || session.ok === false) {
      setLoadError({ scope: "boot" });
      setScreen("boot-failed");
      setLoading(false);
      return;
    }

    const me = session.user ?? null;
    setUser(me);
    setActive(me ? HOME[me.role] : "dashboard");
    setScreen(me ? "app" : "landing");
    if (!me) setLoading(false);
  }, [refreshReference]);

  useEffect(() => {
    boot();
  }, [boot]);

  /**
   * Everything the workspace needs, in one pass.
   *
   * allSettled rather than all: one failing call should not discard the five
   * that worked. Whatever arrived is rendered, and the parts that did not are
   * reported together with a way to ask again.
   */
  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const settled = await Promise.allSettled([
      refreshAppointments(),
      refreshNotifications(),
      refreshRecords(),
      api.doctors({ sort: "rating", perPage: 6 }),
      api.family(),
      api.waitlist(),
    ]);

    const valueAt = (i) => (settled[i].status === "fulfilled" ? settled[i].value : null);
    const failedAt = (i) => {
      const value = valueAt(i);
      return value === null || value === false || value?.ok === false;
    };

    const top = valueAt(3);
    const fam = valueAt(4);
    const wait = valueAt(5);
    if (top?.doctors) setTopDoctors(top.doctors);
    if (fam?.members) setFamily(fam.members);
    if (wait?.entries) setWaitlist(wait.entries);

    setLoading(false);
    if (settled.some((_, i) => failedAt(i))) setLoadError({ scope: "workspace" });
  }, [refreshAppointments, refreshNotifications, refreshRecords]);

  const retryLoad = useCallback(async () => {
    setRetrying(true);
    if (loadError?.scope === "boot") await boot();
    else await loadWorkspace();
    setRetrying(false);
  }, [boot, loadError, loadWorkspace]);

  /** Workspace data. Re-runs on sign-in and sign-out, so no state leaks across. */
  useEffect(() => {
    if (!user) {
      setAppointments([]); setRecords([]); setPrescriptions([]);
      setNotifications([]); setUnread(0); setFamily([]); setWaitlist([]);
      return;
    }
    loadWorkspace();
  }, [user, loadWorkspace]);

  /* ---------------------------------------------------------------------- */
  /* Actions                                                                 */
  /* ---------------------------------------------------------------------- */

  const navigate = useCallback((next) => {
    setActive(next);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Session                                                                 */
  /* ---------------------------------------------------------------------- */

  const openAuth = useCallback((mode, nextRole) => {
    setAuth({ mode, role: nextRole });
    setScreen("auth");
    window.scrollTo({ top: 0 });
  }, []);

  const onAuthenticated = useCallback((account, draft) => {
    setUser(account);
    setDoctorDraft(draft);
    setActive(HOME[account.role]);
    setScreen("app");
    showToast(`Welcome, ${account.name.split(" ")[0]}`);
  }, [showToast]);

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
    setDoctorDraft(null);
    setMenuOpen(false);
    setScreen("landing");
    showToast("Signed out");
  }, [showToast]);

  /** Re-reads the session — used after a doctor submits their application. */
  const refreshSession = useCallback(async () => {
    const session = await api.session();
    setUser(session.user ?? null);
    return session.user ?? null;
  }, []);

  const openDoctor = useCallback(async (doctor) => {
    setSelectedDoctor(doctor);
    navigate("doctor-profile");
    const data = await api.doctor(doctor.id);
    if (data.ok) {
      setSelectedDoctor(data.doctor);
      setDoctorReviews(data.reviews ?? []);
    }
  }, [navigate]);

  const startBooking = useCallback((doctor) => {
    setSelectedDoctor(doctor);
    setRescheduling(null);
    navigate("booking");
  }, [navigate]);

  const confirmBooking = useCallback(async (payload) => {
    // Rescheduling reuses the same slot picker, so route it to PATCH instead.
    if (rescheduling) {
      const result = await api.updateAppointment(rescheduling.id, {
        action: "reschedule",
        startUtc: payload.startUtc,
      });
      if (result.ok) {
        await Promise.all([refreshAppointments(), refreshNotifications()]);
        setRescheduling(null);
        showToast("Appointment rescheduled");
        navigate("appointments");
      } else {
        showToast(result.message ?? "Could not reschedule", "error");
      }
      return result;
    }

    const result = await api.book(payload);
    if (!result.ok) {
      showToast(result.message ?? "Could not book that slot", "error");
      return result;
    }

    await Promise.all([refreshAppointments(), refreshNotifications()]);

    // The slot is held either way. Payment is a separate step on purpose: if
    // starting it fails, the patient still has their appointment and can pay
    // from the appointments list, rather than losing the slot to a wallet
    // problem.
    const method = payload.paymentMethod ?? "bkash";
    const payment = await api.pay({
      appointmentId: result.appointment.id,
      method,
      idempotencyKey: `appt:${result.appointment.id}`,
    });

    /*
     * Land on "what happens next" rather than the appointments list.
     *
     * A toast answers "did it work" and none of the questions someone actually
     * has at this point: when do I join, what if I can't make it, will I be
     * reminded, is my money at risk.
     */
    setJustBooked(result.appointment);
    navigate("booked");

    if (method === "bkash" && payment.ok && payment.payment.status === "pending") {
      setPendingPayment({ payment: payment.payment, appointment: result.appointment });
    } else if (method === "cash") {
      showToast("Appointment confirmed. Pay at the chamber on the day.");
    } else {
      showToast("Appointment confirmed. You're all set!");
    }
    return result;
  }, [rescheduling, refreshAppointments, refreshNotifications, showToast, navigate]);

  /** Resume a bKash payment that was started but never confirmed. */
  const payForAppointment = useCallback(async (appointment) => {
    const payment = await api.pay({
      appointmentId: appointment.id,
      method: "bkash",
      idempotencyKey: `appt:${appointment.id}`,
    });
    if (!payment.ok) {
      showToast(payment.message ?? "Could not start that payment", "error");
      return;
    }
    setPendingPayment({ payment: payment.payment, appointment });
  }, [showToast]);

  const cancelAppointment = useCallback(async (id) => {
    const result = await api.updateAppointment(id, { action: "cancel" });
    if (result.ok) {
      await Promise.all([refreshAppointments(), refreshNotifications()]);
      showToast("Appointment cancelled");
    } else {
      showToast(result.message ?? "Could not cancel", "error");
    }
  }, [refreshAppointments, refreshNotifications, showToast]);

  const reschedule = useCallback((appointment) => {
    setRescheduling(appointment);
    setSelectedDoctor(appointment.doctor);
    navigate("booking");
  }, [navigate]);

  const joinCall = useCallback(async (appointment) => {
    // The room and the token are minted server-side, scoped to this
    // appointment and this participant, and expire. Nothing joinable is held
    // in the client until the server says who you are.
    const result = await api.joinCall(appointment.id);
    if (!result.ok) {
      showToast(result.message ?? "This consultation room isn't open yet.", "error");
      return;
    }
    setActiveCall({ ...appointment, call: result.call });
    navigate("consultation");
  }, [navigate, showToast]);

  const completeCall = useCallback(async (id) => {
    await api.updateAppointment(id, { action: "complete" });
    await refreshAppointments();
    showToast("Consultation completed");
  }, [refreshAppointments, showToast]);

  const submitReview = useCallback(async (payload) => {
    const result = await api.addReview(payload);
    showToast(result.ok ? "Thanks for your review" : (result.message ?? "Could not save review"), result.ok ? "success" : "error");
    if (result.ok) await refreshReference();
  }, [showToast, refreshReference]);

  const addRecord = useCallback(async (payload) => {
    await api.addRecord(payload);
    await refreshRecords();
    showToast("Record added to your timeline");
  }, [refreshRecords, showToast]);

  const issuePrescription = useCallback(async (payload) => {
    const { summaryId, aiSummary, ...prescription } = payload;
    const result = await api.addPrescription(prescription);
    if (!result.ok) {
      showToast(result.message ?? "Could not issue the prescription", "error");
      return;
    }

    /**
     * Publishing the prescription is the doctor's explicit confirmation of the
     * AI draft they reviewed and edited. Only now does the summary become part
     * of the patient's record, authored by the doctor.
     */
    if (summaryId) {
      const approved = await api.reviewSummary(summaryId, {
        action: "approve",
        edited: { summary: aiSummary, diagnosis: prescription.diagnosis, advice: prescription.notes },
      });
      if (!approved.ok) showToast("Prescription saved, but the summary wasn't published", "error");
    }

    await Promise.all([refreshRecords(), refreshNotifications()]);
  }, [refreshRecords, refreshNotifications, showToast]);

  const joinWaitlist = useCallback(async (doctor) => {
    const dateKey = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await api.joinWaitlist({ doctorId: doctor.id, dateKey });
    const data = await api.waitlist();
    setWaitlist(data.entries ?? []);
    showToast("Added to the waitlist — we'll notify you when a slot frees up");
  }, [showToast]);

  const leaveWaitlist = useCallback(async (id) => {
    await api.leaveWaitlist(id);
    const data = await api.waitlist();
    setWaitlist(data.entries ?? []);
    showToast("Removed from the waitlist");
  }, [showToast]);

  const addFamilyMember = useCallback(async (payload) => {
    await api.addFamily(payload);
    const data = await api.family();
    setFamily(data.members ?? []);
    showToast(`${payload.name} added to your family account`);
  }, [showToast]);

  const removeFamilyMember = useCallback(async (id) => {
    await api.removeFamily(id);
    const data = await api.family();
    setFamily(data.members ?? []);
    showToast("Family member removed");
  }, [showToast]);

  const onSearch = useCallback((term) => {
    setSearchTerm(term);
    navigate("doctors");
  }, [navigate]);

  const readNotifications = useCallback(async () => {
    await api.readNotifications();
    setUnread(0);
    setNotifications((list) => list.map((n) => ({ ...n, read: true })));
  }, []);

  /* ---------------------------------------------------------------------- */
  /* View routing                                                            */
  /* ---------------------------------------------------------------------- */

  // Settings is one component for all three roles; it renders from the session.
  const settingsProps = {
    user,
    role,
    doctor: role === "doctor" ? doctorSelf : null,
    reference,
    api,
    onNavigate: navigate,
    onUserChange: setUser,
    notify: showToast,
  };

  const counts = useMemo(() => ({
    appointments: appointments.filter((a) => ["confirmed", "pending"].includes(a.status)).length,
    pending: reference?.stats?.pendingVerifications ?? 0,
  }), [appointments, reference]);

  if (screen === "booting") {
    return (
      <div className="boot-screen" role="status" aria-live="polite">
        <div className="brand-mark"><Icon name="heart" size={20} strokeWidth={2.2} /></div>
        <span>Loading Niramoy…</span>
      </div>
    );
  }

  if (screen === "boot-failed") {
    return (
      <div className="boot-screen">
        <div className="brand-mark"><Icon name="heart" size={20} strokeWidth={2.2} /></div>
        <ErrorState
          title="Niramoy could not start"
          message="We couldn't reach the server to see whether you are signed in. Nothing is lost — try again once your connection is back."
          onRetry={retryLoad}
          retrying={retrying}
          offline={typeof navigator !== "undefined" && !navigator.onLine}
        />
      </div>
    );
  }

  if (screen === "landing") {
    return (
      <Landing
        stats={reference?.stats}
        onSignIn={(r) => openAuth("signin", r)}
        onSignUp={(r) => openAuth("signup", r)}
      />
    );
  }

  if (screen === "auth") {
    return (
      <AuthPage
        mode={auth.mode}
        role={auth.role}
        reference={reference}
        api={api}
        onBack={() => setScreen("landing")}
        onAuthenticated={onAuthenticated}
      />
    );
  }

  /**
   * A doctor account is not a doctor profile. Until an admin has confirmed the
   * BM&DC number there is nothing to schedule, so the workspace is replaced by
   * the application form, then by a "waiting on verification" screen.
   */
  const doctorPending =
    role === "doctor" && user?.verificationStatus && user.verificationStatus !== "verified";

  if (doctorPending && user.verificationStatus === "pending") {
    return (
      <DoctorPending
        user={user}
        onSignOut={signOut}
        onRefresh={async () => {
          const me = await refreshSession();
          if (me?.verificationStatus === "verified") showToast("You're verified — welcome aboard");
          else showToast("Still with an admin. We'll email you as soon as it's decided.");
        }}
      />
    );
  }

  if (doctorPending) {
    return (
      <div className="onboarding-shell">
        <div className="onboarding-top">
          <div className="brand">
            <div className="brand-mark"><Icon name="heart" size={20} strokeWidth={2.2} /></div>
            <div className="brand-name">nira<span>moy</span></div>
          </div>
          <button className="button ghost" onClick={signOut}>
            <Icon name="logout" size={13} /> Sign out
          </button>
        </div>
        <div className="content">
          <JoinAsDoctor
            reference={reference}
            api={api}
            onNavigate={navigate}
            notify={showToast}
            showBack={false}
            defaults={{
              name: user.name,
              email: user.email,
              phone: user.phone,
              bmdcNumber: doctorDraft?.bmdcNumber ?? "",
              registrationType: doctorDraft?.registrationType ?? "mbbs",
              specialty: doctorDraft?.specialty ?? "",
            }}
            onSubmitted={refreshSession}
          />
        </div>
        <BkashCheckout
        open={Boolean(pendingPayment)}
        payment={pendingPayment?.payment}
        appointment={pendingPayment?.appointment}
        onClose={() => {
          setPendingPayment(null);
          showToast("Appointment held. You can pay from your appointments.");
        }}
        onPaid={() => {
          setPendingPayment(null);
          refreshAppointments();
        }}
        api={api}
        notify={showToast}
      />
      <Toast toast={toast} />
      </div>
    );
  }

  let view;
  if (role === "doctor") {
    view = (
      <DoctorWorkspace
        active={active}
        self={doctorSelf}
        appointments={doctorSelf ? appointments.filter((a) => a.doctorId === doctorSelf.id) : appointments}
        loading={loading}
        onNavigate={navigate}
        onJoinCall={joinCall}
        onIssuePrescription={issuePrescription}
        api={api}
        notify={showToast}
      />
    );
    if (active === "consultation") {
      view = <Consultation appointment={activeCall} onNavigate={navigate} onComplete={completeCall} />;
    }
    if (active === "profile") view = <Settings {...settingsProps} />;
  } else if (role === "admin") {
    view = (
      <AdminWorkspace
        active={active}
        reference={reference}
        api={api}
        notify={showToast}
        onRefresh={refreshReference}
      />
    );
    if (active === "profile") view = <Settings {...settingsProps} />;
  } else {
    switch (active) {
      case "doctors":
        view = (
          <FindDoctors
            reference={reference}
            initialSearch={searchTerm}
            onOpenDoctor={openDoctor}
            onNavigate={navigate}
            api={api}
          />
        );
        break;
      case "doctor-profile":
        view = (
          <DoctorProfile
            doctor={selectedDoctor}
            reviews={doctorReviews}
            onBook={startBooking}
            onBack={() => navigate("doctors")}
            onNavigate={navigate}
          />
        );
        break;
      case "booking":
        view = (
          <Booking
            doctor={selectedDoctor}
            family={family}
            onConfirm={confirmBooking}
            onBack={() => navigate(rescheduling ? "appointments" : "doctor-profile")}
            onJoinWaitlist={joinWaitlist}
            api={api}
            notify={showToast}
          />
        );
        break;
      case "appointments":
        view = (
          <Appointments
            loading={loading}
            appointments={appointments}
            waitlist={waitlist}
            onNavigate={navigate}
            onCancel={cancelAppointment}
            onReschedule={reschedule}
            onJoinCall={joinCall}
            onReview={submitReview}
            onLeaveWaitlist={leaveWaitlist}
            onPay={payForAppointment}
          />
        );
        break;
      case "consultation":
        view = <Consultation appointment={activeCall} onNavigate={navigate} onComplete={completeCall} />;
        break;
      case "booked":
        view = (
          <Booked
            appointment={
              // Prefer the refreshed copy: it carries the server's timezone
              // label and cancellation state.
              appointments.find((a) => a.id === justBooked?.id) ?? justBooked
            }
            onNavigate={navigate}
            onOpenSettings={() => navigate("profile")}
          />
        );
        break;
      case "assistant":
        view = <Assistant api={api} onOpenDoctor={openDoctor} onNavigate={navigate} />;
        break;
      case "records":
        view = (
          <Records
            loading={loading}
            records={records}
            prescriptions={prescriptions}
            appointments={appointments}
            onAddRecord={addRecord}
            onNavigate={navigate}
          />
        );
        break;
      case "family":
        view = (
          <Family
            members={family}
            onAdd={addFamilyMember}
            onRemove={removeFamilyMember}
            onNavigate={navigate}
          />
        );
        break;
      case "profile":
        view = <Settings {...settingsProps} />;
        break;
      case "join-as-doctor":
        view = <JoinAsDoctor reference={reference} api={api} onNavigate={navigate} notify={showToast} />;
        break;
      default:
        view = (
          <Dashboard
            loading={loading}
            appointments={appointments}
            doctors={topDoctors}
            records={[...records, ...prescriptions]}
            stats={reference?.stats}
            onNavigate={navigate}
            onOpenDoctor={openDoctor}
            onJoinCall={joinCall}
          />
        );
    }
  }

  return (
    <div className="app-shell">
      {/* First stop for a keyboard user: the sidebar is ~12 tab stops deep. */}
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Sidebar
        active={active}
        onNavigate={navigate}
        role={role}
        user={user}
        onSignOut={signOut}
        counts={counts}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />
      <main className="main-area">
        <Topbar
          active={active}
          notifications={notifications}
          unread={unread}
          onReadNotifications={readNotifications}
          onSearch={onSearch}
          onMenu={() => setMenuOpen(true)}
        />
        <OfflineBar />
        <div className="content" id="main-content" tabIndex={-1}>
          {loadError && !loading && (
            <ErrorState
              compact
              title="Some of your data didn't load"
              message="What you can see below is up to date; the rest is missing because a request failed."
              onRetry={retryLoad}
              retrying={retrying}
              offline={!online}
            />
          )}
          {view}
        </div>
      </main>
      <Toast toast={toast} />
    </div>
  );
}
