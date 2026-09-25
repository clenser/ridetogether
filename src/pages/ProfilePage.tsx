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
  CarFront,
  CheckCircle2,
  Lock,
  Mail,
  MapPinned,
  Phone,
  Route,
  Save,
  ShieldCheck,
  Star,
  UserRound,
} from "lucide-react";
import { DraftBanner } from "../components/DraftBanner";
import { PageHeader } from "../components/PageHeader";
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

const profileStyles = `
.rt-profile-page {
  min-height: 100%;
  background: var(--rt-surface-subtle, #f6faf7);
  color: var(--rt-text, #17231c);
  padding: 28px 20px 56px;
}
.rt-profile-shell { max-width: 1180px; margin: 0 auto; }
.rt-profile-hero {
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(280px, .75fr);
  gap: 24px;
  padding: 28px;
  margin-top: 22px;
  border: 1px solid var(--rt-border, #dfe9e2);
  border-radius: 24px;
  background: linear-gradient(135deg, #ffffff 0%, #f1faf4 100%);
  box-shadow: 0 18px 48px rgba(21, 148, 71, .09);
}
.rt-profile-hero::after {
  content: "";
  position: absolute;
  width: 280px;
  height: 280px;
  right: -120px;
  top: -150px;
  border-radius: 50%;
  background: rgba(21, 148, 71, .08);
  pointer-events: none;
}
.rt-profile-identity { display: flex; align-items: center; gap: 22px; min-width: 0; }
.rt-profile-avatar-wrap { position: relative; flex: 0 0 auto; }
.rt-profile-avatar {
  width: 112px;
  height: 112px;
  border-radius: 28px;
  object-fit: cover;
  border: 4px solid #fff;
  background: #dff4e6;
  box-shadow: 0 12px 30px rgba(21, 148, 71, .18);
}
.rt-profile-avatar-fallback {
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 34px;
  font-weight: 800;
  background: linear-gradient(145deg, #159447, #0c7436);
}
.rt-profile-online {
  position: absolute;
  right: 2px;
  bottom: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 4px solid #fff;
  background: #22c55e;
}
.rt-profile-copy { min-width: 0; }
.rt-profile-name-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.rt-profile-name { margin: 0; font-size: clamp(1.6rem, 3vw, 2.15rem); line-height: 1.15; letter-spacing: -.035em; }
.rt-profile-role {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  color: #116d3b;
  background: #dcf4e5;
  font-size: .76rem;
  font-weight: 750;
}
.rt-profile-bio { margin: 10px 0 0; color: var(--rt-muted, #617068); line-height: 1.6; max-width: 620px; }
.rt-profile-contact-list { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.rt-profile-contact {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  padding: 8px 11px;
  border: 1px solid #dce8df;
  border-radius: 11px;
  color: #33463b;
  background: rgba(255,255,255,.82);
  font-size: .84rem;
  text-decoration: none;
}
.rt-profile-contact span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rt-profile-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-content: center;
  position: relative;
  z-index: 1;
}
.rt-profile-stat {
  min-height: 100px;
  padding: 16px;
  border: 1px solid rgba(21, 148, 71, .13);
  border-radius: 17px;
  background: rgba(255,255,255,.9);
}
.rt-profile-stat-icon {
  width: 31px;
  height: 31px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  color: #128440;
  background: #e4f6ea;
}
.rt-profile-stat-value { display: flex; align-items: center; gap: 8px; margin-top: 9px; font-size: 1.28rem; font-weight: 800; line-height: 1; }
.rt-profile-stat-stars { display: inline-flex; color: #f2ad2e; }
.rt-profile-stat-label { display: block; margin-top: 6px; color: #6b7971; font-size: .76rem; }
.rt-profile-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(290px, .65fr); gap: 22px; margin-top: 22px; align-items: start; }
.rt-profile-card {
  border: 1px solid var(--rt-border, #dfe9e2);
  border-radius: 21px;
  background: var(--rt-card, #fff);
  box-shadow: 0 10px 30px rgba(29, 64, 42, .055);
  overflow: hidden;
}
.rt-profile-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 21px 22px 17px; border-bottom: 1px solid #edf2ee; }
.rt-profile-card-title { margin: 0; font-size: 1.06rem; letter-spacing: -.015em; }
.rt-profile-card-subtitle { margin: 5px 0 0; color: #6a786f; font-size: .84rem; line-height: 1.45; }
.rt-profile-form { padding: 22px; display: grid; gap: 18px; }
.rt-profile-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.rt-profile-field { display: grid; gap: 7px; min-width: 0; }
.rt-profile-field-full { grid-column: 1 / -1; }
.rt-profile-label { font-size: .81rem; font-weight: 750; color: #34473b; }
.rt-profile-label span { color: #87948c; font-weight: 500; }
.rt-profile-input, .rt-profile-textarea, .rt-profile-select {
  width: 100%;
  min-height: 45px;
  border: 1px solid #d8e3db;
  border-radius: 12px;
  padding: 10px 12px;
  color: var(--rt-text, #17231c);
  background: #fff;
  outline: none;
  transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
}
.rt-profile-textarea { min-height: 96px; resize: vertical; line-height: 1.5; }
.rt-profile-input:focus, .rt-profile-textarea:focus, .rt-profile-select:focus {
  border-color: #159447;
  box-shadow: 0 0 0 3px rgba(21, 148, 71, .12);
}
.rt-profile-input[aria-invalid="true"], .rt-profile-textarea[aria-invalid="true"] { border-color: #dc4c4c; }
.rt-profile-error { display: flex; align-items: center; gap: 5px; margin: 0; color: #bd3434; font-size: .75rem; }
.rt-profile-hint { display: flex; align-items: center; gap: 4px; margin: 0; color: #78867d; font-size: .73rem; line-height: 1.45; }
.rt-profile-input:disabled { color: #6f7d74; background: #f2f6f3; cursor: not-allowed; }
[data-theme="dark"] .rt-profile-hint { color: #9daba2; }
[data-theme="dark"] .rt-profile-input:disabled { color: #9daba2; background: #1a241d; }
.rt-profile-avatar-field { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 12px; align-items: start; }
.rt-profile-avatar-controls { display: grid; gap: 8px; min-width: 0; }
.rt-profile-subfield { display: grid; gap: 5px; }
.rt-profile-file {
  width: 100%;
  min-height: 40px;
  padding: 8px 10px;
  border: 1px dashed #c2d8c9;
  border-radius: 12px;
  background: #f6fbf8;
  color: #33513f;
  font: inherit;
  font-size: .82rem;
  cursor: pointer;
}
.rt-profile-file:hover:not(:disabled) { border-color: #159447; background: #eaf6ee; }
.rt-profile-file:disabled { cursor: progress; opacity: .65; }
.rt-profile-file::file-selector-button {
  margin-right: 10px;
  padding: 7px 12px;
  border: 0;
  border-radius: 9px;
  background: #159447;
  color: #fff;
  font: inherit;
  font-size: .78rem;
  font-weight: 600;
  cursor: pointer;
}
.rt-profile-avatar-preview { width: 62px; height: 62px; border-radius: 16px; object-fit: cover; background: #e2f4e7; }
.rt-profile-avatar-fallback-small { display: grid; place-items: center; color: #15823f; }
[data-theme="dark"] .rt-profile-file { border-color: #2f4438; background: #16201a; color: #cdd9d1; }
[data-theme="dark"] .rt-profile-file:hover:not(:disabled) { border-color: #159447; background: #1b2a20; }
.rt-profile-actions { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding-top: 2px; }
.rt-profile-save {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 18px;
  border: 0;
  border-radius: 12px;
  color: #fff;
  background: #159447;
  font: inherit;
  font-size: .86rem;
  font-weight: 750;
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(21, 148, 71, .2);
}
.rt-profile-save:hover:not(:disabled) { background: #10833c; }
.rt-profile-save:disabled { opacity: .62; cursor: not-allowed; }
.rt-profile-feedback { display: inline-flex; align-items: center; gap: 6px; margin: 0; color: #167d40; font-size: .8rem; }
.rt-profile-feedback-error { color: #ba3434; }
.rt-profile-side { display: grid; gap: 16px; }
.rt-profile-link-card { padding: 19px; color: inherit; text-decoration: none; transition: transform .18s ease, box-shadow .18s ease; }
.rt-profile-link-card:hover { transform: translateY(-2px); box-shadow: 0 14px 34px rgba(29, 64, 42, .09); }
.rt-profile-link-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.rt-profile-link-icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 13px; color: #148642; background: #e4f6ea; }
.rt-profile-link-count { font-size: 1.15rem; font-weight: 800; }
.rt-profile-link-title { margin: 16px 0 5px; font-size: .98rem; font-weight: 780; }
.rt-profile-link-copy { margin: 0; color: #6a786f; font-size: .8rem; line-height: 1.5; }
.rt-profile-vehicle-list { padding: 7px 20px 19px; display: grid; gap: 9px; }
.rt-profile-vehicle {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px;
  border-radius: 13px;
  background: #f6faf7;
}
.rt-profile-vehicle-icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 10px; color: #42544a; background: #e5ece7; }
.rt-profile-vehicle-copy { min-width: 0; }
.rt-profile-vehicle-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .82rem; font-weight: 750; }
.rt-profile-vehicle-meta { display: block; margin-top: 2px; color: #75827a; font-size: .72rem; }
.rt-profile-default { margin-left: auto; padding: 4px 7px; border-radius: 999px; color: #11753a; background: #dcf4e5; font-size: .64rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
.rt-profile-security { padding: 19px; }
.rt-profile-security-item { display: flex; align-items: flex-start; gap: 10px; padding: 12px 0; border-bottom: 1px solid #edf2ee; }
.rt-profile-security-item:last-child { border-bottom: 0; padding-bottom: 0; }
.rt-profile-security-item svg { flex: 0 0 auto; margin-top: 1px; color: #159447; }
.rt-profile-security-item strong { display: block; font-size: .82rem; }
.rt-profile-security-item span { display: block; margin-top: 3px; color: #748078; font-size: .75rem; line-height: 1.45; }
.rt-profile-loading { min-height: 60vh; display: grid; place-items: center; color: #637068; }
[data-theme="dark"] .rt-profile-page { --rt-surface-subtle: #101712; --rt-card: #17211a; --rt-border: #2b3a30; --rt-text: #eef7f1; --rt-muted: #a6b5ac; }
[data-theme="dark"] .rt-profile-hero { background: linear-gradient(135deg, #18231c 0%, #152b1d 100%); border-color: #2b3a30; }
[data-theme="dark"] .rt-profile-bio, [data-theme="dark"] .rt-profile-card-subtitle, [data-theme="dark"] .rt-profile-link-copy, [data-theme="dark"] .rt-profile-security-item span { color: #a6b5ac; }
[data-theme="dark"] .rt-profile-card-head { border-color: #2b3a30; }
[data-theme="dark"] .rt-profile-contact, [data-theme="dark"] .rt-profile-stat, [data-theme="dark"] .rt-profile-input, [data-theme="dark"] .rt-profile-textarea, [data-theme="dark"] .rt-profile-select { color: #eef7f1; background: #1b271f; border-color: #34463a; }
[data-theme="dark"] .rt-profile-label, [data-theme="dark"] .rt-profile-link-title, [data-theme="dark"] .rt-profile-security-item strong { color: #eef7f1; }
[data-theme="dark"] .rt-profile-vehicle { background: #1c2820; }
@media (max-width: 860px) {
  .rt-profile-hero { grid-template-columns: 1fr; }
  .rt-profile-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .rt-profile-grid { grid-template-columns: 1fr; }
  .rt-profile-side { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rt-profile-security { grid-column: 1 / -1; }
}
@media (max-width: 620px) {
  .rt-profile-page { padding: 18px 14px 40px; }
  .rt-profile-hero { padding: 20px; border-radius: 20px; }
  .rt-profile-identity { align-items: flex-start; gap: 15px; }
  .rt-profile-avatar { width: 78px; height: 78px; border-radius: 21px; }
  .rt-profile-avatar-fallback { font-size: 25px; }
  .rt-profile-online { width: 20px; height: 20px; }
  .rt-profile-name { font-size: 1.5rem; }
  .rt-profile-contact-list { display: grid; }
  .rt-profile-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rt-profile-form-grid, .rt-profile-side { grid-template-columns: 1fr; }
  .rt-profile-field-full { grid-column: auto; }
  .rt-profile-security { grid-column: auto; }
  .rt-profile-actions { align-items: flex-start; flex-direction: column; }
  .rt-profile-save { width: 100%; }
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
        <div className="rt-profile-loading">Loading your profile…</div>
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
          title="Your profile"
          subtitle="Keep your ride details current so drivers and riders know who they are traveling with."
        />

        <section className="rt-profile-hero" aria-label="Profile overview">
          <div className="rt-profile-identity">
            <div className="rt-profile-avatar-wrap">
              {activeUser.avatar ? (
                <img
                  className="rt-profile-avatar"
                  src={activeUser.avatar}
                  alt={`${activeUser.name} profile`}
                />
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
                  <Mail size={15} /><span>{activeUser.email}</span>
                </a>
                <a className="rt-profile-contact" href={`tel:${activeUser.phone.replace(/\s/g, "")}`}>
                  <Phone size={15} /><span>{activeUser.phone}</span>
                </a>
                <span className="rt-profile-contact"><MapPinned size={15} /><span>Member since {new Date(activeUser.joinedAt).getFullYear()}</span></span>
              </div>
            </div>
          </div>

          <div className="rt-profile-stats">
            <div className="rt-profile-stat">
              <span className="rt-profile-stat-icon"><Star size={16} /></span>
              <strong className="rt-profile-stat-value">{rating.toFixed(1)} <span className="rt-profile-stat-stars"><Stars value={rating} size="small" /></span></strong>
              <span className="rt-profile-stat-label">Community rating</span>
            </div>
            <div className="rt-profile-stat">
              <span className="rt-profile-stat-icon"><Route size={16} /></span>
              <strong className="rt-profile-stat-value">{tripCount}</strong>
              <span className="rt-profile-stat-label">Trips taken or offered</span>
            </div>
            <div className="rt-profile-stat">
              <span className="rt-profile-stat-icon"><CarFront size={16} /></span>
              <strong className="rt-profile-stat-value">{ownedVehicles.length}</strong>
              <span className="rt-profile-stat-label">Saved vehicles</span>
            </div>
            <div className="rt-profile-stat">
              <span className="rt-profile-stat-icon"><ShieldCheck size={16} /></span>
              <strong className="rt-profile-stat-value">{ownedContacts.length}</strong>
              <span className="rt-profile-stat-label">Safety contacts</span>
            </div>
          </div>
        </section>

        <div className="rt-profile-grid">
          <section className="rt-profile-card">
            {profileDraft.restored ? (
              <DraftBanner
                savedAt={profileDraft.savedAt}
                workflow="profile edit"
                onDiscard={profileDraft.discard}
                onDismiss={profileDraft.dismissBanner}
              />
            ) : null}
            <div className="rt-profile-card-head">
              <div>
                <h2 className="rt-profile-card-title">Edit profile</h2>
                <p className="rt-profile-card-subtitle">Changes are saved to your RideTogether profile.</p>
              </div>
              <UserRound size={20} color="#159447" />
            </div>
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
                    <option value="Driver & rider">Driver & Rider</option>
                    <option value="Driver">Driver</option>
                    <option value="Rider">Rider</option>
                  </select>
                  {errors.role && <span className="rt-profile-error"><AlertCircle size={12} />{errors.role}</span>}
                </label>
                <label className="rt-profile-field">
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
                    Your sign-in email is managed by Supabase Auth.
                  </span>
                </label>
                <label className="rt-profile-field">
                  <span className="rt-profile-label">Phone number</span>
                  <input
                    className="rt-profile-input"
                    type="tel"
                    value={form.phone}
                    onChange={(event) => updateField("phone", event.target.value)}
                    autoComplete="tel"
                    aria-invalid={Boolean(errors.phone)}
                  />
                  {errors.phone && <span className="rt-profile-error"><AlertCircle size={12} />{errors.phone}</span>}
                </label>
                <div className="rt-profile-field rt-profile-field-full">
                  <span className="rt-profile-label">Profile photo <span>(optional)</span></span>
                  <div className="rt-profile-avatar-field">
                    {form.avatar ? (
                      <img className="rt-profile-avatar-preview" src={form.avatar} alt="Profile preview" />
                    ) : (
                      <span className="rt-profile-avatar-preview rt-profile-avatar-fallback-small">{previewInitials}</span>
                    )}
                    <div className="rt-profile-avatar-controls">
                      <input
                        ref={fileInputRef}
                        className="rt-profile-file"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={(event) => void handleAvatarFile(event)}
                        disabled={uploadingAvatar}
                        aria-label="Choose a photo to upload"
                      />
                      <p className="rt-profile-hint">
                        Uploads a JPG, PNG, WebP or GIF up to {Math.round(AVATAR_MAX_BYTES / (1024 * 1024))} MB to RideTogether cloud storage.
                        {uploadingAvatar ? " Uploading…" : ""}
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
                      </label>
                      {errors.avatar && <span className="rt-profile-error"><AlertCircle size={12} />{errors.avatar}</span>}
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
                  <span className="rt-profile-label rt-profile-character-count"><span>{form.bio.length}/240</span></span>
                  {errors.bio && <span className="rt-profile-error"><AlertCircle size={12} />{errors.bio}</span>}
                </label>
              </div>
              <div className="rt-profile-actions">
                {message ? (
                  <p className={`rt-profile-feedback${message.type === "error" ? " rt-profile-feedback-error" : ""}`} role="status">
                    {message.type === "success" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                    {message.text}
                  </p>
                ) : <span />}
                <button className="rt-profile-save" type="submit" disabled={saving}>
                  <Save size={16} /> {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </section>

          <aside className="rt-profile-side">
            <Link className="rt-profile-card rt-profile-link-card" to="/vehicles">
              <div className="rt-profile-link-head">
                <span className="rt-profile-link-icon"><CarFront size={21} /></span>
                <span className="rt-profile-link-count">{ownedVehicles.length}</span>
              </div>
              <h3 className="rt-profile-link-title">My vehicles</h3>
              <p className="rt-profile-link-copy">Add a vehicle or choose the one used for your next offered ride.</p>
              <div className="rt-profile-vehicle-list">
                {ownedVehicles.slice(0, 2).map((vehicle) => (
                  <div className="rt-profile-vehicle" key={vehicle.id}>
                    <span className="rt-profile-vehicle-icon"><CarFront size={17} /></span>
                    <span className="rt-profile-vehicle-copy">
                      <span className="rt-profile-vehicle-name">{vehicle.name}</span>
                      <span className="rt-profile-vehicle-meta">{vehicle.make} {vehicle.model} · {vehicle.plate}</span>
                    </span>
                    {vehicle.isDefault && <span className="rt-profile-default">Default</span>}
                  </div>
                ))}
              </div>
            </Link>

            <Link className="rt-profile-card rt-profile-link-card" to="/safety">
              <div className="rt-profile-link-head">
                <span className="rt-profile-link-icon"><ShieldCheck size={21} /></span>
                <span className="rt-profile-link-count">{ownedContacts.length}</span>
              </div>
              <h3 className="rt-profile-link-title">Safety center</h3>
              <p className="rt-profile-link-copy">Manage emergency contacts and review ride safety guidance.</p>
            </Link>

            <section className="rt-profile-card rt-profile-security">
              <div className="rt-profile-security-item">
                <ShieldCheck size={18} />
                <div><strong>Privacy first</strong><span>Your details stay scoped to the active demo profile.</span></div>
              </div>
              <div className="rt-profile-security-item">
                <CheckCircle2 size={18} />
                <div><strong>Verified trip data</strong><span>Your trip count includes confirmed rides in this browser.</span></div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default ProfilePage;
