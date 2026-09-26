import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Bell,
  CheckCircle2,
  ChevronDown,
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
  Sun,
} from "lucide-react";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { PushNotificationToggle } from "../components/PushNotificationToggle";
import { useApp } from "../context/AppContext";
import { hasLegacyLocalData } from "../services/database";
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
  color: var(--rt-text, #17231c);
  background: var(--rt-surface-subtle, #f6faf7);
}
.rt-settings-shell { max-width: 1100px; margin: 0 auto; }
.rt-settings-status {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  margin: 20px 0 18px;
  padding: 8px 11px;
  border: 1px solid #cae6d4;
  border-radius: 999px;
  color: #237544;
  background: #eff9f2;
  font-size: .73rem;
  font-weight: 700;
}
.rt-settings-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #22a35a; box-shadow: 0 0 0 4px rgba(34,163,90,.12); }
.rt-settings-layout { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 22px; align-items: start; }
.rt-settings-nav {
  position: sticky;
  top: 94px;
  padding: 12px;
  border: 1px solid var(--rt-border, #dce7df);
  border-radius: 18px;
  background: var(--rt-card, #fff);
  box-shadow: 0 8px 24px rgba(29, 64, 42, .045);
}
.rt-settings-nav-title { margin: 5px 8px 11px; color: #7b887f; font-size: .66rem; font-weight: 800; text-transform: uppercase; letter-spacing: .09em; }
.rt-settings-nav a {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 11px;
  border-radius: 10px;
  color: #5b6a61;
  text-decoration: none;
  font-size: .79rem;
  font-weight: 650;
}
.rt-settings-nav a:hover { color: #137c3d; background: #eff8f2; }
.rt-settings-nav a svg { color: #159447; }
.rt-settings-content { display: grid; gap: 18px; min-width: 0; }
.rt-settings-card {
  scroll-margin-top: 90px;
  border: 1px solid var(--rt-border, #dce7df);
  border-radius: 20px;
  background: var(--rt-card, #fff);
  box-shadow: 0 10px 30px rgba(29, 64, 42, .05);
  overflow: hidden;
}
.rt-settings-card-head { display: flex; align-items: flex-start; gap: 13px; padding: 20px 22px 17px; border-bottom: 1px solid #edf2ee; }
.rt-settings-card-icon { width: 39px; height: 39px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 12px; color: #137d3d; background: #e2f5e8; }
.rt-settings-card-head h2 { margin: 0; font-size: 1.04rem; letter-spacing: -.015em; }
.rt-settings-card-head p { margin: 5px 0 0; color: #6d7b73; font-size: .78rem; line-height: 1.45; }
.rt-settings-card-body { padding: 8px 22px 20px; }
.rt-settings-note { display: flex; align-items: flex-start; gap: 9px; margin: 0 0 8px; padding: 11px 12px; border-radius: 11px; color: #58685f; background: #f3f7f4; font-size: .74rem; line-height: 1.5; }
.rt-settings-note svg { flex: 0 0 auto; margin-top: 1px; color: #159447; }
.rt-setting-toggle {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 15px 0;
  border-bottom: 1px solid #edf2ee;
  cursor: pointer;
}
.rt-setting-toggle:last-child { border-bottom: 0; }
.rt-setting-toggle-icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 10px; color: #57675d; background: #f0f4f1; }
.rt-setting-toggle-copy strong { display: block; color: #304238; font-size: .83rem; }
.rt-setting-toggle-copy span { display: block; margin-top: 4px; color: #748178; font-size: .72rem; line-height: 1.4; }
.rt-switch { position: relative; width: 43px; height: 24px; flex: 0 0 auto; }
.rt-switch input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.rt-switch-track { position: absolute; inset: 0; border-radius: 999px; background: #cbd5ce; transition: background .2s ease, box-shadow .2s ease; }
.rt-switch-track::after { content: ""; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px; border-radius: 50%; background: #fff; box-shadow: 0 2px 5px rgba(20,40,28,.24); transition: transform .2s ease; }
.rt-switch input:checked + .rt-switch-track { background: #159447; }
.rt-switch input:checked + .rt-switch-track::after { transform: translateX(19px); }
.rt-switch input:focus-visible + .rt-switch-track { box-shadow: 0 0 0 3px rgba(21,148,71,.18); }
/* Wraps one toggle that carries its own status line (push, install). */
.rt-setting-toggle-group .rt-setting-toggle { cursor: default; }
.rt-setting-toggle-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -6px 0 14px 48px;
  color: #15823f;
  font-size: .72rem;
  line-height: 1.4;
}
.rt-setting-toggle-note--error { color: #bd3434; }
.rt-install-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 4px 0; flex-wrap: wrap; }
.rt-install-copy { min-width: 0; }
.rt-install-copy strong { display: block; color: #304238; font-size: .83rem; }
.rt-install-copy span { display: block; margin-top: 4px; color: #748178; font-size: .72rem; line-height: 1.45; }
[data-theme="dark"] .rt-install-copy strong { color: #eef7f1; }
[data-theme="dark"] .rt-install-copy span { color: #a6b5ac; }
[data-theme="dark"] .rt-setting-toggle-note { color: #8be0a6; }
[data-theme="dark"] .rt-setting-toggle-note--error { color: #ffb0b0; }
.rt-appearance-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding-top: 14px; }
.rt-appearance-option {
  position: relative;
  min-height: 116px;
  padding: 14px;
  border: 1px solid #d9e3db;
  border-radius: 15px;
  color: #3d4e44;
  background: #fff;
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
}
.rt-appearance-option:hover { transform: translateY(-1px); border-color: #a9d7b8; }
.rt-appearance-option-active { border-color: #159447; box-shadow: 0 0 0 2px rgba(21,148,71,.11); }
.rt-appearance-preview { height: 48px; display: flex; gap: 6px; padding: 7px; margin-bottom: 11px; border-radius: 9px; background: #edf5ef; }
.rt-appearance-option-dark .rt-appearance-preview { background: #172019; }
.rt-appearance-side { width: 24px; border-radius: 5px; background: #fff; border: 1px solid #d7e2d9; }
.rt-appearance-option-dark .rt-appearance-side { background: #202c23; border-color: #35433a; }
.rt-appearance-main { flex: 1; display: grid; gap: 5px; }
.rt-appearance-bar { height: 5px; border-radius: 99px; background: #d6e1d8; }
.rt-appearance-bar-green { width: 65%; background: #42aa69; }
.rt-appearance-bar-short { width: 48%; }
.rt-appearance-option-dark .rt-appearance-bar { background: #3b4a40; }
.rt-appearance-caption { display: flex; align-items: center; gap: 7px; font-size: .76rem; font-weight: 760; }
.rt-appearance-check { position: absolute; top: 10px; right: 10px; width: 19px; height: 19px; display: grid; place-items: center; border-radius: 50%; color: #fff; background: #159447; }
.rt-faq-list { display: grid; }
.rt-faq {
  border-bottom: 1px solid #edf2ee;
}
.rt-faq:last-child { border-bottom: 0; }
.rt-faq summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 0;
  color: #33463a;
  font-size: .82rem;
  font-weight: 730;
  cursor: pointer;
  list-style: none;
}
.rt-faq summary::-webkit-details-marker { display: none; }
.rt-faq summary svg { flex: 0 0 auto; color: #6e7c73; transition: transform .18s ease; }
.rt-faq[open] summary svg { transform: rotate(180deg); }
.rt-faq-answer { margin: -4px 0 17px; color: #69776e; font-size: .76rem; line-height: 1.6; }
.rt-help-guide { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }
.rt-help-step { padding: 14px; border-radius: 13px; background: #f3f7f4; }
.rt-help-step-number { width: 24px; height: 24px; display: grid; place-items: center; margin-bottom: 9px; border-radius: 8px; color: #fff; background: #159447; font-size: .67rem; font-weight: 800; }
.rt-help-step strong { display: block; font-size: .76rem; }
.rt-help-step span { display: block; margin-top: 4px; color: #738078; font-size: .69rem; line-height: 1.45; }
.rt-about-version { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 17px; }
.rt-about-item { padding: 14px; border-radius: 13px; background: #f4f7f5; }
.rt-about-item span { display: block; color: #7a877f; font-size: .66rem; text-transform: uppercase; letter-spacing: .05em; }
.rt-about-item strong { display: block; margin-top: 5px; font-size: .8rem; }
.rt-about-copy { margin: 0 0 16px; color: #68766d; font-size: .78rem; line-height: 1.6; }
.rt-reset-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 15px; border: 1px solid #f0cccc; border-radius: 14px; background: #fff7f7; }
.rt-reset-copy { display: flex; align-items: flex-start; gap: 10px; }
.rt-reset-copy svg { flex: 0 0 auto; color: #c54343; margin-top: 1px; }
.rt-reset-copy strong { display: block; color: #8e3333; font-size: .8rem; }
.rt-reset-copy span { display: block; margin-top: 4px; color: #8c6262; font-size: .7rem; line-height: 1.4; }
.rt-reset-button {
  min-height: 38px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  border: 1px solid #df9a9a;
  border-radius: 10px;
  color: #a53232;
  background: #fff;
  font: inherit;
  font-size: .75rem;
  font-weight: 760;
  cursor: pointer;
}
.rt-reset-button:hover { background: #fff0f0; }
.rt-reset-button:disabled { opacity: .58; cursor: not-allowed; }
.rt-settings-feedback { display: flex; align-items: center; gap: 8px; padding: 11px 13px; border: 1px solid #bce1c8; border-radius: 11px; color: #176f3a; background: #edf9f1; font-size: .76rem; }
.rt-settings-feedback-error { color: #9c3232; border-color: #efb7b7; background: #fff0f0; }
.rt-reset-warning { display: flex; align-items: flex-start; gap: 10px; padding: 13px; border: 1px solid #efbbbb; border-radius: 12px; color: #913131; background: #fff1f1; font-size: .78rem; line-height: 1.5; }
.rt-reset-warning svg { flex: 0 0 auto; }
.rt-reset-modal-copy { margin: 14px 0 0; color: #647169; font-size: .82rem; line-height: 1.55; }
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
.rt-settings-secondary { border: 1px solid #d5dfd8; color: #55635a; background: #fff; }
.rt-settings-danger { border: 0; color: #fff; background: #cf4343; }
.rt-settings-secondary:disabled, .rt-settings-danger:disabled { opacity: .58; cursor: not-allowed; }
[data-theme="dark"] .rt-settings-page { --rt-surface-subtle: #101712; --rt-card: #17211a; --rt-border: #2b3a30; --rt-text: #eef7f1; }
[data-theme="dark"] .rt-settings-nav a { color: #bdc9c1; }
[data-theme="dark"] .rt-settings-nav a:hover { color: #b8efc8; background: #1d2b21; }
[data-theme="dark"] .rt-settings-card-head, [data-theme="dark"] .rt-setting-toggle, [data-theme="dark"] .rt-faq { border-color: #2b3a30; }
[data-theme="dark"] .rt-settings-card-head p, [data-theme="dark"] .rt-setting-toggle-copy span, [data-theme="dark"] .rt-faq-answer, [data-theme="dark"] .rt-help-step span, [data-theme="dark"] .rt-about-copy { color: #a6b5ac; }
[data-theme="dark"] .rt-setting-toggle-copy strong, [data-theme="dark"] .rt-faq summary { color: #eef7f1; }
[data-theme="dark"] .rt-setting-toggle-icon, [data-theme="dark"] .rt-help-step, [data-theme="dark"] .rt-about-item, [data-theme="dark"] .rt-settings-note { background: #1c2820; }
[data-theme="dark"] .rt-appearance-option, [data-theme="dark"] .rt-settings-secondary { color: #eef7f1; background: #17211a; border-color: #34463a; }
[data-theme="dark"] .rt-appearance-preview { background: #29372d; }
[data-theme="dark"] .rt-appearance-side { background: #17211a; border-color: #405046; }
[data-theme="dark"] .rt-appearance-bar { background: #46564b; }
[data-theme="dark"] .rt-reset-row, [data-theme="dark"] .rt-reset-button { color: #f3b1b1; background: #291c1c; border-color: #654040; }
[data-theme="dark"] .rt-reset-copy strong { color: #ffc5c5; }
[data-theme="dark"] .rt-reset-copy span { color: #d7a7a7; }
@media (max-width: 820px) {
  .rt-settings-layout { grid-template-columns: 1fr; }
  .rt-settings-nav { position: static; display: flex; align-items: center; gap: 4px; overflow-x: auto; }
  .rt-settings-nav-title { display: none; }
  .rt-settings-nav a { flex: 0 0 auto; }
}
@media (max-width: 620px) {
  .rt-settings-page { padding: 18px 14px 44px; }
  .rt-settings-card-head, .rt-settings-card-body { padding-left: 17px; padding-right: 17px; }
  .rt-appearance-grid, .rt-help-guide, .rt-about-version { grid-template-columns: 1fr; }
  .rt-appearance-option { min-height: 96px; }
  .rt-reset-row { align-items: stretch; flex-direction: column; }
  .rt-reset-button { width: 100%; }
  .rt-reset-modal-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
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

  /**
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
          title="Settings"
          subtitle="Control notification, appearance, and privacy preferences stored in this browser."
        />
        <div className="rt-settings-status"><span className="rt-settings-status-dot" /> Preferences save automatically on this device</div>

        <div className="rt-settings-layout">
          <nav className="rt-settings-nav" aria-label="Settings sections">
            <span className="rt-settings-nav-title">On this page</span>
            <a href="#rt-notifications"><Bell size={15} /> Notifications</a>
            <a href="#rt-appearance"><Palette size={15} /> Appearance</a>
            <a href="#rt-privacy"><LockKeyhole size={15} /> Privacy</a>
            <a href="#rt-app"><Download size={15} /> Install</a>
            <a href="#rt-help"><HelpCircle size={15} /> Help</a>
            <a href="#rt-about"><Info size={15} /> About</a>
          </nav>

          <div className="rt-settings-content">
            {resetMessage && (
              <div className={`rt-settings-feedback${resetMessage.type === "error" ? " rt-settings-feedback-error" : ""}`} role="status">
                {resetMessage.type === "success" ? <CheckCircle2 size={16} /> : <Info size={16} />}
                {resetMessage.text}
              </div>
            )}

            <section className="rt-settings-card" id="rt-notifications">
              <div className="rt-settings-card-head">
                <span className="rt-settings-card-icon"><Bell size={20} /></span>
                <div><h2>Notifications</h2><p>Choose which notification channels you want enabled.</p></div>
              </div>
              <div className="rt-settings-card-body">
                <p className="rt-settings-note"><Info size={15} /> In-app and push updates are delivered for real. The email option is remembered for a future mailing list and sends nothing today.</p>
                <SettingToggle id="rt-email-notifications" icon={<Mail size={17} />} title="Email updates" description="Save your preference for ride and booking summaries by email." checked={preferences.notifications.email} onChange={(value) => updateNotification("email", value)} />
                <PushNotificationToggle
                  checked={preferences.notifications.push}
                  onChange={(value) => updateNotification("push", value)}
                />
                <SettingToggle id="rt-in-app-notifications" icon={<MessageSquareText size={17} />} title="In-app updates" description="Keep important ride activity visible in the notifications center." checked={preferences.notifications.inApp} onChange={(value) => updateNotification("inApp", value)} />
              </div>
            </section>

            <section className="rt-settings-card" id="rt-appearance">
              <div className="rt-settings-card-head">
                <span className="rt-settings-card-icon"><Palette size={20} /></span>
                <div><h2>Appearance</h2><p>Apply a theme immediately and keep it for your next visit.</p></div>
              </div>
              <div className="rt-settings-card-body">
                <div className="rt-appearance-grid" role="group" aria-label="Color theme">
                  {appearanceOptions.map((option) => (
                    <button
                      className={`rt-appearance-option${option.className}${preferences.appearance === option.value ? " rt-appearance-option-active" : ""}`}
                      type="button"
                      key={option.value}
                      onClick={() => setAppearance(option.value)}
                      aria-pressed={preferences.appearance === option.value}
                    >
                      {preferences.appearance === option.value && <span className="rt-appearance-check">✓</span>}
                      <span className="rt-appearance-preview" aria-hidden="true">
                        <span className="rt-appearance-side" />
                        <span className="rt-appearance-main"><span className="rt-appearance-bar rt-appearance-bar-green" /><span className="rt-appearance-bar" /><span className="rt-appearance-bar rt-appearance-bar-short" /></span>
                      </span>
                      <span className="rt-appearance-caption">{option.icon}{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="rt-settings-card" id="rt-privacy">
              <div className="rt-settings-card-head">
                <span className="rt-settings-card-icon"><ShieldCheck size={20} /></span>
                <div><h2>Privacy</h2><p>Choose what ride information you prefer to share with co-riders.</p></div>
              </div>
              <div className="rt-settings-card-body">
                <SettingToggle id="rt-show-profile" icon={<Laptop size={17} />} title="Show profile to co-riders" description="Allow people in your rides to see your basic profile and contact details." checked={preferences.privacy.showProfile} onChange={(value) => updatePrivacy("showProfile", value)} />
                <SettingToggle id="rt-share-trip-details" icon={<ExternalLink size={17} />} title="Share trip details" description="Save your preference to share pickup, destination, and timing with confirmed co-riders." checked={preferences.privacy.shareTripDetails} onChange={(value) => updatePrivacy("shareTripDetails", value)} />
              </div>
            </section>

            <section className="rt-settings-card" id="rt-app">
              <div className="rt-settings-card-head">
                <span className="rt-settings-card-icon"><Download size={20} /></span>
                <div><h2>Install app</h2><p>Add RideTogether to your home screen for quicker access and an offline fallback page.</p></div>
              </div>
              <div className="rt-settings-card-body">
                <div className="rt-install-row">
                  <div className="rt-install-copy">
                    <strong>{installState.isInstalled ? "RideTogether is installed" : "Install RideTogether"}</strong>
                    <span>{installMessage}</span>
                  </div>
                  {installState.canInstall ? (
                    <button
                      className="rt-settings-secondary"
                      type="button"
                      onClick={() => void handleInstall()}
                      disabled={installing}
                    >
                      {installing ? "Installing…" : "Install"}
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="rt-settings-card" id="rt-help">
              <div className="rt-settings-card-head">
                <span className="rt-settings-card-icon"><HelpCircle size={20} /></span>
                <div><h2>Help</h2><p>Quick answers for using this local RideTogether demo.</p></div>
              </div>
              <div className="rt-settings-card-body">
                <div className="rt-faq-list">
                  <details className="rt-faq">
                    <summary>How do I find or offer a ride?<ChevronDown size={16} /></summary>
                    <p className="rt-faq-answer">Use Find Ride with your route, date, time, and seat count. To share a car, complete Offer Ride, select one of your vehicles, and publish the trip.</p>
                  </details>
                  <details className="rt-faq">
                    <summary>How do booking requests work?<ChevronDown size={16} /></summary>
                    <p className="rt-faq-answer">A rider’s request starts as pending. The driver can confirm or reject it from My Rides, and confirmed seat counts are reflected on the trip.</p>
                  </details>
                  <details className="rt-faq">
                    <summary>What does the SOS demo do?<ChevronDown size={16} /></summary>
                    <p className="rt-faq-answer">Nothing outside this page. It toggles a local demo state and never places a call, sends a message, shares location, or contacts emergency services or saved contacts.</p>
                  </details>
                  <details className="rt-faq">
                    <summary>Where is my data stored?<ChevronDown size={16} /></summary>
                    <p className="rt-faq-answer">Your rides, bookings, messages, notifications, ratings, vehicles and safety contacts are stored in your RideTogether account and are shared across every device you sign in on. Only your display preferences on this page are kept in this browser.</p>
                  </details>
                </div>
                <div className="rt-help-guide">
                  <div className="rt-help-step"><span className="rt-help-step-number">1</span><strong>Ride issue?</strong><span>Open the trip chat and contact the driver or rider there.</span></div>
                  <div className="rt-help-step"><span className="rt-help-step-number">2</span><strong>Vehicle issue?</strong><span>Review the Vehicles page before the next departure.</span></div>
                  <div className="rt-help-step"><span className="rt-help-step-number">3</span><strong>Safety concern?</strong><span>Review Safety guidance and use your phone in a real emergency.</span></div>
                </div>
              </div>
            </section>

            <section className="rt-settings-card" id="rt-about">
              <div className="rt-settings-card-head">
                <span className="rt-settings-card-icon"><Info size={20} /></span>
                <div><h2>About</h2><p>RideTogether demo information and account details.</p></div>
              </div>
              <div className="rt-settings-card-body">
                <div className="rt-about-version">
                  <div className="rt-about-item"><span>Version</span><strong>{APP_VERSION}</strong></div>
                  <div className="rt-about-item"><span>Storage</span><strong>{cloudConfigured ? "Cloud" : "Unavailable"}</strong></div>
                  <div className="rt-about-item"><span>Accounts</span><strong>{activeUser ? "Signed in" : "Guest"}</strong></div>
                </div>
                <p className="rt-about-copy">RideTogether is a responsive carpooling demonstration with real maps and trip data that syncs across your devices. It is not a live transportation or emergency service.</p>
                {hasLocalData ? (
                  <div className="rt-reset-row">
                    <div className="rt-reset-copy">
                      <RotateCcw size={18} />
                      <span><strong>Clear local browser data</strong><span>Removes trip records an older version of RideTogether cached on this device. Nothing in your account is affected.</span></span>
                    </div>
                    <button className="rt-reset-button" type="button" onClick={() => { setResetOpen(true); setResetMessage(null); }} disabled={resetting}><RotateCcw size={14} /> Clear local data</button>
                  </div>
                ) : (
                  <p className="rt-reset-modal-copy">No leftover local trip data is stored on this device. Everything you see here is loaded fresh when you sign in.</p>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      <Modal isOpen={resetOpen} onClose={() => !resetting && setResetOpen(false)} title="Clear local browser data?" size="sm">
        <div className="rt-reset-warning"><Info size={18} /><span>This clears the leftover demo records an older version of RideTogether kept in this browser before your data moved online.</span></div>
        <p className="rt-reset-modal-copy">It does not delete anything from your account. Your rides, bookings, messages, vehicles, ratings and safety contacts stay safe and are still shared across your devices. Your saved settings and appearance preference on this device will remain unchanged.</p>
        <div className="rt-reset-modal-actions">
          <button className="rt-settings-secondary" type="button" onClick={() => setResetOpen(false)} disabled={resetting}>Cancel</button>
          <button className="rt-settings-danger" type="button" onClick={() => void handleReset()} disabled={resetting}><RotateCcw size={14} /> {resetting ? "Clearing…" : "Clear local data"}</button>
        </div>
      </Modal>
    </div>
  );
}

export default SettingsPage;
