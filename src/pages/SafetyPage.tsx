import { useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { DraftBanner } from "../components/DraftBanner";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
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
.rt-safety-page {
  min-height: 100%;
  padding: 28px 20px 60px;
  color: var(--rt-text, #17231c);
  background: var(--rt-surface-subtle, #f6faf7);
}
.rt-safety-shell { max-width: 1160px; margin: 0 auto; }
.rt-safety-hero {
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 24px;
  align-items: center;
  margin-top: 22px;
  padding: 27px 28px;
  border: 1px solid rgba(21, 148, 71, .2);
  border-radius: 23px;
  background: linear-gradient(135deg, #eaf8ef 0%, #fff 74%);
  box-shadow: 0 14px 38px rgba(21, 148, 71, .08);
}
.rt-safety-hero::after {
  content: "";
  position: absolute;
  width: 240px;
  height: 240px;
  right: -75px;
  bottom: -155px;
  border-radius: 50%;
  background: rgba(21, 148, 71, .08);
}
.rt-safety-hero-copy { position: relative; z-index: 1; }
.rt-safety-kicker { display: flex; align-items: center; gap: 8px; color: #11773a; font-size: .75rem; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
.rt-safety-hero h2 { margin: 11px 0 7px; font-size: clamp(1.35rem, 3vw, 1.8rem); letter-spacing: -.03em; }
.rt-safety-hero p { max-width: 690px; margin: 0; color: #617168; font-size: .84rem; line-height: 1.6; }
.rt-safety-demo-button {
  position: relative;
  z-index: 1;
  min-height: 50px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 0 20px;
  border: 0;
  border-radius: 14px;
  color: #fff;
  background: #d94646;
  box-shadow: 0 10px 24px rgba(217, 70, 70, .23);
  font: inherit;
  font-size: .84rem;
  font-weight: 800;
  cursor: pointer;
}
.rt-safety-demo-button:hover { background: #c53b3b; }
.rt-safety-demo-label { font-size: .62rem; font-weight: 800; letter-spacing: .09em; opacity: .85; }
.rt-safety-active-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
  padding: 14px 16px;
  border: 1px solid #efb2b2;
  border-radius: 14px;
  color: #9b3030;
  background: #fff0f0;
}
.rt-safety-active-copy { display: flex; align-items: center; gap: 10px; }
.rt-safety-active-copy svg { flex: 0 0 auto; }
.rt-safety-active-copy strong { display: block; font-size: .82rem; }
.rt-safety-active-copy span { display: block; margin-top: 2px; font-size: .72rem; }
.rt-safety-cancel {
  flex: 0 0 auto;
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid #e49c9c;
  border-radius: 9px;
  color: #a63333;
  background: #fff;
  font: inherit;
  font-size: .72rem;
  font-weight: 750;
  cursor: pointer;
}
.rt-safety-section { margin-top: 24px; }
.rt-safety-section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.rt-safety-section-head h2 { margin: 0; font-size: 1.16rem; letter-spacing: -.02em; }
.rt-safety-section-head p { margin: 5px 0 0; color: #6d7b73; font-size: .8rem; line-height: 1.45; }
.rt-safety-add {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 13px;
  border: 0;
  border-radius: 11px;
  color: #fff;
  background: #159447;
  font: inherit;
  font-size: .78rem;
  font-weight: 760;
  cursor: pointer;
}
.rt-safety-add:hover { background: #10813b; }
.rt-safety-contact-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.rt-safety-contact-card {
  display: flex;
  align-items: center;
  gap: 13px;
  min-width: 0;
  padding: 17px;
  border: 1px solid var(--rt-border, #dce7df);
  border-radius: 17px;
  background: var(--rt-card, #fff);
  box-shadow: 0 8px 24px rgba(29, 64, 42, .05);
}
.rt-safety-contact-avatar { width: 43px; height: 43px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 14px; color: #137c3d; background: #e2f5e8; }
.rt-safety-contact-copy { min-width: 0; flex: 1; }
.rt-safety-contact-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .87rem; font-weight: 780; }
.rt-safety-contact-relationship { display: block; margin-top: 3px; color: #748179; font-size: .7rem; }
.rt-safety-contact-phone { display: flex; align-items: center; gap: 5px; margin-top: 6px; color: #3d5145; font-size: .75rem; }
.rt-safety-contact-actions { display: flex; flex-direction: column; gap: 5px; }
.rt-safety-icon-button {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid #dde6df;
  border-radius: 9px;
  color: #5c6b62;
  background: #fff;
  cursor: pointer;
}
.rt-safety-icon-button:hover { color: #137e3e; border-color: #b9ddc5; background: #f0faf3; }
.rt-safety-icon-button-danger:hover { color: #c23e3e; border-color: #efb7b7; background: #fff1f1; }
.rt-safety-empty { grid-column: 1 / -1; min-height: 230px; display: grid; place-items: center; border: 1px dashed #cbd9cf; border-radius: 18px; background: rgba(255,255,255,.52); }
.rt-safety-alert {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-bottom: 13px;
  padding: 12px 14px;
  border: 1px solid #efb7b7;
  border-radius: 12px;
  color: #9f3131;
  background: #fff1f1;
  font-size: .78rem;
  line-height: 1.45;
}
.rt-safety-alert-success { color: #146f39; border-color: #bde5c9; background: #edf9f1; }
.rt-safety-alert svg { flex: 0 0 auto; margin-top: 1px; }
.rt-safety-tips { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 15px; }
.rt-safety-tip {
  padding: 20px;
  border: 1px solid var(--rt-border, #dce7df);
  border-radius: 18px;
  background: var(--rt-card, #fff);
  box-shadow: 0 8px 24px rgba(29, 64, 42, .045);
}
.rt-safety-tip-icon { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px; color: #147f3f; background: #e4f6ea; }
.rt-safety-tip h3 { margin: 15px 0 6px; font-size: .9rem; }
.rt-safety-tip p { margin: 0; color: #6a786f; font-size: .77rem; line-height: 1.55; }
.rt-safety-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 15px;
  padding: 13px 15px;
  border-radius: 13px;
  color: #5d5143;
  background: #fff8ea;
  font-size: .76rem;
  line-height: 1.5;
}
.rt-safety-note svg { flex: 0 0 auto; color: #b37818; }
.rt-safety-form { display: grid; gap: 17px; }
.rt-safety-form-intro { display: flex; align-items: flex-start; gap: 10px; margin: 0; padding: 12px 13px; border-radius: 12px; color: #4e6056; background: #f1f8f3; font-size: .77rem; line-height: 1.5; }
.rt-safety-form-intro svg { flex: 0 0 auto; color: #159447; margin-top: 1px; }
.rt-safety-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px; }
.rt-safety-field { display: grid; gap: 6px; min-width: 0; }
.rt-safety-field-full { grid-column: 1 / -1; }
.rt-safety-label { color: #35483d; font-size: .78rem; font-weight: 750; }
.rt-safety-input {
  width: 100%;
  min-height: 44px;
  padding: 9px 11px;
  border: 1px solid #d7e2da;
  border-radius: 11px;
  color: var(--rt-text, #17231c);
  background: #fff;
  outline: none;
  font: inherit;
  font-size: .86rem;
  transition: border-color .18s ease, box-shadow .18s ease;
}
.rt-safety-input:focus { border-color: #159447; box-shadow: 0 0 0 3px rgba(21, 148, 71, .11); }
.rt-safety-input[aria-invalid="true"] { border-color: #d94c4c; }
.rt-safety-field-error { display: flex; align-items: center; gap: 5px; color: #b73535; font-size: .72rem; }
.rt-safety-form-actions { display: flex; justify-content: flex-end; gap: 9px; }
.rt-safety-secondary, .rt-safety-primary, .rt-safety-danger {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 15px;
  border-radius: 11px;
  font: inherit;
  font-size: .79rem;
  font-weight: 750;
  cursor: pointer;
}
.rt-safety-secondary { border: 1px solid #d7e2da; color: #526158; background: #fff; }
.rt-safety-primary { border: 0; color: #fff; background: #159447; }
.rt-safety-primary:hover:not(:disabled) { background: #10813b; }
.rt-safety-danger { border: 0; color: #fff; background: #cf4343; }
.rt-safety-danger:hover:not(:disabled) { background: #b73737; }
.rt-safety-secondary:disabled, .rt-safety-primary:disabled, .rt-safety-danger:disabled { opacity: .58; cursor: not-allowed; }
.rt-safety-delete-copy { margin: 0; color: #65736a; font-size: .86rem; line-height: 1.6; }
.rt-sos-modal { display: grid; gap: 16px; }
.rt-sos-warning {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 13px 14px;
  border: 1px solid #f0c0c0;
  border-radius: 12px;
  color: #922f2f;
  background: #fff1f1;
  font-size: .79rem;
  line-height: 1.5;
}
.rt-sos-warning svg { flex: 0 0 auto; margin-top: 1px; }
.rt-sos-list { margin: 0; padding-left: 20px; color: #5f6e65; font-size: .79rem; line-height: 1.7; }
.rt-sos-actions { display: flex; justify-content: flex-end; gap: 9px; }
.rt-sos-active {
  padding: 18px;
  border: 1px solid #efb4b4;
  border-radius: 14px;
  color: #8f2e2e;
  background: #fff3f3;
  text-align: center;
}
.rt-sos-active-icon { width: 50px; height: 50px; display: grid; place-items: center; margin: 0 auto 11px; border-radius: 50%; color: #fff; background: #d94646; }
.rt-sos-active strong { display: block; font-size: 1rem; }
.rt-sos-active p { margin: 7px 0 0; font-size: .78rem; line-height: 1.5; }
[data-theme="dark"] .rt-safety-page { --rt-surface-subtle: #101712; --rt-card: #17211a; --rt-border: #2b3a30; --rt-text: #eef7f1; }
[data-theme="dark"] .rt-safety-hero { background: linear-gradient(135deg, #17331f 0%, #17211a 74%); }
[data-theme="dark"] .rt-safety-hero p, [data-theme="dark"] .rt-safety-section-head p, [data-theme="dark"] .rt-safety-contact-relationship, [data-theme="dark"] .rt-safety-tip p { color: #a6b5ac; }
[data-theme="dark"] .rt-safety-contact-card, [data-theme="dark"] .rt-safety-tip, [data-theme="dark"] .rt-safety-input, [data-theme="dark"] .rt-safety-secondary, [data-theme="dark"] .rt-safety-icon-button { color: #eef7f1; background: #17211a; border-color: #34463a; }
[data-theme="dark"] .rt-safety-label { color: #eef7f1; }
[data-theme="dark"] .rt-safety-contact-phone { color: #cad8cf; }
[data-theme="dark"] .rt-safety-note { color: #ead7ad; background: #332817; }
[data-theme="dark"] .rt-safety-form-intro, [data-theme="dark"] .rt-sos-list { color: #c1cec5; background: #1d2a21; }
@media (max-width: 880px) {
  .rt-safety-contact-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  .rt-safety-hero { grid-template-columns: 1fr; padding: 22px; }
  .rt-safety-demo-button { width: 100%; }
  .rt-safety-tips { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .rt-safety-page { padding: 18px 14px 42px; }
  .rt-safety-section-head { align-items: stretch; flex-direction: column; }
  .rt-safety-add { width: 100%; }
  .rt-safety-contact-grid { grid-template-columns: 1fr; }
  .rt-safety-form-grid { grid-template-columns: 1fr; }
  .rt-safety-field-full { grid-column: auto; }
  .rt-safety-form-actions, .rt-sos-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rt-safety-active-banner { align-items: flex-start; flex-direction: column; }
  .rt-safety-cancel { width: 100%; }
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
          title="Safety center"
          subtitle="Prepare for shared rides, keep emergency contacts close, and try the clearly labeled local SOS demo."
        />

        <section className="rt-safety-hero">
          <div className="rt-safety-hero-copy">
            <span className="rt-safety-kicker"><ShieldCheck size={15} /> Ride responsibly</span>
            <h2>Your safety information stays in this browser</h2>
            <p>Emergency contacts are private to the active demo profile. In a real emergency, use your phone to contact local emergency services directly.</p>
          </div>
          <button className="rt-safety-demo-button" type="button" onClick={() => setSosOpen(true)}>
            <PhoneCall size={19} /> <span>Open SOS <span className="rt-safety-demo-label">Demo</span></span>
          </button>
        </section>

        {sosActive && (
          <div className="rt-safety-active-banner" role="status">
            <div className="rt-safety-active-copy">
              <AlertTriangle size={20} />
              <span><strong>SOS demo is active locally</strong><span>No call, message, location, or contact action was performed.</span></span>
            </div>
            <button className="rt-safety-cancel" type="button" onClick={() => setSosActive(false)}>Cancel demo</button>
          </div>
        )}

        <section className="rt-safety-section" aria-labelledby="emergency-contacts-title">
          <div className="rt-safety-section-head">
            <div>
              <h2 id="emergency-contacts-title">Emergency contacts</h2>
              <p>{ownedContacts.length} {ownedContacts.length === 1 ? "contact" : "contacts"} saved for the active profile.</p>
            </div>
            <button className="rt-safety-add" type="button" onClick={openAdd}><Plus size={15} /> Add contact</button>
          </div>

          {feedback && (
            <div className={`rt-safety-alert${feedback.type === "success" ? " rt-safety-alert-success" : ""}`} role={feedback.type === "error" ? "alert" : "status"}>
              {feedback.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <span>{feedback.text}</span>
            </div>
          )}

          <div className="rt-safety-contact-grid">
            {ownedContacts.length === 0 ? (
              <div className="rt-safety-empty">
                <EmptyState
                  title="No emergency contacts"
                  description="Add someone you trust. Their details remain private to the active RideTogether profile."
                />
              </div>
            ) : ownedContacts.map((contact) => (
              <article className="rt-safety-contact-card" key={contact.id}>
                <span className="rt-safety-contact-avatar"><UsersRound size={20} /></span>
                <div className="rt-safety-contact-copy">
                  <strong className="rt-safety-contact-name">{contact.name}</strong>
                  <span className="rt-safety-contact-relationship">{contact.relationship}</span>
                  <span className="rt-safety-contact-phone"><Phone size={12} />{contact.phone}</span>
                </div>
                <div className="rt-safety-contact-actions">
                  <button className="rt-safety-icon-button" type="button" onClick={() => openEdit(contact)} aria-label={`Edit ${contact.name}`}><Pencil size={14} /></button>
                  <button className="rt-safety-icon-button rt-safety-icon-button-danger" type="button" onClick={() => setPendingDelete(contact)} aria-label={`Delete ${contact.name}`}><Trash2 size={14} /></button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rt-safety-section" aria-labelledby="safety-guidance-title">
          <div className="rt-safety-section-head">
            <div>
              <h2 id="safety-guidance-title">Practical safety guidance</h2>
              <p>Simple habits to help everyone arrive prepared.</p>
            </div>
          </div>
          <div className="rt-safety-tips">
            <article className="rt-safety-tip">
              <span className="rt-safety-tip-icon"><Clock3 size={20} /></span>
              <h3>Confirm before leaving</h3>
              <p>Review the pickup point, departure time, vehicle, and driver or rider names in the trip chat before setting off.</p>
            </article>
            <article className="rt-safety-tip">
              <span className="rt-safety-tip-icon"><MapPin size={20} /></span>
              <h3>Share your trip</h3>
              <p>Tell a trusted person your route and expected arrival time, and keep your phone charged and accessible.</p>
            </article>
            <article className="rt-safety-tip">
              <span className="rt-safety-tip-icon"><MessageCircle size={20} /></span>
              <h3>Communicate early</h3>
              <p>Use trip chat for delays or changes. If a situation feels unsafe, move to a well-lit public place and seek local help.</p>
            </article>
          </div>
          <div className="rt-safety-note"><AlertCircle size={17} /><span>The SOS control in this demo is an interface preview only. It never calls, messages, shares location, or contacts anyone.</span></div>
        </section>
      </div>

      <Modal isOpen={formOpen} onClose={closeForm} title={editingContact ? "Edit emergency contact" : "Add emergency contact"} size="sm">
        <form className="rt-safety-form" onSubmit={handleSave} noValidate>
          {contactDraft.restored ? (
            <DraftBanner
              savedAt={contactDraft.savedAt}
              workflow={editingContact ? "contact edit" : "contact form"}
              onDiscard={contactDraft.discard}
              onDismiss={contactDraft.dismissBanner}
            />
          ) : null}
          <p className="rt-safety-form-intro"><ShieldCheck size={17} /> This contact is visible only within the active profile’s safety settings.</p>
          <div className="rt-safety-form-grid">
            <label className="rt-safety-field rt-safety-field-full">
              <span className="rt-safety-label">Full name</span>
              <input className="rt-safety-input" value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="e.g. Priya Sharma" autoComplete="name" aria-invalid={Boolean(errors.name)} />
              {errors.name && <span className="rt-safety-field-error"><AlertCircle size={12} />{errors.name}</span>}
            </label>
            <label className="rt-safety-field rt-safety-field-full">
              <span className="rt-safety-label">Phone number</span>
              <input className="rt-safety-input" type="tel" value={draft.phone} onChange={(event) => updateDraft("phone", event.target.value)} placeholder="e.g. +91 98765 43210" autoComplete="tel" aria-invalid={Boolean(errors.phone)} />
              {errors.phone && <span className="rt-safety-field-error"><AlertCircle size={12} />{errors.phone}</span>}
            </label>
            <label className="rt-safety-field rt-safety-field-full">
              <span className="rt-safety-label">Relationship</span>
              <input className="rt-safety-input" value={draft.relationship} onChange={(event) => updateDraft("relationship", event.target.value)} placeholder="e.g. Family, friend, colleague" autoComplete="off" aria-invalid={Boolean(errors.relationship)} />
              {errors.relationship && <span className="rt-safety-field-error"><AlertCircle size={12} />{errors.relationship}</span>}
            </label>
          </div>
          <div className="rt-safety-form-actions">
            <button className="rt-safety-secondary" type="button" onClick={closeForm} disabled={saving}>Cancel</button>
            <button className="rt-safety-primary" type="submit" disabled={saving}><Check size={15} /> {saving ? "Saving…" : "Save contact"}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={Boolean(pendingDelete)} onClose={() => !deleting && setPendingDelete(null)} title="Remove emergency contact?" size="sm">
        <p className="rt-safety-delete-copy">Remove <strong>{pendingDelete?.name}</strong> from the active profile? This cannot be undone.</p>
        <div className="rt-safety-form-actions" style={{ marginTop: 20 }}>
          <button className="rt-safety-secondary" type="button" onClick={() => setPendingDelete(null)} disabled={deleting}>Keep contact</button>
          <button className="rt-safety-danger" type="button" onClick={() => void confirmDelete()} disabled={deleting}><Trash2 size={15} /> {deleting ? "Removing…" : "Remove"}</button>
        </div>
      </Modal>

      <Modal isOpen={sosOpen} onClose={() => setSosOpen(false)} title="SOS demo — no emergency call" size="sm">
        <div className="rt-sos-modal">
          <div className="rt-sos-warning"><AlertTriangle size={19} /><span><strong>This is a demo interface only.</strong> It does not contact emergency services, emergency contacts, or anyone else.</span></div>
          {!sosActive ? (
            <>
              <p className="rt-sos-list">Activating this demo changes only the local state of this page. It does not place a call, send a message, share your location, or notify your saved contacts.</p>
              <div className="rt-sos-actions">
                <button className="rt-safety-secondary" type="button" onClick={() => setSosOpen(false)}>Close</button>
                <button className="rt-safety-danger" type="button" onClick={() => setSosActive(true)}><PhoneCall size={15} /> Activate local demo</button>
              </div>
            </>
          ) : (
            <div className="rt-sos-active">
              <span className="rt-sos-active-icon"><AlertTriangle size={24} /></span>
              <strong>SOS demo activated locally</strong>
              <p>No call, message, location share, or emergency contact action was performed.</p>
              <div className="rt-sos-actions" style={{ marginTop: 16, display: "flex" }}>
                <button className="rt-safety-secondary" type="button" onClick={() => setSosOpen(false)}><X size={15} /> Close</button>
                <button className="rt-safety-danger" type="button" onClick={() => { setSosActive(false); setSosOpen(false); }}>Cancel demo</button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

export default SafetyPage;
