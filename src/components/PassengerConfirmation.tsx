import { Check, X } from "lucide-react";
import type { ActiveStop } from "../services/detourEngine";

interface PassengerConfirmationProps {
  type: "pickup" | "dropoff";
  stop: ActiveStop;
  onConfirm: () => void;
  onDeny: () => void;
  loading?: boolean;
}

export function PassengerConfirmation({ type, stop, onConfirm, onDeny, loading }: PassengerConfirmationProps) {
  const isPickup = type === "pickup";

  return (
    <div className="passenger-confirmation" role="dialog" aria-label={isPickup ? "Confirm pickup" : "Confirm drop-off"}>
      <div className="passenger-confirmation__icon">
        {isPickup ? <Check size={20} /> : <Check size={20} />}
      </div>
      <div className="passenger-confirmation__content">
        <h3 className="passenger-confirmation__title">
          {isPickup ? "Were you picked up?" : "Have you been dropped off?"}
        </h3>
        <p className="passenger-confirmation__description">
          {isPickup
            ? "The driver has indicated that you were picked up. Please confirm to continue."
            : "The driver has indicated that you have been dropped off. Please confirm to complete your trip."}
        </p>
        <div className="passenger-confirmation__actions">
          <button
            type="button"
            className="ds-button ds-button--primary ds-button--sm"
            onClick={onConfirm}
            disabled={loading}
          >
            <Check size={14} />
            Yes
          </button>
          <button
            type="button"
            className="ds-button ds-button--danger ds-button--sm"
            onClick={onDeny}
            disabled={loading}
          >
            <X size={14} />
            No
          </button>
        </div>
      </div>
    </div>
  );
}

export default PassengerConfirmation;
