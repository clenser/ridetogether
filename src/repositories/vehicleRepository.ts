import type { Vehicle } from "../types";
import { getSupabaseClient } from "../services/supabase";
import { DataError, toDataError, toNumber, toText } from "./dataError";
import { getAuthenticatedUserId } from "./session";

/**
 * Supabase-backed vehicle data. Supabase is the source of truth; the owner is
 * always the authenticated Supabase user id, never a value from the UI.
 */

const VEHICLE_TABLE = "vehicles";
const VEHICLE_COLUMNS = "id, owner_id, name, make, model, color, plate, seats, is_default, created_at, updated_at";

export interface VehicleRow {
  id: string;
  owner_id: string;
  name: string;
  make: string;
  model: string;
  color: string | null;
  plate: string;
  seats: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** What the UI may set. `id`/`userId` are intentionally absent. */
export interface VehicleDraft {
  name: string;
  make: string;
  model: string;
  color: string;
  plate: string;
  seats: number;
  isDefault: boolean;
}

const rowToVehicle = (row: VehicleRow): Vehicle => ({
  id: row.id,
  userId: row.owner_id,
  name: toText(row.name),
  make: toText(row.make),
  model: toText(row.model),
  color: toText(row.color),
  plate: toText(row.plate),
  seats: toNumber(row.seats, 1),
  isDefault: Boolean(row.is_default),
});

const toPatch = (draft: VehicleDraft): Record<string, unknown> => ({
  name: draft.name.trim(),
  make: draft.make.trim(),
  model: draft.model.trim(),
  color: draft.color.trim(),
  plate: draft.plate.trim().toUpperCase(),
  seats: draft.seats,
  is_default: draft.isDefault,
});

const validateDraft = (draft: VehicleDraft): void => {
  if (!draft.name.trim()) throw new DataError("Give the vehicle a name.", "invalid");
  if (!draft.make.trim()) throw new DataError("Enter the vehicle make.", "invalid");
  if (!draft.model.trim()) throw new DataError("Enter the vehicle model.", "invalid");
  if (!draft.plate.trim()) throw new DataError("Enter the registration plate.", "invalid");
  if (!Number.isInteger(draft.seats) || draft.seats < 1 || draft.seats > 12) {
    throw new DataError("Vehicle seats must be between 1 and 12.", "invalid");
  }
};

/** Vehicles owned by the authenticated user. */
export const listVehicles = async (): Promise<Vehicle[]> => {
  const ownerId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(VEHICLE_TABLE)
    .select(VEHICLE_COLUMNS)
    .eq("owner_id", ownerId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) throw toDataError(error, "load");
  return ((data ?? []) as VehicleRow[]).map(rowToVehicle);
};

export const getVehicleById = async (vehicleId: string): Promise<Vehicle | null> => {
  if (!vehicleId) return null;
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(VEHICLE_TABLE)
    .select(VEHICLE_COLUMNS)
    .eq("id", vehicleId)
    .maybeSingle();

  if (error) throw toDataError(error, "load");
  return data ? rowToVehicle(data as VehicleRow) : null;
};

export const createVehicle = async (draft: VehicleDraft): Promise<Vehicle> => {
  validateDraft(draft);
  const ownerId = await getAuthenticatedUserId();
  const client = getSupabaseClient();
  const patch = toPatch(draft);

  const { data, error } = await client
    .from(VEHICLE_TABLE)
    .insert({ ...patch, owner_id: ownerId })
    .select(VEHICLE_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new DataError("That registration plate is already registered.", "duplicate", error);
    }
    throw toDataError(error, "create");
  }

  const created = rowToVehicle(data as VehicleRow);
  if (created.isDefault) {
    await makeDefaultVehicle(created.id);
    return { ...created, isDefault: true };
  }
  return created;
};

export const updateVehicle = async (vehicleId: string, draft: VehicleDraft): Promise<Vehicle> => {
  validateDraft(draft);
  await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(VEHICLE_TABLE)
    .update(toPatch(draft))
    .eq("id", vehicleId)
    .select(VEHICLE_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      throw new DataError("That registration plate is already registered.", "duplicate", error);
    }
    throw toDataError(error, "update");
  }
  if (!data) {
    throw new DataError("We could not find that vehicle. It may have been removed.", "not-found");
  }
  return rowToVehicle(data as VehicleRow);
};

export const deleteVehicle = async (vehicleId: string): Promise<void> => {
  await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { error } = await client.from(VEHICLE_TABLE).delete().eq("id", vehicleId);
  if (error) throw toDataError(error, "delete");
};

/**
 * Marks one vehicle as the default and clears the flag on the owner's others.
 * Runs in two statements; a failure is non-fatal because the vehicle is still
 * usable, it just is not the default.
 */
export const makeDefaultVehicle = async (vehicleId: string): Promise<void> => {
  const ownerId = await getAuthenticatedUserId();
  const client = getSupabaseClient();

  const { error: clearError } = await client
    .from(VEHICLE_TABLE)
    .update({ is_default: false })
    .eq("owner_id", ownerId)
    .neq("id", vehicleId);

  if (clearError) throw toDataError(clearError, "update");

  const { error } = await client
    .from(VEHICLE_TABLE)
    .update({ is_default: true })
    .eq("id", vehicleId)
    .eq("owner_id", ownerId);

  if (error) throw toDataError(error, "update");
};

export const listVehiclesByIds = async (vehicleIds: string[]): Promise<Vehicle[]> => {
  const unique = [...new Set(vehicleIds.filter(Boolean))];
  if (unique.length === 0) return [];
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(VEHICLE_TABLE)
    .select(VEHICLE_COLUMNS)
    .in("id", unique);

  if (error) throw toDataError(error, "load");
  return ((data ?? []) as VehicleRow[]).map(rowToVehicle);
};

export { rowToVehicle, VEHICLE_COLUMNS, VEHICLE_TABLE };
