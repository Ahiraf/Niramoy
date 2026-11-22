"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons.js";
import { Empty, PageHeading } from "./ui.js";

const date = (value) => new Date(value).toLocaleString("en-BD", {
  timeZone: "Asia/Dhaka", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

export function CareMessages({ api, role, onNavigate }) {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const selectedRef = useRef(null);
  const sendRef = useRef(false);
  const retryRef = useRef(null);
  const logRef = useRef(null);
  const followRef = useRef(true);
  const olderLoadedRef = useRef(false);
  const conversation = conversations.find((c) => c.id === selected);
  const draft = drafts[selected] ?? "";

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const result = await api.conversations();
      if (!alive) return;
      setLoading(false);
      if (result.ok) { setConversations(result.conversations); setError(""); }
      else setError(result.message ?? "Could not load conversations.");
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 10_000);
    return () => { alive = false; clearInterval(timer); };
  }, [api, revision]);

  const receive = useCallback(async (id, before) => {
    const result = await api.messages(id, before);
    if (selectedRef.current !== id) return;
    if (!result.ok) { setError(result.message ?? "Could not load messages. Your draft is safe."); return; }
    setError("");
    setMessages((current) => {
      const merged = new Map(current.map((m) => [m.id, m]));
      result.messages.forEach((m) => merged.set(m.id, m));
      return [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    });
    // Older-page availability belongs to the oldest page already loaded.
    if (before) { olderLoadedRef.current = true; setHasMore(result.hasMore); }
    else if (!olderLoadedRef.current) setHasMore(result.hasMore);
    if (!document.hidden) {
      const unread = result.messages.filter((m) => !m.mine && !m.readAt).map((m) => m.id);
      if (unread.length) await api.readMessages(id, unread);
      setConversations((rows) => rows.map((c) => c.id === id ? { ...c, unread: 0 } : c));
    }
  }, [api]);

  useEffect(() => {
    selectedRef.current = selected;
    setMessages([]);
    setHasMore(false);
    setError("");
    followRef.current = true;
    olderLoadedRef.current = false;
    if (!selected) return;
    setThreadLoading(true);
    void receive(selected).finally(() => { if (selectedRef.current === selected) setThreadLoading(false); });
    const poll = () => { if (!document.hidden) void receive(selected); };
    const timer = setInterval(poll, 5000);
    window.addEventListener("focus", poll);
    return () => { selectedRef.current = null; clearInterval(timer); window.removeEventListener("focus", poll); };
  }, [selected, receive]);

  useEffect(() => {
    if (followRef.current && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  const send = async (event) => {
    event.preventDefault();
    if (!draft.trim() || !selected || sendRef.current) return;
    sendRef.current = true;
    setSending(true);
    const id = selected;
    const body = draft.trim();
    const previous = retryRef.current;
    const payload = previous?.appointmentId === id && previous.body === body
      ? previous : { appointmentId: id, body, clientId: crypto.randomUUID() };
    retryRef.current = payload;
    try {
      const result = await api.sendMessage(payload);
      if (!result.ok) { setError(result.message ?? "Message not sent. Please try again."); return; }
      retryRef.current = null;
      setDrafts((all) => ({ ...all, [id]: "" }));
      followRef.current = true;
      await receive(id);
    } finally { sendRef.current = false; setSending(false); }
  };

  return <div className={`care-page ${selected ? "has-thread" : ""}`}>
    <PageHeading title={role === "doctor" ? "Patient messages" : "Message your doctor"}
      subtitle="Your care team, one conversation away."
      actions={<button className="button ghost small" onClick={() => onNavigate(role === "doctor" ? "doctor-home" : "dashboard")}><Icon name="back" size={16} />Back to overview</button>} />
    {role === "patient" && <details className="care-safety"><summary><Icon name="alert" size={16} />For emergencies, don’t wait for a reply</summary>
      <p>Messages are not monitored continuously. For an emergency in Bangladesh, <a href="tel:999">call 999</a> or seek urgent in-person care.</p>
    </details>}
    <div className={`care-chat ${selected ? "thread-open" : ""}`}>
      <aside className="care-inbox card" aria-label="Appointment conversations">
        <h2>Your conversations</h2>
        {loading ? <p role="status">Loading conversations…</p> : !conversations.length ?
          <Empty icon="calendar" title="No conversations yet" hint={role === "doctor" ? "Your patients appear here after booking." : "Book with a doctor to message them here. Sample profiles cannot receive messages."}
            action={role === "patient" ? <button className="button secondary" onClick={() => onNavigate("doctors")}>Find a doctor</button> : null} /> :
          conversations.map((c) => <button className={`care-thread ${selected === c.id ? "active" : ""}`} key={c.id}
            aria-current={selected === c.id ? "true" : undefined} onClick={() => { selectedRef.current = c.id; setSelected(c.id); }} disabled={sending}>
            <span className="care-thread-avatar" aria-hidden="true">{c.peerName?.replace(/^Dr\.\s*/, "").slice(0, 1)}</span>
            <span className="care-thread-content"><strong>{c.peerName}</strong><span>Visit: {date(c.startUtc)}</span>
            <span className="care-preview">{c.latestBody || (c.status === "cancelled" ? "Read-only conversation" : "Start a conversation")}</span></span>
            {c.unread > 0 && <b>{c.unread} unread</b>}
          </button>)}
      </aside>
      <section className="care-conversation card" aria-label="Direct messages">
        {conversation ? <>
          <header><button className="button ghost small care-back" onClick={() => setSelected(null)} disabled={sending}><Icon name="back" size={18} />Messages</button>
            <div><h2>{conversation.peerName}</h2><p>Visit: {date(conversation.startUtc)}</p></div></header>
          <div className="care-message-log" ref={logRef} role="log" aria-live="polite" aria-label={`Messages with ${conversation.peerName}`}
            onScroll={(e) => { const el = e.currentTarget; followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
            {hasMore && <button className="button ghost small" disabled={olderLoading} onClick={async () => {
              setOlderLoading(true); followRef.current = false;
              try { await receive(selected, messages[0]?.id); } finally { setOlderLoading(false); }
            }}>{olderLoading ? "Loading…" : "Earlier messages"}</button>}
            {threadLoading ? <p role="status">Loading messages…</p> : !messages.length && <p className="care-chat-empty">Start a conversation. Include your question and any changes since your appointment.</p>}
            {messages.map((m) => <article className={`care-message ${m.mine ? "mine" : ""}`} key={m.id}>
              <p>{m.body}</p>
              <small>{date(m.createdAt)}{m.mine ? (m.readAt ? " · Read" : " · Sent") : ""}</small>
            </article>)}
          </div>
          {conversation.status === "cancelled" ? <p className="care-chat-empty">This appointment was cancelled. Conversation history is still available.</p> :
            <form className="care-compose" onSubmit={send}>
              <label htmlFor="care-message">Your message</label>
              <textarea id="care-message" rows={2} maxLength={2000} value={draft} disabled={sending}
                placeholder="Write to your care team…" onChange={(e) => setDrafts((all) => ({ ...all, [selected]: e.target.value }))} />
              <div><small>{draft.length}/2000</small><button className="button primary" disabled={sending || !draft.trim()}><Icon name="send" size={16} />{sending ? "Sending…" : "Send message"}</button></div>
            </form>}
        </> : <Empty icon="users" title="Choose a conversation" hint="Messages are shared only with the patient and doctor on that appointment." />}
      </section>
    </div>
    {error && <div className="care-chat-error" role="alert">{error} <button className="text-link" onClick={() => { setRevision((n) => n + 1); if (selected) void receive(selected); }}>Retry</button></div>}
  </div>;
}
