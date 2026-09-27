import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  AlarmClock,
  AlertCircle,
  Bell,
  BellRing,
  CalendarCheck2,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  LoaderCircle,
  LocateFixed,
  MessageCircle,
  Navigation,
  Star,
  TicketCheck,
  Timer,
  TriangleAlert,
  UserX,
  Wallet,
  XCircle,
} from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { useApp } from "../context/AppContext";
import type { AppNotification, NotificationType } from "../types";

type NotificationFilter = "all" | "unread" | "read";

interface NotificationVisual {
  label: string;
  icon: LucideIcon;
  tone: "request" | "success" | "warning" | "danger" | "message" | "rating" | "travel" | "payment";
}

const notificationStyles = `
.rt-notifications-page { min-height: 100%; padding: 28px 20px 60px; color: var(--rt-text, var(--rt-text-strong)); background: var(--rt-surface-subtle, var(--rt-surface-subtle)); }
.rt-notifications-shell { max-width: 980px; margin: 0 auto; }
.rt-notifications-heading { display: flex; align-items: center; gap: 7px; color: var(--rt-primary-strong); font-size: .76rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.rt-notifications-mark-all { min-height: 43px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 15px; border: 1px solid var(--rt-border); border-radius: 12px; color: var(--rt-primary-strong); background: var(--rt-surface-subtle); font: inherit; font-size: .8rem; font-weight: 760; cursor: pointer; }
.rt-notifications-mark-all:hover:not(:disabled) { background: var(--rt-surface-muted); }
.rt-notifications-mark-all:disabled { opacity: .48; cursor: not-allowed; }
.rt-notifications-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 22px 0 25px; }
.rt-notifications-stat { display: flex; align-items: center; gap: 12px; padding: 15px; border: 1px solid var(--rt-border, var(--rt-border)); border-radius: 17px; background: var(--rt-card, var(--rt-card)); box-shadow: 0 8px 24px color-mix(in srgb, var(--rt-primary) 5%, transparent); }
.rt-notifications-stat-icon { width: 40px; height: 40px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 12px; color: var(--rt-primary-strong); background: var(--rt-surface-muted); }
.rt-notifications-stat:nth-child(2) .rt-notifications-stat-icon { color: var(--rt-info-text); background: var(--rt-info-soft); }
.rt-notifications-stat:nth-child(3) .rt-notifications-stat-icon { color: var(--rt-muted); background: var(--rt-info-soft); }
.rt-notifications-stat strong { display: block; font-size: 1.16rem; line-height: 1; }
.rt-notifications-stat span:last-child { display: block; margin-top: 5px; color: var(--rt-muted); font-size: .72rem; }
.rt-notifications-alert { display: flex; align-items: flex-start; gap: 9px; margin: 0 0 16px; padding: 12px 14px; border: 1px solid var(--rt-danger-border); border-radius: 13px; color: var(--rt-danger-text); background: var(--rt-danger-soft); font-size: .81rem; line-height: 1.45; }
.rt-notifications-alert svg { flex: 0 0 auto; margin-top: 1px; }
.rt-notifications-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 12px; }
.rt-notifications-toolbar h2 { margin: 0; font-size: 1.05rem; letter-spacing: -.018em; }
.rt-notifications-toolbar p { margin: 4px 0 0; color: var(--rt-muted); font-size: .76rem; }
.rt-notifications-sort { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; color: var(--rt-muted); font-size: .72rem; }
.rt-notifications-filters { margin: 0 0 14px; }
.rt-notifications-filtered-empty { border: 1px solid var(--rt-border); border-radius: 17px; background: var(--rt-card); }
.rt-notifications-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.rt-notification { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: stretch; gap: 0; overflow: hidden; border: 1px solid var(--rt-border, var(--rt-border)); border-radius: 17px; background: var(--rt-card, var(--rt-card)); box-shadow: 0 7px 22px color-mix(in srgb, var(--rt-primary) 5%, transparent); transition: border-color .18s ease, transform .18s ease, box-shadow .18s ease; }
.rt-notification:hover { transform: translateY(-1px); border-color: var(--rt-border); box-shadow: 0 11px 28px color-mix(in srgb, var(--rt-primary) 7%, transparent); }
.rt-notification--unread { border-color: var(--rt-border); background: linear-gradient(135deg, var(--rt-surface-subtle), var(--rt-card) 58%); }
.rt-notification--unread::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--rt-primary); }
.rt-notification-link { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 13px; padding: 15px 9px 15px 17px; color: inherit; text-decoration: none; }
.rt-notification-icon { width: 43px; height: 43px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 13px; color: var(--rt-info-text); background: var(--rt-info-soft); }
.rt-notification-icon--request { color: var(--rt-warning-text); background: var(--rt-warning-border); }
.rt-notification-icon--success { color: var(--rt-primary-strong); background: var(--rt-surface-muted); }
.rt-notification-icon--warning { color: var(--rt-warning-text); background: var(--rt-warning-border); }
.rt-notification-icon--danger { color: var(--rt-danger-text); background: var(--rt-danger-soft); }
.rt-notification-icon--message { color: var(--rt-info-text); background: var(--rt-info-soft); }
.rt-notification-icon--rating { color: var(--rt-info-text); background: var(--rt-info-soft); }
.rt-notification-icon--travel { color: var(--rt-info-text); background: var(--rt-info-soft); }
.rt-notification-icon--payment { color: var(--rt-warning-text); background: var(--rt-warning-border); }
.rt-notification-copy { min-width: 0; }
.rt-notification-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.rt-notification-type { color: var(--rt-muted); font-size: .65rem; font-weight: 800; letter-spacing: .045em; text-transform: uppercase; }
.rt-notification-unread { display: inline-flex; align-items: center; gap: 5px; padding: 3px 6px; border-radius: 999px; color: var(--rt-primary-strong); background: var(--rt-primary-soft); font-size: .61rem; font-weight: 800; }
.rt-notification-title { margin: 5px 0 0; overflow: hidden; font-size: .88rem; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.rt-notification-body { margin: 4px 0 0; color: var(--rt-text); font-size: .77rem; line-height: 1.48; }
.rt-notification-time { display: flex; align-items: center; gap: 5px; margin-top: 7px; color: var(--rt-muted); font-size: .67rem; }
.rt-notification-chevron { color: var(--rt-muted); }
.rt-notification-read { align-self: center; width: 38px; height: 38px; display: grid; place-items: center; margin-right: 10px; border: 1px solid var(--rt-border); border-radius: 11px; color: var(--rt-text); background: var(--rt-card); cursor: pointer; }
.rt-notification-read:hover:not(:disabled) { border-color: var(--rt-border); color: var(--rt-primary-strong); background: var(--rt-surface-subtle); }
.rt-notification-read:disabled { opacity: .5; cursor: wait; }
.rt-notification-read--checked { border-color: transparent; color: var(--rt-primary-strong); background: transparent; cursor: default; }
.rt-notification-spin { animation: rt-notifications-spin .8s linear infinite; }
@keyframes rt-notifications-spin { to { transform: rotate(360deg); } }
.rt-notifications-empty { min-height: 400px; display: grid; place-items: center; border: 1px dashed var(--rt-border); border-radius: 22px; background: rgba(255,255,255,.58); }
.rt-notifications-empty .empty-state { max-width: 520px; padding: 30px; text-align: center; }
[data-theme="dark"] .rt-notifications-page { --rt-surface-subtle: var(--rt-surface-subtle); --rt-card: var(--rt-surface); --rt-border: var(--rt-border); --rt-text: var(--rt-text); }
[data-theme="dark"] .rt-notifications-stat, [data-theme="dark"] .rt-notifications-empty { background: var(--rt-surface); border-color: var(--rt-border); }
[data-theme="dark"] .rt-notifications-mark-all { color: #a8e3ba; background: #19321f; border-color: #315a3c; }
[data-theme="dark"] .rt-notifications-toolbar p { color: var(--rt-muted); }
[data-theme="dark"] .rt-notification { background: var(--rt-surface); border-color: var(--rt-border); }
[data-theme="dark"] .rt-notification--unread { background: linear-gradient(135deg, #19301f, var(--rt-surface)); border-color: #31533d; }
[data-theme="dark"] .rt-notification-body { color: var(--rt-muted); }
[data-theme="dark"] .rt-notification-read { color: var(--rt-muted); background: #1a251e; border-color: #35453b; }
/*
 * Dark values for the eight notification tones.
 *
 * These are the most colourful elements on the page, and each one is a filled
 * chip. Left on their light-mode values they become a row of bright stickers
 * against a near-black card, which is unreadable and reads as a rendering fault
 * rather than a design. Each tone keeps its own hue so the type of update is
 * still distinguishable at a glance, and the label beside it carries the meaning
 * in either theme.
 */
[data-theme="dark"] .rt-notification-icon--request { color: var(--rt-warning-text); background: #33290f; }
[data-theme="dark"] .rt-notification-icon--success { color: var(--rt-success-text); background: #16301f; }
[data-theme="dark"] .rt-notification-icon--warning { color: #f5c877; background: #362a10; }
[data-theme="dark"] .rt-notification-icon--danger { color: var(--rt-danger-text); background: #341c1c; }
[data-theme="dark"] .rt-notification-icon--message { color: #bcd8f0; background: #1d2c3a; }
[data-theme="dark"] .rt-notification-icon--rating { color: #d3bdf0; background: #2a1f3d; }
[data-theme="dark"] .rt-notification-icon--travel { color: #a5dfe3; background: #143034; }
[data-theme="dark"] .rt-notification-icon--payment { color: #e8cfa0; background: #33280f; }
@media (max-width: 680px) {
  .rt-notifications-page { padding: 18px 14px 44px; }
  .rt-notifications-mark-all { width: 100%; }
  .rt-notifications-summary { grid-template-columns: 1fr; }
  .rt-notification { grid-template-columns: minmax(0, 1fr); }
  .rt-notification-link { grid-template-columns: auto minmax(0, 1fr); padding: 14px 13px 11px 16px; }
  .rt-notification-chevron { display: none; }
  .rt-notification-read { justify-self: end; width: auto; height: 34px; margin: 0 10px 10px auto; padding: 0 9px; }
  .rt-notification-title { white-space: normal; }
}
`;

const notificationVisuals: Record<NotificationType, NotificationVisual> = {
  "booking-request": { label: "Booking request", icon: BellRing, tone: "request" },
  "booking-accepted": { label: "Seat accepted", icon: Timer, tone: "request" },
  "booking-confirmed": { label: "Booking confirmed", icon: TicketCheck, tone: "success" },
  "booking-rejected": { label: "Booking declined", icon: XCircle, tone: "danger" },
  "booking-cancelled": { label: "Booking cancelled", icon: XCircle, tone: "warning" },
  "booking-no-show": { label: "Marked as no-show", icon: UserX, tone: "danger" },
  "ride-cancelled": { label: "Ride cancelled", icon: TriangleAlert, tone: "warning" },
  "ride-completed": { label: "Ride completed", icon: CheckCheck, tone: "success" },
  "ride-started": { label: "Trip started", icon: Navigation, tone: "travel" },
  "ride-reminder": { label: "Departure reminder", icon: AlarmClock, tone: "travel" },
  "driver-approaching": { label: "Driver approaching", icon: LocateFixed, tone: "travel" },
  "payment-status": { label: "Payment", icon: Wallet, tone: "payment" },
  message: { label: "New message", icon: MessageCircle, tone: "message" },
  "rating-request": { label: "Rate your ride", icon: Star, tone: "rating" },
};

const notificationTarget = (notification: AppNotification) => {
  if (!notification.rideId) return null;
  if (notification.type === "message") return `/chat/${notification.rideId}`;
  if (notification.type === "booking-request") return `/rides/${notification.rideId}`;
  return `/rides/${notification.rideId}`;
};

const notificationTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Time unavailable";
  const elapsedMinutes = Math.round((parsed.getTime() - Date.now()) / 60000);
  if (Math.abs(elapsedMinutes) < 1) return "Just now";
  if (elapsedMinutes > 0 && elapsedMinutes < 60) return `${elapsedMinutes} min ago`;
  if (elapsedMinutes < 0 && elapsedMinutes > -60) return `In ${Math.abs(elapsedMinutes)} min`;
  if (elapsedMinutes >= 60 && elapsedMinutes < 1440) return `${Math.round(elapsedMinutes / 60)} hr ago`;
  if (elapsedMinutes < -60 && elapsedMinutes > -1440) return `In ${Math.round(Math.abs(elapsedMinutes) / 60)} hr`;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
};

const exactNotificationTime = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
};

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export function NotificationsPage() {
  const {
    activeUserId,
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
  } = useApp();
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
  }, [activeUserId]);

  const userNotifications = useMemo(() => notifications
    .filter((notification) => notification.userId === activeUserId)
    .sort((first, second) => {
      const firstTime = new Date(first.createdAt).getTime();
      const secondTime = new Date(second.createdAt).getTime();
      return (Number.isFinite(secondTime) ? secondTime : 0) - (Number.isFinite(firstTime) ? firstTime : 0);
    }), [activeUserId, notifications]);
  const unreadCount = userNotifications.filter((notification) => !notification.read).length;
  const readCount = userNotifications.length - unreadCount;

  /**
   * The filter is a view, not a fetch: the same rows are already loaded, so
   * switching tabs is instant and cannot fail. It is kept in component state
   * rather than the URL because it is not a shareable destination - but it is
   * reset when the member switches profile, since the counts change entirely.
   */
  const [filter, setFilter] = useState<NotificationFilter>("all");

  useEffect(() => {
    setFilter("all");
  }, [activeUserId]);

  const visibleNotifications = useMemo(() => {
    if (filter === "unread") return userNotifications.filter((notification) => !notification.read);
    if (filter === "read") return userNotifications.filter((notification) => notification.read);
    return userNotifications;
  }, [filter, userNotifications]);

  const filterTabs = [
    { id: "all" as const, label: "All", count: userNotifications.length },
    { id: "unread" as const, label: "Unread", count: unreadCount },
    { id: "read" as const, label: "Read", count: readCount },
  ];

  const markOneRead = async (notificationId: string) => {
    if (busyIds.includes(notificationId) || markingAll) return;
    setBusyIds((current) => [...current, notificationId]);
    setError("");
    try {
      await markNotificationRead(notificationId);
    } catch (caught) {
      setError(errorText(caught, "We could not mark that notification as read."));
    } finally {
      setBusyIds((current) => current.filter((id) => id !== notificationId));
    }
  };

  const markEverythingRead = async () => {
    if (unreadCount === 0 || markingAll) return;
    setMarkingAll(true);
    setError("");
    try {
      await markAllNotificationsRead();
    } catch (caught) {
      setError(errorText(caught, "We could not mark your notifications as read."));
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div className="rt-notifications-page">
      <style>{notificationStyles}</style>
      <div className="rt-notifications-shell">
        <PageHeader
          title="Notifications"
          description="Booking decisions, ride updates, messages, and rating prompts for your active profile."
          eyebrow={<span className="rt-notifications-heading"><Bell size={15} /> Activity centre</span>}
          actions={(
            <button className="rt-notifications-mark-all" type="button" disabled={unreadCount === 0 || markingAll} onClick={() => void markEverythingRead()}>
              {markingAll ? <LoaderCircle className="rt-notifications-spin" size={16} /> : <CheckCheck size={17} />}
              {markingAll ? "Updating…" : unreadCount > 0 ? `Mark all ${unreadCount} read` : "All caught up"}
            </button>
          )}
        />

        <section className="rt-notifications-summary" aria-label="Notification overview">
          <div className="rt-notifications-stat"><span className="rt-notifications-stat-icon"><BellRing size={19} /></span><div><strong>{unreadCount}</strong><span>Unread updates</span></div></div>
          <div className="rt-notifications-stat"><span className="rt-notifications-stat-icon"><Check size={19} /></span><div><strong>{userNotifications.length - unreadCount}</strong><span>Read updates</span></div></div>
          <div className="rt-notifications-stat"><span className="rt-notifications-stat-icon"><CalendarCheck2 size={19} /></span><div><strong>{userNotifications.length}</strong><span>Total updates</span></div></div>
        </section>

        {error ? <div className="rt-notifications-alert" role="alert"><AlertCircle size={17} />{error}</div> : null}

        {userNotifications.length === 0 ? (
          <div className="rt-notifications-empty">
            <EmptyState
              icon={Bell}
              title="You’re all caught up"
              description="Booking requests, confirmations, ride messages, cancellations, and rating prompts will appear here."
              action={<Link className="rt-notifications-mark-all" to="/find"><CalendarCheck2 size={16} /> Find a ride</Link>}
            />
          </div>
        ) : (
          <section aria-labelledby="notification-list-title">
            <div className="rt-notifications-toolbar">
              <div>
                <h2 id="notification-list-title">Recent activity</h2>
                <p>{unreadCount > 0 ? `${unreadCount} ${unreadCount === 1 ? "update needs" : "updates need"} your attention.` : "You have read every update."}</p>
              </div>
              <span className="rt-notifications-sort"><Clock3 size={14} /> Newest first</span>
            </div>
            <div className="rt-notifications-filters">
              <Tabs
                items={filterTabs}
                activeId={filter}
                onChange={(id) => setFilter(id as NotificationFilter)}
                label="Filter notifications"
                idPrefix="notification-filter"
              />
            </div>
            {visibleNotifications.length === 0 ? (
              <div className="rt-notifications-filtered-empty">
                <EmptyState
                  icon={filter === "unread" ? CheckCheck : Bell}
                  title={filter === "unread" ? "Nothing unread" : "Nothing read yet"}
                  description={filter === "unread"
                    ? "Every update has been read. New booking requests and messages will show up here."
                    : "Updates you have read will collect here so you can look back at them."}
                  action={filter === "unread" && unreadCount > 0 ? (
                    <button className="rt-notifications-mark-all" type="button" onClick={() => void markEverythingRead()}>
                      <CheckCheck size={16} /> Mark all read
                    </button>
                  ) : undefined}
                />
              </div>
            ) : (
            <ol className="rt-notifications-list">
              {visibleNotifications.map((notification) => {
                const visual = notificationVisuals[notification.type];
                const Icon = visual.icon;
                const target = notificationTarget(notification);
                const busy = busyIds.includes(notification.id);
                const content = (
                  <>
                    <span className={`rt-notification-icon rt-notification-icon--${visual.tone}`} aria-hidden="true"><Icon size={20} /></span>
                    <div className="rt-notification-copy">
                      <div className="rt-notification-meta">
                        <span className="rt-notification-type">{visual.label}</span>
                        {!notification.read ? <span className="rt-notification-unread"><span aria-hidden="true">●</span> New</span> : null}
                      </div>
                      <h3 className="rt-notification-title">{notification.title}</h3>
                      <p className="rt-notification-body">{notification.body}</p>
                      <time className="rt-notification-time" dateTime={notification.createdAt} title={exactNotificationTime(notification.createdAt)}>
                        {notificationTime(notification.createdAt)}
                      </time>
                    </div>
                    {target ? <ChevronRight className="rt-notification-chevron" size={18} aria-hidden="true" /> : null}
                  </>
                );

                return (
                  <li
                    className={`rt-notification${notification.read ? "" : " rt-notification--unread"}`}
                    key={notification.id}
                    aria-label={`${visual.label}${notification.read ? "" : ", unread"}: ${notification.title}`}
                  >
                    {target ? (
                      <Link
                        className="rt-notification-link"
                        to={target}
                        onClick={() => {
                          if (!notification.read && !busy) void markOneRead(notification.id);
                        }}
                        aria-label={`${notification.read ? "Open" : "Mark as read and open"}: ${notification.title}`}
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="rt-notification-link">{content}</div>
                    )}
                    {notification.read ? (
                      <span className="rt-notification-read rt-notification-read--checked" aria-label="Read">
                        <CheckCheck size={17} />
                      </span>
                    ) : (
                      <button
                        className="rt-notification-read"
                        type="button"
                        disabled={busy || markingAll}
                        aria-label={`Mark ${notification.title} as read`}
                        title="Mark as read"
                        onClick={() => void markOneRead(notification.id)}
                      >
                        {busy ? <LoaderCircle className="rt-notifications-spin" size={16} /> : <Check size={17} />}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export default NotificationsPage;
