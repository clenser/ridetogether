import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { Booking, Coordinates, Ride } from "../types";
import { haversineDistanceKm } from "../services/geometry";
import {
  buildActiveStops,
  calculateDriverProgress,
  checkDeparture,
  checkProximity,
  DETOUR_DEFAULTS,
  orderStops,
  type ActiveStop,
  type DetourEngineConfig,
  type NavigationState,
} from "../services/detourEngine";
import { getSupabaseClient } from "../services/supabase";
import { getAuthenticatedUserId } from "../repositories/session";

export interface DetourEngineHookOptions {
  ride: Ride | null;
  bookings: Booking[];
  driverPosition: Coordinates | null;
  isDriver: boolean;
  isRunning: boolean;
  enabled: boolean;
}

export interface DetourEngineHookResult {
  navigationState: NavigationState;
  activeStop: ActiveStop | null;
  orderedStops: ActiveStop[];
  driverFraction: number;
  driverProgressKm: number;
  totalRouteKm: number;
  error: string;
  confirmPickup: (bookingId: string) => Promise<void>;
  confirmDropoff: (bookingId: string) => Promise<void>;
  denyPickup: (bookingId: string) => Promise<void>;
  denyDropoff: (bookingId: string) => Promise<void>;
}

interface InternalState {
  navigationState: NavigationState;
  activeStop: ActiveStop | null;
  completedStopIds: Set<string>;
  lastArrivalNotified: Set<string>;
  lastDepartureNotified: Set<string>;
  driverFraction: number;
  driverProgressKm: number;
  totalRouteKm: number;
  error: string;
}

type Action =
  | { type: "SET_STATE"; payload: Partial<InternalState> }
  | { type: "MARK_STOP_COMPLETED"; stopKey: string }
  | { type: "MARK_ARRIVAL_NOTIFIED"; stopKey: string }
  | { type: "MARK_DEPARTURE_NOTIFIED"; stopKey: string }
  | { type: "RESET" };

const initialState: InternalState = {
  navigationState: "BASE_ROUTE_TRAVEL",
  activeStop: null,
  completedStopIds: new Set(),
  lastArrivalNotified: new Set(),
  lastDepartureNotified: new Set(),
  driverFraction: 0,
  driverProgressKm: 0,
  totalRouteKm: 0,
  error: "",
};

function reducer(state: InternalState, action: Action): InternalState {
  switch (action.type) {
    case "SET_STATE":
      return { ...state, ...action.payload };
    case "MARK_STOP_COMPLETED":
      return {
        ...state,
        completedStopIds: new Set([...state.completedStopIds, action.stopKey]),
      };
    case "MARK_ARRIVAL_NOTIFIED":
      return {
        ...state,
        lastArrivalNotified: new Set([...state.lastArrivalNotified, action.stopKey]),
      };
    case "MARK_DEPARTURE_NOTIFIED":
      return {
        ...state,
        lastDepartureNotified: new Set([...state.lastDepartureNotified, action.stopKey]),
      };
    case "RESET":
      return { ...initialState, completedStopIds: new Set(), lastArrivalNotified: new Set(), lastDepartureNotified: new Set() };
    default:
      return state;
  }
}

const sendNotification = async (riderId: string, rideId: string, type: string, title: string, body: string) => {
  try {
    const client = getSupabaseClient();
    await client.from("notifications").insert({
      user_id: riderId,
      ride_id: rideId,
      type,
      title,
      body,
    });
  } catch {
    // Notification failure must not break the detour engine
  }
};

export function useDetourEngine({
  ride,
  bookings,
  driverPosition,
  isDriver,
  isRunning,
  enabled,
}: DetourEngineHookOptions): DetourEngineHookResult {
  const [state, dispatch] = useReducer(reducer, initialState);
  const config: DetourEngineConfig = useMemo(
    () => ({
      pickupToleranceKm: DETOUR_DEFAULTS.pickupToleranceKm,
      dropoffToleranceKm: DETOUR_DEFAULTS.dropoffToleranceKm,
      arrivalRadiusMeters: DETOUR_DEFAULTS.arrivalRadiusMeters,
      departureRadiusMeters: DETOUR_DEFAULTS.departureRadiusMeters,
    }),
    [],
  );

  const activeStops = useMemo(() => {
    if (!ride || !isDriver || !isRunning) return [];
    return buildActiveStops(bookings, ride, config);
  }, [ride, bookings, isDriver, isRunning, config]);

  const orderedStops = useMemo(() => {
    return orderStops(activeStops, state.driverFraction, state.completedStopIds);
  }, [activeStops, state.driverFraction, state.completedStopIds]);

  const activeStop = orderedStops[0] ?? null;

  useEffect(() => {
    if (!enabled || !isDriver || !isRunning || !ride) {
      dispatch({ type: "RESET" });
      return;
    }

    if (!driverPosition) {
      dispatch({ type: "SET_STATE", payload: { error: "Waiting for GPS position..." } });
      return;
    }

    const geometry = (ride.routeGeometry ?? []) as [number, number][];
    if (geometry.length < 2) {
      dispatch({ type: "SET_STATE", payload: { error: "No route geometry available for detour calculation." } });
      return;
    }

    const progress = calculateDriverProgress(driverPosition, geometry);
    const newError = "";

    if (!activeStop) {
      dispatch({
        type: "SET_STATE",
        payload: {
          navigationState: "BASE_ROUTE_TRAVEL",
          activeStop: null,
          driverFraction: progress.fraction,
          driverProgressKm: progress.progressKm,
          totalRouteKm: progress.totalKm,
          error: newError,
        },
      });
      return;
    }

    const stopKey = `${activeStop.bookingId}-${activeStop.type}`;
    const proximity = checkProximity(driverPosition, activeStop, config);
    const hasArrived = state.lastArrivalNotified.has(stopKey);
    const hasDeparted = state.lastDepartureNotified.has(stopKey);

    let newNavigationState: NavigationState = state.navigationState;

    if (proximity === "arrived" && !hasArrived) {
      if (activeStop.type === "pickup") {
        newNavigationState = "ARRIVED_PICKUP";
      } else {
        newNavigationState = "ARRIVED_DROP";
      }

      dispatch({ type: "MARK_ARRIVAL_NOTIFIED", stopKey });

      const riderName = "Passenger";
      if (activeStop.type === "pickup") {
        void sendNotification(
          activeStop.riderId,
          ride.id,
          "driver-arriving",
          "Reached",
          `${riderName}, your driver has arrived at the pickup location.`,
        );
      } else {
        void sendNotification(
          activeStop.riderId,
          ride.id,
          "driver-arriving",
          "Reached your drop-off",
          `${riderName}, your driver has arrived at your drop-off location.`,
        );
      }
    } else if (proximity === "approaching" && !hasArrived) {
      if (activeStop.type === "pickup") {
        newNavigationState = "APPROACHING_PICKUP";
      } else {
        newNavigationState = "APPROACHING_DROP";
      }
    } else if (proximity === "far" && hasArrived && !hasDeparted) {
      const hasActuallyDeparted = checkDeparture(driverPosition, activeStop, config);

      if (hasActuallyDeparted) {
        dispatch({ type: "MARK_DEPARTURE_NOTIFIED", stopKey });

        if (activeStop.type === "pickup") {
          newNavigationState = "AWAITING_PICKUP_CONFIRMATION";
          void sendNotification(
            activeStop.riderId,
            ride.id,
            "booking-confirmed",
            "Were you picked up?",
            "Please confirm that you were picked up by the driver.",
          );
        } else {
          newNavigationState = "AWAITING_DROP_CONFIRMATION";
          void sendNotification(
            activeStop.riderId,
            ride.id,
            "booking-confirmed",
            "Have you been dropped off?",
            "Please confirm that you have been dropped off.",
          );
        }
      }
    } else if (state.navigationState === "PASSENGER_PICKED_UP" && activeStop.type === "dropoff") {
      newNavigationState = "APPROACHING_DROP";
    } else if (state.navigationState === "PASSENGER_DROPPED") {
      newNavigationState = "DETOUR_TO_REJOIN";
    }

    dispatch({
      type: "SET_STATE",
      payload: {
        navigationState: newNavigationState,
        activeStop,
        driverFraction: progress.fraction,
        driverProgressKm: progress.progressKm,
        totalRouteKm: progress.totalKm,
        error: newError,
      },
    });
  }, [enabled, isDriver, isRunning, ride, driverPosition, activeStop, config, state.navigationState, state.lastArrivalNotified, state.lastDepartureNotified]);

  const confirmPickup = useCallback(
    async (bookingId: string) => {
      if (!ride) return;
      try {
        const client = getSupabaseClient();
        const driverId = await getAuthenticatedUserId();
        await client
          .from("bookings")
          .update({ status: "picked_up", picked_up_at: new Date().toISOString() })
          .eq("id", bookingId)
          .eq("ride_id", ride.id);

        const stopKey = `${bookingId}-pickup`;
        dispatch({ type: "MARK_STOP_COMPLETED", stopKey });
        dispatch({ type: "SET_STATE", payload: { navigationState: "PASSENGER_PICKED_UP" } });

        const booking = bookings.find((b) => b.id === bookingId);
        if (booking) {
          await sendNotification(
            booking.riderId,
            ride.id,
            "booking-confirmed",
            "Pickup confirmed",
            "Your pickup has been confirmed. Have a safe trip!",
          );
        }
      } catch (error) {
        dispatch({
          type: "SET_STATE",
          payload: { error: error instanceof Error ? error.message : "Failed to confirm pickup" },
        });
      }
    },
    [ride, bookings],
  );

  const confirmDropoff = useCallback(
    async (bookingId: string) => {
      if (!ride) return;
      try {
        const client = getSupabaseClient();
        await client
          .from("bookings")
          .update({ status: "completed" })
          .eq("id", bookingId)
          .eq("ride_id", ride.id);

        const stopKey = `${bookingId}-dropoff`;
        dispatch({ type: "MARK_STOP_COMPLETED", stopKey });
        dispatch({ type: "SET_STATE", payload: { navigationState: "PASSENGER_DROPPED" } });

        const booking = bookings.find((b) => b.id === bookingId);
        if (booking) {
          await sendNotification(
            booking.riderId,
            ride.id,
            "booking-confirmed",
            "Drop-off confirmed",
            "Thank you for riding with ShareRide!",
          );
        }
      } catch (error) {
        dispatch({
          type: "SET_STATE",
          payload: { error: error instanceof Error ? error.message : "Failed to confirm drop-off" },
        });
      }
    },
    [ride, bookings],
  );

  const denyPickup = useCallback(
    async (bookingId: string) => {
      if (!ride) return;
      const booking = bookings.find((b) => b.id === bookingId);
      if (!booking) return;

      await sendNotification(
        booking.riderId,
        ride.id,
        "booking-cancelled",
        "Pickup not confirmed",
        "The driver indicated that pickup was not completed. Please contact support.",
      );

      dispatch({ type: "SET_STATE", payload: { error: "Pickup not confirmed. Please handle this passenger manually." } });
    },
    [ride, bookings],
  );

  const denyDropoff = useCallback(
    async (bookingId: string) => {
      if (!ride) return;
      const booking = bookings.find((b) => b.id === bookingId);
      if (!booking) return;

      await sendNotification(
        booking.riderId,
        ride.id,
        "booking-cancelled",
        "Drop-off not confirmed",
        "The driver indicated that drop-off was not completed. Please contact support.",
      );

      dispatch({ type: "SET_STATE", payload: { error: "Drop-off not confirmed. Please handle this passenger manually." } });
    },
    [ride, bookings],
  );

  return {
    navigationState: state.navigationState,
    activeStop: state.activeStop,
    orderedStops,
    driverFraction: state.driverFraction,
    driverProgressKm: state.driverProgressKm,
    totalRouteKm: state.totalRouteKm,
    error: state.error,
    confirmPickup,
    confirmDropoff,
    denyPickup,
    denyDropoff,
  };
}
