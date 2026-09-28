import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { Navigation } from "lucide-react";
import type { Coordinates, RideLocation } from "../types";
import { getSupabaseClient } from "../services/supabase";
import { rowToRideLocation, type RideLocationRow } from "../repositories/liveLocationRepository";

interface PassengerLiveMapProps {
  rideId: string;
  origin: Coordinates;
  destination: Coordinates;
  waypoints: Coordinates[];
  routeGeometry: [number, number][];
}

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const POLL_INTERVAL_MS = 2_000;

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
  waypoints,
  routeGeometry,
}: PassengerLiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyMapRef = useRef<MapLibreMap | null>(null);
  const driverMarkerRef = useRef<MapLibreMarker | null>(null);
  const lastLocationKeyRef = useRef<string | null>(null);

  const [location, setLocation] = useState<RideLocation | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [isMapReady, setIsMapReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

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

    mapRef.current = map;

    const handleStyleLoad = () => {
      readyMapRef.current = map;
      setIsMapReady(true);
    };
    map.once("style.load", handleStyleLoad);

    return () => {
      map.remove();
      mapRef.current = null;
      readyMapRef.current = null;
      driverMarkerRef.current = null;
    };
  }, [origin.lat, origin.lon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyMapRef.current) return;

    const validRoute = routeGeometry.filter(
      (pos) =>
        Array.isArray(pos) &&
        Number.isFinite(pos[0]) &&
        Number.isFinite(pos[1]) &&
        pos[0] >= -180 &&
        pos[0] <= 180 &&
        pos[1] >= -90 &&
        pos[1] <= 90,
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
    bounds.extend([origin.lon, origin.lat]);
    bounds.extend([destination.lon, destination.lat]);
    map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 650 });
  }, [routeGeometry, origin, destination]);

  const liveLat = location?.lat ?? null;
  const liveLon = location?.lon ?? null;
  const liveHeading = location?.heading ?? null;
  const liveStale = location ? (Date.now() - Date.parse(location.recordedAt)) / 1000 > 45 : false;

  useEffect(() => {
    const map = readyMapRef.current;
    if (!map || !isMapReady) return;

    if (
      liveLat === null
      || liveLon === null
      || !Number.isFinite(liveLat)
      || !Number.isFinite(liveLon)
      || liveLat < -90
      || liveLat > 90
      || liveLon < -180
      || liveLon > 180
    ) {
      driverMarkerRef.current?.remove();
      driverMarkerRef.current = null;
      return;
    }

    const existing = driverMarkerRef.current;
    if (existing) {
      existing.setLngLat([liveLon, liveLat]);
      map.triggerRepaint();
      const element = existing.getElement();
      element.classList.toggle("ride-map-live--stale", liveStale);
      const arrow = element.querySelector<HTMLElement>(".ride-map-live__arrow");
      if (arrow && liveHeading !== null && Number.isFinite(liveHeading)) {
        arrow.style.transform = `rotate(${liveHeading}deg)`;
      }
      return;
    }

    driverMarkerRef.current = new maplibregl.Marker({
      element: createDriverMarkerElement(liveHeading ?? undefined),
      anchor: "center",
    })
      .setLngLat([liveLon, liveLat])
      .addTo(map);
  }, [isMapReady, liveHeading, liveLat, liveLon, liveStale]);

  useEffect(() => {
    if (!rideId) return;

    let active = true;
    const client = getSupabaseClient();

    const handleLocation = (loc: RideLocation) => {
      if (!active) return;
      const key = `${loc.lat},${loc.lon},${loc.recordedAt}`;
      if (key === lastLocationKeyRef.current) return;
      lastLocationKeyRef.current = key;
      setLocation(loc);
      setNow(Date.now());

      const map = readyMapRef.current;
      if (!map || !isMapReady) return;
      const lat = loc.lat;
      const lon = loc.lon;
      if (!isValidCoordinate(lat, lon)) return;
      const existing = driverMarkerRef.current;
      if (existing) {
        console.log("[LIVE-MAP] marker update", { lat: loc.lat, lon: loc.lon, recordedAt: loc.recordedAt });
        existing.setLngLat([lon, lat]);
        map.triggerRepaint();
        const element = existing.getElement();
        element.classList.toggle("ride-map-live--stale", false);
        const arrow = element.querySelector<HTMLElement>(".ride-map-live__arrow");
        if (arrow && loc.heading != null && Number.isFinite(loc.heading)) {
          arrow.style.transform = `rotate(${loc.heading}deg)`;
        }
      }
    };

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
          const next = (payload.new ?? payload.old) as Partial<RideLocationRow> | undefined;
          if (!next?.ride_id) return;
          const parsed = rowToRideLocation(next as RideLocationRow);
          console.log("[LIVE-MAP] realtime received", { lat: parsed.lat, lon: parsed.lon, recordedAt: parsed.recordedAt });
          handleLocation(parsed);
        },
      )
      .subscribe((status) => {
        console.log("[LIVE-MAP] realtime status", { status, rideId });
      });

    const poll = async () => {
      if (!active) return;
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/ride_locations?ride_id=eq.${rideId}&select=*`;
        const { data: { session } } = await client.auth.getSession();
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${session?.access_token ?? ""}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            cache: "no-store",
          },
        });
        console.log("[LIVE-MAP] poll response", {
          status: response.status,
          lat: (await response.clone().json())[0]?.lat,
          lon: (await response.clone().json())[0]?.lon,
          recordedAt: (await response.clone().json())[0]?.recorded_at,
        });
        if (!response.ok) {
          const body = await response.text();
          console.log("[LIVE-MAP] REST ERROR", { status: response.status, body });
          return;
        }
        const rows = (await response.json()) as RideLocationRow[];
        const stored = rows[0];
        if (!stored) return;
        const parsed = rowToRideLocation(stored);
        console.log("[LIVE-MAP] poll data", { lat: parsed.lat, lon: parsed.lon, recordedAt: parsed.recordedAt });
        handleLocation(parsed);
      } catch (error) {
        console.log("[LIVE-MAP] poll error", error);
      }
    };

    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
      void client.removeChannel(channel);
    };
  }, [rideId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const ageSeconds = location
    ? Math.max(0, Math.round((now - Date.parse(location.recordedAt)) / 1000))
    : null;

  return (
    <div className="passenger-live-map">
      <div ref={containerRef} className="passenger-live-map__container" />
      {location ? (
        <p className="live-status">
          <Navigation size={14} />
          {ageSeconds !== null && ageSeconds > 45
            ? `Driver's last position was ${ageSeconds}s ago.`
            : "Showing the driver's live position."}
        </p>
      ) : (
        <p className="live-status live-status--waiting">Waiting for driver location…</p>
      )}
    </div>
  );
}

export default PassengerLiveMap;
