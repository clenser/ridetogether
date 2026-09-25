import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight, Image as ImageIcon, LoaderCircle, LogOut, Save, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { isProfileComplete } from "../../repositories/profileRepository";
import { validateFullName, validatePhone } from "../../services/auth";
import { useDraft } from "../../services/drafts";
import { AuthShell } from "./AuthShell";

interface ProfileForm {
  fullName: string;
  phone: string;
  bio: string;
  avatarUrl: string;
}

type FieldName = keyof ProfileForm;
type FieldErrors = Partial<Record<FieldName, string>>;

const MAX_BIO_LENGTH = 240;

const getInitials = (name: string): string =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "RT";

export function CompleteProfilePage() {
  const { profileUser, profile, profileLoading, profileError, reloadProfile, updateProfile, signOut } = useAuth();
  const navigate = useNavigate();
  /**
   * Draft-backed so a reload or an OS-level app restart does not lose a
   * half-filled form. The `hydrated` guard below still wins for a profile that
   * already has data on the server.
   */
  const emptyProfileDraft = useMemo<ProfileForm>(
    () => ({
      fullName: profileUser?.name ?? "",
      phone: profileUser?.phone ?? "",
      bio: profileUser?.bio ?? "",
      avatarUrl: profileUser?.avatar ?? "",
    }),
    [profileUser?.name, profileUser?.phone, profileUser?.bio, profileUser?.avatar],
  );
  // Declared before useDraft because the draft's `merge` runs during the first
  // render, inside the state initialiser.
  const emptyProfileDraftRef = useRef(emptyProfileDraft);
  emptyProfileDraftRef.current = emptyProfileDraft;
  const profileDraft = useDraft<ProfileForm>("complete-profile", emptyProfileDraft, profileUser?.id ?? "", {
    merge: (draft) => ({ ...emptyProfileDraftRef.current, ...draft }),
  });
  const { value: form, setValue: setForm } = profileDraft;
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Once the stored profile has been adopted into the form, later background
  // refreshes must not wipe what the user is typing.
  const [hydrated, setHydrated] = useState(false);

  /**
   * The profile row can arrive after this screen mounts (session restore, or a
   * slow network). Adopt it as soon as it lands so existing data is shown
   * instead of an empty form that looks like the profile was lost - but merge
   * rather than overwrite, so a restored draft (or anything already typed) is
   * never discarded by a late-arriving row.
   */
  useEffect(() => {
    if (hydrated || !profile) return;
    setForm((current) => ({
      fullName: current.fullName || profile.full_name || "",
      phone: current.phone || profile.phone || "",
      bio: current.bio || profile.bio || "",
      avatarUrl: current.avatarUrl || profile.avatar_url || "",
    }));
    setHydrated(true);
  }, [profile, hydrated, setForm]);

  // A profile that is already complete never needed this screen; send the user
  // straight into the app instead of showing the form again.
  useEffect(() => {
    if (hydrated || !profile) return;
    if (isProfileComplete(profile)) navigate("/", { replace: true });
  }, [profile, hydrated, navigate]);

  const updateField = (key: FieldName, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setFormError(null);
  };

  const validate = (): boolean => {
    const next: FieldErrors = {};
    const nameError = validateFullName(form.fullName);
    const phoneError = validatePhone(form.phone);

    if (nameError) next.fullName = nameError;
    if (phoneError) next.phone = phoneError;
    if (form.avatarUrl.trim() && !/^https?:\/\//i.test(form.avatarUrl.trim())) {
      next.avatarUrl = "Use a full http or https image URL.";
    }
    if (form.bio.length > MAX_BIO_LENGTH) {
      next.bio = `Keep your bio to ${MAX_BIO_LENGTH} characters or fewer.`;
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !validate()) return;

    setSaving(true);
    setFormError(null);
    try {
      await updateProfile({
        fullName: form.fullName,
        phone: form.phone,
        bio: form.bio,
        avatarUrl: form.avatarUrl,
      });
      // Saved to Supabase: nothing left for the draft to protect.
      profileDraft.complete();
      navigate("/", { replace: true });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "We could not save your profile.");
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      setFormError("We could not sign you out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  };

  const previewInitials = getInitials(form.fullName || profileUser?.name || "");

  // While the stored profile is still in flight, do not render an empty form -
  // that is what made returning users think their profile had been lost.
  if (profileLoading && !hydrated) {
    return (
      <AuthShell
        eyebrow="One more step"
        title="Loading your profile"
        subtitle="Checking the details we already have for your account."
      >
        <div className="rt-auth__done">
          <span className="app-loading__spinner" aria-hidden="true" />
          <p className="rt-auth__done-copy">Fetching your saved profile from Supabase…</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="One more step"
      title="Complete your profile"
      subtitle="Drivers and riders see these details before sharing a ride, so please fill them in."
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="rt-auth__body" style={{ padding: 0, gap: 16 }}>
          {profileError ? (
            <p className="rt-auth__notice rt-auth__notice--error" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              {profileError}{" "}
              <button
                type="button"
                className="rt-auth__link"
                onClick={() => void reloadProfile()}
                style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" }}
              >
                Retry
              </button>
            </p>
          ) : null}

          {formError ? (
            <p className="rt-auth__notice rt-auth__notice--error" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              {formError}
            </p>
          ) : null}

          <label className="rt-auth__field">
            <span className="rt-auth__label">Full name</span>
            <input
              className="rt-auth__input"
              type="text"
              value={form.fullName}
              onChange={(event) => updateField("fullName", event.target.value)}
              autoComplete="name"
              autoFocus
              placeholder="Your full name"
              aria-invalid={Boolean(errors.fullName)}
            />
            {errors.fullName ? (
              <span className="rt-auth__error">
                <AlertCircle size={12} aria-hidden="true" />
                {errors.fullName}
              </span>
            ) : null}
          </label>

          <label className="rt-auth__field">
            <span className="rt-auth__label">Phone number</span>
            <input
              className="rt-auth__input"
              type="tel"
              value={form.phone}
              onChange={(event) => updateField("phone", event.target.value)}
              autoComplete="tel"
              placeholder="+91 98765 43210"
              aria-invalid={Boolean(errors.phone)}
            />
            {errors.phone ? (
              <span className="rt-auth__error">
                <AlertCircle size={12} aria-hidden="true" />
                {errors.phone}
              </span>
            ) : (
              <span className="rt-auth__hint">Used for ride coordination only. Never shown publicly.</span>
            )}
          </label>

          <label className="rt-auth__field">
            <span className="rt-auth__label">Profile photo URL</span>
            <div className="rt-auth__avatar-field">
              {form.avatarUrl.trim() ? (
                <img className="rt-auth__avatar-preview" src={form.avatarUrl.trim()} alt="Profile preview" />
              ) : (
                <span className="rt-auth__avatar-preview rt-auth__avatar-fallback" aria-hidden="true">
                  {previewInitials}
                </span>
              )}
              <input
                className="rt-auth__input"
                type="url"
                value={form.avatarUrl}
                onChange={(event) => updateField("avatarUrl", event.target.value)}
                placeholder="https://example.com/photo.jpg"
                aria-invalid={Boolean(errors.avatarUrl)}
              />
            </div>
            {errors.avatarUrl ? (
              <span className="rt-auth__error">
                <AlertCircle size={12} aria-hidden="true" />
                {errors.avatarUrl}
              </span>
            ) : (
              <span className="rt-auth__hint">
                <ImageIcon size={12} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 4 }} />
                Optional. Paste an image link now; direct uploads can be added with Supabase Storage later.
              </span>
            )}
          </label>

          <label className="rt-auth__field">
            <span className="rt-auth__label">About you</span>
            <textarea
              className="rt-auth__input"
              style={{ minHeight: 88, resize: "vertical", lineHeight: 1.5 }}
              value={form.bio}
              onChange={(event) => updateField("bio", event.target.value)}
              maxLength={MAX_BIO_LENGTH}
              placeholder="Share your commuting habits or a friendly hello."
              aria-invalid={Boolean(errors.bio)}
            />
            {errors.bio ? (
              <span className="rt-auth__error">
                <AlertCircle size={12} aria-hidden="true" />
                {errors.bio}
              </span>
            ) : (
              <span className="rt-auth__hint">{form.bio.length}/{MAX_BIO_LENGTH}</span>
            )}
          </label>

          <p className="rt-auth__locked">
            <ShieldCheck size={14} aria-hidden="true" />
            Signed in as {profileUser?.email ?? "your account"}. Your sign-in email is managed by Supabase
            Auth and cannot be changed here.
          </p>

          <button className="rt-auth__submit" type="submit" disabled={saving || profileLoading}>
            {saving ? (
              <>
                <LoaderCircle className="spin" size={17} aria-hidden="true" /> Saving profile…
              </>
            ) : (
              <>
                <Save size={17} aria-hidden="true" /> Save and continue <ArrowRight size={16} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </form>

      <button
        className="rt-auth__link"
        type="button"
        onClick={() => void handleSignOut()}
        disabled={signingOut}
        style={{ background: "none", border: 0, font: "inherit", cursor: "pointer", justifySelf: "center" }}
      >
        {signingOut ? (
          <LoaderCircle className="spin" size={14} aria-hidden="true" />
        ) : (
          <LogOut size={14} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 4 }} />
        )}
        Sign out
      </button>
    </AuthShell>
  );
}

export default CompleteProfilePage;
