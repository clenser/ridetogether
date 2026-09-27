import { useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Clock3,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { DraftBanner } from "../components/DraftBanner";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge, IconButton } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Group } from "../components/ui/Group";
import { State } from "../components/ui/State";
import { useApp } from "../context/AppContext";
import { useDraft, type DraftScope } from "../services/drafts";
import type { SafetyContact } from "../types";

interface ContactDraft {
  name: string;
  phone: string;
  relationship: string;
}

type ContactErrors = Partial<Record<keyof ContactDraft, string>>;

const emptyContact: ContactDraft = {
  name: "",
  phone: "",
  relationship: "",
};

const safetyStyles = `
.rt-safety-page { min-height: 100%; background: var(--rt-surface-subtle); color: var(--rt-text); padding: 26px 20px calc(56px + var(--rt-safe-bottom)); }
.rt-safety-shell { max-width: 1120px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }

/* ---- SOS: deliberately its own block ---- */
/* The SOS panel is styled apart from everything else on the page. It is the one
   control here that looks urgent, and the one that does nothing, so it must not
   be visually adjacent to ordinary content. */
.rt-safety-sos {
  position: relative;
  display: flex;
  align-items: center;
  gap: 17px;
  padding: 19px 21px;
  border-radius: var(--rt-radius-card);
  border: 1px solid var(--rt-danger-border);
  background: var(--rt-danger-soft);
  overflow: hidden;
}
.rt-safety-sos::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: var(--rt-danger);
}
.rt-safety-sos-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 50px;
  height: 50px;
  border-radius: 16px;
  color: var(--rt-text-inverse);
  background: var(--rt-danger);
}
.rt-safety-sos-copy { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.rt-safety-sos-title { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.rt-safety-sos-title strong { color: var(--rt-text-strong); font-size: 1rem; font-weight: 780; letter-spacing: -0.015em; }
.rt-safety-sos-body { margin: 0; color: var(--rt-muted); font-size: 0.8rem; line-height: 1.55; max-width: 60ch; }

.rt-safety-sos-active {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 15px 17px;
  border-radius: var(--rt-radius-card);
  border: 1px solid var(--rt-danger-border);
  background: var(--rt-danger-soft);
  color: var(--rt-danger);
}
.rt-safety-sos-active svg { flex: 0 0 auto; }
.rt-safety-sos-active-copy { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
.rt-safety-sos-active-copy strong { font-size: 0.86rem; }
.rt-safety-sos-active-copy span { color: var(--rt-muted); font-size: 0.77rem; line-height: 1.5; }

/* ---- two-column body ---- */
.rt-safety-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 20px; align-items: start; }
.rt-safety-column { display: flex; flex-direction: column; gap: 20px; min-width: 0; }

/* ---- feedback ---- */
.rt-safety-alert {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 13px 15px;
  border-radius: var(--rt-radius-md);
  border: 1px solid var(--rt-danger-border);
  background: var(--rt-danger-soft);
  color: var(--rt-danger);
  font-size: 0.82rem;
  font-weight: 620;
  line-height: 1.5;
}
.rt-safety-alert svg { flex: 0 0 auto; margin-top: 1px; }
.rt-safety-alert-success { border-color: var(--rt-success-border); background: var(--rt-success-soft); color: var(--rt-primary-strong); }

/* ---- contacts ---- */
.rt-safety-contact-list { display: flex; flex-direction: column; }
.rt-safety-contact {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 14px 17px;
  border-bottom: 1px solid var(--rt-border);
}
.rt-safety-contact:last-child { border-bottom: 0; }
.rt-safety-contact-avatar {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  color: var(--rt-primary-strong);
  background: var(--rt-primary-soft);
}
.rt-safety-contact-copy { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
.rt-safety-contact-name { color: var(--rt-text); font-size: 0.9rem; font-weight: 720; overflow-wrap: anywhere; }
.rt-safety-contact-relationship { color: var(--rt-muted); font-size: 0.76rem; }
.rt-safety-contact-phone {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  color: var(--rt-primary-strong);
  font-size: 0.79rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.rt-safety-contact-actions { display: flex; gap: 6px; flex: 0 0 auto; }

.rt-safety-empty { padding: 38px 22px; }

/* ---- guidance ---- */
.rt-safety-tips { display: flex; flex-direction: column; }
.rt-safety-tip { display: flex; align-items: flex-start; gap: 12px; padding: 14px 17px; border-bottom: 1px solid var(--rt-border); }
.rt-safety-tip:last-child { border-bottom: 0; }
.rt-safety-tip-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  color: var(--rt-info-text);
  background: var(--rt-info-soft);
}
.rt-safety-tip-copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.rt-safety-tip h3 { margin: 0; color: var(--rt-text); font-size: 0.85rem; font-weight: 720; }
.rt-safety-tip p { margin: 0; color: var(--rt-muted); font-size: 0.77rem; line-height: 1.55; }

.rt-safety-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: var(--rt-radius-md);
  background: var(--rt-warning-soft);
  color: var(--rt-warning-text);
  font-size: 0.76rem;
  font-weight: 600;
  line-height: 1.55;
}
.rt-safety-note svg { flex: 0 0 auto; margin-top: 1px; }

/* ---- form ---- */
.rt-safety-form { display: flex; flex-direction: column; gap: 15px; }
.rt-safety-form-intro { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 11px 13px; border-radius: 13px; background: var(--rt-surface-subtle); color: var(--rt-muted); font-size: 0.78rem; line-height: 1.5; }
.rt-safety-form-intro svg { flex: 0 0 auto; margin-top: 1px; color: var(--rt-primary-strong); }
.rt-safety-form-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
.rt-safety-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.rt-safety-label { color: var(--rt-text); font-size: 0.78rem; font-weight: 700; }
.rt-safety-input {
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
.rt-safety-input:focus-visible {
  outline: none;
  border-color: var(--rt-primary-strong);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rt-primary) 20%, transparent);
}
.rt-safety-input[aria-invalid="true"] { border-color: var(--rt-danger); }
.rt-safety-field-error { display: inline-flex; align-items: center; gap: 5px; color: var(--rt-danger); font-size: 0.74rem; font-weight: 620; }
.rt-safety-form-actions { display: flex; align-items: center; justify-content: flex-end; gap: 9px; flex-wrap: wrap; }
.rt-safety-delete-copy { margin: 0 0 13px; color: var(--rt-muted); font-size: 0.86rem; line-height: 1.6; }
.rt-safety-delete-copy strong { color: var(--rt-text); }

/* ---- sos modal ---- */
.rt-sos-modal { display: flex; flex-direction: column; gap: 14px; }
.rt-sos-warning { display: flex; align-items: flex-start; gap: 9px; padding: 12px 14px; border-radius: var(--rt-radius-md); background: var(--rt-warning-soft); color: var(--rt-warning-text); font-size: 0.79rem; line-height: 1.55; }
.rt-sos-warning svg { flex: 0 0 auto; margin-top: 1px; }
.rt-sos-warning strong { display: block; }
.rt-sos-list { margin: 0; color: var(--rt-muted); font-size: 0.84rem; line-height: 1.6; }
.rt-sos-actions { display: flex; align-items: center; justify-content: flex-end; gap: 9px; flex-wrap: wrap; margin-top: 4px; }
.rt-sos-active { display: flex; flex-direction: column; align-items: center; gap: 9px; padding: 22px 18px; border-radius: var(--rt-radius-card); background: var(--rt-danger-soft); text-align: center; }
.rt-sos-active-icon { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 18px; color: var(--rt-text-inverse); background: var(--rt-danger); }
.rt-sos-active strong { color: var(--rt-text-strong); font-size: 1rem; }
.rt-sos-active p { margin: 0; color: var(--rt-muted); font-size: 0.8rem; line-height: 1.55; max-width: 34ch; }
.rt-sos-active .rt-sos-actions { width: 100%; }

@media (max-width: 900px) {
  .rt-safety-grid { grid-template-columns: 1fr; }
}
@media (max-width: 620px) {
  .rt-safety-page { padding: 18px 14px calc(44px + var(--rt-safe-bottom)); }
  .rt-safety-sos { flex-direction: column; align-items: stretch; gap: 14px; padding: 17px 18px; }
  .rt-safety-sos .ds-button { width: 100%; }
  .rt-safety-sos-active { flex-direction: column; align-items: stretch; }
  .rt-safety-form-actions { flex-direction: column-reverse; align-items: stretch; }
  .rt-safety-form-actions .ds-button { width: 100%; }
  .rt-sos-actions { flex-direction: column-reverse; align-items: stretch; }
  .rt-sos-actions .ds-button { width: 100%; }
  .rt-safety-contact { padding: 13px 15px; }
  .rt-safety-empty { padding: 28px 16px; }
}
`;
export function SafetyPage() {
  const { activeUserId, safetyContacts, saveSafetyContact, deleteSafetyContact } = useApp();
  const [formOpen, setFormOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<SafetyContact | null>(null);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SafetyContact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [sosOpen, setSosOpen] = useState(false);
  const [sosActive, setSosActive] = useState(false);

  const ownedContacts = useMemo(
    () => safetyContacts.filter((contact) => contact.userId === activeUserId),
    [activeUserId, safetyContacts],
  );

  /**
   * Keyed by mode so an unfinished "add contact" and an unfinished
   * "edit contact X" cannot overwrite each other, and both survive a reload.
   *
   * In edit mode the fallback is the contact's saved values, so opening a contact
   * shows its real details unless the user has an unfinished edit in progress.
   * Opening the form changes `editingContact` and the scope together, so the draft
   * store re-seeds with this fallback on the same render.
   */
  const contactDraftScope: DraftScope = editingContact
    ? `safety-contact-form:${editingContact.id}`
    : "safety-contact-form";
  const contactDraftFallback = useMemo<ContactDraft>(
    () => (editingContact
      ? {
        name: editingContact.name,
        phone: editingContact.phone,
        relationship: editingContact.relationship,
      }
      : emptyContact),
    [editingContact],
  );
  const contactDraft = useDraft<ContactDraft>(contactDraftScope, contactDraftFallback, activeUserId);
  const { value: draft, setValue: setDraft } = contactDraft;

  const openAdd = () => {
    setEditingContact(null);
    setFormOpen(true);
    setErrors({});
    setFeedback(null);
  };

  const openEdit = (contact: SafetyContact) => {
    setEditingContact(contact);
    setFormOpen(true);
    setErrors({});
    setFeedback(null);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setEditingContact(null);
    setErrors({});
  };

  const updateDraft = <K extends keyof ContactDraft>(key: K, value: ContactDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const validate = () => {
    const next: ContactErrors = {};
    const phone = draft.phone.trim();
    const digits = phone.replace(/\D/g, "");
    if (draft.name.trim().length < 2) next.name = "Enter the contact’s full name.";
    if (!/^[+\d\s().-]+$/.test(phone) || digits.length < 7 || digits.length > 15) next.phone = "Enter a valid phone number with 7–15 digits.";
    if (!draft.relationship.trim()) next.relationship = "Add a relationship, such as family or friend.";
    const duplicate = ownedContacts.some(
      (contact) => contact.id !== editingContact?.id && contact.phone.replace(/\D/g, "") === digits,
    );
    if (duplicate) next.phone = "This phone number is already in your contacts.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;
    setSaving(true);
    const contact = {
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      relationship: draft.relationship.trim(),
    };
    try {
      if (editingContact) {
        await saveSafetyContact({ id: editingContact.id, ...contact });
        setFeedback({ type: "success", text: `${contact.name} was updated.` });
      } else {
        // No id and no userId: the repository inserts a row owned by the
        // signed-in Supabase user. Generating an id here used to route the add
        // through the UPDATE branch, so adding a contact always failed.
        await saveSafetyContact(contact);
        setFeedback({ type: "success", text: `${contact.name} was added.` });
      }
      setFormOpen(false);
      setEditingContact(null);
      // Stored in Supabase, so the draft has nothing left to protect.
      contactDraft.complete();
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Unable to save this contact." });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteSafetyContact(pendingDelete.id);
      setFeedback({ type: "success", text: `${pendingDelete.name} was removed.` });
      setPendingDelete(null);
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Unable to delete this contact." });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rt-safety-page">
      <style>{safetyStyles}</style>
      <div className="rt-safety-shell">
        <PageHeader
          eyebrow="Safety"
          title="Safety center"
          description="Prepare for shared rides, keep emergency contacts close, and try the clearly labeled local SOS demo."
        />

        <section className="rt-safety-sos" aria-labelledby="sos-title">
          <span className="rt-safety-sos-icon" aria-hidden="true"><PhoneCall size={22} /></span>
          <div className="rt-safety-sos-copy">
            <span className="rt-safety-sos-title">
              <strong id="sos-title">Emergency SOS</strong>
              <Badge tone="warning">Interface demo</Badge>
            </span>
            <p className="rt-safety-sos-body">
              A preview of what an emergency trigger would look like. It changes nothing outside this page -
              in a real emergency, contact your local emergency services directly from your phone.
            </p>
          </div>
          <Button variant="danger" data-testid="sos-open" onClick={() => setSosOpen(true)}>
            <PhoneCall size={17} aria-hidden="true" />
            Open SOS demo
          </Button>
        </section>

        {sosActive ? (
          <div className="rt-safety-sos-active" role="status">
            <AlertTriangle size={20} aria-hidden="true" />
            <span className="rt-safety-sos-active-copy">
              <strong>SOS demo is active locally</strong>
              <span>No call, message, location, or contact action was performed.</span>
            </span>
            <Button variant="danger-quiet" size="sm" onClick={() => setSosActive(false)}>Cancel demo</Button>
          </div>
        ) : null}

        <div className="rt-safety-grid">
          <div className="rt-safety-column">
            <Group
              id="safety-contacts"
              title="Emergency contacts"
              description={`${ownedContacts.length} ${ownedContacts.length === 1 ? "contact" : "contacts"} saved for the active profile. Private to you - never shown to drivers or riders.`}
              action={
                <Button size="sm" data-testid="contact-add" onClick={openAdd}>
                  <Plus size={15} aria-hidden="true" />
                  Add contact
                </Button>
              }
            >
              {feedback ? (
                <div style={{ padding: "14px 17px 0" }}>

                  <div
                    className={`rt-safety-alert${feedback.type === "success" ? " rt-safety-alert-success" : ""}`}
                    role={feedback.type === "error" ? "alert" : "status"}
                  >
                    {feedback.type === "success" ? <Check size={16} /> : <AlertCircle size={16} />}
                    <span>{feedback.text}</span>
                  </div>
                </div>
              ) : null}

              {ownedContacts.length === 0 ? (
                <div className="rt-safety-empty">
                  <State
                    icon={<UsersRound size={26} />}
                    title="No emergency contacts"
                    body="Add someone you trust. Their details remain private to the active RideTogether profile."
                    actionLabel="Add your first contact"
                    onAction={openAdd}
                    testId="safety-contacts-empty"
                  />
                </div>
              ) : (
                <div className="rt-safety-contact-list">
                  {ownedContacts.map((contact) => (
                    <article className="rt-safety-contact" key={contact.id}>
                      <span className="rt-safety-contact-avatar"><UsersRound size={19} /></span>
                      <div className="rt-safety-contact-copy">
                        <strong className="rt-safety-contact-name">{contact.name}</strong>
                        <span className="rt-safety-contact-relationship">{contact.relationship}</span>
                        <span className="rt-safety-contact-phone">
                          <Phone size={12} aria-hidden="true" />
                          {contact.phone}
                        </span>
                      </div>
                      <div className="rt-safety-contact-actions">
                        <IconButton
                          bordered
                          icon={Pencil}
                          label={`Edit ${contact.name}`}
                          data-testid={`contact-edit-${contact.id}`}
                          onClick={() => openEdit(contact)}
                        />
                        <IconButton
                          bordered
                          tone="danger"
                          icon={Trash2}
                          label={`Delete ${contact.name}`}
                          onClick={() => setPendingDelete(contact)}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Group>
          </div>

          <div className="rt-safety-column">
            <Group
              id="safety-guidance"
              title="Safety information"
              description="Simple habits to help everyone arrive prepared."
            >
              <div className="rt-safety-tips">
                <article className="rt-safety-tip">
                  <span className="rt-safety-tip-icon"><Clock3 size={18} /></span>
                  <div className="rt-safety-tip-copy">
                    <h3>Confirm before leaving</h3>
                    <p>Review the pickup point, departure time, vehicle, and driver or rider names in the trip chat before setting off.</p>
                  </div>
                </article>
                <article className="rt-safety-tip">
                  <span className="rt-safety-tip-icon"><MapPin size={18} /></span>
                  <div className="rt-safety-tip-copy">
                    <h3>Share your trip</h3>
                    <p>Tell a trusted person your route and expected arrival time, and keep your phone charged and accessible.</p>
                  </div>
                </article>
                <article className="rt-safety-tip">
                  <span className="rt-safety-tip-icon"><MessageCircle size={18} /></span>
                  <div className="rt-safety-tip-copy">
                    <h3>Communicate early</h3>
                    <p>Use trip chat for delays or changes. If a situation feels unsafe, move to a well-lit public place and seek local help.</p>
                  </div>
                </article>
              </div>
            </Group>

            <div className="rt-safety-note">
              <AlertCircle size={17} aria-hidden="true" />
              <span>
                The SOS control in this demo is an interface preview only. It never calls, messages, shares
                location, or contacts anyone.
              </span>
            </div>
          </div>
        </div>
      </div>

      <Modal
        isOpen={formOpen}
        onClose={closeForm}
        title={editingContact ? "Edit emergency contact" : "Add emergency contact"}
        size="sm"
      >
        <form className="rt-safety-form" onSubmit={handleSave} noValidate>
          {contactDraft.restored ? (
            <DraftBanner
              savedAt={contactDraft.savedAt}
              workflow={editingContact ? "contact edit" : "contact form"}
              onDiscard={contactDraft.discard}
              onDismiss={contactDraft.dismissBanner}
            />
          ) : null}

          <p className="rt-safety-form-intro">
            <ShieldCheck size={17} aria-hidden="true" />
            This contact is visible only within the active profile&rsquo;s safety settings.
          </p>

          <div className="rt-safety-form-grid">
            <label className="rt-safety-field">
              <span className="rt-safety-label">Full name</span>
              <input
                className="rt-safety-input"
                data-testid="contact-name"
                value={draft.name}
                onChange={(event) => updateDraft("name", event.target.value)}
                placeholder="e.g. Priya Sharma"
                autoComplete="name"
                aria-invalid={Boolean(errors.name)}
              />
              {errors.name && <span className="rt-safety-field-error"><AlertCircle size={12} />{errors.name}</span>}
            </label>

            <label className="rt-safety-field">
              <span className="rt-safety-label">Phone number</span>
              <input
                className="rt-safety-input"
                data-testid="contact-phone"
                type="tel"
                value={draft.phone}
                onChange={(event) => updateDraft("phone", event.target.value)}
                placeholder="e.g. +91 98765 43210"
                autoComplete="tel"
                aria-invalid={Boolean(errors.phone)}
              />
              {errors.phone && <span className="rt-safety-field-error"><AlertCircle size={12} />{errors.phone}</span>}
            </label>

            <label className="rt-safety-field">
              <span className="rt-safety-label">Relationship</span>
              <input
                className="rt-safety-input"
                data-testid="contact-relationship"
                value={draft.relationship}
                onChange={(event) => updateDraft("relationship", event.target.value)}
                placeholder="e.g. Family, friend, colleague"
                autoComplete="off"
                aria-invalid={Boolean(errors.relationship)}
              />
              {errors.relationship && <span className="rt-safety-field-error"><AlertCircle size={12} />{errors.relationship}</span>}
            </label>
          </div>

          <div className="rt-safety-form-actions">
            <Button variant="ghost" onClick={closeForm} disabled={saving}>Cancel</Button>
            <Button type="submit" data-testid="contact-save" loading={saving} loadingLabel="Saving">
              {saving ? null : <Check size={15} aria-hidden="true" />}
              Save contact
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(pendingDelete)}
        onClose={() => !deleting && setPendingDelete(null)}
        title="Remove emergency contact?"
        size="sm"
      >
        <p className="rt-safety-delete-copy">
          Remove <strong>{pendingDelete?.name}</strong> from the active profile? This cannot be undone.
        </p>
        <div className="rt-safety-form-actions" style={{ marginTop: 16 }}>
          <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>Keep contact</Button>
          <Button variant="danger" onClick={() => void confirmDelete()} loading={deleting} loadingLabel="Removing">
            <Trash2 size={15} aria-hidden="true" />
            Remove
          </Button>
        </div>
      </Modal>

      <Modal isOpen={sosOpen} onClose={() => setSosOpen(false)} title="SOS demo � no emergency call" size="sm">
        <div className="rt-sos-modal">
          <div className="rt-sos-warning">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>
              <strong>This is a demo interface only.</strong>
              It does not contact emergency services, emergency contacts, or anyone else.
            </span>
          </div>

          {!sosActive ? (
            <>
              <p className="rt-sos-list">
                Activating this demo changes only the local state of this page. It does not place a call, send a
                message, share your location, or notify your saved contacts.
              </p>
              <div className="rt-sos-actions">
                <Button variant="ghost" onClick={() => setSosOpen(false)}>Close</Button>
                <Button variant="danger" onClick={() => setSosActive(true)}>
                  <PhoneCall size={15} aria-hidden="true" />
                  Activate local demo
                </Button>
              </div>
            </>
          ) : (
            <div className="rt-sos-active">
              <span className="rt-sos-active-icon"><AlertTriangle size={26} /></span>
              <strong>SOS demo activated locally</strong>
              <p>No call, message, location share, or emergency contact action was performed.</p>
              <div className="rt-sos-actions">
                <Button variant="ghost" onClick={() => setSosOpen(false)}>
                  <X size={15} aria-hidden="true" />
                  Close
                </Button>
                <Button variant="danger" onClick={() => { setSosActive(false); setSosOpen(false); }}>
                  Cancel demo
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

export default SafetyPage;
