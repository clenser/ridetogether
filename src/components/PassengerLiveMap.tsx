import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { AlertCircle, Navigation, RefreshCw } from "lucide-react";
import type { Coordinates, RideLocation } from "../types";
import { getSupabaseClient } from "../services/supabase";
import { readRideLocationRow, rowToRideLocation, type RideLocationRow } from "../repositories/liveLocationRepository";

interface PassengerLiveMapProps {
  rideId: string;
  origin: Coordinates;
  destination: Coordinates;
  waypoints: Coordinates[];
  routeGeometry: [number, number][];
}

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

/**
 * The single fallback read interval.
 *
 * Realtime is the primary transport and feeds the same handler; this only covers
 * a dropped socket or a browser that throttles websockets in a background tab.
 * There is deliberately no second interval anywhere in the passenger path.
 */
const POLL_INTERVAL_MS = 3_000;

/** A fix older than this is drawn dimmed rather than as the current position. */
const STALE_AFTER_SECONDS = 45;

function isValidCoordinate(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function isStaleLocation(location: RideLocation, now: number): boolean {
  const recordedAt = Date.parse(location.recordedAt);
  if (Number.isNaN(recordedAt)) return true;
  return (now - recordedAt) / 1000 > STALE_AFTER_SECONDS;
}

function createDriverMarkerElement(heading?: number): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "ride-map-marker ride-map-live";
  element.setAttribute("aria-label", "Driver's current position");
  element.innerHTML = '<span class="ride-map-live__arrow"></span>';
  const arrow = element.querySelector<HTMLElement>(".ride-map-live__arrow");
  if (arrow && typeof heading === "number" && Number.isFinite(heading)) {
    arrow.style.transform = `rotate(${heading}deg)`;
  }
  return element;
}

export function PassengerLiveMap({
  rideId,
  origin,
  destination,
  routeGeometry,
}: PassengerLiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const readyMapRef = useRef<MapLibreMap | null>(null);
  const driverMarkerRef = useRef<MapLibreMarker | null>(null);

  /**
   * The newest position we have been told about, held outside React state.
   *
   * A fix can arrive before the map style finishes loading. Keeping it here means
   * the marker is drawn the moment the map is ready instead of waiting for the
   * next write, and it means no consumer has to reason about a stale `isMapReady`
   * closure to decide whether a location was worth storing.
   */
  const latestLocationRef = useRef<RideLocation | null>(null);
  const lastRecordedAtRef = useRef<string | null>(null);

  const [location, setLocation] = useState<RideLocation | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [isMapReady, setIsMapReady] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  /**
   * The one and only marker update path.
   *
   * Position, heading and staleness are written here and nowhere else, so there
   * is no way for two handlers to disagree about where the car is. It reads the
   * map from a ref rather than from state, so it is correct both when the map is
   * already ready and when a fix arrived first. It returns whether the marker
   * could be drawn, so the caller can keep the location queued for later.
   */
  const updateDriverMarker = useCallback((next: RideLocation | null): boolean => {
    const map = readyMapRef.current;
    if (!map) return false;

    if (!next || !isValidCoordinate(next.lat, next.lon)) {
      driverMarkerRef.current?.remove();
      driverMarkerRef.current = null;
      return true;
    }

    const stale = isStaleLocation(next, Date.now());
    const existing = driverMarkerRef.current;

    if (existing) {
      // Moved, not rebuilt: the element is reused so the car turns instead of
      // blinking out and back on every fix.
      existing.setLngLat([next.lon, next.lat]);
      const element = existing.getElement();
      element.classList.toggle("ride-map-live--stale", stale);
      const arrow = element.querySelector<HTMLElement>(".ride-map-live__arrow");
      if (arrow && next.heading != null && Number.isFinite(next.heading)) {
        arrow.style.transform = `rotate(${next.heading}deg)`;
      }
      return true;
    }

    driverMarkerRef.current = new maplibregl.Marker({
      element: createDriverMarkerElement(next.heading),
      anchor: "center",
    })
      .setLngLat([next.lon, next.lat])
      .addTo(map);
    driverMarkerRef.current.getElement().classList.toggle("ride-map-live--stale", stale);
    return true;
  }, []);

  /**
   * The one and only ingestion point.
   *
   * Realtime, the fallback poll and the manual refresh all land here, so a fix
   * cannot be handled differently depending on which transport delivered it. An
   * identical `recorded_at` is the same fix arriving twice and is dropped, which
   * is what keeps realtime and the poll from fighting over the marker.
   */
  const receiveLocation = useCallback(
    (next: RideLocation, options: { force?: boolean } = {}): void => {
      if (!isValidCoordinate(next.lat, next.lon)) return;
      if (!options.force && lastRecordedAtRef.current === next.recordedAt) return;

      lastRecordedAtRef.current = next.recordedAt;
      latestLocationRef.current = next;
      setLocation(next);
      setNow(Date.now());
      // Safe to call before the map is ready: the location is already stored in
      // `latestLocationRef`, and the readiness effect below redraws it.
      updateDriverMarker(next);
    },
    [updateDriverMarker],
  );

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [origin.lon, origin.lat],
      zoom: 12,
      attributionControl: false,
      cooperativeGestures: true,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    const handleStyleLoad = () => {
      readyMapRef.current = map;
      setIsMapReady(true);
    };
    map.once("style.load", handleStyleLoad);

    return () => {
      map.remove();
      readyMapRef.current = null;
      driverMarkerRef.current?.remove();
      driverMarkerRef.current = null;
      setIsMapReady(false);
    };
    // Primitives only: the map is built once for this ride. A new `origin`
    // object with the same coordinates must never tear the map down.
  }, [origin.lat, origin.lon]);

  /**
   * Draws whatever we already know as soon as the map is usable.
   *
   * `updateDriverMarker` is stable and reads the map from a ref, so this cannot
   * capture a stale readiness flag - it is the fix for a location that landed
   * before `style.load` being thrown away.
   */
  useEffect(() => {
    if (!isMapReady) return;
    updateDriverMarker(latestLocationRef.current);
  }, [isMapReady, updateDriverMarker]);

  /**
   * Stable identities for the route effect.
   *
   * `origin`, `destination` and the `routeGeometry` default are rebuilt on every
   * parent render, so depending on them directly re-ran `fitBounds` roughly once
   * a second and fought the user for the camera. These strings change only when
   * the route actually changes.
   */
  const originKey = `${origin.lat},${origin.lon}`;
  const destinationKey = `${destination.lat},${destination.lon}`;
  const routeKey = useMemo(
    () => routeGeometry.map((position) => `${position[0]},${position[1]}`).join("|"),
    [routeGeometry],
  );

  const routePropsRef = useRef({ origin, destination, routeGeometry });
  routePropsRef.current = { origin, destination, routeGeometry };

  /**
   * Route geometry and camera. This is the only place the camera is moved, and it
   * runs only when the route itself changes - never when the driver moves.
   */
  useEffect(() => {
    if (!isMapReady) return;
    const map = readyMapRef.current;
    if (!map) return;

    const { origin: currentOrigin, destination: currentDestination, routeGeometry: currentRoute } =
      routePropsRef.current;

    const validRoute = currentRoute.filter(
      (position) =>
        Array.isArray(position) &&
        Number.isFinite(position[0]) &&
        Number.isFinite(position[1]) &&
        position[0] >= -180 &&
        position[0] <= 180 &&
        position[1] >= -90 &&
        position[1] <= 90,
    );

    const routeData = {
      type: "FeatureCollection" as const,
      features:
        validRoute.length >= 2
          ? [
              {
                type: "Feature" as const,
                properties: {},
                geometry: { type: "LineString" as const, coordinates: validRoute },
              },
            ]
          : [],
    };

    const existingSource = map.getSource("passenger-route") as maplibregl.GeoJSONSource | undefined;
    if (existingSource) {
      existingSource.setData(routeData);
    } else {
      map.addSource("passenger-route", { type: "geojson", data: routeData });
      map.addLayer({
        id: "passenger-route-line",
        type: "line",
        source: "passenger-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#159447", "line-width": 5 },
      });
    }

    const bounds = new maplibregl.LngLatBounds();
    validRoute.forEach(([lon, lat]) => bounds.extend([lon, lat]));
    bounds.extend([currentOrigin.lon, currentOrigin.lat]);
    bounds.extend([currentDestination.lon, currentDestination.lat]);
    map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 650 });
  }, [isMapReady, originKey, destinationKey, routeKey]);

  /**
   * Realtime plus one fallback poll, both feeding `receiveLocation`.
   */
  useEffect(() => {
    if (!rideId) return undefined;

    let active = true;
    const client = getSupabaseClient();

    const channel = client
      .channel(`passenger-live-location:${rideId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ride_locations",
          filter: `ride_id=eq.${rideId}`,
        },
        (payload) => {
          if (!active) return;
          const next = (payload.new ?? payload.old) as Partial<RideLocationRow> | undefined;
          if (!next?.ride_id) return;
          receiveLocation(rowToRideLocation(next as RideLocationRow));
        },
      )
      .subscribe();

    const poll = async () => {
      if (!active) return;
      try {
        const stored = await readRideLocationRow(rideId);
        if (!active || !stored) return;
        receiveLocation(stored);
      } catch (error) {
        // Realtime may still be delivering, so a failed read is not surfaced as a
        // user-facing error here. The repository already logged status and body.
        if (import.meta.env.DEV) {
          console.warn("[live-location] fallback poll failed", error);
        }
      }
    };

    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    // Read once on arrival so a passenger joining mid-journey sees the car
    // immediately rather than waiting a full interval.
    void poll();

    return () => {
      active = false;
      window.clearInterval(interval);
      void client.removeChannel(channel);
    };
  }, [receiveLocation, rideId]);

  /**
   * Re-evaluates the stale badge on a tick.
   *
   * This calls the same `updateDriverMarker` as every other source. It changes
   * only the dimmed styling, because that depends on wall-clock time rather than
   * on a new fix - but it goes through the one marker path so the two can never
   * disagree.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      updateDriverMarker(latestLocationRef.current);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [updateDriverMarker]);

  /**
   * Manual refresh of the driver's position.
   *
   * This is deliberately not "refresh route": no route is recalculated, the map
   * is not recreated and the camera does not move. It reads the stored position
   * once and pushes it straight through the marker path. If the read fails the
   * existing marker stays exactly where it is and the reason is shown, because a
   * marker that jumps to the origin is worse than one that admits it is old.
   */
  const handleRefreshLocation = useCallback(async () => {
    if (!rideId || isRefreshing) return;
    setIsRefreshing(true);
    setRefreshError("");
    try {
      const stored = await readRideLocationRow(rideId);
      if (!stored) {
        setRefreshError("The driver has not shared a position for this trip yet.");
        return;
      }
      receiveLocation(stored, { force: true });
    } catch (error) {
      setRefreshError(
        error instanceof Error && error.message
          ? error.message
          : "We could not refresh the driver's position.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, receiveLocation, rideId]);

  const ageSeconds = location && Number.isFinite(now)
    ? Math.max(0, Math.round((now - Date.parse(location.recordedAt)) / 1000))
    : null;
  const isStale = location ? isStaleLocation(location, now) : false;

  return (
    <div className="passenger-live-map">
      <div className="passenger-live-map__toolbar">
        <p
          className={`live-status${isStale ? " live-status--stale" : ""}`}
          role="status"
          aria-live="polite"
        >
          <Navigation size={14} aria-hidden="true" />
          {location === null
            ? "Waiting for driver location…"
            : isStale
              ? `Driver's last position was ${ageSeconds ?? 0}s ago.`
              : "Showing the driver's live position."}
        </p>
        <button
          className="icon-button"
          type="button"
          onClick={() => void handleRefreshLocation()}
          disabled={isRefreshing}
          aria-label="Refresh driver location"
          title="Refresh driver location"
          data-testid="live-location-refresh"
        >
          <RefreshCw className={isRefreshing ? "spin" : undefined} size={16} aria-hidden="true" />
        </button>
      </div>

      <div
        ref={containerRef}
        className="passenger-live-map__container"
        data-testid="passenger-live-map"
      />

      {refreshError ? (
        <p className="live-status live-status--error" role="alert" data-testid="live-location-error">
          <AlertCircle size={14} aria-hidden="true" />
          {refreshError}
        </p>
      ) : null}
    </div>
  );
}

export default PassengerLiveMap;
