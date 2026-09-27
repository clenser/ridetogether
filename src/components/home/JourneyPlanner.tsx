import { useId, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, CarFront, MapPinned } from "lucide-react";
import LocationSearch from "../LocationSearch";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { SegmentedControl } from "../ui/Tabs";
import { MAX_HANDOFF_SEATS, encodeJourneyParams } from "../../services/journeyParams";
import type { Coordinates } from "../../types";

type PlannerMode = "find" | "offer";

const localDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const todayKey = () => localDateKey(new Date());

/**
 * The home page's journey planner.
 *
 * One control that both kinds of member use, rather than two competing CTAs.
 * "Find" asks the questions a rider has - where from, where to, when, how many
 * seats. "Offer" asks the driver's - the same route, plus how many seats they
 * are offering and what each rider contributes.
 *
 * What it deliberately does not do is search, route or price anything. It hands
 * the journey to the real Find Ride or Offer Ride form through the URL and lets
 * those pages do the actual work, so there is exactly one geocoder, one router
 * and one fare calculator in the product.
 */
export function JourneyPlanner() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<PlannerMode>("find");
  const [origin, setOrigin] = useState<Coordinates | null>(null);
  const [destination, setDestination] = useState<Coordinates | null>(null);
  const [date, setDate] = useState(todayKey);
  const [time, setTime] = useState("");
  const [seats, setSeats] = useState(1);
  const [contribution, setContribution] = useState(0);
  const [error, setError] = useState("");
  const groupId = useId();
  const errorId = `${groupId}-error`;

  const isOffer = mode === "offer";
  const label = isOffer ? "Offer" : "Find";

  const summary = useMemo(() => {
    const from = origin?.label ?? "your start";
    const to = destination?.label ?? "your destination";
    return `${from} to ${to}`;
  }, [destination, origin]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!origin || !destination) {
      setError("Choose a start and a destination so we know which way you are travelling.");
      return;
    }
    if (origin.lat === destination.lat && origin.lon === destination.lon) {
      setError("Your start and destination are the same place. Pick somewhere else to travel to.");
      return;
    }
    const search = encodeJourneyParams(
      isOffer
        ? { origin, destination, date, time, seats, contribution }
        : { origin, destination, date, time, seats },
    );
    navigate(`${isOffer ? "/offer" : "/find"}?${search.toString()}`);
  };

  return (
    <form className="rt-planner" onSubmit={handleSubmit} aria-describedby={error ? errorId : undefined}>
      <div className="rt-planner__tabs">
        <SegmentedControl
          block
          label="What would you like to do?"
          value={mode}
          onChange={(next) => {
            setMode(next);
            setError("");
          }}
          options={[
            { value: "find", label: "Find a ride", icon: <MapPinned size={16} aria-hidden="true" /> },
            { value: "offer", label: "Offer a ride", icon: <CarFront size={16} aria-hidden="true" /> },
          ]}
        />
      </div>

      <div className="rt-planner__route">
        <LocationSearch
          label="From"
          placeholder="Where are you starting?"
          value={origin}
          onChange={(next) => {
            setOrigin(next);
            setError("");
          }}
          onClear={() => setOrigin(null)}
          className="rt-planner__location"
        />
        <LocationSearch
          label="To"
          placeholder="Where are you heading?"
          value={destination}
          onChange={(next) => {
            setDestination(next);
            setError("");
          }}
          onClear={() => setDestination(null)}
          className="rt-planner__location"
        />
      </div>

      <div className="rt-planner__grid">
        <TextField
          label="Date"
          type="date"
          value={date}
          min={todayKey()}
          onChange={(event) => setDate(event.target.value)}
        />
        <TextField
          label="Time"
          type="time"
          optional
          value={time}
          onChange={(event) => setTime(event.target.value)}
        />
        <TextField
          label={isOffer ? "Seats available" : "Seats needed"}
          type="number"
          min={1}
          max={MAX_HANDOFF_SEATS}
          inputMode="numeric"
          value={seats}
          onChange={(event) => {
            const next = Number(event.target.value);
            setSeats(Number.isFinite(next) ? Math.min(MAX_HANDOFF_SEATS, Math.max(1, next)) : 1);
          }}
        />
        {isOffer ? (
          <TextField
            label="Contribution per seat"
            type="number"
            min={0}
            inputMode="numeric"
            value={contribution}
            onChange={(event) => {
              const next = Number(event.target.value);
              setContribution(Number.isFinite(next) ? Math.max(0, next) : 0);
            }}
            hint="You can adjust this later."
          />
        ) : null}
      </div>

      {error ? (
        <p className="rt-planner__error" id={errorId} role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" block>
        {label} this journey
        <ArrowRight size={18} aria-hidden="true" />
      </Button>

      <p className="rt-planner__note">
        {isOffer
          ? "We will show the real route, distance and fair cost before you publish."
          : `Continue to search real rides along ${summary}.`}
      </p>
    </form>
  );
}

export default JourneyPlanner;
