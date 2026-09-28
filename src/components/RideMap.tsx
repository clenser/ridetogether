import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  LineLayerSpecification,
  Map as MapLibreMap,
  MapMouseEvent,
  Marker as MapLibreMarker,
} from "maplibre-gl";
import type { Coordinates } from "../types";

export type RideMapSelectionTarget = "origin" | "destination" | "waypoint";
export type MapCoordinate = Pick<Coordinates, "lat" | "lon">;

export interface LivePosition {
  lat: number;
  lon: number;
  heading?: number;
  /** Older than the freshness window; drawn dimmer and labelled as such. */
  stale?: boolean;
}

export interface RideMapProps {
  origin?: Coordinates;
  destination?: Coordinates;
  waypoints?: Coordinates[];
  route?: [number, number][];
  /**
   * The host's current position on a running ride.
   *
   * Rendered by its own effect rather than as another route marker, because it
   * must not re-fit the viewport: the marker moves every few seconds, and
   * calling `fitBounds` each time would drag the map out from under somebody
   * reading it.
   */
  liveLocation?: LivePosition | null;
  className?: string;
  interactive?: boolean;
  selectionTarget?: RideMapSelectionTarget | null;
  onPickLocation?: (point: MapCoordinate) => void;
}

type MarkerKind = "origin" | "waypoint" | "destination";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const ROUTE_SOURCE_ID = "ride-route";
const ROUTE_LAYER_ID = "ride-route-line";
const ROUTE_CASING_LAYER_ID = "ride-route-casing";

function isValidCoordinate(coordinate: Coordinates): boolean {
  return (
    Number.isFinite(coordinate.lat) &&
    Number.isFinite(coordinate.lon) &&
    coordinate.lat >= -90 &&
    coordinate.lat <= 90 &&
    coordinate.lon >= -180 &&
    coordinate.lon <= 180
  );
}

function createMarkerElement(kind: MarkerKind, index?: number): HTMLDivElement {
  const element = document.createElement("div");
  element.className = `ride-map-marker ride-map-marker--${kind}`;
  element.textContent = kind === "waypoint" ? String((index ?? 0) + 1) : kind === "origin" ? "A" : "B";
  element.setAttribute("aria-label", kind === "origin" ? "Ride origin" : kind === "destination" ? "Ride destination" : `Ride stop ${(index ?? 0) + 1}`);
  return element;
}

/**
 * The driver's car, as a dot with a heading arrow.
 *
 * The arrow is rotated in place when a new fix arrives rather than by recreating
 * the marker, so a passenger watching the map sees the car turn instead of the
 * marker blinking out and back.
 */
function createLiveMarkerElement(heading?: number): HTMLDivElement {
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

export function RideMap({
  origin,
  destination,
  waypoints = [],
  route,
  liveLocation = null,
  className = "",
  interactive = true,
  selectionTarget = null,
  onPickLocation,
}: RideMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyMapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<MapLibreMarker[]>([]);
  const liveMarkerRef = useRef<MapLibreMarker | null>(null);
  const onPickLocationRef = useRef(onPickLocation);
  const [isMapReady, setIsMapReady] = useState(false);
  const waypointKey = waypoints.map((waypoint) => `${waypoint.lat},${waypoint.lon}`).join("|");

  useEffect(() => {
    onPickLocationRef.current = onPickLocation;
  }, [onPickLocation]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [78.9629, 22.5937],
      zoom: 4.2,
      attributionControl: false,
      cooperativeGestures: true,
      interactive,
    });

    mapRef.current = map;
    if (interactive) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    if (!interactive) {
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.boxZoom.disable();
      map.dragRotate.disable();
      map.keyboard.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
      map.touchPitch.disable();
    }

    const handleMapClick = (event: MapMouseEvent) => {
      onPickLocationRef.current?.({ lat: event.lngLat.lat, lon: event.lngLat.lng });
    };
    if (interactive) map.on("click", handleMapClick);

    const handleStyleLoad = () => {
      readyMapRef.current = map;
      setIsMapReady(true);
    };
    map.once("style.load", handleStyleLoad);

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.off("style.load", handleStyleLoad);
      map.off("click", handleMapClick);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      liveMarkerRef.current?.remove();
      liveMarkerRef.current = null;
      readyMapRef.current = null;
      map.remove();
      mapRef.current = null;
      setIsMapReady(false);
    };
  }, [interactive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) return;
    map.getCanvas().style.cursor = selectionTarget ? "crosshair" : "";
  }, [isMapReady, selectionTarget]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady || readyMapRef.current !== map) return;

    if (!map.getSource(ROUTE_SOURCE_ID)) {
      map.addSource(ROUTE_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: ROUTE_CASING_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 9 },
      } satisfies LineLayerSpecification);
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#159447", "line-width": 5 },
      } satisfies LineLayerSpecification);
    }

    const validRoute = (route ?? []).filter(
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
    const routeSource = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
    routeSource?.setData(routeData);

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const markerPoints: Array<{ point: Coordinates; kind: MarkerKind; index?: number }> = [];
    if (origin && isValidCoordinate(origin)) markerPoints.push({ point: origin, kind: "origin" });
    waypoints.forEach((waypoint, index) => {
      if (isValidCoordinate(waypoint)) markerPoints.push({ point: waypoint, kind: "waypoint", index });
    });
    if (destination && isValidCoordinate(destination)) {
      markerPoints.push({ point: destination, kind: "destination" });
    }

    markerPoints.forEach(({ point, kind, index }) => {
      const marker = new maplibregl.Marker({
        element: createMarkerElement(kind, index),
        anchor: "center",
      })
        .setLngLat([point.lon, point.lat])
        .addTo(map);
      markersRef.current.push(marker);
    });

    const routeBounds = validRoute.map(([lon, lat]) => [lon, lat] as [number, number]);
    const markerBounds = markerPoints.map(({ point }) => [point.lon, point.lat] as [number, number]);
    const fitPoints = routeBounds.length >= 2 ? routeBounds : markerBounds;

    if (fitPoints.length >= 2) {
      const bounds = new maplibregl.LngLatBounds();
      fitPoints.forEach(([lon, lat]) => bounds.extend([lon, lat]));
      map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 650 });
    } else if (fitPoints.length === 1) {
      map.easeTo({ center: fitPoints[0], zoom: Math.max(map.getZoom(), 12), duration: 500 });
    }
  }, [destination, isMapReady, origin, route, waypointKey]);

  const liveLat = liveLocation?.lat ?? null;
  const liveLon = liveLocation?.lon ?? null;
  const liveHeading = liveLocation?.heading ?? null;
  const liveStale = liveLocation?.stale ?? false;

  const liveLocationRef = useRef<LivePosition | null>(null);
  liveLocationRef.current = liveLocation;

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
      liveMarkerRef.current?.remove();
      liveMarkerRef.current = null;
      return;
    }

    const existing = liveMarkerRef.current;
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

    liveMarkerRef.current = new maplibregl.Marker({
      element: createLiveMarkerElement(liveHeading ?? undefined),
      anchor: "center",
    })
      .setLngLat([liveLon, liveLat])
      .addTo(map);
  }, [isMapReady, liveHeading, liveLat, liveLon, liveStale]);

  // When the tab becomes visible again, immediately sync the marker to the
  // latest known location from the ref. This handles the case where realtime
  // events were received while the page was hidden but the effect didn't fire.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const location = liveLocationRef.current;
      if (!location) return;
      const map = readyMapRef.current;
      if (!map || !isMapReady) return;
      const lat = location.lat;
      const lon = location.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const existing = liveMarkerRef.current;
      if (existing) {
        existing.setLngLat([lon, lat]);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [isMapReady]);

  return (
    <div
      ref={containerRef}
      className={`ride-map${className ? ` ${className}` : ""}${interactive ? "" : " ride-map--static"}${selectionTarget ? " ride-map--selecting" : ""}`}
      role="region"
      aria-label={selectionTarget ? `Select a ${selectionTarget === "waypoint" ? "route stop" : selectionTarget} on the map` : "Ride route map"}
    />
  );
}

export default RideMap;
