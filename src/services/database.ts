import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/**
 * Legacy browser storage - retained only so the old local cache can be cleared.
 *
 * RideTogether is a cloud app. Rides, vehicles, bookings, chat, notifications,
 * ratings and safety contacts all live in Supabase and are read through the
 * repositories in `src/repositories`. Nothing in the app reads an application
 * record from IndexedDB any more, and this module deliberately keeps no schema
 * for them: the stores below exist only so an upgrade from an older build can
 * find and delete what that build left behind.
 *
 * Keeping a writable local store of app data is what previously made it possible
 * for a stale ride to look current, so nothing here can be written by app code.
 */
/**
 * The stores an earlier build may have created.
 *
 * They are declared individually rather than through an index signature because
 * `idb` derives its store-name union from this interface, and an index
 * signature collapses that union to `never`. The value type is `unknown`
 * throughout on purpose: the app no longer knows or cares what shape these rows
 * had, and typing them would only invite reading them.
 */
export interface LegacyDatabase extends DBSchema {
  users: { key: string; value: unknown };
  vehicles: { key: string; value: unknown };
  rides: { key: string; value: unknown };
  rideStops: { key: string; value: unknown };
  bookings: { key: string; value: unknown };
  messages: { key: string; value: unknown };
  notifications: { key: string; value: unknown };
  ratings: { key: string; value: unknown };
  safetyContacts: { key: string; value: unknown };
  meta: { key: string; value: unknown };
}

/** Every store name, in the order an upgrade should create them. */
const LEGACY_STORES = [
  "users",
  "vehicles",
  "rides",
  "rideStops",
  "bookings",
  "messages",
  "notifications",
  "ratings",
  "safetyContacts",
  "meta",
] as const satisfies readonly (keyof LegacyDatabase)[];

const DB_NAME = "ride-together";
const DB_VERSION = 1;

let connection: Promise<IDBPDatabase<LegacyDatabase> | null> | null = null;

const openLegacyDatabase = (): Promise<IDBPDatabase<LegacyDatabase> | null> => {
  if (connection) return connection;

  connection = (async () => {
    // Private-browsing modes and hardened browser settings can refuse IndexedDB
    // outright. That is fine: there is simply nothing to clear.
    if (typeof indexedDB === "undefined") return null;
    try {
      const db = await openDB<LegacyDatabase>(DB_NAME, DB_VERSION, {
        upgrade(database) {
          for (const store of LEGACY_STORES) {
            if (!database.objectStoreNames.contains(store)) {
              database.createObjectStore(store);
            }
          }
        },
        blocked() {
          console.warn("[legacy] upgrade blocked by another open tab");
        },
      });
      return db;
    } catch (error) {
      console.warn("[legacy] IndexedDB unavailable", error);
      return null;
    }
  })();

  return connection;
};

/**
 * Deletes every object store an earlier build may have written.
 *
 * Exposed as "Clear local data" in Settings. It touches nothing in the cloud,
 * and the confirmation dialog says so, because a member's real rides and
 * bookings live in Supabase and are unaffected.
 */
export const clearLegacyLocalData = async (): Promise<void> => {
  const db = await openLegacyDatabase();
  if (!db) return;

  // Cleared in one transaction so the app is never in a half-cleared state, and
  // every known store is included even if this build did not open it.
  const tx = db.transaction(LEGACY_STORES, "readwrite");
  await Promise.all(LEGACY_STORES.map((store) => tx.objectStore(store).clear()));
  await tx.done;

  db.close();
  connection = null;
};

/**
 * True when an older build left records behind. Used only to decide whether the
 * Settings action has anything to do - never to display local data.
 */
export const hasLegacyLocalData = async (): Promise<boolean> => {
  const db = await openLegacyDatabase();
  if (!db) return false;
  try {
    for (const store of LEGACY_STORES) {
      const count = await db.count(store);
      if (count > 0) return true;
    }
    return false;
  } catch {
    return false;
  }
};
