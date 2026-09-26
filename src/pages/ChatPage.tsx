import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CarFront,
  CornerDownLeft,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  MessagesSquare,
  Route as RouteIcon,
  Send,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useApp } from "../context/AppContext";
import { MESSAGE_MAX_LENGTH } from "../repositories/messageRepository";
import { useDraft, type DraftScope } from "../services/drafts";
import type { Message, Ride } from "../types";

interface MessageGroup {
  senderId: string;
  messages: Message[];
}

const chatStyles = `
.rt-chat-page { min-height: 100%; display: flex; flex-direction: column; padding: 28px 20px 48px; color: var(--rt-text, #17231c); background: var(--rt-surface-subtle, #f6faf7); }
.rt-chat-shell { width: 100%; max-width: 980px; margin: 0 auto; display: flex; flex-direction: column; }
.rt-chat-heading { display: flex; align-items: center; gap: 7px; color: #148642; font-size: .76rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.rt-chat-details { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 14px; border: 1px solid #d7e2da; border-radius: 11px; color: #4d5d54; background: var(--rt-card, #fff); font-size: .78rem; font-weight: 750; text-decoration: none; }
.rt-chat-details:hover { border-color: #b9d6c3; background: #f1f9f4; }
.rt-chat-state { min-height: 540px; display: grid; place-items: center; border: 1px solid var(--rt-border, #dce7df); border-radius: 22px; background: var(--rt-card, #fff); box-shadow: 0 12px 34px rgba(29,64,42,.055); overflow: hidden; }
.rt-chat-state .empty-state { max-width: 540px; padding: 30px; text-align: center; }
.rt-chat-panel { min-height: 560px; height: min(72vh, 720px); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; border: 1px solid var(--rt-border, #dce7df); border-radius: 22px; background: var(--rt-card, #fff); box-shadow: 0 14px 38px rgba(29,64,42,.07); overflow: hidden; }
.rt-chat-route { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 17px 19px; border-bottom: 1px solid #e5ece7; background: linear-gradient(135deg, #f3faf5, #fff); }
.rt-chat-route-copy { min-width: 0; }
.rt-chat-route-kicker { display: flex; align-items: center; gap: 6px; color: #148642; font-size: .68rem; font-weight: 800; letter-spacing: .045em; text-transform: uppercase; }
.rt-chat-route h2 { margin: 5px 0 0; overflow: hidden; font-size: .96rem; letter-spacing: -.012em; text-overflow: ellipsis; white-space: nowrap; }
.rt-chat-meta { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 7px; color: #6d7b73; font-size: .72rem; }
.rt-chat-meta span { display: inline-flex; align-items: center; gap: 5px; padding: 6px 8px; border-radius: 999px; background: #edf4ef; white-space: nowrap; }
.rt-chat-conversation { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 22px; background: #f8faf9; scroll-behavior: smooth; }
.rt-chat-day { display: flex; align-items: center; gap: 10px; margin: 3px 0 20px; color: #8a968f; font-size: .66rem; font-weight: 750; }
.rt-chat-day::before, .rt-chat-day::after { content: ""; height: 1px; flex: 1; background: #e1e8e3; }
.rt-chat-group { display: flex; align-items: flex-end; gap: 9px; margin: 0 0 15px; }
.rt-chat-group--own { flex-direction: row-reverse; }
.rt-chat-avatar { width: 32px; height: 32px; flex: 0 0 auto; display: grid; place-items: center; overflow: hidden; border: 2px solid #fff; border-radius: 11px; color: #147a3e; background: #dff3e5; box-shadow: 0 4px 10px rgba(29,64,42,.08); font-size: .73rem; font-weight: 800; }
.rt-chat-avatar img { width: 100%; height: 100%; object-fit: cover; }
.rt-chat-group-content { display: grid; gap: 4px; max-width: min(76%, 620px); }
.rt-chat-group--own .rt-chat-group-content { justify-items: end; }
.rt-chat-sender { display: flex; align-items: center; gap: 6px; padding: 0 3px; color: #728078; font-size: .66rem; font-weight: 700; }
.rt-chat-sender strong { color: #4c5b52; }
.rt-chat-bubble { display: flex; align-items: flex-end; gap: 7px; }
.rt-chat-message { max-width: 100%; padding: 10px 12px; border: 1px solid #dfe7e2; border-radius: 5px 15px 15px 15px; color: #27362e; background: #fff; box-shadow: 0 4px 12px rgba(29,64,42,.045); font-size: .83rem; line-height: 1.52; overflow-wrap: anywhere; white-space: pre-wrap; }
.rt-chat-group--own .rt-chat-message { border-color: #159447; border-radius: 15px 5px 15px 15px; color: #fff; background: #159447; box-shadow: 0 7px 16px rgba(21,148,71,.16); }
.rt-chat-time { flex: 0 0 auto; color: #8b9790; font-size: .6rem; white-space: nowrap; }
.rt-chat-group--own .rt-chat-time { color: rgba(255,255,255,.72); }
.rt-chat-consecutive .rt-chat-message { margin-top: -8px; }
.rt-chat-empty { min-height: 100%; display: grid; place-content: center; justify-items: center; padding: 30px; text-align: center; }
.rt-chat-empty-icon { width: 64px; height: 64px; display: grid; place-items: center; border-radius: 21px; color: #148642; background: #dff4e6; box-shadow: 0 10px 25px rgba(21,148,71,.12); }
.rt-chat-empty h3 { margin: 16px 0 6px; font-size: 1rem; }
.rt-chat-empty p { max-width: 380px; margin: 0; color: #748178; font-size: .8rem; line-height: 1.55; }
.rt-chat-privacy { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 14px; border-bottom: 1px solid #edf2ef; color: #6d7b73; background: #fbfcfb; font-size: .66rem; }
.rt-chat-composer { padding: 13px 15px 15px; border-top: 1px solid #e4ebe6; background: #fff; }
.rt-chat-readonly { display: flex; align-items: flex-start; gap: 9px; padding: 11px 12px; border: 1px solid #dce6df; border-radius: 12px; color: #5e6d64; background: #f4f8f5; font-size: .74rem; line-height: 1.5; }
.rt-chat-readonly svg { flex: 0 0 auto; margin-top: 1px; color: #68786e; }
.rt-chat-readonly strong { display: block; color: #425248; font-size: .78rem; }
.rt-chat-form { display: grid; gap: 8px; }
.rt-chat-input-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 9px; }
.rt-chat-field { position: relative; }
.rt-chat-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.rt-chat-textarea { width: 100%; min-height: 47px; max-height: 140px; padding: 12px 42px 10px 13px; resize: none; border: 1px solid #d5e1d8; border-radius: 13px; color: var(--rt-text, #17231c); background: #fbfcfb; outline: none; font: inherit; font-size: .84rem; line-height: 1.45; }
.rt-chat-textarea:focus { border-color: #159447; background: #fff; box-shadow: 0 0 0 3px rgba(21,148,71,.11); }
.rt-chat-textarea:disabled { opacity: .6; cursor: not-allowed; }
.rt-chat-count { position: absolute; right: 11px; bottom: 8px; color: #98a29c; font-size: .61rem; }
.rt-chat-send { width: 47px; height: 47px; display: grid; place-items: center; border: 0; border-radius: 13px; color: #fff; background: #159447; box-shadow: 0 8px 18px rgba(21,148,71,.2); cursor: pointer; }
.rt-chat-send:hover:not(:disabled) { background: #10813b; }
.rt-chat-send:disabled { opacity: .48; cursor: not-allowed; }
.rt-chat-spin { animation: rt-chat-spin .8s linear infinite; }
@keyframes rt-chat-spin { to { transform: rotate(360deg); } }
.rt-chat-error { display: flex; align-items: flex-start; gap: 6px; margin: 0; color: #a63838; font-size: .72rem; line-height: 1.4; }
[data-theme="dark"] .rt-chat-page { --rt-surface-subtle: #101712; --rt-card: #17211a; --rt-border: #2b3a30; --rt-text: #eef7f1; }
[data-theme="dark"] .rt-chat-details, [data-theme="dark"] .rt-chat-state, [data-theme="dark"] .rt-chat-panel { background: #17211a; border-color: #2b3a30; }
[data-theme="dark"] .rt-chat-details:hover { background: #1d2a21; }
[data-theme="dark"] .rt-chat-route { background: linear-gradient(135deg, #19301f, #17211a); border-color: #2b3a30; }
[data-theme="dark"] .rt-chat-meta span { color: #b3c0b8; background: #243229; }
[data-theme="dark"] .rt-chat-conversation { background: #111a14; }
[data-theme="dark"] .rt-chat-day { color: #8f9e95; }
[data-theme="dark"] .rt-chat-day::before, [data-theme="dark"] .rt-chat-day::after { background: #2b3a30; }
[data-theme="dark"] .rt-chat-message { color: #e8f1eb; background: #202c24; border-color: #35453b; }
[data-theme="dark"] .rt-chat-readonly { color: #b4c0b8; background: #1c2820; border-color: #34463a; }
[data-theme="dark"] .rt-chat-readonly strong { color: #eef7f1; }
[data-theme="dark"] .rt-chat-privacy, [data-theme="dark"] .rt-chat-composer { background: #17211a; border-color: #2b3a30; }
[data-theme="dark"] .rt-chat-privacy { color: #a6b5ac; }
[data-theme="dark"] .rt-chat-textarea { color: #eef7f1; background: #111a14; border-color: #3a4b40; }
[data-theme="dark"] .rt-chat-textarea:focus { background: #18231b; }
[data-theme="dark"] .rt-chat-empty p { color: #a6b5ac; }
@media (max-width: 1024px) {
  /*
   * The breakpoint where the fixed bottom nav appears, so this is the range where
   * the panel has to be sized from the space the shell actually leaves over: the
   * sticky topbar above and the bottom nav below.
   *
   * It used to subtract a hard-coded 210px from 100dvh and then carry a 480px
   * min-height. Both are wrong. 210px counted the topbar a second time (the page
   * already starts below it) while missing the real page header, which is a stacked
   * column with a full-width button under 720px; and a 480px floor overrode the
   * viewport-derived height outright on a 568-640px phone. The panel then ended
   * below the fold, where the fixed nav sat on top of the composer and only
   * scrolling the page - not the message list - could reach it.
   *
   * A definite height rather than a min-height is what makes the fix hold: the
   * message list is a 1fr grid row, so an indefinite container lets that row take
   * its max-content height, the page grow past the viewport and the document scroll.
   * Bounding the page, letting the panel shrink and giving the list the
   * minmax(0, 1fr) row is what keeps the composer on screen and makes the list the
   * only scroller.
   */
  .rt-chat-page {
    height: calc(100vh - var(--rt-topbar-height, 72px) - var(--rt-mobile-nav-inset, 0px));
    height: calc(100dvh - var(--rt-topbar-height, 72px) - var(--rt-mobile-nav-inset, 0px));
  }
  .rt-chat-shell { flex: 1 1 auto; min-height: 0; }
  .rt-chat-panel { flex: 1 1 auto; height: auto; min-height: 0; }
  .rt-chat-state { flex: 1 1 auto; min-height: 0; }
}
@media (max-width: 680px) {
  .rt-chat-page { padding: 18px 12px 24px; }
  .rt-chat-details { width: 100%; }
  .rt-chat-panel { border-radius: 18px; }
  .rt-chat-route { align-items: flex-start; padding: 14px; }
  .rt-chat-meta { max-width: 115px; justify-content: flex-end; }
  .rt-chat-meta span:nth-child(2) { display: none; }
  .rt-chat-conversation { padding: 16px 12px; }
  .rt-chat-group-content { max-width: 84%; }
  .rt-chat-composer { padding: 10px; }
  .rt-chat-privacy { display: none; }
}
`;

const getDeparture = (ride: Ride | null) => {
  if (!ride) return null;
  if (ride.departureDate.includes("T")) {
    const parsed = new Date(ride.departureDate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const [year, month, day] = ride.departureDate.split("-").map(Number);
  const [hours, minutes] = ride.departureTime.split(":").map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day, hours || 0, minutes || 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDeparture = (departure: Date | null, fallbackDate: string, fallbackTime: string) => {
  if (!departure) return `${fallbackDate} at ${fallbackTime}`;
  const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(departure);
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(departure);
  return `${date} at ${time}`;
};

const formatMessageTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(parsed);
};

const formatDay = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Ride conversation";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (parsed.toDateString() === today.toDateString()) return "Today";
  if (parsed.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
};

const groupMessages = (messages: Message[]): MessageGroup[] => messages.reduce<MessageGroup[]>((groups, message) => {
  const lastGroup = groups[groups.length - 1];
  if (lastGroup?.senderId === message.senderId) {
    lastGroup.messages.push(message);
  } else {
    groups.push({ senderId: message.senderId, messages: [message] });
  }
  return groups;
}, []);

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export function ChatPage() {
  const { rideId } = useParams<{ rideId: string }>();
  const {
    activeUser,
    activeUserId,
    rides,
    bookings,
    messages,
    sendMessage,
  } = useApp();
  /**
   * The unsent message is kept per ride, so switching conversations (or a
   * reload) does not discard half-typed text. Sent messages are never drafted -
   * they live in Supabase.
   */
  const chatDraftScope: DraftScope = `chat:${rideId}`;
  const chatDraft = useDraft<{ text: string }>(chatDraftScope, { text: "" }, activeUserId);
  const { value: chatDraftValue, setValue: setChatDraftValue } = chatDraft;
  const draft = chatDraftValue.text;
  const setDraft = (value: string) => setChatDraftValue((current) => ({ ...current, text: value }));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const ride = useMemo(
    () => rides.find((item) => item.id === rideId) ?? null,
    [rideId, rides],
  );
  const riderBookings = useMemo(
    () => bookings.filter((booking) => (
      booking.rideId === rideId
      && booking.riderId === activeUserId
    )),
    [activeUserId, bookings, rideId],
  );
   const riderBooking = [...riderBookings]
     .filter((booking) => booking.status === "pending" || booking.status === "confirmed" || booking.status === "completed")
     .sort((first, second) => {
       const firstTime = new Date(first.updatedAt || first.createdAt).getTime();
       const secondTime = new Date(second.updatedAt || second.createdAt).getTime();
       return (Number.isFinite(secondTime) ? secondTime : 0) - (Number.isFinite(firstTime) ? firstTime : 0);
     })[0] ?? null;
   const isDriver = Boolean(ride && activeUserId && ride.driverId === activeUserId);
   const isRider = Boolean(riderBooking);
   const hasAccess = Boolean(activeUserId && ride && (isDriver || isRider));
   const canSend = ride?.status === "active" && (isDriver || riderBooking?.status === "pending" || riderBooking?.status === "confirmed");

  const rideMessages = useMemo(() => messages
    .filter((message) => message.rideId === rideId)
    .sort((first, second) => {
      const firstTime = new Date(first.createdAt).getTime();
      const secondTime = new Date(second.createdAt).getTime();
      return (Number.isFinite(firstTime) ? firstTime : 0) - (Number.isFinite(secondTime) ? secondTime : 0);
    }), [messages, rideId]);
  const messageGroups = useMemo(() => groupMessages(rideMessages), [rideMessages]);

  useEffect(() => {
    setError("");
  }, [activeUserId, rideId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [rideId, rideMessages.length]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!ride || !hasAccess || !canSend || sending) return;
    if (!text) {
      setError("Type a message before sending.");
      return;
    }
    if (text.length > MESSAGE_MAX_LENGTH) {
      setError(`Messages can contain up to ${MESSAGE_MAX_LENGTH.toLocaleString()} characters.`);
      return;
    }
    setSending(true);
    setError("");
    try {
      await sendMessage(ride.id, text);
      setDraft("");
      // Delivered to Supabase, so the unsent-text draft is no longer needed.
      chatDraft.complete();
    } catch (caught) {
      setError(errorText(caught, "Your message could not be saved. Please try again."));
    } finally {
      setSending(false);
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const renderHeader = (showRide = true) => ride && showRide ? (
    <PageHeader
      title="Ride chat"
      description={`${ride.origin.label} to ${ride.destination.label}`}
      eyebrow={<span className="rt-chat-heading"><MessagesSquare size={15} /> Ride conversation</span>}
      actions={<Link className="rt-chat-details" to={`/rides/${ride.id}`}><ArrowLeft size={16} /> Ride details</Link>}
    />
  ) : (
    <PageHeader
      title="Ride chat"
       description="Open a conversation with the driver and riders who have a booking for this journey."
      eyebrow={<span className="rt-chat-heading"><MessagesSquare size={15} /> Ride conversation</span>}
    />
  );

  if (!rideId || !ride) {
    return (
      <div className="rt-chat-page">
        <style>{chatStyles}</style>
        <div className="rt-chat-shell">
          {renderHeader()}
          <div className="rt-chat-state">
            <EmptyState
              icon={MessageCircle}
              title="Conversation not found"
              description="This chat link does not match a saved ride. It may have been removed or the route may be incorrect."
              action={<Link className="rt-chat-details" to="/rides"><ArrowLeft size={16} /> Back to my rides</Link>}
            />
          </div>
        </div>
      </div>
    );
  }

  if (!hasAccess) {
    const destination = isDriver ? `/rides/${ride.id}` : "/bookings";
    return (
      <div className="rt-chat-page">
        <style>{chatStyles}</style>
        <div className="rt-chat-shell">
          {renderHeader(false)}
          <div className="rt-chat-state">
            <EmptyState
              icon={LockKeyhole}
              title="This conversation is private"
              description="Only the driver and riders with a booking on this ride can open its chat. Rejected and unrelated bookings cannot access these messages."
              action={<Link className="rt-chat-details" to={destination}><ArrowLeft size={16} /> {isDriver ? "View ride" : "My bookings"}</Link>}
            />
          </div>
        </div>
      </div>
    );
  }

  const departure = getDeparture(ride);
  const departureLabel = formatDeparture(departure, ride.departureDate, ride.departureTime);
  const ownAvatar = activeUser?.avatar || "";
  const initials = activeUser?.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "RT";
  const senderLabel = (senderId: string) => {
    if (senderId === activeUserId) return "You";
    if (senderId === ride.driverId) return "Driver";
    return "Passenger";
  };

  return (
    <div className="rt-chat-page">
      <style>{chatStyles}</style>
      <div className="rt-chat-shell">
        {renderHeader()}
        <section className="rt-chat-panel" aria-label={`Chat for ${ride.origin.label} to ${ride.destination.label}`}>
          <header className="rt-chat-route">
            <div className="rt-chat-route-copy">
              <span className="rt-chat-route-kicker"><RouteIcon size={14} /> Shared journey</span>
              <h2>{ride.origin.label} <span aria-hidden="true">→</span> {ride.destination.label}</h2>
            </div>
            <div className="rt-chat-meta">
              <span><CalendarDays size={13} /> {departureLabel}</span>
              <span><CarFront size={13} /> {isDriver ? "You are driving" : "With the driver"}</span>
            </div>
          </header>

          <div className="rt-chat-conversation" role="log" aria-label="Ride messages" aria-live="polite" aria-relevant="additions">
            {rideMessages.length === 0 ? (
              <div className="rt-chat-empty">
                <span className="rt-chat-empty-icon"><MessagesSquare size={29} /></span>
                <h3>Start the conversation</h3>
                <p>Share pickup details, arrival timing, or anything else that helps everyone travel smoothly.</p>
              </div>
            ) : (
              <>
                {rideMessages.map((message, index) => (
                  index === 0 || new Date(rideMessages[index - 1].createdAt).toDateString() !== new Date(message.createdAt).toDateString()
                    ? <div className="rt-chat-day" key={`day-${message.id}`}>{formatDay(message.createdAt)}</div>
                    : null
                ))}
                {messageGroups.map((group) => {
                  const own = group.senderId === activeUserId;
                  return (
                    <article
                      className={`rt-chat-group${own ? " rt-chat-group--own" : ""}`}
                      key={`${group.senderId}-${group.messages[0].id}`}
                      aria-label={`${own ? "Your" : senderLabel(group.senderId)} messages`}
                    >
                      <span className="rt-chat-avatar" aria-hidden="true">
                        {own && ownAvatar ? <img src={ownAvatar} alt="" /> : own ? initials : <UserRound size={16} />}
                      </span>
                      <div className="rt-chat-group-content">
                        <div className="rt-chat-sender">
                          <strong>{senderLabel(group.senderId)}</strong>
                          {own ? <span>· Sent</span> : null}
                        </div>
                        {group.messages.map((message, messageIndex) => (
                          <div className={`rt-chat-bubble${messageIndex > 0 ? " rt-chat-consecutive" : ""}`} key={message.id}>
                            <div className="rt-chat-message">{message.text}</div>
                            <time className="rt-chat-time" dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString("en-IN")}>
                              {formatMessageTime(message.createdAt)}
                            </time>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
                <div ref={messagesEndRef} aria-hidden="true" />
              </>
            )}
          </div>

          <div className="rt-chat-composer">
              <div className="rt-chat-privacy"><ShieldCheck size={13} /> Messages for this ride are visible only to its driver and confirmed riders.</div>

            {canSend ? (
              <>
                <form className="rt-chat-form" onSubmit={handleSubmit}>
                  <div className="rt-chat-input-row">
                    <div className="rt-chat-field">
                      <label className="rt-chat-label" htmlFor="ride-message">Message</label>
                      <textarea
                        id="ride-message"
                        data-testid="chat-input"
                        className="rt-chat-textarea"
                        value={draft}
                        rows={1}
                        maxLength={1000}
                        placeholder="Write a message…"
                        disabled={sending}
                        aria-describedby={error ? "chat-send-error" : "chat-message-help"}
                        onChange={(event) => {
                          setDraft(event.target.value);
                          if (error) setError("");
                        }}
                        onKeyDown={handleComposerKeyDown}
                      />
                      <span className="rt-chat-count" aria-hidden="true">{draft.length}/1000</span>
                    </div>
                    <button className="rt-chat-send" data-testid="chat-send" type="submit" disabled={sending || !draft.trim()} aria-label="Send message" title="Send message">
                      {sending ? <LoaderCircle className="rt-chat-spin" size={19} /> : <Send size={19} />}
                    </button>
                  </div>
                  {error ? <p className="rt-chat-error" id="chat-send-error" role="alert" data-testid="chat-error"><AlertCircle size={14} />{error}</p> : <span id="chat-message-help" style={{ display: "none" }}>Press Enter to send or Shift plus Enter for a new line.</span>}
                </form>
                <p className="rt-chat-privacy" style={{ padding: "6px 0 0", border: 0, background: "transparent" }}><CornerDownLeft size={12} /> Enter sends · Shift + Enter adds a line</p>
              </>
            ) : (
              <div className="rt-chat-readonly">
                <LockKeyhole size={16} />
                <span><strong>Read-only conversation</strong>This booking is closed, so you can still review this ride’s messages but cannot add new ones.</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default ChatPage;
