import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CarFront,
  CheckCircle2,
  Lock,
  Mail,
  MapPinned,
  Phone,
  Route,
  Save,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
} from "lucide-react";
import { DraftBanner } from "../components/DraftBanner";
import { AppLoadingScreen } from "../components/LoadingScreen";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { Group, Metric, Row } from "../components/ui/Group";
import { UpiField } from "../components/ui/UpiField";
import { Stars } from "../components/Stars";
import { useApp } from "../context/AppContext";
import { useDraft } from "../services/drafts";
import { AVATAR_MAX_BYTES } from "../repositories/avatarRepository";

interface ProfileForm {
  name: string;
  email: string;
  phone: string;
  avatar: string;
  role: string;
  bio: string;
}

type ProfileErrors = Partial<Record<keyof ProfileForm, string>>;

const emptyProfile: ProfileForm = {
  name: "",
  email: "",
  phone: "",
  avatar: "",
  role: "Driver & rider",
  bio: "",
};

/**
 * Profile is built from the shared `Group` / `Row` vocabulary so it reads like
 * the rest of the product. The only page-specific CSS here is the header block
 * and the two-column split - everything else is a shared primitive.
 */
const profileStyles = `
.rt-profile-page {
  min-height: 100%;
  background: var(--rt-surface-subtle);
  color: var(--rt-text);
  padding: 26px 20px calc(56px + var(--rt-safe-bottom));
}
.rt-profile-shell { max-width: 1120px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px; }

/* ---- header ---- */
.rt-profile-hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 26px;
  align-items: center;
  padding: 26px;
  border: 1px solid var(--rt-border);
  border-radius: var(--rt-radius-card);
  background: var(--rt-card);
  box-shadow: var(--rt-shadow-md);
  overflow: hidden;
}
/* A single brand wash in the corner, so the header is recognisable without
   spending an image request or a second surface colour on it. */
.rt-profile-hero::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: linear-gradient(90deg, var(--rt-primary), var(--rt-accent));
}
.rt-profile-identity { display: flex; align-items: center; gap: 19px; min-width: 0; }
.rt-profile-avatar-wrap { position: relative; flex: 0 0 auto; }
.rt-profile-avatar {
  width: 92px;
  height: 92px;
  border-radius: 26px;
  object-fit: cover;
  border: 1px solid var(--rt-border);
  background: var(--rt-surface-muted);
}
.rt-profile-avatar-fallback {
  display: grid;
  place-items: center;
  color: var(--rt-primary-strong);
  background: var(--rt-primary-soft);
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.rt-profile-online {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--rt-primary);
  border: 3px solid var(--rt-card);
}
.rt-profile-copy { min-width: 0; display: flex; flex-direction: column; gap: 9px; }
.rt-profile-name-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rt-profile-name { margin: 0; color: var(--rt-text-strong); font-size: 1.72rem; font-weight: 800; letter-spacing: -0.035em; line-height: 1.15; }
.rt-profile-role {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 999px;
  color: var(--rt-primary-strong);
  background: var(--rt-primary-soft);
  font-size: 0.72rem;
  font-weight: 750;
}
.rt-profile-bio { margin: 0; color: var(--rt-muted); font-size: 0.86rem; line-height: 1.55; max-width: 52ch; }
.rt-profile-contact-list { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rt-profile-contact {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid var(--rt-border);
  background: var(--rt-surface-subtle);
  color: var(--rt-muted);
  font-size: 0.75rem;
  font-weight: 600;
  text-decoration: none;
  transition: border-color var(--rt-dur-base) var(--rt-ease), color var(--rt-dur-base) var(--rt-ease);
}
a.rt-profile-contact:hover { border-color: var(--rt-primary); color: var(--rt-primary-strong); }
.rt-profile-contact svg { flex: 0 0 auto; color: var(--rt-primary-strong); }
.rt-profile-contact span { overflow-wrap: anywhere; }

.rt-profile-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; width: 300px; flex: 0 0 auto; }
.rt-profile-metric-rating { display: flex; align-items: center; gap: 6px; }
.rt-profile-metric-rating .ds-metric__value { display: flex; align-items: center; gap: 6px; }

/* ---- body ---- */
.rt-profile-grid { display: grid; grid-template-columns: minmax(0, 1.62fr) minmax(0, 1fr); gap: 22px; align-items: start; }
.rt-profile-column { display: flex; flex-direction: column; gap: 22px; min-width: 0; }

.rt-profile-form { display: flex; flex-direction: column; gap: 16px; padding: 18px; }
.rt-profile-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px; }
.rt-profile-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.rt-profile-field-full { grid-column: 1 / -1; }
.rt-profile-label { display: flex; align-items: center; gap: 6px; color: var(--rt-text); font-size: 0.78rem; font-weight: 700; }
.rt-profile-label span { color: var(--rt-muted); font-weight: 500; }
.rt-profile-input, .rt-profile-select, .rt-profile-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--rt-border-strong);
  border-radius: var(--rt-radius-sm);
  background: var(--rt-surface);
  color: var(--rt-text);
  font: inherit;
  font-size: 0.875rem;
  transition: border-color var(--rt-dur-base) var(--rt-ease), box-shadow var(--rt-dur-base) var(--rt-ease);
}
.rt-profile-textarea { min-height: 92px; resize: vertical; line-height: 1.55; }
.rt-profile-input:focus-visible, .rt-profile-select:focus-visible, .rt-profile-textarea:focus-visible {
  outline: none;
  border-color: var(--rt-primary-strong);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rt-primary) 20%, transparent);
}
.rt-profile-input[aria-invalid="true"], .rt-profile-select[aria-invalid="true"], .rt-profile-textarea[aria-invalid="true"] { border-color: var(--rt-danger); }
.rt-profile-input:disabled, .rt-profile-select:disabled { background: var(--rt-surface-subtle); color: var(--rt-muted); cursor: not-allowed; }
.rt-profile-error { display: inline-flex; align-items: center; gap: 5px; color: var(--rt-danger); font-size: 0.74rem; font-weight: 620; }
.rt-profile-hint { display: flex; align-items: center; color: var(--rt-muted); font-size: 0.73rem; line-height: 1.45; }
.rt-profile-character-count { justify-content: flex-end; color: var(--rt-muted); font-size: 0.72rem; }
.rt-profile-subfield { display: flex; flex-direction: column; gap: 6px; margin-top: 11px; padding-top: 12px; border-top: 1px dashed var(--rt-border); }

/* ---- photo ---- */
.rt-profile-avatar-field { display: flex; align-items: flex-start; gap: 14px; }
.rt-profile-avatar-preview {
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  border-radius: 18px;
  object-fit: cover;
  border: 1px solid var(--rt-border);
  background: var(--rt-surface-muted);
}
.rt-profile-avatar-fallback-small { display: grid; place-items: center; color: var(--rt-primary-strong); background: var(--rt-primary-soft); font-size: 21px; font-weight: 800; }
.rt-profile-avatar-controls { display: flex; flex-direction: column; gap: 7px; min-width: 0; flex: 1 1 auto; }
.rt-profile-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.rt-profile-file-label { display: inline-flex; cursor: pointer; }
.rt-profile-file-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 14px;
  border-radius: 999px;
  border: 1px solid var(--rt-primary-border, var(--rt-border-strong));
  color: var(--rt-primary-strong);
  background: var(--rt-primary-soft);
  font-size: 0.8rem;
  font-weight: 700;
  transition: border-color var(--rt-dur-base) var(--rt-ease), transform var(--rt-dur-base) var(--rt-ease);
}
.rt-profile-file-label:hover .rt-profile-file-button { border-color: var(--rt-primary); }
.rt-profile-file-button:active { transform: translateY(1px); }
.rt-profile-file:focus-visible + .rt-profile-file-button { outline: 2px solid var(--rt-primary-strong); outline-offset: 3px; }
.rt-profile-file:disabled + .rt-profile-file-button { opacity: .6; cursor: progress; }

/* ---- actions ---- */
.rt-profile-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-top: 4px; border-top: 1px solid var(--rt-border); }
.rt-profile-feedback { display: inline-flex; align-items: center; gap: 6px; margin: 0; color: var(--rt-primary-strong); font-size: 0.8rem; font-weight: 650; }
.rt-profile-feedback-error { color: var(--rt-danger); }

/* ---- linked destinations ---- */
.rt-profile-link { display: flex; align-items: center; gap: 13px; padding: 15px 17px; text-decoration: none; color: inherit; border-bottom: 1px solid var(--rt-border); transition: background var(--rt-dur-base) var(--rt-ease); }
.rt-profile-link:last-child { border-bottom: 0; }
.rt-profile-link:hover { background: var(--rt-surface-subtle); }
.rt-profile-link-icon { display: grid; place-items: center; flex: 0 0 auto; width: 36px; height: 36px; border-radius: 12px; color: var(--rt-primary-strong); background: var(--rt-primary-soft); }
.rt-profile-link-copy { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
.rt-profile-link-title { color: var(--rt-text); font-size: 0.875rem; font-weight: 700; }
.rt-profile-link-meta { color: var(--rt-muted); font-size: 0.76rem; line-height: 1.45; }
.rt-profile-link-count { flex: 0 0 auto; color: var(--rt-muted); font-size: 0.78rem; font-weight: 700; }
.rt-profile-link-arrow { flex: 0 0 auto; color: var(--rt-muted); }

.rt-profile-vehicle-list { display: flex; flex-direction: column; gap: 7px; padding: 0 17px 15px; }
.rt-profile-vehicle { display: flex; align-items: center; gap: 10px; padding: 10px 11px; border-radius: 13px; background: var(--rt-surface-subtle); border: 1px solid var(--rt-border); }
.rt-profile-vehicle-icon { display: grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px; border-radius: 11px; color: var(--rt-text); background: var(--rt-surface-muted); }
.rt-profile-vehicle-copy { min-width: 0; flex: 1 1 auto; }
.rt-profile-vehicle-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.82rem; font-weight: 720; }
.rt-profile-vehicle-meta { display: block; margin-top: 2px; color: var(--rt-muted); font-size: 0.72rem; }
.rt-profile-default { margin-left: auto; flex: 0 0 auto; padding: 3px 8px; border-radius: 999px; color: var(--rt-primary-strong); background: var(--rt-primary-soft); font-size: 0.62rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }

@media (max-width: 980px) {
  .rt-profile-grid { grid-template-columns: 1fr; }
  .rt-profile-hero { grid-template-columns: 1fr; gap: 20px; align-items: start; }
  .rt-profile-metrics { width: 100%; grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  .rt-profile-form-grid { grid-template-columns: 1fr; }
}
@media (max-width: 620px) {
  .rt-profile-page { padding: 18px 14px calc(44px + var(--rt-safe-bottom)); }
  .rt-profile-hero { padding: 19px; border-radius: 20px; }
  .rt-profile-identity { align-items: flex-start; gap: 15px; }
  .rt-profile-avatar { width: 72px; height: 72px; border-radius: 21px; }
  .rt-profile-avatar-fallback { font-size: 24px; }
  .rt-profile-online { width: 19px; height: 19px; }
  .rt-profile-name { font-size: 1.4rem; }
  .rt-profile-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rt-profile-form { padding: 15px; }
  .rt-profile-avatar-field { flex-direction: column; }
  .rt-profile-actions { flex-direction: column; align-items: stretch; }
  .rt-profile-actions .ds-button { width: 100%; }
  .rt-profile-feedback { justify-content: center; }
}
`;

export function ProfilePage() {
  const {
    activeUser,
    activeUserId,
    vehicles,
    rides,
    bookings,
    ratings,
    safetyContacts,
    saveProfile,
    uploadAvatar,
    deleteAvatar,
  } = useApp();
  /**
   * The edit form is draft-backed, and hydration is keyed on the user id rather
   * than the `activeUser` object. `activeUser` is rebuilt on every snapshot
   * refresh (any realtime event, any mutation anywhere), so depending on it
   * meant unrelated activity silently wiped whatever the user was typing.
   */
  const emptyProfileDraft = useMemo<ProfileForm>(
    () => ({ ...emptyProfile, email: activeUser?.email ?? "", name: activeUser?.name ?? "" }),
    [activeUser?.email, activeUser?.name],
  );
  // Declared before useDraft because the draft's `merge` runs during the first
  // render, inside the state initialiser.
  const emptyProfileDraftRef = useRef(emptyProfileDraft);
  emptyProfileDraftRef.current = emptyProfileDraft;
  const profileDraft = useDraft<ProfileForm>("profile", emptyProfileDraft, activeUserId, {
    merge: (draft) => ({ ...emptyProfileDraftRef.current, ...draft }),
  });
  const { value: form, setValue: setForm } = profileDraft;
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Uploads the chosen photo and drops the returned URL into the form.
   *
   * The file is not submitted with the rest of the form: the upload has to
   * finish first so the member sees a real image and a real error, instead of a
   * "Save changes" that silently stores a broken link.
   */
  const handleAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset immediately so re-picking the same file still fires a change event.
    event.target.value = "";
    if (!file) return;

    setUploadingAvatar(true);
    setAvatarError("");
    try {
      const previous = form.avatar.trim();
      const url = await uploadAvatar(file);
      updateField("avatar", url);
      setErrors((current) => ({ ...current, avatar: undefined }));
      if (previous.startsWith("/storage/")) void deleteAvatar(previous);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "We could not upload that photo.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  /**
   * Adopt the server profile into an untouched form, once per user.
   *
   * The previous version depended on the `activeUser` object, which is rebuilt
   * on every snapshot refresh, so a realtime event or an unrelated mutation
   * reset the form and destroyed unsaved edits. Keying on the id and skipping
   * while there is unsaved input fixes that; a restored draft is merged over
   * the server values so cloud data still fills any field the draft left blank.
   */
  const hydratedUserRef = useRef("");
  useEffect(() => {
    if (!activeUser || !activeUserId) return;
    if (hydratedUserRef.current === activeUserId) return;
    hydratedUserRef.current = activeUserId;
    setForm((current) => {
      const fromServer: ProfileForm = {
        name: activeUser.name,
        email: activeUser.email,
        phone: activeUser.phone,
        avatar: activeUser.avatar,
        role: activeUser.role,
        bio: activeUser.bio,
      };
      const pristine = !current.name && !current.phone && !current.bio && !current.avatar;
      return pristine || profileDraft.restored ? { ...fromServer, ...current } : current;
    });
    setErrors({});
    setMessage(null);
  }, [activeUser, activeUserId, setForm, profileDraft.restored]);

  const ownedVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.userId === activeUserId),
    [activeUserId, vehicles],
  );

  const ownedContacts = useMemo(
    () => safetyContacts.filter((contact) => contact.userId === activeUserId),
    [activeUserId, safetyContacts],
  );

  const tripCount = useMemo(() => {
    if (!activeUserId) return activeUser?.tripCount ?? 0;
    const tripIds = new Set<string>();
    rides.forEach((ride) => {
      if (ride.driverId === activeUserId && ride.status !== "cancelled") tripIds.add(ride.id);
    });
    bookings.forEach((booking) => {
      if (
        booking.riderId === activeUserId
        && (booking.status === "confirmed" || booking.status === "completed")
      ) {
        tripIds.add(booking.rideId);
      }
    });
    return Math.max(activeUser?.tripCount ?? 0, tripIds.size);
  }, [activeUser?.tripCount, activeUserId, bookings, rides]);

  const rating = useMemo(() => {
    const received = ratings.filter((item) => item.revieweeId === activeUserId);
    if (!received.length) return activeUser?.rating ?? 0;
    return received.reduce((sum, item) => sum + item.stars, 0) / received.length;
  }, [activeUser?.rating, activeUserId, ratings]);

  if (!activeUser) {
    return (
      <div className="rt-profile-page">
        <AppLoadingScreen label="Loading your profile" />
      </div>
    );
  }

  const initials = activeUser.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "RT";

  const previewInitials = (form.name || activeUser.name)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "RT";

  const updateField = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setMessage(null);
  };

  const validate = () => {
    const next: ProfileErrors = {};
    if (form.name.trim().length < 2) next.name = "Enter at least 2 characters.";
    const phone = form.phone.trim();
    if (!/^[+\d\s().-]+$/.test(phone) || phone.replace(/\D/g, "").length < 7) next.phone = "Enter a valid phone number.";
    if (form.avatar && !/^https?:\/\//i.test(form.avatar.trim())) next.avatar = "Use a full http or https image URL.";
    if (!form.role.trim()) next.role = "Choose a role.";
    if (form.bio.length > 240) next.bio = "Keep your bio to 240 characters or fewer.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setMessage(null);
    try {
      await saveProfile(activeUserId, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        avatar: form.avatar.trim(),
        role: form.role.trim(),
        bio: form.bio.trim(),
      });
      setMessage({ type: "success", text: "Profile saved" });
      // Saved to Supabase: the draft has nothing left to protect.
      profileDraft.complete();
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to save your profile.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rt-profile-page">

      <style>{profileStyles}</style>
      <div className="rt-profile-shell">
        <PageHeader
          eyebrow="Account"
          title="Your profile"
          description="Keep your ride details current so drivers and riders know who they are traveling with."
        />

        <section className="rt-profile-hero" aria-label="Profile overview">
          <div className="rt-profile-identity">
            <div className="rt-profile-avatar-wrap">
              {activeUser.avatar ? (
                <img className="rt-profile-avatar" src={activeUser.avatar} alt={`${activeUser.name} profile`} />
              ) : (
                <div className="rt-profile-avatar rt-profile-avatar-fallback" aria-label={activeUser.name}>
                  {initials}
                </div>
              )}
              <span className="rt-profile-online" aria-label="Demo profile active" />
            </div>
            <div className="rt-profile-copy">
              <div className="rt-profile-name-row">
                <h2 className="rt-profile-name">{activeUser.name}</h2>
                <span className="rt-profile-role"><UserRound size={13} /> {activeUser.role}</span>
              </div>
              <p className="rt-profile-bio">
                {activeUser.bio || "Add a short introduction to help fellow riders get to know you."}
              </p>
              <div className="rt-profile-contact-list">
                <a className="rt-profile-contact" href={`mailto:${activeUser.email}`}>
                  <Mail size={15} aria-hidden="true" />
                  <span>{activeUser.email}</span>
                </a>
                <a className="rt-profile-contact" href={`tel:${activeUser.phone.replace(/\s/g, "")}`}>
                  <Phone size={15} aria-hidden="true" />
                  <span>{activeUser.phone}</span>
                </a>
                <span className="rt-profile-contact">
                  <MapPinned size={15} aria-hidden="true" />
                  <span>Member since {new Date(activeUser.joinedAt).getFullYear()}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="rt-profile-metrics">
            <Metric
              icon={<Star size={16} />}
              label="Community rating"
              value={
                <span className="rt-profile-metric-rating">
                  {rating.toFixed(1)}
                  <Stars value={rating} size="small" />
                </span>
              }
            />
            <Metric icon={<Route size={16} />} label="Trips taken or offered" value={tripCount} />
            <Metric icon={<CarFront size={16} />} label="Saved vehicles" value={ownedVehicles.length} />
            <Metric icon={<ShieldCheck size={16} />} label="Safety contacts" value={ownedContacts.length} />
          </div>
        </section>

        <div className="rt-profile-grid">
          <div className="rt-profile-column">
            <Group
              id="profile-details"
              title="Your details"
              description="What other members see when you request a seat or offer a ride."
            >
              {profileDraft.restored ? (
                <DraftBanner
                  savedAt={profileDraft.savedAt}
                  workflow="profile edit"
                  onDiscard={profileDraft.discard}
                  onDismiss={profileDraft.dismissBanner}
                />
              ) : null}
              <form className="rt-profile-form" onSubmit={handleSubmit} noValidate>
                <div className="rt-profile-form-grid">
                  <label className="rt-profile-field">
                    <span className="rt-profile-label">Full name</span>
                    <input
                      className="rt-profile-input"
                      value={form.name}
                      onChange={(event) => updateField("name", event.target.value)}
                      autoComplete="name"
                      aria-invalid={Boolean(errors.name)}
                    />
                    {errors.name && <span className="rt-profile-error"><AlertCircle size={12} />{errors.name}</span>}
                  </label>

                  <label className="rt-profile-field">
                    <span className="rt-profile-label">RideTogether role</span>
                    <select
                      className="rt-profile-select"
                      value={form.role}
                      onChange={(event) => updateField("role", event.target.value)}
                      aria-invalid={Boolean(errors.role)}
                    >
                      <option value="Driver & rider">Driver &amp; Rider</option>
                      <option value="Driver">Driver</option>
                      <option value="Rider">Rider</option>
                    </select>
                    {errors.role && <span className="rt-profile-error"><AlertCircle size={12} />{errors.role}</span>}
                  </label>

                  <label className="rt-profile-field">
                    <span className="rt-profile-label">Phone number</span>
                    <input
                      className="rt-profile-input"
                      data-testid="profile-phone"
                      type="tel"
                      value={form.phone}
                      onChange={(event) => updateField("phone", event.target.value)}
                      autoComplete="tel"
                      aria-invalid={Boolean(errors.phone)}
                    />
                    {errors.phone && <span className="rt-profile-error"><AlertCircle size={12} />{errors.phone}</span>}
                  </label>

                  <div className="rt-profile-field">
                    <span className="rt-profile-label">Email address</span>
                    <input
                      className="rt-profile-input"
                      type="email"
                      value={form.email}
                      readOnly
                      disabled
                      autoComplete="email"
                    />
                    <span className="rt-profile-hint">
                      <Lock size={12} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 4 }} />
                      Your sign-in email cannot be changed here.
                    </span>
                  </div>

                  <div className="rt-profile-field rt-profile-field-full">
                    <span className="rt-profile-label">Profile photo <span>(optional)</span></span>
                    <div className="rt-profile-avatar-field">
                      {form.avatar ? (
                        <img className="rt-profile-avatar-preview" src={form.avatar} alt="Profile preview" />
                      ) : (
                        <span className="rt-profile-avatar-preview rt-profile-avatar-fallback-small">{previewInitials}</span>
                      )}
                      <div className="rt-profile-avatar-controls">
                        <label className="rt-profile-file-label">
                          <input
                            ref={fileInputRef}
                            className="rt-profile-file"
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            onChange={(event) => void handleAvatarFile(event)}
                            disabled={uploadingAvatar}
                            aria-label="Choose a photo to upload"
                          />
                          <span className="rt-profile-file-button">
                            <Sparkles size={15} aria-hidden="true" />
                            {uploadingAvatar ? "Uploading�" : "Upload a photo"}
                          </span>
                        </label>
                        <p className="rt-profile-hint">
                          JPG, PNG, WebP or GIF up to {Math.round(AVATAR_MAX_BYTES / (1024 * 1024))} MB, stored on your account.
                        </p>
                        {avatarError && <span className="rt-profile-error"><AlertCircle size={12} />{avatarError}</span>}
                        <label className="rt-profile-subfield">
                          <span className="rt-profile-label">Or paste an image link</span>
                          <input
                            className="rt-profile-input"
                            type="url"
                            value={form.avatar}
                            onChange={(event) => updateField("avatar", event.target.value)}
                            placeholder="https://example.com/photo.jpg"
                            aria-invalid={Boolean(errors.avatar)}
                          />
                          {errors.avatar && <span className="rt-profile-error"><AlertCircle size={12} />{errors.avatar}</span>}
                        </label>
                      </div>
                    </div>
                  </div>

                  <label className="rt-profile-field rt-profile-field-full">
                    <span className="rt-profile-label">About <span>(optional)</span></span>
                    <textarea
                      className="rt-profile-textarea"
                      value={form.bio}
                      onChange={(event) => updateField("bio", event.target.value)}
                      maxLength={240}
                      placeholder="Share your commuting habits or a friendly hello."
                      aria-invalid={Boolean(errors.bio)}
                    />
                    <span className="rt-profile-character-count"><span>{form.bio.length}/240</span></span>
                    {errors.bio && <span className="rt-profile-error"><AlertCircle size={12} />{errors.bio}</span>}
                  </label>
                </div>

                <div className="rt-profile-actions">
                  {message ? (
                    <p
                      className={`rt-profile-feedback${message.type === "error" ? " rt-profile-feedback-error" : ""}`}
                      role="status"
                      data-testid={message.type === "error" ? "profile-error" : "profile-success"}
                    >
                      {message.type === "success" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                      {message.text}
                    </p>
                  ) : <span />}
                  <Button type="submit" data-testid="profile-save" loading={saving} loadingLabel="Saving">
                    <Save size={16} aria-hidden="true" />
                    Save changes
                  </Button>
                </div>
              </form>
            </Group>

            <Group
              id="profile-payments"
              title="Payments"
              description="Settlement details for when real payouts are enabled."
            >
              <UpiField />
            </Group>
          </div>

          <div className="rt-profile-column">
            <Group
              id="profile-linked"
              title="Your RideTogether"
              description="The other places your account details live."
            >
              <Link className="rt-profile-link" to="/vehicles">
                <span className="rt-profile-link-icon"><CarFront size={19} /></span>
                <span className="rt-profile-link-copy">
                  <span className="rt-profile-link-title">My vehicles</span>
                  <span className="rt-profile-link-meta">
                    {ownedVehicles.length
                      ? `${ownedVehicles.length} saved${ownedVehicles[0]?.isDefault ? `, default ${ownedVehicles[0].name}` : ""}`
                      : "Add a vehicle to offer rides"}
                  </span>
                </span>
                <span className="rt-profile-link-arrow"><ArrowRight size={17} /></span>
              </Link>

              <Link className="rt-profile-link" to="/safety">
                <span className="rt-profile-link-icon"><ShieldCheck size={19} /></span>
                <span className="rt-profile-link-copy">
                  <span className="rt-profile-link-title">Safety center</span>
                  <span className="rt-profile-link-meta">
                    {ownedContacts.length
                      ? `${ownedContacts.length} emergency contact${ownedContacts.length === 1 ? "" : "s"}`
                      : "Add an emergency contact"}
                  </span>
                </span>
                <span className="rt-profile-link-arrow"><ArrowRight size={17} /></span>
              </Link>

              {ownedVehicles.length ? (
                <div className="rt-profile-vehicle-list">
                  {ownedVehicles.slice(0, 2).map((vehicle) => (
                    <div className="rt-profile-vehicle" key={vehicle.id}>
                      <span className="rt-profile-vehicle-icon"><CarFront size={17} /></span>
                      <span className="rt-profile-vehicle-copy">
                        <span className="rt-profile-vehicle-name">{vehicle.name}</span>
                        <span className="rt-profile-vehicle-meta">{vehicle.make} {vehicle.model} � {vehicle.plate}</span>
                      </span>
                      {vehicle.isDefault && <span className="rt-profile-default">Default</span>}
                    </div>
                  ))}
                </div>
              ) : null}
            </Group>

            <Group id="profile-privacy" title="Privacy">
              <Row
                icon={<ShieldCheck size={18} />}
                title="Scoped to the active profile"
                description="Your details stay tied to the demo profile you are signed in as."
              />
              <Row
                icon={<CheckCircle2 size={18} />}
                title="Verified trip data"
                description="Your trip count includes confirmed rides stored for this account."
              />
            </Group>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProfilePage;
