import { MapPin, Navigation } from "lucide-react";

interface GpsPermissionPromptProps {
  message: string;
  onRequestPermission: () => void;
  onCancel?: () => void;
  loading?: boolean;
}

export function GpsPermissionPrompt({ message, onRequestPermission, onCancel, loading }: GpsPermissionPromptProps) {
  return (
    <div className="gps-permission-prompt" role="dialog" aria-label="Location permission required">
      <div className="gps-permission-prompt__icon">
        <Navigation size={24} />
      </div>
      <div className="gps-permission-prompt__content">
        <h3 className="gps-permission-prompt__title">Location Access Required</h3>
        <p className="gps-permission-prompt__message">{message}</p>
        <div className="gps-permission-prompt__actions">
          <button
            type="button"
            className="ds-button ds-button--primary"
            onClick={onRequestPermission}
            disabled={loading}
          >
            <MapPin size={16} />
            {loading ? "Requesting..." : "Grant Location Access"}
          </button>
          {onCancel ? (
            <button type="button" className="ds-button ds-button--ghost" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default GpsPermissionPrompt;
