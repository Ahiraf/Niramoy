"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./lib/api.js";
import { Sidebar, Topbar } from "./components/shell.js";
import { Toast } from "./components/ui.js";
import { Dashboard } from "./components/patient/dashboard.js";
import { FindDoctors, DoctorProfile } from "./components/patient/find-doctors.js";
import { Booking } from "./components/patient/booking.js";
import { Appointments, Consultation } from "./components/patient/appointments.js";
import { Assistant } from "./components/patient/assistant.js";
import { Records, Family, Settings } from "./components/patient/records.js";
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

  // Navigation payloads.
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [doctorReviews, setDoctorReviews] = useState([]);
  const [activeCall, setActiveCall] = useState(null);
  const [rescheduling, setRescheduling] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  const doctorSelf = useDoctorSelf(user, api);

  const showToast = useCallback((message, tone = "success") => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 3200);
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Data loading                                                            */
  /* ---------------------------------------------------------------------- */

  const refreshAppointments = useCallback(async () => {
    const data = await api.appointments();
    setAppointments(data.appointments ?? []);
  }, []);

  const refreshNotifications = useCallback(async () => {
    const data = await api.notifications();
    setNotifications(data.notifications ?? []);
    setUnread(data.unread ?? 0);
  }, []);

  const refreshReference = useCallback(async () => {
    const data = await api.reference();
    setReference(data);
  }, []);

  const refreshRecords = useCallback(async () => {
    const data = await api.records();
    setRecords(data.records ?? []);
    setPrescriptions(data.prescriptions ?? []);
  }, []);

  /**
   * Session first: the landing page needs the reference stats either way, but
   * nothing personal is fetched until we know who is asking.
   */
  useEffect(() => {
    (async () => {
      const [session] = await Promise.all([api.session(), refreshReference()]);
      const me = session.user ?? null;
      setUser(me);
      setActive(me ? HOME[me.role] : "dashboard");
      setScreen(me ? "app" : "landing");
      if (!me) setLoading(false);
    })();
  }, [refreshReference]);

  /** Workspace data. Re-runs on sign-in and sign-out, so no state leaks across. */
  useEffect(() => {
    if (!user) {
      setAppointments([]); setRecords([]); setPrescriptions([]);
      setNotifications([]); setUnread(0); setFamily([]); setWaitlist([]);
      return;
    }
    (async () => {
      setLoading(true);
      const [, , , top, fam, wait] = await Promise.all([
        refreshAppointments(),
        refreshNotifications(),
        refreshRecords(),
        api.doctors({ sort: "rating", perPage: 6 }),
        api.family(),
        api.waitlist(),
      ]);
      setTopDoctors(top.doctors ?? []);
      setFamily(fam.members ?? []);
      setWaitlist(wait.entries ?? []);
      setLoading(false);
    })();
  }, [user, refreshAppointments, refreshNotifications, refreshRecords]);

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
    if (result.ok) {
      await Promise.all([refreshAppointments(), refreshNotifications()]);
      showToast("Appointment confirmed. You're all set!");
      navigate("appointments");
    } else {
      showToast(result.message ?? "Could not book that slot", "error");
    }
    return result;
  }, [rescheduling, refreshAppointments, refreshNotifications, showToast, navigate]);

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

  const joinCall = useCallback((appointment) => {
    setActiveCall(appointment);
    navigate("consultation");
  }, [navigate]);

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
    await api.addPrescription(payload);
    await Promise.all([refreshRecords(), refreshNotifications()]);
  }, [refreshRecords, refreshNotifications]);

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
    if (active === "profile") view = <Settings onNavigate={navigate} />;
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
    if (active === "profile") view = <Settings onNavigate={navigate} />;
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
          />
        );
        break;
      case "consultation":
        view = <Consultation appointment={activeCall} onNavigate={navigate} onComplete={completeCall} />;
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
        view = <Settings onNavigate={navigate} />;
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
        <div className="content">{view}</div>
      </main>
      <Toast toast={toast} />
    </div>
  );
}
