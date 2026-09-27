import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
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
import { PageHeader } from "../components/ui/PageHeader";
import { useComposerInset } from "../components/chat/useComposerInset";
import { chatPageStyles } from "./chatPageStyles";
import { useApp } from "../context/AppContext";
import { MESSAGE_MAX_LENGTH } from "../repositories/messageRepository";
import { useDraft, type DraftScope } from "../services/drafts";
import type { Message, Ride } from "../types";

interface MessageGroup {
  senderId: string;
  messages: Message[];
}

/** One row in the conversation list, with the details needed to sort and label it. */
interface Conversation {
  ride: Ride;
  isDriver: boolean;
  /** The newest message in this conversation, if any. */
  latest: Message | null;
  unread: number;
}

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

/** "Just now", "12m", "3h", then a date. Short enough for a list row. */
const formatListTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const minutes = Math.floor((Date.now() - parsed.getTime()) / 60_000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(parsed);
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
   * they live in the database.
   */
  const chatDraftScope: DraftScope = `chat:${rideId ?? "list"}`;
  const chatDraft = useDraft<{ text: string }>(chatDraftScope, { text: "" }, activeUserId);
  const { value: chatDraftValue, setValue: setChatDraftValue } = chatDraft;
  const draft = chatDraftValue.text;
  const setDraft = (value: string) => setChatDraftValue((current) => ({ ...current, text: value }));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [unread, setUnread] = useState<Record<string, number>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const composerInset = useComposerInset();

  const ride = useMemo(
    () => rides.find((item) => item.id === rideId) ?? null,
    [rideId, rides],
  );

  /**
   * The same access rule as the single-conversation view, applied to every ride:
   * a conversation exists only for the driver and for riders whose booking is
   * still live. Applying it in one place means the list can never offer a chat
   * the detail view would then refuse.
   */
  const conversations = useMemo<Conversation[]>(() => {
    if (!activeUserId) return [];
    const bookedRideIds = new Set(
      bookings
        .filter((booking) => (
          booking.riderId === activeUserId
          && (booking.status === "pending" || booking.status === "confirmed" || booking.status === "completed")
        ))
        .map((booking) => booking.rideId),
    );
    return rides
      .filter((item) => item.driverId === activeUserId || bookedRideIds.has(item.id))
      .map((item) => {
        const thread = messages
          .filter((message) => message.rideId === item.id)
          .sort((first, second) => {
            const firstTime = new Date(first.createdAt).getTime();
            const secondTime = new Date(second.createdAt).getTime();
            return (Number.isFinite(firstTime) ? firstTime : 0) - (Number.isFinite(secondTime) ? secondTime : 0);
          });
        return {
          ride: item,
          isDriver: item.driverId === activeUserId,
          latest: thread[thread.length - 1] ?? null,
          unread: unread[item.id] ?? 0,
        };
      })
      .sort((first, second) => {
        const firstTime = first.latest ? new Date(first.latest.createdAt).getTime() : getDeparture(first.ride)?.getTime() ?? 0;
        const secondTime = second.latest ? new Date(second.latest.createdAt).getTime() : getDeparture(second.ride)?.getTime() ?? 0;
        return (Number.isFinite(secondTime) ? secondTime : 0) - (Number.isFinite(firstTime) ? firstTime : 0);
      });
  }, [activeUserId, bookings, messages, rides, unread]);

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

  /**
   * A conversation counts as read once it has been on screen, so the badge is
   * cleared by looking at it rather than by a separate "mark read" request.
   */
  const markRead = useCallback((id: string | undefined) => {
    if (!id) return;
    setUnread((current) => (current[id] ? { ...current, [id]: 0 } : current));
  }, []);

  useEffect(() => {
    if (!rideId) return;
    markRead(rideId);
  }, [rideId, markRead]);

  // Count a new message from someone else only while the chat is not on screen,
  // so opening a conversation does not immediately light its own badge up.
  useEffect(() => {
    if (!rideId || !activeUserId) return;
    setUnread((current) => {
      const latest = rideMessages[rideMessages.length - 1];
      if (!latest || latest.senderId === activeUserId) return current;
      return { ...current, [rideId]: (current[rideId] ?? 0) + 1 };
    });
    // Only the newest message should trigger a count, not every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideMessages[rideMessages.length - 1]?.id]);

  const scrollToLatest = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, []);

  // layoutEffect so the thread is already at the bottom before it paints. With
  // useEffect there is a visible jump every time a message arrives.
  useLayoutEffect(() => {
    scrollToLatest();
  }, [rideId, rideMessages.length, scrollToLatest]);

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
      // Delivered to the database, so the unsent-text draft is no longer needed.
      chatDraft.complete();
      scrollToLatest();
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

  const departure = ride ? getDeparture(ride) : null;
  const departureLabel = ride ? formatDeparture(departure, ride.departureDate, ride.departureTime) : "";
  const ownAvatar = activeUser?.avatar || "";
  const initials = activeUser?.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "RT";
  const senderLabel = (senderId: string) => {
    if (senderId === activeUserId) return "You";
    if (senderId === ride?.driverId) return "Driver";
    return "Passenger";
  };

  /* ---------------- conversation list ---------------- */

  const renderConversationList = () => {
    if (conversations.length === 0) {
      return (
        <div className="rt-chat-conversations">
          <div className="rt-chat-state" style={{ border: 0, borderRadius: 0, minHeight: 320 }}>
            <div className="rt-chat-state-inner">
              <span className="rt-chat-state-icon"><MessageCircle size={24} /></span>
              <h2>No conversations yet</h2>
              <p>
                A chat opens once you share a ride. Book a seat in Find Ride, or offer one of your own,
                and the conversation appears here.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                <Link className="rt-chat-details" to="/find">Find a ride</Link>
                <Link className="rt-chat-details" to="/offer">Offer a ride</Link>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <nav className="rt-chat-conversations" aria-label="Ride conversations">
        <div className="rt-chat-conversations-head">
          <h2 className="rt-chat-conversations-title"><MessagesSquare size={15} /> Conversations</h2>
          <span className="rt-chat-conversations-time">{conversations.length} total</span>
        </div>
        <div className="rt-chat-conversations-list">
          {conversations.map((conversation) => {
            const current = conversation.ride.id === rideId;
            return (
              <Link
                className="rt-chat-conversation-item"
                key={conversation.ride.id}
                to={`/chat/${conversation.ride.id}`}
                aria-current={current ? "true" : undefined}
              >
                <span className="rt-chat-conversation-avatar" aria-hidden="true">
                  {conversation.isDriver ? <CarFront size={18} /> : <MessagesSquare size={18} />}
                </span>
                <span className="rt-chat-conversation-copy">
                  <span className="rt-chat-conversation-route">
                    {conversation.ride.origin.label} <span aria-hidden="true">→</span> {conversation.ride.destination.label}
                  </span>
                  <span className="rt-chat-conversation-meta">
                    <span className={`rt-chat-conversation-role${conversation.isDriver ? " rt-chat-conversation-role--driver" : ""}`}>
                      {conversation.isDriver ? "Driving" : "Riding"}
                    </span>
                    {conversation.latest
                      ? <span className="rt-chat-conversation-preview">
                          {conversation.latest.senderId === activeUserId ? "You: " : ""}
                          {conversation.latest.text}
                        </span>
                      : <span className="rt-chat-conversation-preview">No messages yet</span>}
                  </span>
                </span>
                <span className="rt-chat-conversation-time">
                  {conversation.latest ? formatListTime(conversation.latest.createdAt) : ""}
                  {conversation.unread > 0 ? (
                    <span className="rt-chat-unread" aria-label={`${conversation.unread} unread`}>{conversation.unread}</span>
                  ) : null}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    );
  };

  /* ---------------- list only: /chat ---------------- */

  if (!rideId) {
    return (
      <div className="rt-chat-page">
        <style>{chatPageStyles}</style>
        <div className="rt-chat-shell">
          <PageHeader
            eyebrow="Ride conversations"
            title="Chat"
            description="Every ride you are driving or booked on, with the driver and the other riders."
          />
          {renderConversationList()}
        </div>
      </div>
    );
  }

  /* ---------------- detail ---------------- */

  if (!ride) {
    return (
      <div className="rt-chat-page">
        <style>{chatPageStyles}</style>
        <div className="rt-chat-shell">
          <PageHeader
            eyebrow="Ride conversations"
            title="Chat"
            actions={<Link className="rt-chat-details" to="/chat"><ArrowLeft size={16} /> All chats</Link>}
          />
          <div className="rt-chat-state">
            <div className="rt-chat-state-inner">
              <span className="rt-chat-state-icon"><MessageCircle size={24} /></span>
              <h2>Conversation not found</h2>
              <p>This chat link does not match a saved ride. It may have been removed, or the link may be out of date.</p>
              <Link className="rt-chat-details" to="/chat"><ArrowLeft size={16} /> Back to conversations</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!hasAccess) {
    const destination = isDriver ? `/rides/${ride.id}` : "/bookings";
    return (
      <div className="rt-chat-page">
        <style>{chatPageStyles}</style>
        <div className="rt-chat-shell">
          <PageHeader
            eyebrow="Ride conversations"
            title="Chat"
            actions={<Link className="rt-chat-details" to="/chat"><ArrowLeft size={16} /> All chats</Link>}
          />
          <div className="rt-chat-state">
            <div className="rt-chat-state-inner">
              <span className="rt-chat-state-icon"><LockKeyhole size={24} /></span>
              <h2>This conversation is private</h2>
              <p>Only the driver and riders with a booking on this ride can open its chat. Rejected and unrelated bookings cannot read these messages.</p>
              <Link className="rt-chat-details" to={destination}><ArrowLeft size={16} /> {isDriver ? "View ride" : "My bookings"}</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rt-chat-page">
      <style>{chatPageStyles}</style>
      <div className="rt-chat-shell">
        <PageHeader
          eyebrow="Ride conversation"
          title={ride.origin.label}
          description={ride.destination.label}
          actions={
            <>
              {/* Shown only on a phone, where the list is a separate screen. */}
              <Link className="rt-chat-details rt-chat-back" to="/chat"><ArrowLeft size={16} /> All chats</Link>
              <Link className="rt-chat-details" to={`/rides/${ride.id}`}>Ride details</Link>
            </>
          }
        />

        <div className="rt-chat-split">
          {/* Hidden on a phone, where it is the screen you came from. */}
          <div className="rt-chat-rail" data-testid="chat-rail">
            {renderConversationList()}
          </div>

          <section className="rt-chat-panel" aria-label={`Chat for ${ride.origin.label} to ${ride.destination.label}`}>
            <header className="rt-chat-journey">
              <div className="rt-chat-journey-copy">
                <span className="rt-chat-journey-kicker"><RouteIcon size={14} /> Shared journey</span>
                <h2 className="rt-chat-journey-title">
                  {ride.origin.label} <span aria-hidden="true">→</span> {ride.destination.label}
                </h2>
              </div>
              <div className="rt-chat-journey-meta">
                <span><CalendarDays size={13} aria-hidden="true" /> {departureLabel}</span>
                <span><CarFront size={13} aria-hidden="true" /> {isDriver ? "You are driving" : "With the driver"}</span>
              </div>
            </header>

            <div
              className="rt-chat-thread"
              ref={threadRef}
              role="log"
              aria-label="Ride messages"
              aria-live="polite"
              aria-relevant="additions"
            >
              {rideMessages.length === 0 ? (
                <div className="rt-chat-empty">
                  <span className="rt-chat-empty-icon"><MessagesSquare size={26} /></span>
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

            {/*
              The composer clears the app's bottom navigation and, when it is
              present, the soft keyboard. It is a spacer rather than a padding
              value so the extra space is not painted in the card's colour.
            */}
            <div className="rt-chat-composer">
              <div
                className="rt-chat-composer-inner"
                style={{ paddingBottom: composerInset > 0 ? `calc(11px + ${composerInset}px)` : undefined }}
              >
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
                            maxLength={MESSAGE_MAX_LENGTH}
                            placeholder="Write a message…"
                            disabled={sending}
                            aria-describedby={error ? "chat-send-error" : "chat-message-help"}
                            onChange={(event) => {
                              setDraft(event.target.value);
                              if (error) setError("");
                            }}
                            onKeyDown={handleComposerKeyDown}
                          />
                          <span className="rt-chat-count" aria-hidden="true">{draft.length}/{MESSAGE_MAX_LENGTH}</span>
                        </div>
                        <button
                          className="rt-chat-send"
                          data-testid="chat-send"
                          type="submit"
                          disabled={sending || !draft.trim()}
                          aria-label="Send message"
                          title="Send message"
                        >
                          {sending ? <LoaderCircle className="rt-chat-spin" size={19} /> : <Send size={19} />}
                        </button>
                      </div>
                      {error ? (
                        <p className="rt-chat-error" id="chat-send-error" role="alert" data-testid="chat-error">
                          <AlertCircle size={14} aria-hidden="true" />
                          {error}
                        </p>
                      ) : (
                        <span id="chat-message-help" style={{ display: "none" }}>Press Enter to send or Shift plus Enter for a new line.</span>
                      )}
                    </form>
                    <p className="rt-chat-privacy rt-chat-hint"><CornerDownLeft size={12} aria-hidden="true" /> Enter sends · Shift + Enter adds a line</p>
                  </>
                ) : (
                  <div className="rt-chat-readonly">
                    <LockKeyhole size={16} aria-hidden="true" />
                    <span>
                      <strong>Read-only conversation</strong>
                      This ride is no longer active, so you can still read the messages but cannot add new ones.
                    </span>
                  </div>
                )}
                <p className="rt-chat-privacy rt-chat-privacy--composer">
                  <ShieldCheck size={13} aria-hidden="true" />
                  Messages for this ride are visible only to its driver and riders with a booking.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default ChatPage;
