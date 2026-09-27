import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  Check,
  ChevronDown,
  CreditCard,
  Download,
  ExternalLink,
  HelpCircle,
  Info,
  Laptop,
  LockKeyhole,
  Mail,
  MessageSquareText,
  MonitorSmartphone,
  Moon,
  Palette,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Sun,
  UserRound,
  Wallet,
} from "lucide-react";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { Group, Row, RowValue } from "../components/ui/Group";
import { UpiField } from "../components/ui/UpiField";
import { PushNotificationToggle } from "../components/PushNotificationToggle";
import { useApp } from "../context/AppContext";
import { hasLegacyLocalData } from "../services/database";
import { PAYMENT_DISCLAIMER } from "../services/payment";
import { isSupabaseConfigured } from "../services/supabase";
import { readAppearance, saveAppearance, type Appearance } from "../services/theme";
import {
  dismissInstallPrompt,
  getInstallState,
  requestInstall,
  subscribeToInstallState,
  type InstallPromptState,
} from "../services/pwa";

interface Preferences {
  notifications: {
    email: boolean;
    push: boolean;
    inApp: boolean;
  };
  appearance: Appearance;
  privacy: {
    showProfile: boolean;
    shareTripDetails: boolean;
  };
}

interface ToggleProps {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const STORAGE_KEY = "ridetogether-settings";
const APP_VERSION = "1.0.0";

/** Resolved once per render so the About card reports the real integration state. */
const cloudConfigured = isSupabaseConfigured();

const defaultPreferences: Preferences = {
  notifications: {
    email: true,
    push: false,
    inApp: true,
  },
  appearance: "system",
  privacy: {
    showProfile: true,
    shareTripDetails: true,
  },
};

const settingsStyles = `
.rt-settings-page {
  min-height: 100%;
  padding: 28px 20px 64px;
  color: var(--rt-text, var(--rt-text-strong));
  background: var(--rt-surface-subtle, var(--rt-surface-subtle));
}
.rt-settings-shell { max-width: 1100px; margin: 0 auto; }


.rt-settings-layout { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 22px; align-items: start; }
.rt-settings-nav {
  position: sticky;
  top: 94px;
  padding: 12px;
  border: 1px solid var(--rt-border, var(--rt-border));
  border-radius: 18px;
  background: var(--rt-card, var(--rt-card));
  box-shadow: 0 8px 24px color-mix(in srgb, var(--rt-primary) 5%, transparent);
}
.rt-settings-nav-title { margin: 5px 8px 11px; color: var(--rt-muted); font-size: .66rem; font-weight: 800; text-transform: uppercase; letter-spacing: .09em; }
.rt-settings-nav a {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 11px;
  border-radius: 10px;
  color: var(--rt-text);
  text-decoration: none;
  font-size: .79rem;
  font-weight: 650;
}
.rt-settings-nav a:hover { color: var(--rt-primary-strong); background: var(--rt-surface-subtle); }
.rt-settings-nav a svg { color: var(--rt-primary-strong); }
.rt-settings-content { display: grid; gap: 18px; min-width: 0; }






.rt-settings-note { display: flex; align-items: flex-start; gap: 9px; margin: 0 0 8px; padding: 11px 12px; border-radius: 11px; color: var(--rt-text); background: var(--rt-surface-subtle); font-size: .74rem; line-height: 1.5; }
.rt-settings-note svg { flex: 0 0 auto; margin-top: 1px; color: var(--rt-primary-strong); }
.rt-setting-toggle {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 15px 0;
  border-bottom: 1px solid var(--rt-surface-muted);
  cursor: pointer;
}
.rt-setting-toggle:last-child { border-bottom: 0; }
.rt-setting-toggle-icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 10px; color: var(--rt-text); background: var(--rt-surface-muted); }
.rt-setting-toggle-copy strong { display: block; color: var(--rt-text); font-size: .83rem; }
.rt-setting-toggle-copy span { display: block; margin-top: 4px; color: var(--rt-muted); font-size: .72rem; line-height: 1.4; }
.rt-switch { position: relative; width: 43px; height: 24px; flex: 0 0 auto; }
.rt-switch input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.rt-switch-track { position: absolute; inset: 0; border-radius: 999px; background: var(--rt-border); transition: background .2s ease, box-shadow .2s ease; }
.rt-switch-track::after { content: ""; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px; border-radius: 50%; background: var(--rt-card); box-shadow: 0 2px 5px rgba(20,40,28,.24); transition: transform .2s ease; }
.rt-switch input:checked + .rt-switch-track { background: var(--rt-primary-strong); }
.rt-switch input:checked + .rt-switch-track::after { transform: translateX(19px); }
.rt-switch input:focus-visible + .rt-switch-track { box-shadow: 0 0 0 3px color-mix(in srgb, var(--rt-primary) 18%, transparent); }
/* Wraps one toggle that carries its own status line (push, install). */
.rt-setting-toggle-group .rt-setting-toggle { cursor: default; }
.rt-setting-toggle-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -6px 0 14px 48px;
  color: var(--rt-primary-strong);
  font-size: .72rem;
  line-height: 1.4;
}
.rt-setting-toggle-note--error { color: var(--rt-danger); }
/* The four push facts (supported / permission / this device / delivery). Two
   columns on a phone, four on a desktop card: each fact is read from the browser
   or the database so a member can tell a working setup from a broken one. */
.rt-push-status {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
  margin: -2px 0 12px;
  padding: 0;
  list-style: none;
}
.rt-push-status li { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.rt-push-status span { color: var(--rt-muted); font-size: .66rem; letter-spacing: .04em; text-transform: uppercase; }
.rt-push-status strong { color: var(--rt-text); font-size: .74rem; font-weight: 700; }
.rt-push-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
.rt-push-actions .rt-settings-secondary { display: inline-flex; align-items: center; gap: 7px; }


.rt-install-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 4px 0; flex-wrap: wrap; }
.rt-install-copy { min-width: 0; }
.rt-install-copy strong { display: block; color: var(--rt-text); font-size: .83rem; }
.rt-install-copy span { display: block; margin-top: 4px; color: var(--rt-muted); font-size: .72rem; line-height: 1.45; }




.rt-appearance-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding-top: 14px; }
.rt-appearance-option {
  position: relative;
  min-height: 116px;
  padding: 14px;
  border: 1px solid var(--rt-border);
  border-radius: 15px;
  color: var(--rt-text);
  background: var(--rt-card);
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
}
.rt-appearance-option:hover { transform: translateY(-1px); border-color: var(--rt-border); }
.rt-appearance-option-active { border-color: var(--rt-primary-strong); box-shadow: 0 0 0 2px color-mix(in srgb, var(--rt-primary) 11%, transparent); }
.rt-appearance-preview { height: 48px; display: flex; gap: 6px; padding: 7px; margin-bottom: 11px; border-radius: 9px; background: var(--rt-surface-muted); }
.rt-appearance-option-dark .rt-appearance-preview { background: var(--rt-text-strong); }
.rt-appearance-side { width: 24px; border-radius: 5px; background: var(--rt-card); border: 1px solid var(--rt-border); }
.rt-appearance-option-dark .rt-appearance-side { background: var(--rt-text-strong); border-color: var(--rt-text); }
.rt-appearance-main { flex: 1; display: grid; gap: 5px; }
.rt-appearance-bar { height: 5px; border-radius: 99px; background: var(--rt-border); }
.rt-appearance-bar-green { width: 65%; background: var(--rt-primary); }
.rt-appearance-bar-short { width: 48%; }
.rt-appearance-option-dark .rt-appearance-bar { background: var(--rt-text); }
.rt-appearance-caption { display: flex; align-items: center; gap: 7px; font-size: .76rem; font-weight: 760; }

.rt-faq-list { display: grid; }
.rt-faq {
  border-bottom: 1px solid var(--rt-surface-muted);
}
.rt-faq:last-child { border-bottom: 0; }
.rt-faq summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 0;
  color: var(--rt-text);
  font-size: .82rem;
  font-weight: 730;
  cursor: pointer;
  list-style: none;
}
.rt-faq summary::-webkit-details-marker { display: none; }
.rt-faq summary svg { flex: 0 0 auto; color: var(--rt-muted); transition: transform .18s ease; }
.rt-faq[open] summary svg { transform: rotate(180deg); }
.rt-faq-answer { margin: -4px 0 17px; color: var(--rt-text); font-size: .76rem; line-height: 1.6; }










.rt-reset-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 15px; border: 1px solid var(--rt-danger-border); border-radius: 14px; background: var(--rt-danger-soft); }
.rt-reset-copy { display: flex; align-items: flex-start; gap: 10px; }
.rt-reset-copy svg { flex: 0 0 auto; color: var(--rt-danger); margin-top: 1px; }
.rt-reset-copy strong { display: block; color: var(--rt-danger-text); font-size: .8rem; }
.rt-reset-copy span { display: block; margin-top: 4px; color: var(--rt-danger); font-size: .7rem; line-height: 1.4; }



.rt-settings-feedback { display: flex; align-items: center; gap: 8px; padding: 11px 13px; border: 1px solid var(--rt-border); border-radius: 11px; color: var(--rt-primary-strong); background: var(--rt-surface-subtle); font-size: .76rem; }
.rt-settings-feedback-error { color: var(--rt-danger-text); border-color: var(--rt-danger-border); background: var(--rt-danger-soft); }
.rt-reset-warning { display: flex; align-items: flex-start; gap: 10px; padding: 13px; border: 1px solid var(--rt-danger-border); border-radius: 12px; color: var(--rt-danger-text); background: var(--rt-danger-soft); font-size: .78rem; line-height: 1.5; }
.rt-reset-warning svg { flex: 0 0 auto; }
.rt-reset-modal-copy { margin: 14px 0 0; color: var(--rt-text); font-size: .82rem; line-height: 1.55; }
.rt-reset-modal-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 19px; }
.rt-settings-secondary, .rt-settings-danger {
  min-height: 41px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 14px;
  border-radius: 10px;
  font: inherit;
  font-size: .77rem;
  font-weight: 750;
  cursor: pointer;
}
.rt-settings-secondary { border: 1px solid var(--rt-border); color: var(--rt-text); background: var(--rt-card); }

.rt-settings-secondary:disabled, .rt-settings-danger:disabled { opacity: .58; cursor: not-allowed; }







/* The icon rules above hard-code the light-theme green, but the containers they
   sit on are re-coloured for dark mode. Without this the nav and note icons stay
   var(--rt-primary-strong) on a var(--rt-text-strong) card, which lands near 3.9:1 and reads as a dim smudge
   next to the var(--rt-border) label beside it. On mobile that nav is a horizontal strip
   of these icons, so it is the most visible place the shortfall shows up. */








@media (max-width: 820px) {
  .rt-settings-layout { grid-template-columns: 1fr; }
  /* Becomes a horizontal strip of clickable icon+label links. Momentum scrolling
     keeps it usable with a thumb, and the side insets stop the first and last
     links sitting under a landscape notch or gesture bar. */
  .rt-settings-nav {
    position: static;
    display: flex;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    padding-inline: max(12px, env(safe-area-inset-left)) max(12px, env(safe-area-inset-right));
    -webkit-overflow-scrolling: touch;
  }
  .rt-settings-nav-title { display: none; }
  .rt-settings-nav a { flex: 0 0 auto; }
}
@media (max-width: 620px) {
  .rt-settings-page { padding: 18px 14px 44px; }

  .rt-appearance-grid { grid-template-columns: 1fr; }
  .rt-appearance-option { min-height: 96px; }
  .rt-reset-row { align-items: stretch; flex-direction: column; }

  .rt-reset-modal-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* The input takes the full row on a phone so it is not squeezed to an
     unusable width by two buttons, which then wrap onto their own row. */
  .rt-settings-upi-row { grid-template-columns: 1fr; }
  .rt-settings-upi-row .rt-settings-primary,
  .rt-settings-upi-row .rt-settings-secondary { width: 100%; }
}










@media (prefers-reduced-motion: reduce) {

}
`;

function readPreferences(): Preferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultPreferences, appearance: readAppearance() };
    const saved = JSON.parse(raw) as Partial<Preferences>;
    return {
      notifications: {
        email: saved.notifications?.email ?? defaultPreferences.notifications.email,
        push: saved.notifications?.push ?? defaultPreferences.notifications.push,
        inApp: saved.notifications?.inApp ?? defaultPreferences.notifications.inApp,
      },
      appearance: readAppearance(),
      privacy: {
        showProfile: saved.privacy?.showProfile ?? defaultPreferences.privacy.showProfile,
        shareTripDetails: saved.privacy?.shareTripDetails ?? defaultPreferences.privacy.shareTripDetails,
      },
    };
  } catch {
    return { ...defaultPreferences, appearance: readAppearance() };
  }
}

/**
 * One notification or privacy switch.
 *
 * The whole row is the label, so the sentence next to the switch is part of the
 * hit target. The switch itself stays a real `<input type="checkbox">` so it
 * works with a keyboard and with assistive technology without extra wiring.
 */
function SettingToggle({ id, icon, title, description, checked, onChange }: ToggleProps) {
  return (
    <label className="rt-setting-toggle" htmlFor={id}>
      <span className="rt-setting-toggle-icon">{icon}</span>
      <span className="rt-setting-toggle-copy"><strong>{title}</strong><span>{description}</span></span>
      <span className="rt-switch">
        <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span className="rt-switch-track" />
      </span>
    </label>
  );
}

export function SettingsPage() {
  const { clearLocalCache, activeUser } = useApp();
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [installState, setInstallState] = useState<InstallPromptState>(getInstallState);
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<string | null>(null);
  // Only offer the clear action when a pre-cloud build actually left rows here.
  const [hasLocalData, setHasLocalData] = useState(false);

  const refreshLocalDataFlag = useCallback(async () => {
    try {
      setHasLocalData(await hasLegacyLocalData());
    } catch {
      setHasLocalData(false);
    }
  }, []);

  useEffect(() => {
    void refreshLocalDataFlag();
  }, [refreshLocalDataFlag]);

  useEffect(
    () => subscribeToInstallState((next) => setInstallState(next)),
    [],
  );

  /*
   * The browser only offers `beforeinstallprompt` on some platforms, and only
   * once. The button is hidden when there is nothing to trigger, and the copy
   * explains the manual route rather than leaving a control that does nothing.
   */
  const installMessage = installResult
    ?? (installState.isInstalled
      ? "You are using the installed app. Updates arrive automatically."
      : installState.canInstall
        ? "Adds a home-screen icon and lets the app open without a browser bar."
        : installState.dismissed
          ? "You chose not to be asked again. Use your browser's “Add to home screen” option instead."
          : "Your browser has not offered an install prompt. On iPhone, use Share → Add to Home Screen.");

  const handleInstall = async () => {
    setInstalling(true);
    setInstallResult(null);
    try {
      const outcome = await requestInstall();
      if (outcome === "accepted") {
        setInstallResult("Installing RideTogether…");
      } else if (outcome === "dismissed") {
        dismissInstallPrompt();
        setInstallResult("No problem. You can install later from this page.");
      } else {
        setInstallResult("This browser will not show an install prompt right now.");
      }
    } finally {
      setInstalling(false);
    }
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      return;
    }
  }, [preferences]);

  const updateNotification = (key: keyof Preferences["notifications"], value: boolean) => {
    setPreferences((current) => ({ ...current, notifications: { ...current.notifications, [key]: value } }));
    setResetMessage(null);
  };

  const updatePrivacy = (key: keyof Preferences["privacy"], value: boolean) => {
    setPreferences((current) => ({ ...current, privacy: { ...current.privacy, [key]: value } }));
    setResetMessage(null);
  };

  const setAppearance = (appearance: Appearance) => {
    saveAppearance(appearance);
    setPreferences((current) => ({ ...current, appearance }));
  };

  const handleReset = async () => {
    setResetting(true);
    setResetMessage(null);
    try {
      await clearLocalCache();
      await refreshLocalDataFlag();
      setResetOpen(false);
      setResetMessage({ type: "success", text: "Local browser data was cleared. Your account data is unchanged." });
    } catch (error) {
      setResetMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to clear local data." });
    } finally {
      setResetting(false);
    }
  };

  const appearanceOptions: Array<{ value: Appearance; label: string; icon: ReactNode; className: string }> = [
    { value: "light", label: "Light", icon: <Sun size={15} />, className: "" },
    { value: "dark", label: "Dark", icon: <Moon size={15} />, className: " rt-appearance-option-dark" },
    { value: "system", label: "System", icon: <MonitorSmartphone size={15} />, className: "" },
  ];

  return (
    <div className="rt-settings-page">
      <style>{settingsStyles}</style>
      <div className="rt-settings-shell">
        <PageHeader
          eyebrow="Settings"
          title="Settings"
          description="Control how RideTogether looks, which updates you get, and what stays private. Changes save automatically on this device."
        />

        <div className="rt-settings-layout">
          <nav className="rt-settings-nav" aria-label="Settings sections">
            <span className="rt-settings-nav-title">On this page</span>
            <a href="#rt-appearance"><Palette size={15} /> Appearance</a>
            <a href="#rt-notifications"><Bell size={15} /> Notifications</a>
            <a href="#rt-privacy"><LockKeyhole size={15} /> Privacy</a>
            <a href="#rt-payments"><Wallet size={15} /> Payments</a>
            <a href="#rt-security"><ShieldCheck size={15} /> Security</a>
            <a href="#rt-app"><Download size={15} /> Install</a>
            <a href="#rt-account"><UserRound size={15} /> Account</a>
            <a href="#rt-help"><HelpCircle size={15} /> Help</a>
          </nav>

          <div className="rt-settings-content">
            {resetMessage ? (
              <div className={`rt-settings-feedback${resetMessage.type === "error" ? " rt-settings-feedback-error" : ""}`} role="status">
                {resetMessage.type === "success" ? <Check size={16} /> : <Info size={16} />}
                {resetMessage.text}
              </div>
            ) : null}

            <Group
              id="rt-appearance"
              title="Appearance"
              description="Apply a theme immediately and keep it for your next visit."
            >
              <div className="rt-appearance-grid" role="group" aria-label="Colour theme">
                {appearanceOptions.map((option) => (
                  <button
                    className={`rt-appearance-option${option.className}${preferences.appearance === option.value ? " rt-appearance-option-active" : ""}`}
                    type="button"
                    key={option.value}
                    onClick={() => setAppearance(option.value)}
                    aria-pressed={preferences.appearance === option.value}
                  >
                    <span className="rt-appearance-preview" aria-hidden="true">
                      <span className="rt-appearance-side" />
                      <span className="rt-appearance-main"><span className="rt-appearance-bar rt-appearance-bar-green" /><span className="rt-appearance-bar" /><span className="rt-appearance-bar rt-appearance-bar-short" /></span>
                    </span>
                    <span className="rt-appearance-caption">{option.icon}{option.label}</span>
                  </button>
                ))}
              </div>
              <div className="rt-settings-note">
                <Info size={15} aria-hidden="true" />
                <span>System follows your device. Light and dark are remembered on this device only.</span>
              </div>
            </Group>

            <Group
              id="rt-notifications"
              title="Notifications"
              description="Choose which updates RideTogether may bring you."
            >
              <div className="rt-settings-note">
                <Info size={15} aria-hidden="true" />
                <span>In-app and push updates are delivered for real. Email is remembered for a future mailing list and sends nothing today.</span>
              </div>
              <SettingToggle id="rt-in-app-notifications" icon={<MessageSquareText size={17} />} title="In-app updates" description="Keep important ride activity visible in the notifications center." checked={preferences.notifications.inApp} onChange={(value) => updateNotification("inApp", value)} />
              <SettingToggle id="rt-email-notifications" icon={<Mail size={17} />} title="Email updates" description="Save your preference for ride and booking summaries by email." checked={preferences.notifications.email} onChange={(value) => updateNotification("email", value)} />
              <PushNotificationToggle
                checked={preferences.notifications.push}
                onChange={(value) => updateNotification("push", value)}
              />
            </Group>

            <Group
              id="rt-privacy"
              title="Privacy"
              description="Decide what co-riders can see about you and your trips."
            >
              <SettingToggle id="rt-show-profile" icon={<Laptop size={17} />} title="Show profile to co-riders" description="Allow people in your rides to see your basic profile and contact details." checked={preferences.privacy.showProfile} onChange={(value) => updatePrivacy("showProfile", value)} />
              <SettingToggle id="rt-share-trip-details" icon={<ExternalLink size={17} />} title="Share trip details" description="Save your preference to share pickup, destination, and timing with confirmed co-riders." checked={preferences.privacy.shareTripDetails} onChange={(value) => updatePrivacy("shareTripDetails", value)} />
            </Group>

            <Group
              id="rt-payments"
              title="Payments"
              description="Save the UPI handle a driver would send contributions to."
            >
              <div className="rt-settings-note">
                <Info size={15} aria-hidden="true" />
                <span>{PAYMENT_DISCLAIMER}</span>
              </div>
              <div className="rt-settings-note">
                <LockKeyhole size={15} aria-hidden="true" />
                <span>Optional, and private to you. It is stored in your own payment profile and never appears on your public profile.</span>
              </div>
              <UpiField />
            </Group>

            <Group
              id="rt-security"
              title="Security &amp; safety"
              description="Keep your emergency details ready and review your account protection."
            >
              <Row
                as="div"
                icon={<ShieldCheck size={17} />}
                title="Emergency contacts"
                description="Trusted contacts you can reach if a ride goes wrong. Private to your profile."
                action={<Link className="ds-button ds-button--subtle ds-button--sm" to="/safety">Manage</Link>}
              />
              <div className="rt-settings-note">
                <Info size={15} aria-hidden="true" />
                <span>The SOS control in Safety is an interface demo. It never calls, messages, or shares your location.</span>
              </div>
              <Row
                as="div"
                icon={<LockKeyhole size={17} />}
                title="Password and sign-in"
                description={`Signed in as ${activeUser?.email ?? "a guest account"}. Your sign-in email cannot be changed from this page.`}
                action={<RowValue tone={activeUser ? "success" : "warning"}>{activeUser ? "Active" : "Guest"}</RowValue>}
              />
            </Group>

            <Group
              id="rt-app"
              title="Install app"
              description="Add RideTogether to your home screen for quicker access."
            >
              <div className="rt-install-row">
                <div className="rt-install-copy">
                  <strong>{installState.isInstalled ? "RideTogether is installed" : "Install RideTogether"}</strong>
                  <span>{installMessage}</span>
                </div>
                {installState.canInstall ? (
                  <Button variant="subtle" type="button" onClick={() => void handleInstall()} loading={installing} loadingLabel="Installing">
                    {installing ? null : <Download size={15} aria-hidden="true" />}
                    Install
                  </Button>
                ) : null}
              </div>
            </Group>

            <Group
              id="rt-account"
              title="Account"
              description="RideTogether demo information and this device's storage."
            >
              <Row as="div" icon={<UserRound size={17} />} title="Signed in as" description={activeUser?.name ?? "Guest"} action={<RowValue>{activeUser?.email ?? "Not signed in"}</RowValue>} />
              <Row as="div" icon={<Smartphone size={17} />} title="Storage" description="Where your rides, bookings, messages and vehicles are kept." action={<RowValue tone={cloudConfigured ? "success" : "warning"}>{cloudConfigured ? "Cloud" : "Unavailable"}</RowValue>} />
              <Row as="div" icon={<Info size={17} />} title="Version" description="Responsive carpooling demo with real maps and trip data." action={<RowValue>{APP_VERSION}</RowValue>} />
              {hasLocalData ? (
                <div className="rt-reset-row">
                  <div className="rt-reset-copy">
                    <RotateCcw size={18} />
                    <span><strong>Clear local browser data</strong><span>Removes trip records an older version cached on this device. Nothing in your account is affected.</span></span>
                  </div>
                  <Button variant="danger-quiet" type="button" onClick={() => { setResetOpen(true); setResetMessage(null); }} disabled={resetting}>
                    <RotateCcw size={14} aria-hidden="true" />
                    Clear local data
                  </Button>
                </div>
              ) : (
                <div className="rt-settings-note">
                  <Info size={15} aria-hidden="true" />
                  <span>No leftover local trip data is stored on this device. Everything here loads fresh when you sign in.</span>
                </div>
              )}
            </Group>

            <Group
              id="rt-help"
              title="Help"
              description="Quick answers for using RideTogether."
            >
              <div className="rt-faq-list">
                <details className="rt-faq">
                  <summary>How do I find or offer a ride?<ChevronDown size={16} /></summary>
                  <p className="rt-faq-answer">Use Find Ride with your route, date, time, and seat count. To share a car, complete Offer Ride, select one of your vehicles, and publish the trip.</p>
                </details>
                <details className="rt-faq">
                  <summary>How do booking requests work?<ChevronDown size={16} /></summary>
                  <p className="rt-faq-answer">A rider�s request starts as pending. The driver can confirm or reject it from My Rides, and confirmed seat counts are reflected on the trip.</p>
                </details>
                <details className="rt-faq">
                  <summary>What does the SOS demo do?<ChevronDown size={16} /></summary>
                  <p className="rt-faq-answer">Nothing outside that page. It toggles a local demo state and never places a call, sends a message, shares location, or contacts anyone.</p>
                </details>
                <details className="rt-faq">
                  <summary>Where is my data stored?<ChevronDown size={16} /></summary>
                  <p className="rt-faq-answer">Your rides, bookings, messages, notifications, ratings, vehicles and safety contacts are stored in your RideTogether account and shared across every device you sign in on. Only the display preferences on this page stay in this browser.</p>
                </details>
              </div>
            </Group>
          </div>
        </div>
      </div>

      <Modal isOpen={resetOpen} onClose={() => !resetting && setResetOpen(false)} title="Clear local browser data?" size="sm">
        <div className="rt-reset-warning"><Info size={18} /><span>This clears the leftover demo records an older version of RideTogether kept in this browser before your data moved online.</span></div>
        <p className="rt-reset-modal-copy">It does not delete anything from your account. Your rides, bookings, messages, vehicles, ratings and safety contacts stay safe and are still shared across your devices. Your saved settings and appearance preference on this device will remain unchanged.</p>
        <div className="rt-reset-modal-actions">
          <Button variant="ghost" type="button" onClick={() => setResetOpen(false)} disabled={resetting}>Cancel</Button>
          <Button variant="danger" type="button" onClick={() => void handleReset()} loading={resetting} loadingLabel="Clearing">
            <RotateCcw size={14} aria-hidden="true" />
            Clear local data
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export default SettingsPage;
