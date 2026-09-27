import { useCallback, useEffect, useRef, useState } from "react";
import { reportRideLocation } from "../repositories/liveLocationRepository";
import type { RideLocation } from "../types";
import {
  createSimulationFrame,
  cumulativeDistances,
  validateRouteGeometry,
  type SimulationFrame,
} from "../services/simulation";
import type { LonLat } from "../services/geometry";

const PUBLISH_INTERVAL_MS = 1_500;
const BASE_SPEED_KPH = 40;

export type SimulationStatus = "off" | "playing" | "paused" | "finished";

export interface UseDemoSimulationOptions {
  rideId: string;
  driverId: string;
  routeGeometry: unknown;
  isActive: boolean;
}

export interface UseDemoSimulationResult {
  status: SimulationStatus;
  frame: SimulationFrame | null;
  speedMultiplier: number;
  error: string;
  start: () => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  setSpeedMultiplier: (multiplier: number) => void;
  stop: () => void;
}

export function useDemoSimulation({
  rideId,
  driverId,
  routeGeometry,
  isActive,
}: UseDemoSimulationOptions): UseDemoSimulationResult {
  const [status, setStatus] = useState<SimulationStatus>("off");
  const [frame, setFrame] = useState<SimulationFrame | null>(null);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [error, setError] = useState("");

  const validGeometry = validateRouteGeometry(routeGeometry);
  const cumulativeKm = validGeometry ? cumulativeDistances(validGeometry) : null;

  const elapsedRef = useRef(0);
  const lastTickRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const lastPublishRef = useRef(0);
  const statusRef = useRef<SimulationStatus>("off");
  const speedRef = useRef(speedMultiplier);
  const frameRef = useRef<SimulationFrame | null>(null);

  statusRef.current = status;
  speedRef.current = speedMultiplier;

  const publish = useCallback(
    async (simFrame: SimulationFrame) => {
      try {
        await reportRideLocation({
          rideId,
          lat: simFrame.lat,
          lon: simFrame.lon,
          heading: simFrame.heading,
          speedKph: simFrame.speedKph,
          accuracyMeters: 15,
        });
      } catch (caught: unknown) {
        const message = caught instanceof Error ? caught.message : "Unknown error";
        setError(`Location publish failed: ${message}`);
      }
    },
    [rideId],
  );

  const tick = useCallback(
    (timestamp: number) => {
      if (statusRef.current !== "playing") return;

      if (lastTickRef.current === 0) {
        lastTickRef.current = timestamp;
      }

      const deltaSeconds = (timestamp - lastTickRef.current) / 1000;
      lastTickRef.current = timestamp;
      elapsedRef.current += deltaSeconds;

      if (!validGeometry || !cumulativeKm) return;

      const simFrame = createSimulationFrame(
        { routeGeometry: validGeometry, baseSpeedKph: BASE_SPEED_KPH, speedMultiplier: speedRef.current },
        cumulativeKm,
        elapsedRef.current,
      );

      if (!simFrame) return;

      frameRef.current = simFrame;
      setFrame(simFrame);

      if (simFrame.progress >= 1) {
        setStatus("finished");
        return;
      }

      if (timestamp - lastPublishRef.current >= PUBLISH_INTERVAL_MS) {
        lastPublishRef.current = timestamp;
        void publish(simFrame);
      }

      animationRef.current = requestAnimationFrame(tick);
    },
    [validGeometry, cumulativeKm, publish],
  );

  const start = useCallback(() => {
    if (!validGeometry || !cumulativeKm) {
      setError("No valid route geometry available for simulation.");
      return;
    }
    if (!rideId || !driverId) {
      setError("Ride or driver information is missing.");
      return;
    }
    setError("");
    elapsedRef.current = 0;
    lastTickRef.current = 0;
    lastPublishRef.current = 0;
    setStatus("playing");
    animationRef.current = requestAnimationFrame(tick);
  }, [validGeometry, cumulativeKm, rideId, driverId, tick]);

  const pause = useCallback(() => {
    setStatus("paused");
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const resume = useCallback(() => {
    if (status !== "paused") return;
    setError("");
    lastTickRef.current = 0;
    setStatus("playing");
    animationRef.current = requestAnimationFrame(tick);
  }, [status, tick]);

  const restart = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    elapsedRef.current = 0;
    lastTickRef.current = 0;
    lastPublishRef.current = 0;
    setFrame(null);
    setError("");
    setStatus("playing");
    animationRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const stop = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    setStatus("off");
    setFrame(null);
    setError("");
  }, []);

  const changeSpeed = useCallback((multiplier: number) => {
    setSpeedMultiplier(multiplier);
    speedRef.current = multiplier;
  }, []);

  useEffect(() => {
    if (!isActive && status !== "off") {
      stop();
    }
  }, [isActive, status, stop]);

  useEffect(() => {
    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, []);

  return {
    status,
    frame,
    speedMultiplier,
    error,
    start,
    pause,
    resume,
    restart,
    setSpeedMultiplier: changeSpeed,
    stop,
  };
}
