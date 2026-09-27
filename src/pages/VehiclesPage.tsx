import { useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Armchair,
  CarFront,
  Check,
  Gauge,
  Palette,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { DraftBanner } from "../components/DraftBanner";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge, IconButton } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Group } from "../components/ui/Group";
import { SkeletonList, State } from "../components/ui/State";
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
.rt-vehicles-page { min-height: 100%; background: var(--rt-surface-subtle); color: var(--rt-text); padding: 26px 20px calc(56px + var(--rt-safe-bottom)); }
.rt-vehicles-shell { max-width: 1120px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }

/* ---- summary + primary action ---- */
.rt-vehicles-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.rt-vehicles-summary { display: flex; align-items: center; gap: 13px; min-width: 0; }
.rt-vehicles-summary-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 46px;
  height: 46px;
  border-radius: 15px;
  color: var(--rt-primary-strong);
  background: var(--rt-primary-soft);
}
.rt-vehicles-summary-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.rt-vehicles-summary-copy strong { color: var(--rt-text-strong); font-size: 1.02rem; font-weight: 780; letter-spacing: -0.02em; }
.rt-vehicles-summary-copy span { color: var(--rt-muted); font-size: 0.8rem; line-height: 1.45; }

/* ---- feedback ---- */
.rt-vehicles-alert {
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
.rt-vehicles-alert svg { flex: 0 0 auto; margin-top: 1px; }
.rt-vehicles-alert-success { border-color: var(--rt-success-border); background: var(--rt-success-soft); color: var(--rt-primary-strong); }

/* ---- list ---- */
.rt-vehicles-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(324px, 1fr)); gap: 15px; }

/* ---- vehicle card ---- */
.rt-vehicle-card {
  display: flex;
  flex-direction: column;
  background: var(--rt-card);
  border: 1px solid var(--rt-border);
  border-radius: var(--rt-radius-card);
  box-shadow: var(--rt-shadow-card);
  overflow: hidden;
  transition: transform var(--rt-dur-base) var(--rt-ease), box-shadow var(--rt-dur-base) var(--rt-ease), border-color var(--rt-dur-base) var(--rt-ease);
}
.rt-vehicle-card:hover { transform: translateY(-2px); box-shadow: var(--rt-shadow-md); }
/* The default vehicle gets a brand edge rather than a different layout, so the
   cards stay comparable when they are side by side. */
.rt-vehicle-card-default { border-color: var(--rt-primary); box-shadow: var(--rt-shadow-md); }

.rt-vehicle-visual {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 17px 19px;
  background: var(--rt-surface-subtle);
  border-bottom: 1px solid var(--rt-border);
}
.rt-vehicle-car-icon {
  display: grid;
  place-items: center;
  width: 62px;
  height: 62px;
  border-radius: 19px;
  color: var(--rt-primary-strong);
  background: var(--rt-primary-soft);
}
.rt-vehicle-card-default .rt-vehicle-car-icon { color: var(--rt-text-inverse); background: var(--rt-primary); }
.rt-vehicle-badges { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }

.rt-vehicle-body { display: flex; flex-direction: column; gap: 14px; padding: 17px 19px 19px; flex: 1 1 auto; }
.rt-vehicle-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.rt-vehicle-name { margin: 0; color: var(--rt-text-strong); font-size: 1.08rem; font-weight: 780; letter-spacing: -0.02em; line-height: 1.25; }
.rt-vehicle-subtitle { margin: 3px 0 0; color: var(--rt-muted); font-size: 0.8rem; }
.rt-vehicle-actions { display: flex; gap: 6px; flex: 0 0 auto; }

.rt-vehicle-specs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.rt-vehicle-spec {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 11px;
  border-radius: 13px;
  background: var(--rt-surface-subtle);
  border: 1px solid var(--rt-border);
  min-width: 0;
}
.rt-vehicle-spec-label { display: flex; align-items: center; gap: 5px; color: var(--rt-muted); font-size: 0.68rem; font-weight: 650; text-transform: uppercase; letter-spacing: 0.04em; }
.rt-vehicle-spec-label svg { flex: 0 0 auto; }
/* A plate is the one spec that is a fixed-width code, so it gets its own
   monospace treatment - it is read character by character, not as a word. */
.rt-vehicle-spec-value { color: var(--rt-text); font-size: 0.85rem; font-weight: 720; overflow-wrap: anywhere; }
.rt-vehicle-spec-value--plate { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.04em; }

.rt-vehicle-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-top: auto; padding-top: 13px; border-top: 1px solid var(--rt-border); }
.rt-vehicle-seat-note { color: var(--rt-muted); font-size: 0.73rem; }

/* ---- empty ---- */
.rt-vehicles-empty {
  grid-column: 1 / -1;
  padding: 46px 24px;
  border: 1px dashed var(--rt-border-strong);
  border-radius: var(--rt-radius-card);
  background: var(--rt-card);
}

/* ---- form ---- */
.rt-vehicle-form { display: flex; flex-direction: column; gap: 15px; }
.rt-vehicle-form-intro { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 11px 13px; border-radius: 13px; background: var(--rt-surface-subtle); color: var(--rt-muted); font-size: 0.78rem; line-height: 1.5; }
.rt-vehicle-form-intro svg { flex: 0 0 auto; margin-top: 1px; color: var(--rt-primary-strong); }
.rt-vehicle-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.rt-vehicle-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.rt-vehicle-field-full { grid-column: 1 / -1; }
.rt-vehicle-label { display: flex; align-items: center; gap: 6px; color: var(--rt-text); font-size: 0.78rem; font-weight: 700; }
.rt-vehicle-label span { color: var(--rt-muted); font-weight: 500; }
.rt-vehicle-input {
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
.rt-vehicle-input:focus-visible {
  outline: none;
  border-color: var(--rt-primary-strong);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rt-primary) 20%, transparent);
}
.rt-vehicle-input[aria-invalid="true"] { border-color: var(--rt-danger); }
.rt-vehicle-input--plate { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.05em; text-transform: uppercase; }
.rt-vehicle-field-error { display: inline-flex; align-items: center; gap: 5px; color: var(--rt-danger); font-size: 0.74rem; font-weight: 620; }
.rt-vehicle-form-actions { display: flex; align-items: center; justify-content: flex-end; gap: 9px; flex-wrap: wrap; }
.rt-vehicle-delete-copy { margin: 0 0 13px; color: var(--rt-muted); font-size: 0.86rem; line-height: 1.6; }
.rt-vehicle-delete-copy strong { color: var(--rt-text); }
.rt-vehicle-delete-warning { display: flex; align-items: flex-start; gap: 8px; padding: 11px 13px; border-radius: 13px; background: var(--rt-warning-soft); color: var(--rt-warning-text); font-size: 0.78rem; font-weight: 620; line-height: 1.5; }
.rt-vehicle-delete-warning svg { flex: 0 0 auto; margin-top: 1px; }

@media (max-width: 620px) {
  .rt-vehicles-page { padding: 18px 14px calc(44px + var(--rt-safe-bottom)); }
  .rt-vehicles-toolbar { flex-direction: column; align-items: stretch; }
  .rt-vehicles-toolbar .ds-button { width: 100%; }
  .rt-vehicles-list { grid-template-columns: 1fr; }
  .rt-vehicle-form-grid { grid-template-columns: 1fr; }
  .rt-vehicle-specs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rt-vehicle-form-actions { flex-direction: column-reverse; align-items: stretch; }
  .rt-vehicle-form-actions .ds-button { width: 100%; }
  .rt-vehicles-empty { padding: 34px 18px; }
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
          eyebrow="Account"
          title="My vehicles"
          description="Manage the vehicles available for your offered rides and choose a preferred default."
          actions={
            <Button data-testid="vehicle-add" onClick={openAdd}>
              <Plus size={17} aria-hidden="true" />
              Add vehicle
            </Button>
          }
        />

        <div className="rt-vehicles-toolbar">
          <div className="rt-vehicles-summary">
            <span className="rt-vehicles-summary-icon"><CarFront size={22} /></span>
            <span className="rt-vehicles-summary-copy">
              <strong>
                {loading
                  ? "Loading�"
                  : `${ownedVehicles.length} ${ownedVehicles.length === 1 ? "vehicle" : "vehicles"} saved`}
              </strong>
              <span>
                {loading
                  ? "Getting your vehicles."
                  : ownedVehicles.length
                    ? "Only you can edit or remove these vehicles."
                    : "Add a vehicle before offering a ride."}
              </span>
            </span>
          </div>
        </div>

        {feedback ? (
          <div
            className={`rt-vehicles-alert${feedback.type === "success" ? " rt-vehicles-alert-success" : ""}`}
            role={feedback.type === "error" ? "alert" : "status"}
          >
            {feedback.type === "success" ? <Check size={17} /> : <AlertCircle size={17} />}
            <span>{feedback.text}</span>
          </div>
        ) : null}

        <Group
          id="vehicles-list"
          title={loading ? "Your vehicles" : ownedVehicles.length ? "Your vehicles" : "Get started"}
          description={
            loading
              ? undefined
              : ownedVehicles.length
                ? "Tap a vehicle to edit it, or make it your default for faster ride posting."
                : "Vehicles are private to your profile and are only shown on the rides you offer."
          }
        >
          {loading ? (
            <div className="rt-vehicles-list">
              <SkeletonList count={2} />
            </div>
          ) : ownedVehicles.length === 0 ? (
            <div className="rt-vehicles-empty">
              <State
                icon={<CarFront size={26} />}
                title="No vehicles yet"
                body="Add the car you use for carpooling, then set it as your default for faster ride posting."
                actionLabel="Add your first vehicle"
                onAction={openAdd}
                testId="vehicles-empty"
              />
            </div>
          ) : (
            <div className="rt-vehicles-list">
              {ownedVehicles.map((vehicle) => (
                <article
                  className={`rt-vehicle-card${vehicle.isDefault ? " rt-vehicle-card-default" : ""}`}
                  key={vehicle.id}
                >
                  <div className="rt-vehicle-visual">
                    <span className="rt-vehicle-car-icon"><CarFront size={30} /></span>
                    <div className="rt-vehicle-badges">
                      {vehicle.isDefault
                        ? <Badge tone="brand" icon={Check}>Default</Badge>
                        : <Badge tone="neutral" icon={ShieldCheck}>Saved</Badge>}
                    </div>
                  </div>

                  <div className="rt-vehicle-body">
                    <div className="rt-vehicle-title-row">
                      <div>
                        <h2 className="rt-vehicle-name">{vehicle.name}</h2>
                        <p className="rt-vehicle-subtitle">{vehicle.make} {vehicle.model}</p>
                      </div>
                      <div className="rt-vehicle-actions">
                        <IconButton
                          bordered
                          icon={Pencil}
                          label={`Edit ${vehicle.name}`}
                          data-testid={`vehicle-edit-${vehicle.id}`}
                          onClick={() => openEdit(vehicle)}
                        />
                        <IconButton
                          bordered
                          tone="danger"
                          icon={Trash2}
                          label={`Delete ${vehicle.name}`}
                          onClick={() => requestDelete(vehicle)}
                        />
                      </div>

                    </div>

                    <div className="rt-vehicle-specs">
                      <div className="rt-vehicle-spec">
                        <span className="rt-vehicle-spec-label"><ShieldCheck size={12} /> Plate</span>
                        <strong className="rt-vehicle-spec-value rt-vehicle-spec-value--plate">{vehicle.plate}</strong>
                      </div>
                      <div className="rt-vehicle-spec">
                        <span className="rt-vehicle-spec-label"><Palette size={12} /> Color</span>
                        <strong className="rt-vehicle-spec-value">{vehicle.color}</strong>
                      </div>
                      <div className="rt-vehicle-spec">
                        <span className="rt-vehicle-spec-label"><Armchair size={12} /> Seats</span>
                        <strong className="rt-vehicle-spec-value">{vehicle.seats}</strong>
                      </div>
                    </div>

                    <div className="rt-vehicle-footer">
                      <span className="rt-vehicle-seat-note">Rider seats exclude the driver</span>
                      <Button
                        variant={vehicle.isDefault ? "subtle" : "secondary"}
                        size="sm"
                        onClick={() => void chooseDefault(vehicle)}
                        disabled={vehicle.isDefault}
                      >
                        <Check size={14} aria-hidden="true" />
                        {vehicle.isDefault ? "Default" : "Set as default"}
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Group>
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

          <p className="rt-vehicle-form-intro">
            <ShieldCheck size={17} aria-hidden="true" />
            Vehicle details are private and can only be managed by the active profile.
          </p>

          <div className="rt-vehicle-form-grid">
            <label className="rt-vehicle-field rt-vehicle-field-full">
              <span className="rt-vehicle-label">Vehicle nickname</span>
              <input
                className="rt-vehicle-input"
                data-testid="vehicle-name"
                value={draft.name}
                onChange={(event) => updateDraft("name", event.target.value)}
                placeholder="e.g. Green City Car"
                aria-invalid={Boolean(errors.name)}
              />
              {errors.name && <span className="rt-vehicle-field-error"><AlertCircle size={12} />{errors.name}</span>}
            </label>

            <label className="rt-vehicle-field">
              <span className="rt-vehicle-label">Make</span>
              <input
                className="rt-vehicle-input"
                data-testid="vehicle-make"
                value={draft.make}
                onChange={(event) => updateDraft("make", event.target.value)}
                placeholder="e.g. Toyota"
                autoComplete="off"
                aria-invalid={Boolean(errors.make)}
              />
              {errors.make && <span className="rt-vehicle-field-error"><AlertCircle size={12} />{errors.make}</span>}
            </label>

            <label className="rt-vehicle-field">
              <span className="rt-vehicle-label">Model</span>
              <input
                className="rt-vehicle-input"
                data-testid="vehicle-model"
                value={draft.model}
                onChange={(event) => updateDraft("model", event.target.value)}
                placeholder="e.g. Corolla"
                autoComplete="off"
                aria-invalid={Boolean(errors.model)}
              />
              {errors.model && <span className="rt-vehicle-field-error"><AlertCircle size={12} />{errors.model}</span>}
            </label>

            <label className="rt-vehicle-field">
              <span className="rt-vehicle-label">Color</span>
              <input
                className="rt-vehicle-input"
                data-testid="vehicle-color"
                value={draft.color}
                onChange={(event) => updateDraft("color", event.target.value)}
                placeholder="e.g. Green"
                autoComplete="off"
                aria-invalid={Boolean(errors.color)}
              />
              {errors.color && <span className="rt-vehicle-field-error"><AlertCircle size={12} />{errors.color}</span>}
            </label>

            <label className="rt-vehicle-field">
              <span className="rt-vehicle-label">Registration plate</span>
              <input
                className="rt-vehicle-input rt-vehicle-input--plate"
                data-testid="vehicle-plate"
                value={draft.plate}
                onChange={(event) => updateDraft("plate", event.target.value.toUpperCase())}
                placeholder="e.g. WB 12 AB 1234"
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={Boolean(errors.plate)}
              />
              {errors.plate && <span className="rt-vehicle-field-error"><AlertCircle size={12} />{errors.plate}</span>}
            </label>

            <label className="rt-vehicle-field rt-vehicle-field-full">
              <span className="rt-vehicle-label">Available rider seats <span>(1�12, excluding the driver)</span></span>
              <input
                className="rt-vehicle-input"
                data-testid="vehicle-seats"
                type="number"
                min={1}
                max={12}
                step={1}
                value={draft.seats}
                onChange={(event) => updateDraft("seats", Number(event.target.value))}
                aria-invalid={Boolean(errors.seats)}
              />
              {errors.seats && <span className="rt-vehicle-field-error"><AlertCircle size={12} />{errors.seats}</span>}
            </label>
          </div>

          <div className="rt-vehicle-form-actions">
            <Button variant="ghost" onClick={closeForm} disabled={saving}>Cancel</Button>
            <Button type="submit" data-testid="vehicle-save" loading={saving} loadingLabel="Saving">
              {saving ? null : <Check size={15} aria-hidden="true" />}
              {editingVehicle ? "Save changes" : "Add vehicle"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(pendingDelete)}
        onClose={() => !deleting && setPendingDelete(null)}
        title="Delete vehicle?"
        size="sm"
      >
        <p className="rt-vehicle-delete-copy">
          This removes <strong>{pendingDelete?.name}</strong> from your active profile. This action cannot be undone.
        </p>
        <div className="rt-vehicle-delete-warning">
          <AlertCircle size={16} aria-hidden="true" />
          Vehicles linked to active or completed rides cannot be deleted.
        </div>
        <div className="rt-vehicle-form-actions" style={{ marginTop: 18 }}>
          <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>Keep vehicle</Button>
          <Button variant="danger" onClick={() => void confirmDelete()} loading={deleting} loadingLabel="Deleting">
            <Trash2 size={15} aria-hidden="true" />
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export default VehiclesPage;
