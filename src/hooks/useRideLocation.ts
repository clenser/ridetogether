import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "../services/supabase";
import {
  clearRideLocation,
  getRideLocation,
  reportRideLocation,
  rowToRideLocation,
  type RideLocationRow,
} from "../repositories/liveLocationRepository";
import type { RideLocation } from "../types";

/**
 * Live driver position for one ride.
 *
 * Two very different jobs share this hook, because the two audiences watch it
 * from opposite ends of the same trip:
 *
 *   - the **host** (`share` on) writes their position from the browser's
 *     geolocation watch, every few seconds, for as long as the trip is running;
 *   - everybody involved **reads** it over the `ride_locations` realtime channel,
 *     so a passenger's map moves without polling.
 *
 * Reporting is deliberately not routed through the app's snapshot refresh. A fix
 * arrives every few seconds; refetching rides, bookings, messages, notifications
 * and ratings each time would swamp the channel the passenger is watching and
 * make the map stutter. The write is one narrow upsert and the read is one
 * channel, so the cost stays flat while driving.
 *
 * Nothing is invented. Until the driver has actually reported a position the
 * hook returns null, and a stale position is labelled with its age rather than
 * drawn as if it were live.
 */

const CHANNEL_NAME = "ride-location";
/** How often a fresh fix is written. The database keeps only the latest. */
const REPORT_INTERVAL_MS = 5_000;
/** A fix older than this is shown as stale rather than as the current position. */
export const STALE_AFTER_SECONDS = 45;
/** Fallback polling interval for passengers watching a live ride. */
const FALLBACK_POLL_INTERVAL_MS = 3_500;

export interface UseRideLocationOptions {
  rideId: string;
  /** The signed-in member is the host, so the hook publishes their position. */
  share: boolean;
  /** `ride.status === "in_progress"`. Reporting is refused before and after. */
  isRunning: boolean;
  enabled?: boolean;
}

export interface UseRideLocationResult {
  location: RideLocation | null;
  /** Seconds since the last fix, or null when nothing has been reported. */
  ageSeconds: number | null;
  isStale: boolean;
  isSharing: boolean;
  error: string;
  /** Releases the browser's position watch and deletes the stored position. */
  stopSharing: () => Promise<void>;
}

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export function useRideLocation({
  rideId,
  share,
  isRunning,
  enabled = true,
}: UseRideLocationOptions): UseRideLocationResult {
  const [location, setLocation] = useState<RideLocation | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const lastReportAt = useRef(0);
  const shareRef = useRef(share && isRunning && enabled);
  const watchId = useRef<number | null>(null);
  const reportController = useRef<AbortController | null>(null);

  shareRef.current = share && isRunning && enabled;

  // One timer for the "how stale is this" label, rather than re-rendering on
  // every fix just to recompute a duration.
  useEffect(() => {
    if (!enabled || !location) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [enabled, location]);

  // Read the stored position on arrival, so a passenger who opens the page
  // mid-journey sees where the car already is rather than waiting for the next
  // write.
  useEffect(() => {
    if (!rideId || !enabled) {
      setLocation(null);
      return undefined;
    }
    let active = true;
    void getRideLocation(rideId)
      .then((stored) => {
        if (active && stored) {
          locationRef.current = stored;
          setLocation(stored);
          setNow(Date.now());
        }
      })
      .catch((caught: unknown) => {
        if (active) setError(errorText(caught, "We could not load the driver's position."));
      });
    return () => {
      active = false;
    };
  }, [enabled, rideId]);

  // Subscribe to writes for this ride. The channel is filtered by `ride_id` so a
  // member with several rides open only receives the one they are watching.
  //
  // The callback uses refs to avoid stale closures: `setLocation` and `setNow`
  // are stable, but the payload handler must never capture an old `location`
  // value or it will appear to "not update" when React batches renders.
  const locationRef = useRef<RideLocation | null>(null);
  useEffect(() => {
    if (!rideId || !enabled) return undefined;
    const client = getSupabaseClient();
    const channel = client
      .channel(`${CHANNEL_NAME}:${rideId}`, { config: { broadcast: { self: true } } })
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ride_locations",
          filter: `ride_id=eq.${rideId}`,
        },
        (payload) => {
          const next = (payload.new ?? payload.old) as Partial<RideLocationRow> | undefined;
          if (!next?.ride_id) return;
          const parsed = rowToRideLocation(next as RideLocationRow);
          locationRef.current = parsed;
          if (import.meta.env.DEV) {
            console.log("[LIVE-LOCATION] realtime received", { lat: parsed.lat, lon: parsed.lon, recordedAt: parsed.recordedAt });
          }
          setLocation(parsed);
          setNow(Date.now());
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [enabled, rideId]);

  // Fallback polling for passengers watching a live ride. Realtime is the
  // primary transport; this is a safety net for dropped connections or
  // environments where realtime is unreliable.
  useEffect(() => {
    if (!rideId || !enabled || !isRunning || share) return undefined;

    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const stored = await getRideLocation(rideId);
        if (!active || !stored) return;
        const previousRecordedAt = locationRef.current?.recordedAt ?? null;
        console.log("[LIVE-LOCATION] poll response", {
          lat: stored.lat,
          lon: stored.lon,
          recordedAt: stored.recordedAt,
          previousRecordedAt,
          isNewer: !previousRecordedAt || stored.recordedAt > previousRecordedAt,
        });
        const current = locationRef.current;
        if (current && stored.recordedAt <= current.recordedAt) {
          console.log("[LIVE-LOCATION] poll skipped", {
            storedRecordedAt: stored.recordedAt,
            previousRecordedAt,
          });
          return;
        }
        locationRef.current = stored;
        if (import.meta.env.DEV) {
          console.log("[LIVE-LOCATION] polling received", { lat: stored.lat, lon: stored.lon, recordedAt: stored.recordedAt });
        }
        setLocation(stored);
        setNow(Date.now());
      } catch {
        // Polling failure is silent — realtime may still be working.
      }
    };

    const interval = window.setInterval(() => void poll(), FALLBACK_POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [enabled, isRunning, rideId, share]);

  const stopWatching = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    reportController.current?.abort();
    reportController.current = null;
    setIsSharing(false);
  }, []);

  const publish = useCallback(
    async (position: GeolocationPosition) => {
      if (!rideId || !shareRef.current) return;
      const since = Date.now() - lastReportAt.current;
      if (since < REPORT_INTERVAL_MS) return;
      lastReportAt.current = Date.now();
      const { latitude, longitude, heading, speed, accuracy } = position.coords;
      try {
        const written = await reportRideLocation({
          rideId,
          lat: latitude,
          lon: longitude,
          heading: heading == null || !Number.isFinite(heading) ? undefined : heading,
          speedKph: speed == null || !Number.isFinite(speed) ? undefined : Math.max(0, speed * 3.6),
          accuracyMeters: accuracy == null || !Number.isFinite(accuracy) ? undefined : accuracy,
        });
        setLocation(written);
        setNow(Date.now());
        setError("");
      } catch (caught: unknown) {
        // A single failed write is not worth interrupting a drive for, but it is
        // worth saying: a passenger watching a frozen marker should be able to
        // tell the difference between "stopped" and "not reporting".
        setError(errorText(caught, "Your position is not being shared right now."));
      }
    },
    [rideId],
  );

  // Start and stop the browser's position watch with the host's share flag.
  useEffect(() => {
    if (!enabled || !share || !isRunning) {
      stopWatching();
      return undefined;
    }
    if (!navigator.geolocation) {
      setError("This device cannot share a position, so live tracking is unavailable.");
      return undefined;
    }

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        void publish(position);
      },
      (positionError) => {
        setError(
          positionError.code === positionError.PERMISSION_DENIED
            ? "Location permission is needed to share your position with passengers."
            : positionError.message || "We could not get your position.",
        );
        stopWatching();
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 4_000 },
    );
    setIsSharing(true);

    return () => {
      stopWatching();
    };
  }, [enabled, isRunning, publish, share, stopWatching]);

  // Clear the stored position when a trip ends, so the next journey does not
  // start by showing the last one's marker.
  const wasRunning = useRef(isRunning);
  useEffect(() => {
    if (wasRunning.current && !isRunning && rideId) {
      void clearRideLocation(rideId).catch(() => undefined);
      setLocation(null);
    }
    wasRunning.current = isRunning;
  }, [isRunning, rideId]);

  const ageSeconds = location
    ? Math.max(0, Math.round((now - Date.parse(location.recordedAt)) / 1000))
    : null;

  const stopSharing = useCallback(async () => {
    stopWatching();
    if (!rideId) return;
    try {
      await clearRideLocation(rideId);
      setLocation(null);
    } catch (caught: unknown) {
      setError(errorText(caught, "We could not stop sharing your position."));
    }
  }, [rideId, stopWatching]);

  return {
    location,
    ageSeconds,
    isStale: ageSeconds !== null && ageSeconds > STALE_AFTER_SECONDS,
    isSharing,
    error,
    stopSharing,
  };
}
