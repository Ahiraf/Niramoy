"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons.js";
import { Avatar, ErrorState, PageHeading, Rating, Banner, Loading } from "../ui.js";

const PROMPTS = [
  "I've had a headache every day for two weeks",
  "My child has a rash and itchy skin",
  "I feel anxious and can't sleep properly",
  "Burning feeling when I pass urine",
];

const URGENCY_TONE = {
  emergency: "danger",
  urgent: "danger",
  see_doctor_soon: "warn",
  routine: "info",
  self_care: "good",
};

export function Assistant({ api, onOpenDoctor, onNavigate }) {
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      from: "ai",
      text: "Hi Nabila, I'm here to help you find the right care. Tell me what you're experiencing — in Bangla or English — and I'll suggest a direction and matching doctors.",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  /** The description that did not get through, kept so it can be re-sent. */
  const [failed, setFailed] = useState(null);
  const [result, setResult] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking, result]);

  const send = async (text) => {
    const message = (text ?? input).trim();
    if (!message || thinking) return;

    setInput("");
    setFailed(null);
    setMessages((m) => [...m, { id: `u-${Date.now()}`, from: "user", text: message }]);
    setThinking(true);

    const data = await api.triage({ message });
    setThinking(false);

    if (!data.ok) {
      /*
       * Give the words back.
       *
       * Someone describing their symptoms has just done the hardest part of
       * using this app, often in a second language and often while unwell.
       * Clearing the box on a failed request makes them type it all again, so
       * the text goes back where they left it and the retry re-sends exactly
       * what they wrote.
       */
      setInput((current) => (current.trim() ? current : message));
      setFailed({
        message,
        offline: data.reason === "network",
        detail: data.message,
      });
      return;
    }

    setMessages((m) => [...m, { id: `a-${Date.now()}`, from: "ai", text: data.reply }]);
    setResult(data);
  };

  const triage = result?.triage;

  return (
    <>
      <PageHeading
        title="AI health assistant"
        subtitle="A starting point for understanding your symptoms — never a diagnosis."
      />

      <div className="ai-layout">
        <section className="ai-panel card">
          <div className="ai-head">
            <div className="ai-icon"><Icon name="bot" size={21} /></div>
            <div>
              <h2>Care guide</h2>
              <p>Symptom triage · doctor matching</p>
            </div>
            <span className="status confirmed" style={{ marginLeft: "auto" }}>Online</span>
          </div>

          <div className="chat-area" ref={scrollRef}>
            {messages.map((m) => (
              <div className={`chat-message ${m.from === "user" ? "user" : ""}`} key={m.id}>
                {m.from === "ai"
                  ? <div className="avatar sm teal">AI</div>
                  : <div className="avatar sm tan">NB</div>}
                <div className="chat-bubble">{m.text}</div>
              </div>
            ))}

            {thinking && (
              <div className="chat-message">
                <div className="avatar sm teal">AI</div>
                <div className="chat-bubble typing">
                  <i /><i /><i />
                </div>
              </div>
            )}

            {failed && (
              <ErrorState
                compact
                offline={failed.offline}
                title={failed.offline ? "You're offline" : "That didn't get through"}
                message={
                  failed.offline
                    ? "Your description is still in the box below. Reconnect and send it again."
                    : (failed.detail ?? "We couldn't reach the assistant. Your description is still in the box below.")
                }
                onRetry={() => send(failed.message)}
                retrying={thinking}
              />
            )}

            {triage && (
              <div className={`triage-result ${URGENCY_TONE[triage.urgency]}`}>
                <div className="result-head">
                  <strong>Your care direction</strong>
                  <span className="result-badge">{triage.urgencyLabel}</span>
                </div>
                <p>{triage.reasoning}</p>
                {!triage.redFlag && (
                  <p className="result-specialty">
                    Recommended specialty: <strong>{triage.specialty}</strong>
                  </p>
                )}
                {triage.redFlag && (
                  <a className="button emergency-button" href="tel:999">
                    <Icon name="alert" size={14} /> Call 999 now
                  </a>
                )}
              </div>
            )}
          </div>

          {messages.length === 1 && (
            <div className="prompt-chips">
              {PROMPTS.map((p) => (
                <button key={p} className="prompt-chip" onClick={() => send(p)}>{p}</button>
              ))}
            </div>
          )}

          <form
            className="chat-compose"
            onSubmit={(e) => { e.preventDefault(); send(); }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe how you're feeling…"
              aria-label="Describe your symptoms"
              disabled={thinking}
            />
            <button className="button primary" type="submit" aria-label="Send" disabled={thinking || !input.trim()}>
              <Icon name="send" size={15} />
            </button>
          </form>

          <p className="ai-disclaimer">
            Niramoy AI offers general guidance, not a diagnosis. In an emergency, call 999.
          </p>
        </section>

        <aside className="side-info card">
          {result?.matches?.length ? (
            <>
              <h3>Matching doctors</h3>
              <p className="muted-note" style={{ marginTop: -4 }}>
                Ranked by specialty fit, location, rating and availability.
              </p>
              {result.matches.map((m) => (
                <button className="match-row" key={m.doctor.id} onClick={() => onOpenDoctor(m.doctor)}>
                  <Avatar person={m.doctor} size="sm" />
                  <div className="match-main">
                    <strong>{m.doctor.name}</strong>
                    <span>{m.doctor.specialty} · {m.doctor.district}</span>
                    <ul className="match-why">
                      {m.why.map((w) => <li key={w}><Icon name="check" size={10} />{w}</li>)}
                    </ul>
                  </div>
                  <div className="match-side">
                    <Rating value={m.doctor.rating} />
                    <em>{m.doctor.feeLabel}</em>
                  </div>
                </button>
              ))}
              <button className="button secondary" style={{ width: "100%", marginTop: 10 }} onClick={() => onNavigate("doctors")}>
                Browse all doctors <Icon name="arrow" size={13} />
              </button>
            </>
          ) : (
            <>
              <h3>What can I help with?</h3>
              <div className="safety-box">
                <strong><Icon name="shield" size={13} /> Your safety comes first</strong>
                This assistant does not replace a doctor. It helps you prepare for a consultation and
                understand general health information. Emergency symptoms are flagged immediately and
                never routed into a booking.
              </div>
              {[
                ["heart", "Check my symptoms", "Get a recommended care direction"],
                ["users", "Find the right doctor", "Match with a verified specialist"],
                ["file", "Understand my prescription", "Explain medicines and instructions"],
                ["calendar", "Book a convenient slot", "Find care that fits your schedule"],
              ].map(([icon, title, sub]) => (
                <div className="triage-option" key={title}>
                  <div className="triage-option-icon"><Icon name={icon} size={15} /></div>
                  <div><strong>{title}</strong><span>{sub}</span></div>
                </div>
              ))}
            </>
          )}
        </aside>
      </div>
    </>
  );
}
