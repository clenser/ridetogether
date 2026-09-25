import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  Bell,
  BellRing,
  CalendarCheck2,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  LoaderCircle,
  MessageCircle,
  Star,
  TicketCheck,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useApp } from "../context/AppContext";
import type { AppNotification, NotificationType } from "../types";

interface NotificationVisual {
  label: string;
  icon: LucideIcon;
  tone: "request" | "success" | "warning" | "danger" | "message" | "rating";
}

const notificationStyles = `
.rt-notifications-page { min-height: 100%; padding: 28px 20px 60px; color: var(--rt-text, #17231c); background: var(--rt-surface-subtle, #f6faf7); }
.rt-notifications-shell { max-width: 980px; margin: 0 auto; }
.rt-notifications-heading { display: flex; align-items: center; gap: 7px; color: #148642; font-size: .76rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.rt-notifications-mark-all { min-height: 43px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 15px; border: 1px solid #cfe1d5; border-radius: 12px; color: #137a3d; background: #f0faf4; font: inherit; font-size: .8rem; font-weight: 760; cursor: pointer; }
.rt-notifications-mark-all:hover:not(:disabled) { background: #e0f4e7; }
.rt-notifications-mark-all:disabled { opacity: .48; cursor: not-allowed; }
.rt-notifications-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 22px 0 25px; }
.rt-notifications-stat { display: flex; align-items: center; gap: 12px; padding: 15px; border: 1px solid var(--rt-border, #dce7df); border-radius: 17px; background: var(--rt-card, #fff); box-shadow: 0 8px 24px rgba(29,64,42,.045); }
.rt-notifications-stat-icon { width: 40px; height: 40px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 12px; color: #148642; background: #e2f5e8; }
.rt-notifications-stat:nth-child(2) .rt-notifications-stat-icon { color: #2563a7; background: #e9f2fb; }
.rt-notifications-stat:nth-child(3) .rt-notifications-stat-icon { color: #6e7780; background: #eef1f2; }
.rt-notifications-stat strong { display: block; font-size: 1.16rem; line-height: 1; }
.rt-notifications-stat span:last-child { display: block; margin-top: 5px; color: #748178; font-size: .72rem; }
.rt-notifications-alert { display: flex; align-items: flex-start; gap: 9px; margin: 0 0 16px; padding: 12px 14px; border: 1px solid #efb9b9; border-radius: 13px; color: #a43131; background: #fff1f1; font-size: .81rem; line-height: 1.45; }
.rt-notifications-alert svg { flex: 0 0 auto; margin-top: 1px; }
.rt-notifications-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 12px; }
.rt-notifications-toolbar h2 { margin: 0; font-size: 1.05rem; letter-spacing: -.018em; }
.rt-notifications-toolbar p { margin: 4px 0 0; color: #748178; font-size: .76rem; }
.rt-notifications-sort { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; color: #718078; font-size: .72rem; }
.rt-notifications-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.rt-notification { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: stretch; gap: 0; overflow: hidden; border: 1px solid var(--rt-border, #dce7df); border-radius: 17px; background: var(--rt-card, #fff); box-shadow: 0 7px 22px rgba(29,64,42,.045); transition: border-color .18s ease, transform .18s ease, box-shadow .18s ease; }
.rt-notification:hover { transform: translateY(-1px); border-color: #c7dccf; box-shadow: 0 11px 28px rgba(29,64,42,.07); }
.rt-notification--unread { border-color: #bcdcc6; background: linear-gradient(135deg, #f1faf4, #fff 58%); }
.rt-notification--unread::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: #159447; }
.rt-notification-link { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 13px; padding: 15px 9px 15px 17px; color: inherit; text-decoration: none; }
.rt-notification-icon { width: 43px; height: 43px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 13px; color: #2563a7; background: #eaf2fb; }
.rt-notification-icon--request { color: #94600a; background: #fff2d8; }
.rt-notification-icon--success { color: #11743a; background: #e2f5e9; }
.rt-notification-icon--warning { color: #9a6207; background: #fff3dc; }
.rt-notification-icon--danger { color: #a33a3a; background: #fdeaea; }
.rt-notification-icon--message { color: #2563a7; background: #eaf2fb; }
.rt-notification-icon--rating { color: #7955a5; background: #f1eafb; }
.rt-notification-copy { min-width: 0; }
.rt-notification-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.rt-notification-type { color: #6f7c74; font-size: .65rem; font-weight: 800; letter-spacing: .045em; text-transform: uppercase; }
.rt-notification-unread { display: inline-flex; align-items: center; gap: 5px; padding: 3px 6px; border-radius: 999px; color: #116f38; background: #dff4e6; font-size: .61rem; font-weight: 800; }
.rt-notification-title { margin: 5px 0 0; overflow: hidden; font-size: .88rem; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.rt-notification-body { margin: 4px 0 0; color: #68766e; font-size: .77rem; line-height: 1.48; }
.rt-notification-time { display: flex; align-items: center; gap: 5px; margin-top: 7px; color: #87928c; font-size: .67rem; }
.rt-notification-chevron { color: #8b9790; }
.rt-notification-read { align-self: center; width: 38px; height: 38px; display: grid; place-items: center; margin-right: 10px; border: 1px solid #d9e3dc; border-radius: 11px; color: #68776e; background: #fff; cursor: pointer; }
.rt-notification-read:hover:not(:disabled) { border-color: #b9d6c3; color: #137c3e; background: #eef9f2; }
.rt-notification-read:disabled { opacity: .5; cursor: wait; }
.rt-notification-read--checked { border-color: transparent; color: #13813f; background: transparent; cursor: default; }
.rt-notification-spin { animation: rt-notifications-spin .8s linear infinite; }
@keyframes rt-notifications-spin { to { transform: rotate(360deg); } }
.rt-notifications-empty { min-height: 400px; display: grid; place-items: center; border: 1px dashed #cad8cf; border-radius: 22px; background: rgba(255,255,255,.58); }
.rt-notifications-empty .empty-state { max-width: 520px; padding: 30px; text-align: center; }
[data-theme="dark"] .rt-notifications-page { --rt-surface-subtle: #101712; --rt-card: #17211a; --rt-border: #2b3a30; --rt-text: #eef7f1; }
[data-theme="dark"] .rt-notifications-stat, [data-theme="dark"] .rt-notifications-empty { background: #17211a; border-color: #2b3a30; }
[data-theme="dark"] .rt-notifications-mark-all { color: #a8e3ba; background: #19321f; border-color: #315a3c; }
[data-theme="dark"] .rt-notifications-toolbar p { color: #a6b5ac; }
[data-theme="dark"] .rt-notification { background: #17211a; border-color: #2b3a30; }
[data-theme="dark"] .rt-notification--unread { background: linear-gradient(135deg, #19301f, #17211a); border-color: #31533d; }
[data-theme="dark"] .rt-notification-body { color: #a6b5ac; }
[data-theme="dark"] .rt-notification-read { color: #c5d0c9; background: #1a251e; border-color: #35453b; }
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
  "booking-confirmed": { label: "Booking confirmed", icon: TicketCheck, tone: "success" },
  "booking-rejected": { label: "Booking declined", icon: XCircle, tone: "danger" },
  "booking-cancelled": { label: "Booking cancelled", icon: XCircle, tone: "warning" },
  "ride-cancelled": { label: "Ride cancelled", icon: TriangleAlert, tone: "warning" },
  "ride-completed": { label: "Ride completed", icon: CheckCheck, tone: "success" },
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
            <ol className="rt-notifications-list">
              {userNotifications.map((notification) => {
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
          </section>
        )}
      </div>
    </div>
  );
}

export default NotificationsPage;
