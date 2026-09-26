import { useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Armchair,
  CarFront,
  Check,
  CheckCircle2,
  Gauge,
  LoaderCircle,
  Palette,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { DraftBanner } from "../components/DraftBanner";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { useApp, type VehicleFormValues } from "../context/AppContext";
import { useDraft, type DraftScope } from "../services/drafts";
import type { Vehicle } from "../types";

/** Form state is the same shape the repository accepts; one type, no drift. */
type VehicleDraft = VehicleFormValues;

type VehicleErrors = Partial<Record<keyof VehicleDraft, string>>;

const emptyDraft: VehicleDraft = {
  name: "",
  make: "",
  model: "",
  color: "",
  plate: "",
  seats: 4,
};

const vehicleStyles = `
.rt-vehicles-page {
  min-height: 100%;
  padding: 28px 20px 60px;
  color: var(--rt-text, #17231c);
  background: var(--rt-surface-subtle, #f6faf7);
}
.rt-vehicles-shell { max-width: 1160px; margin: 0 auto; }
.rt-vehicles-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin: 22px 0 18px;
}
.rt-vehicles-summary { display: flex; align-items: center; gap: 12px; min-width: 0; }
.rt-vehicles-summary-icon {
  width: 45px;
  height: 45px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 14px;
  color: #148542;
  background: #dff4e6;
}
.rt-vehicles-summary-copy strong { display: block; font-size: .92rem; }
.rt-vehicles-summary-copy span { display: block; margin-top: 3px; color: #708077; font-size: .78rem; }
.rt-vehicles-add {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 17px;
  border: 0;
  border-radius: 12px;
  color: #fff;
  background: #159447;
  box-shadow: 0 8px 20px rgba(21, 148, 71, .2);
  font: inherit;
  font-size: .84rem;
  font-weight: 760;
  cursor: pointer;
}
.rt-vehicles-add:hover { background: #10813b; }
.rt-vehicles-alert {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 16px;
  padding: 13px 15px;
  border: 1px solid #f1b7b7;
  border-radius: 13px;
  color: #9c2f2f;
  background: #fff1f1;
  font-size: .81rem;
  line-height: 1.45;
}
.rt-vehicles-alert svg { flex: 0 0 auto; margin-top: 1px; }
.rt-vehicles-alert-success { color: #116f38; border-color: #bde6ca; background: #ecf9f0; }
.rt-vehicles-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.rt-vehicle-card {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--rt-border, #dce7df);
  border-radius: 21px;
  background: var(--rt-card, #fff);
  box-shadow: 0 10px 30px rgba(29, 64, 42, .06);
  transition: transform .2s ease, box-shadow .2s ease;
}
.rt-vehicle-card:hover { transform: translateY(-2px); box-shadow: 0 16px 36px rgba(29, 64, 42, .09); }
.rt-vehicle-card-default { border-color: rgba(21, 148, 71, .42); }
.rt-vehicle-visual {
  position: relative;
  min-height: 128px;
  display: flex;
  align-items: center;
  padding: 22px;
  overflow: hidden;
  background: linear-gradient(135deg, #e9f8ee 0%, #f8fcf9 72%);
}
.rt-vehicle-visual::before, .rt-vehicle-visual::after {
  content: "";
  position: absolute;
  border-radius: 50%;
  background: rgba(21, 148, 71, .07);
}
.rt-vehicle-visual::before { width: 190px; height: 190px; right: -70px; top: -100px; }
.rt-vehicle-visual::after { width: 110px; height: 110px; left: -50px; bottom: -75px; }
.rt-vehicle-car-icon {
  position: relative;
  z-index: 1;
  width: 72px;
  height: 72px;
  display: grid;
  place-items: center;
  border-radius: 22px;
  color: #fff;
  background: linear-gradient(145deg, #1aa14e, #0d7637);
  box-shadow: 0 12px 24px rgba(21, 148, 71, .23);
}
.rt-vehicle-badges { position: absolute; z-index: 1; top: 16px; right: 16px; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.rt-vehicle-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 9px;
  border-radius: 999px;
  color: #425249;
  background: rgba(255,255,255,.84);
  font-size: .68rem;
  font-weight: 750;
  backdrop-filter: blur(8px);
}
.rt-vehicle-badge-default { color: #0e7437; background: #dff5e7; }
.rt-vehicle-body { padding: 20px; }
.rt-vehicle-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.rt-vehicle-name { margin: 0; font-size: 1.15rem; letter-spacing: -.02em; }
.rt-vehicle-subtitle { margin: 5px 0 0; color: #6c7a72; font-size: .8rem; }
.rt-vehicle-actions { display: flex; gap: 6px; }
.rt-vehicle-icon-button {
  width: 37px;
  height: 37px;
  display: grid;
  place-items: center;
  border: 1px solid #dfe7e1;
  border-radius: 11px;
  color: #58675f;
  background: #fff;
  cursor: pointer;
  transition: color .18s ease, background .18s ease, border-color .18s ease;
}
.rt-vehicle-icon-button:hover { color: #12833e; border-color: #b8ddc4; background: #f0faf3; }
.rt-vehicle-icon-button-danger:hover { color: #c23d3d; border-color: #efb9b9; background: #fff1f1; }
.rt-vehicle-icon-button:disabled { opacity: .45; cursor: not-allowed; }
.rt-vehicle-specs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; margin: 18px 0; }
.rt-vehicle-spec {
  min-width: 0;
  padding: 10px;
  border-radius: 12px;
  background: #f5f8f6;
}
.rt-vehicle-spec-label { display: flex; align-items: center; gap: 5px; color: #7a877f; font-size: .65rem; text-transform: uppercase; letter-spacing: .035em; }
.rt-vehicle-spec-value { display: block; margin-top: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .78rem; font-weight: 730; }
.rt-vehicle-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 16px; border-top: 1px solid #edf2ee; }
.rt-vehicle-seat-note { color: #6e7c73; font-size: .73rem; }
.rt-vehicle-default-button {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 11px;
  border: 1px solid #cce5d5;
  border-radius: 10px;
  color: #137b3d;
  background: #f0faf4;
  font: inherit;
  font-size: .74rem;
  font-weight: 750;
  cursor: pointer;
}
.rt-vehicle-default-button:hover:not(:disabled) { background: #ddf4e5; }
.rt-vehicle-default-button:disabled { color: #5f6f65; border-color: #dfe5e1; background: #f4f6f5; cursor: default; }
.rt-vehicles-empty { grid-column: 1 / -1; min-height: 330px; display: grid; place-items: center; border: 1px dashed #cddbd2; border-radius: 21px; background: rgba(255,255,255,.58); }
.rt-vehicles-loading { display: grid; justify-items: center; gap: 12px; color: #6d7c73; font-size: .82rem; }
.rt-vehicles-spin { color: #159447; animation: rt-vehicles-spin .8s linear infinite; }
@keyframes rt-vehicles-spin { to { transform: rotate(360deg); } }
.rt-vehicle-form { display: grid; gap: 18px; }
.rt-vehicle-form-intro { display: flex; align-items: flex-start; gap: 11px; margin: 0; padding: 12px 13px; border-radius: 12px; color: #496056; background: #f1f8f3; font-size: .78rem; line-height: 1.5; }
.rt-vehicle-form-intro svg { flex: 0 0 auto; color: #159447; margin-top: 1px; }
.rt-vehicle-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px; }
.rt-vehicle-field { display: grid; gap: 6px; min-width: 0; }
.rt-vehicle-field-full { grid-column: 1 / -1; }
.rt-vehicle-label { color: #34473b; font-size: .78rem; font-weight: 750; }
.rt-vehicle-label span { color: #849087; font-weight: 500; }
.rt-vehicle-input {
  width: 100%;
  min-height: 44px;
  padding: 9px 11px;
  border: 1px solid #d8e2db;
  border-radius: 11px;
  color: var(--rt-text, #17231c);
  background: #fff;
  outline: none;
  font: inherit;
  font-size: .86rem;
  transition: border-color .18s ease, box-shadow .18s ease;
}
.rt-vehicle-input:focus { border-color: #159447; box-shadow: 0 0 0 3px rgba(21, 148, 71, .11); }
.rt-vehicle-input[aria-invalid="true"] { border-color: #d94c4c; }
.rt-vehicle-field-error { display: flex; align-items: center; gap: 5px; color: #b93434; font-size: .72rem; }
.rt-vehicle-form-actions { display: flex; justify-content: flex-end; gap: 9px; padding-top: 3px; }
.rt-vehicle-secondary, .rt-vehicle-primary, .rt-vehicle-danger {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 15px;
  border-radius: 11px;
  font: inherit;
  font-size: .8rem;
  font-weight: 750;
  cursor: pointer;
}
.rt-vehicle-secondary { border: 1px solid #d8e2db; color: #536159; background: #fff; }
.rt-vehicle-secondary:hover:not(:disabled) { background: #f6f8f7; }
.rt-vehicle-primary { border: 0; color: #fff; background: #159447; }
.rt-vehicle-primary:hover:not(:disabled) { background: #10813b; }
.rt-vehicle-danger { border: 0; color: #fff; background: #cf4343; }
.rt-vehicle-danger:hover:not(:disabled) { background: #b73737; }
.rt-vehicle-secondary:disabled, .rt-vehicle-primary:disabled, .rt-vehicle-danger:disabled { opacity: .58; cursor: not-allowed; }
.rt-vehicle-delete-copy { margin: 0; color: #66746c; font-size: .86rem; line-height: 1.6; }
.rt-vehicle-delete-warning { display: flex; gap: 9px; margin: 14px 0 0; padding: 11px 12px; border-radius: 11px; color: #8c3434; background: #fff0f0; font-size: .76rem; line-height: 1.45; }
.rt-vehicle-delete-warning svg { flex: 0 0 auto; }
[data-theme="dark"] .rt-vehicles-page { --rt-surface-subtle: #101712; --rt-card: #17211a; --rt-border: #2b3a30; --rt-text: #eef7f1; }
[data-theme="dark"] .rt-vehicle-body, [data-theme="dark"] .rt-vehicle-icon-button, [data-theme="dark"] .rt-vehicle-input, [data-theme="dark"] .rt-vehicle-secondary { color: #eef7f1; background: #17211a; border-color: #34463a; }
[data-theme="dark"] .rt-vehicle-subtitle, [data-theme="dark"] .rt-vehicle-seat-note, [data-theme="dark"] .rt-vehicle-spec-label, [data-theme="dark"] .rt-vehicle-label { color: #a6b5ac; }
[data-theme="dark"] .rt-vehicle-visual { background: linear-gradient(135deg, #183321 0%, #17251b 72%); }
[data-theme="dark"] .rt-vehicle-spec { background: #1c2820; }
[data-theme="dark"] .rt-vehicle-footer { border-color: #2b3a30; }
[data-theme="dark"] .rt-vehicles-alert-success { color: #a7e7ba; background: #17351f; border-color: #315a3c; }
@media (max-width: 780px) {
  .rt-vehicles-grid { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .rt-vehicles-page { padding: 18px 14px 42px; }
  .rt-vehicles-toolbar { align-items: stretch; flex-direction: column; }
  .rt-vehicles-add { width: 100%; }
  .rt-vehicle-form-grid { grid-template-columns: 1fr; }
  .rt-vehicle-field-full { grid-column: auto; }
  .rt-vehicle-specs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rt-vehicle-visual { min-height: 116px; }
  .rt-vehicle-body { padding: 17px; }
  .rt-vehicle-footer { align-items: flex-start; flex-direction: column; }
  .rt-vehicle-default-button { width: 100%; }
  .rt-vehicle-form-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`;

export function VehiclesPage() {
  const { loading, activeUserId, vehicles, rides, saveVehicle, updateVehicle, setDefaultVehicle, deleteVehicle } = useApp();
  const [formOpen, setFormOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [errors, setErrors] = useState<VehicleErrors>({});
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Vehicle | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const ownedVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.userId === activeUserId),
    [activeUserId, vehicles],
  );

  /**
   * The add/edit form is keyed by mode so an unfinished "add" and an unfinished
   * "edit vehicle X" cannot overwrite each other, and both survive a reload.
   *
   * In edit mode the fallback is the vehicle's saved values, so opening a vehicle
   * shows its real details unless the user has an unfinished edit in progress.
   * Opening the form changes `editingVehicle` and the scope together, so the draft
   * store re-seeds with this fallback on the same render.
   */
  const vehicleDraftScope: DraftScope = editingVehicle ? `vehicle-form:${editingVehicle.id}` : "vehicle-form";
  const vehicleDraftFallback = useMemo<VehicleDraft>(
    () => (editingVehicle
      ? {
        name: editingVehicle.name,
        make: editingVehicle.make,
        model: editingVehicle.model,
        color: editingVehicle.color,
        plate: editingVehicle.plate,
        seats: editingVehicle.seats,
      }
      : emptyDraft),
    [editingVehicle],
  );
  const vehicleDraft = useDraft<VehicleDraft>(vehicleDraftScope, vehicleDraftFallback, activeUserId);
  const { value: draft, setValue: setDraftValue } = vehicleDraft;
  const setDraft = setDraftValue;

  const openAdd = () => {
    setEditingVehicle(null);
    setFormOpen(true);
    setErrors({});
    setFeedback(null);
  };

  const openEdit = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setFormOpen(true);
    setErrors({});
    setFeedback(null);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setEditingVehicle(null);
    setErrors({});
  };

  const updateDraft = <K extends keyof VehicleDraft>(key: K, value: VehicleDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const validate = () => {
    const next: VehicleErrors = {};
    const normalizedPlate = draft.plate.trim().toUpperCase();
    if (draft.name.trim().length < 2) next.name = "Give this vehicle a recognizable nickname.";
    if (!draft.make.trim()) next.make = "Enter the vehicle manufacturer.";
    if (!draft.model.trim()) next.model = "Enter the vehicle model.";
    if (!draft.color.trim()) next.color = "Enter the vehicle color.";
    if (!/^[A-Z0-9 -]{4,15}$/.test(normalizedPlate)) next.plate = "Use 4–15 letters, numbers, spaces, or hyphens.";
    if (!Number.isInteger(draft.seats) || draft.seats < 1 || draft.seats > 12) next.seats = "Choose between 1 and 12 rider seats.";
    const duplicate = ownedVehicles.some(
      (vehicle) => vehicle.id !== editingVehicle?.id && vehicle.plate.trim().toUpperCase() === normalizedPlate,
    );
    if (duplicate) next.plate = "You already have a vehicle with this plate.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;
    setSaving(true);
    const cleanDraft = {
      name: draft.name.trim(),
      make: draft.make.trim(),
      model: draft.model.trim(),
      color: draft.color.trim(),
      plate: draft.plate.trim().toUpperCase(),
      seats: draft.seats,
    };
    try {
      if (editingVehicle) {
        await updateVehicle(editingVehicle.id, cleanDraft);
        setFeedback({ type: "success", text: `${cleanDraft.name} was updated.` });
      } else {
        // No id, no userId, no isDefault: the repository inserts a row owned by
        // the signed-in Supabase user and promotes it to default if this is the
        // member's first vehicle. Passing a client-generated id here previously
        // routed the add through the UPDATE branch and always failed.
        await saveVehicle(cleanDraft);
        setFeedback({ type: "success", text: `${cleanDraft.name} was added.` });
      }
      setFormOpen(false);
      setEditingVehicle(null);
      // Persisted in Supabase, so the unfinished form draft is no longer needed.
      vehicleDraft.complete();
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to save this vehicle.",
      });
    } finally {
      setSaving(false);
    }
  };

  const chooseDefault = async (vehicle: Vehicle) => {
    if (vehicle.isDefault) return;
    setFeedback(null);
    try {
      await setDefaultVehicle(vehicle.id);
      setFeedback({ type: "success", text: `${vehicle.name} is now your default vehicle.` });
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to update the default vehicle.",
      });
    }
  };

  const requestDelete = (vehicle: Vehicle) => {
    setFeedback(null);
    const protectedRide = rides.find(
      (ride) => ride.vehicleId === vehicle.id && (ride.status === "active" || ride.status === "completed"),
    );
    if (protectedRide) {
      const statusLabel = protectedRide.status === "active" ? "an active" : "a completed";
      setFeedback({
        type: "error",
        text: `${vehicle.name} is linked to ${statusLabel} ride (${protectedRide.origin.label} to ${protectedRide.destination.label}). Cancel or complete that ride before deleting this vehicle.`,
      });
      return;
    }
    setPendingDelete(vehicle);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteVehicle(pendingDelete.id);
      setFeedback({ type: "success", text: `${pendingDelete.name} was deleted.` });
      setPendingDelete(null);
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to delete this vehicle.",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rt-vehicles-page">
      <style>{vehicleStyles}</style>
      <div className="rt-vehicles-shell">
        <PageHeader
          title="My vehicles"
          subtitle="Manage the vehicles available for your offered rides and choose a preferred default."
        />

        <div className="rt-vehicles-toolbar">
          <div className="rt-vehicles-summary">
            <span className="rt-vehicles-summary-icon"><CarFront size={22} /></span>
            <span className="rt-vehicles-summary-copy">
              <strong>{loading ? "Loading…" : `${ownedVehicles.length} ${ownedVehicles.length === 1 ? "vehicle" : "vehicles"}`}</strong>
              <span>{loading ? "Getting your vehicles." : ownedVehicles.length ? "Only you can edit or remove these vehicles." : "Add a vehicle before offering a ride."}</span>
            </span>
          </div>
          <button className="rt-vehicles-add" data-testid="vehicle-add" type="button" onClick={openAdd}>
            <Plus size={17} /> Add vehicle
          </button>
        </div>

        {feedback && (
          <div
            className={`rt-vehicles-alert${feedback.type === "success" ? " rt-vehicles-alert-success" : ""}`}
            role={feedback.type === "error" ? "alert" : "status"}
          >
            {feedback.type === "success" ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
            <span>{feedback.text}</span>
          </div>
        )}

        <div className="rt-vehicles-grid">
          {loading ? (
            <div className="rt-vehicles-empty">
              <div className="rt-vehicles-loading" role="status">
                <LoaderCircle className="rt-vehicles-spin" size={24} aria-hidden="true" />
                <span className="sr-only">Loading your vehicles</span>
              </div>
            </div>
          ) : ownedVehicles.length === 0 ? (
            <div className="rt-vehicles-empty">
              <EmptyState
                title="No vehicles yet"
                description="Add the car you use for carpooling, then set it as your default for faster ride posting."
              />
            </div>
          ) : ownedVehicles.map((vehicle) => (
            <article className={`rt-vehicle-card${vehicle.isDefault ? " rt-vehicle-card-default" : ""}`} key={vehicle.id}>
              <div className="rt-vehicle-visual">
                <span className="rt-vehicle-car-icon"><CarFront size={38} /></span>
                <div className="rt-vehicle-badges">
                  {vehicle.isDefault && <span className="rt-vehicle-badge rt-vehicle-badge-default"><Check size={12} /> Default</span>}
                  <span className="rt-vehicle-badge"><ShieldCheck size={12} /> Saved vehicle</span>
                </div>
              </div>
              <div className="rt-vehicle-body">
                <div className="rt-vehicle-title-row">
                  <div>
                    <h2 className="rt-vehicle-name">{vehicle.name}</h2>
                    <p className="rt-vehicle-subtitle">{vehicle.make} {vehicle.model}</p>
                  </div>
                  <div className="rt-vehicle-actions">
                    <button className="rt-vehicle-icon-button" data-testid={`vehicle-edit-${vehicle.id}`} type="button" onClick={() => openEdit(vehicle)} aria-label={`Edit ${vehicle.name}`}>
                      <Pencil size={16} />
                    </button>
                    <button
                      className="rt-vehicle-icon-button rt-vehicle-icon-button-danger"
                      type="button"
                      onClick={() => requestDelete(vehicle)}
                      aria-label={`Delete ${vehicle.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="rt-vehicle-specs">
                  <div className="rt-vehicle-spec">
                    <span className="rt-vehicle-spec-label"><Gauge size={12} /> Plate</span>
                    <strong className="rt-vehicle-spec-value">{vehicle.plate}</strong>
                  </div>
                  <div className="rt-vehicle-spec">
                    <span className="rt-vehicle-spec-label"><Palette size={12} /> Color</span>
                    <strong className="rt-vehicle-spec-value">{vehicle.color}</strong>
                  </div>
                  <div className="rt-vehicle-spec">
                    <span className="rt-vehicle-spec-label"><Armchair size={12} /> Rider seats</span>
                    <strong className="rt-vehicle-spec-value">{vehicle.seats}</strong>
                  </div>
                </div>
                <div className="rt-vehicle-footer">
                  <span className="rt-vehicle-seat-note">Rider seats exclude the driver</span>
                  <button
                    className="rt-vehicle-default-button"
                    type="button"
                    onClick={() => void chooseDefault(vehicle)}
                    disabled={vehicle.isDefault}
                  >
                    <Check size={14} /> {vehicle.isDefault ? "Default vehicle" : "Set as default"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <Modal
        isOpen={formOpen}
        onClose={closeForm}
        title={editingVehicle ? "Edit vehicle" : "Add a vehicle"}
        size="md"
      >
        <form className="rt-vehicle-form" onSubmit={handleSave} noValidate>
          {vehicleDraft.restored ? (
            <DraftBanner
              savedAt={vehicleDraft.savedAt}
              workflow={editingVehicle ? "vehicle edit" : "vehicle form"}
              onDiscard={vehicleDraft.discard}
              onDismiss={vehicleDraft.dismissBanner}
            />
          ) : null}
          <p className="rt-vehicle-form-intro"><UserRound size={17} /> Vehicle details are private and can only be managed by the active profile.</p>
          <div className="rt-vehicle-form-grid">
            <label className="rt-vehicle-field rt-vehicle-field-full">
              <span className="rt-vehicle-label">Vehicle nickname</span>
              <input className="rt-vehicle-input" data-testid="vehicle-name" value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="e.g. Green City Car" aria-invalid={Boolean(errors.name)} />
              {errors.name && <span className="rt-vehicle-field-error"><AlertCircle size={12} />{errors.name}</span>}
            </label>
            <label className="rt-vehicle-field">
              <span className="rt-vehicle-label">Make</span>
              <input className="rt-vehicle-input" data-testid="vehicle-make" value={draft.make} onChange={(event) => updateDraft("make", event.target.value)} placeholder="e.g. Toyota" autoComplete="off" aria-invalid={Boolean(errors.make)} />
              {errors.make && <span className="rt-vehicle-field-error"><AlertCircle size={12} />{errors.make}</span>}
            </label>
            <label className="rt-vehicle-field">
              <span className="rt-vehicle-label">Model</span>
              <input className="rt-vehicle-input" data-testid="vehicle-model" value={draft.model} onChange={(event) => updateDraft("model", event.target.value)} placeholder="e.g. Corolla" autoComplete="off" aria-invalid={Boolean(errors.model)} />
              {errors.model && <span className="rt-vehicle-field-error"><AlertCircle size={12} />{errors.model}</span>}
            </label>
            <label className="rt-vehicle-field">
              <span className="rt-vehicle-label">Color</span>
              <input className="rt-vehicle-input" data-testid="vehicle-color" value={draft.color} onChange={(event) => updateDraft("color", event.target.value)} placeholder="e.g. Green" autoComplete="off" aria-invalid={Boolean(errors.color)} />
              {errors.color && <span className="rt-vehicle-field-error"><AlertCircle size={12} />{errors.color}</span>}
            </label>
            <label className="rt-vehicle-field">
              <span className="rt-vehicle-label">Registration plate</span>
              <input className="rt-vehicle-input" data-testid="vehicle-plate" value={draft.plate} onChange={(event) => updateDraft("plate", event.target.value.toUpperCase())} placeholder="e.g. WB 12 AB 1234" autoCapitalize="characters" aria-invalid={Boolean(errors.plate)} />
              {errors.plate && <span className="rt-vehicle-field-error"><AlertCircle size={12} />{errors.plate}</span>}
            </label>
            <label className="rt-vehicle-field rt-vehicle-field-full">
               <span className="rt-vehicle-label">Available rider seats <span>(1–12, excluding the driver)</span></span>
               <input className="rt-vehicle-input" data-testid="vehicle-seats" type="number" min={1} max={12} step={1} value={draft.seats} onChange={(event) => updateDraft("seats", Number(event.target.value))} aria-invalid={Boolean(errors.seats)} />
              {errors.seats && <span className="rt-vehicle-field-error"><AlertCircle size={12} />{errors.seats}</span>}
            </label>
          </div>
          <div className="rt-vehicle-form-actions">
            <button className="rt-vehicle-secondary" type="button" onClick={closeForm} disabled={saving}>Cancel</button>
            <button className="rt-vehicle-primary" data-testid="vehicle-save" type="submit" disabled={saving}>
              <Check size={15} /> {saving ? "Saving…" : editingVehicle ? "Save changes" : "Add vehicle"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={Boolean(pendingDelete)} onClose={() => !deleting && setPendingDelete(null)} title="Delete vehicle?" size="sm">
        <p className="rt-vehicle-delete-copy">
          This removes <strong>{pendingDelete?.name}</strong> from your active profile. This action cannot be undone.
        </p>
        <div className="rt-vehicle-delete-warning"><AlertCircle size={16} /> Vehicles linked to active or completed rides cannot be deleted.</div>
        <div className="rt-vehicle-form-actions" style={{ marginTop: 20 }}>
          <button className="rt-vehicle-secondary" type="button" onClick={() => setPendingDelete(null)} disabled={deleting}>Keep vehicle</button>
          <button className="rt-vehicle-danger" type="button" onClick={() => void confirmDelete()} disabled={deleting}>
            <Trash2 size={15} /> {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

export default VehiclesPage;
