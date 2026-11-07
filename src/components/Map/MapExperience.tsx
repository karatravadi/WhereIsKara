"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import nextDynamic from "next/dynamic";
import { formatDistanceToNowStrict } from "date-fns";
import type { MapFilterMode } from "./MapView";
import { CityPopup } from "./CityPopup";
import { FilterToggle } from "./FilterToggle";
import {
  getArbitratedPinStatus,
  getCanonicalCurrentTrip,
  isWithinTrip,
  pickRepresentativeVisit,
} from "@/lib/status";
import { msSinceLoad, nextPinIndex, track } from "@/lib/track";
import type { CityWithVisits, DailyUpdate, Trip } from "@/lib/types";

// mapbox-gl is large (JS and its own CSS) and only ever runs in the
// browser - loading it eagerly blocked first paint on every page load,
// whether or not the map had rendered yet. Splitting it into its own
// chunk keeps it off the critical path entirely.
const MapView = nextDynamic(() => import("./MapView").then((mod) => mod.MapView), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-bg" />,
});

const SIXTY_HOURS_MS = 60 * 60 * 60 * 1000;

type Props = {
  cities: CityWithVisits[];
  latestUpdateByVisit: Record<string, DailyUpdate>;
  trip: Trip | null;
};

export function MapExperience({ cities, latestUpdateByVisit, trip }: Props) {
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [mode, setMode] = useState<MapFilterMode>("travels");

  // What the tracking handlers need to read, held in a ref so the handlers
  // keep a stable identity (MapView rebuilds every marker whenever
  // onSelectCity changes).
  const trackCtx = useRef({ cities, trip, mode, latestUpdateByVisit });
  useEffect(() => {
    trackCtx.current = { cities, trip, mode, latestUpdateByVisit };
  });
  const openPin = useRef<{ id: string; name: string; openedAt: number } | null>(null);

  const handleSelectCity = useCallback((city: CityWithVisits) => {
    setSelectedCityId(city.id);

    const open = openPin.current;
    if (open?.id === city.id) return; // re-tapping the open pin isn't a new selection
    const ctx = trackCtx.current;
    const now = new Date();

    if (open) {
      track("pin_close", {
        city: open.name,
        pin_id: open.id,
        ms_open: Math.round(performance.now() - open.openedAt),
        reason: "switch",
      });
    }

    // Status exactly as the pin itself is drawn (see MapView).
    const visitsForStatus =
      ctx.mode === "travels" && city.pin_type !== "personal"
        ? city.visits.filter((v) => isWithinTrip(v, ctx.trip))
        : city.visits;
    const rep = pickRepresentativeVisit(visitsForStatus, city.timezone, now);
    const pinStatus = getArbitratedPinStatus(
      city,
      rep,
      getCanonicalCurrentTrip(ctx.cities, ctx.trip, now),
      now
    );

    // "Latest" = the pin holding the most recent check-in across the whole map.
    const cityVisitIds = new Set(city.visits.map((v) => v.id));
    let newestOverall: DailyUpdate | null = null;
    let newestForCity: DailyUpdate | null = null;
    for (const update of Object.values(ctx.latestUpdateByVisit)) {
      if (!newestOverall || update.created_at > newestOverall.created_at) newestOverall = update;
      if (
        cityVisitIds.has(update.visit_id) &&
        (!newestForCity || update.created_at > newestForCity.created_at)
      ) {
        newestForCity = update;
      }
    }

    track("pin_select", {
      city: city.name,
      pin_id: city.id,
      trip: ctx.mode === "travels" ? "26/27" : "all_time",
      pin_status: pinStatus,
      is_current: pinStatus === "current",
      is_latest: newestOverall ? cityVisitIds.has(newestOverall.visit_id) : false,
      days_since_checkin: newestForCity
        ? Math.floor((now.getTime() - new Date(newestForCity.created_at).getTime()) / 86_400_000)
        : null,
      select_index: nextPinIndex(),
      ms_since_load: msSinceLoad(),
    });
    openPin.current = { id: city.id, name: city.name, openedAt: performance.now() };
  }, []);

  const handleClose = useCallback(() => {
    const open = openPin.current;
    if (open) {
      track("pin_close", {
        city: open.name,
        pin_id: open.id,
        ms_open: Math.round(performance.now() - open.openedAt),
        reason: "close",
      });
    }
    openPin.current = null;
    setSelectedCityId(null);
  }, []);

  const handleModeChange = useCallback((next: MapFilterMode) => {
    if (trackCtx.current.mode !== next) {
      track("trip_toggle", { to_value: next === "travels" ? "26/27" : "all_time" });
    }
    setMode(next);
  }, []);

  const selectedCity = cities.find((c) => c.id === selectedCityId) ?? null;

  const checkedInValue = trip?.last_checked_in
    ? formatDistanceToNowStrict(new Date(trip.last_checked_in), { addSuffix: true })
    : null;

  // Date.now() is impure, so it can't be called directly during render - a
  // lazily-initialized "now" tracked in state (refreshed periodically via a
  // callback, not synchronously in the effect body) stands in for it.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const checkedInStale = trip?.last_checked_in
    ? now - new Date(trip.last_checked_in).getTime() > SIXTY_HOURS_MS
    : false;

  return (
    <div className="absolute inset-0">
      <MapView
        cities={cities}
        trip={trip}
        mode={mode}
        onSelectCity={handleSelectCity}
        selectedCityId={selectedCityId}
      />

      <div className="absolute left-4 top-[calc(3.5rem+0.75rem)] z-10">
        <FilterToggle mode={mode} onChange={handleModeChange} />
      </div>

      {checkedInValue && (
        <div className="absolute right-4 top-[calc(3.5rem+0.75rem)] z-10 rounded-[2px] border border-line bg-surface px-3 py-1.5 text-right leading-tight">
          <p className="text-[11px] uppercase text-text-secondary">Check-in</p>
          <p
            className={`font-mono-num text-[13px] whitespace-nowrap ${
              checkedInStale ? "text-text-secondary" : "text-text-primary"
            }`}
          >
            {checkedInValue}
          </p>
        </div>
      )}

      {selectedCity && (
        <CityPopup
          city={selectedCity}
          cities={cities}
          trip={trip}
          latestUpdateByVisit={latestUpdateByVisit}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
