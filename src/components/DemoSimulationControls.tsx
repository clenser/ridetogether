import { Pause, Play, RotateCcw } from "lucide-react";
import type { UseDemoSimulationResult } from "../hooks/useDemoSimulation";

const SPEED_OPTIONS = [0.5, 1, 2, 5, 10] as const;

interface DemoSimulationControlsProps {
  simulation: UseDemoSimulationResult;
}

export function DemoSimulationControls({ simulation }: DemoSimulationControlsProps) {
  const { status, frame, speedMultiplier, error } = simulation;

  return (
    <div className="demo-simulation" aria-label="Demo simulation controls">
      <div className="demo-simulation__row">
        <span className={`demo-simulation__status demo-simulation__status--${status}`}>
          {status === "off" && "OFF"}
          {status === "playing" && "ON"}
          {status === "paused" && "PAUSED"}
          {status === "finished" && "COMPLETE"}
        </span>
        <div className="demo-simulation__controls">
          {status === "off" || status === "finished" ? (
            <button
              type="button"
              className="ds-button ds-button--primary ds-button--sm"
              onClick={status === "finished" ? simulation.restart : simulation.start}
            >
              <Play size={14} />
              {status === "finished" ? "Restart" : "Start"}
            </button>
          ) : null}
          {status === "playing" ? (
            <button
              type="button"
              className="ds-button ds-button--subtle ds-button--sm"
              onClick={simulation.pause}
            >
              <Pause size={14} />
              Pause
            </button>
          ) : null}
          {status === "paused" ? (
            <button
              type="button"
              className="ds-button ds-button--primary ds-button--sm"
              onClick={simulation.resume}
            >
              <Play size={14} />
              Resume
            </button>
          ) : null}
          {status === "playing" || status === "paused" ? (
            <button
              type="button"
              className="ds-button ds-button--ghost ds-button--sm"
              onClick={simulation.restart}
            >
              <RotateCcw size={14} />
              Restart
            </button>
          ) : null}
        </div>
      </div>

      <div className="demo-simulation__row">
        <span className="demo-simulation__speed-label">Speed</span>
        <div className="demo-simulation__speed-options">
          {SPEED_OPTIONS.map((speed) => (
            <button
              key={speed}
              type="button"
              className={`ds-button ds-button--sm${speedMultiplier === speed ? " ds-button--primary" : " ds-button--ghost"}`}
              onClick={() => simulation.setSpeedMultiplier(speed)}
              aria-pressed={speedMultiplier === speed}
            >
              {speed}×
            </button>
          ))}
        </div>
      </div>

      {frame ? (
        <div className="demo-simulation__progress">
          <div className="demo-simulation__progress-bar">
            <div
              className="demo-simulation__progress-fill"
              style={{ width: `${Math.round(frame.progress * 100)}%` }}
            />
          </div>
          <div className="demo-simulation__progress-info">
            <span>{Math.round(frame.progress * 100)}%</span>
            <span>{Math.round(frame.speedKph)} km/h</span>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="demo-simulation__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default DemoSimulationControls;
