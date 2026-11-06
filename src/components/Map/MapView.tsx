"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { CityWithVisits, PinStatus, Trip } from "@/lib/types";
import {
  getArbitratedPinStatus,
  getCanonicalCurrentTrip,
  getStaySequence,
  getVisitStatus,
  isWithinTrip,
  pickRepresentativeVisit,
  statusColor,
} from "@/lib/status";
import { pinSvg } from "@/lib/pinIcon";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// On the globe projection, Mapbox visually curves a rendered line to
// follow the sphere, but a bare 2-point LineString gives it nothing to
// curve - the line bows on screen while "line-center" symbol placement
// still anchors to the midpoint of the original straight (now-inaccurate)
// chord, so the arrow sits visibly off the curved line it's meant to sit
// on. Subdividing into many short segments first means there's no gap
// between the geometry the line layer draws and the geometry the arrow
// is placed against.
function subdivideLine(from: [number, number], to: [number, number], steps = 32): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }
  return points;
}

export type MapFilterMode = "travels" | "all-time";

type Props = {
  cities: CityWithVisits[];
  trip: Trip | null;
  mode: MapFilterMode;
  onSelectCity: (city: CityWithVisits) => void;
  selectedCityId: string | null;
};

export function MapView({ cities, trip, mode, onSelectCity, selectedCityId }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/kt7373/cmrsbvkcy008y01qk68g6h7c1",
      projection: "globe",
      zoom: 1.4,
      center: [20, 20],
      preserveDrawingBuffer: true,
    });
    mapRef.current = map;

    // Self-tracked map load count, so we get an early warning before
    // hitting Mapbox's billed usage tiers. Fire-and-forget, non-blocking.
    fetch("/api/track/map-load", { method: "POST" }).catch(() => {});

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

    // The route lines and the initial flyTo are always scoped to the 26/27
    // travels, regardless of which pins are currently shown. Only two legs
    // are drawn: the one Kara just came in on (solid) and the one she's
    // heading out on next (dashed, arrowed). Older history isn't drawn.
    const now = new Date();
    const tripCities = cities.filter((c) => c.pin_type === "trip");

    // One entry per stay, not per city, so a repeat stop (e.g. Taipei, out to
    // Sun Moon Lake and back) is a real "next" leg. Day trips never determine
    // where Kara "is", so they're left out of the sequence entirely.
    const stays = tripCities.flatMap((city) =>
      city.visits
        .filter((v) => isWithinTrip(v, trip) && !v.is_day_trip)
        .map((visit) => ({ data: city, visit, timezone: city.timezone }))
    );

    // Current/upcoming are derived positionally from the sorted sequence of
    // stays, not independently per city - this is what keeps the route and
    // arrow correct on a changeover day (one stay ending exactly when the
    // next begins).
    const { current, visited, future } = getStaySequence(stays, now);

    type LatLng = { lng: number; lat: number };
    const previous: LatLng | undefined = visited[visited.length - 1]?.data;
    const here: LatLng | undefined = current?.data;

    // While Kara is on a day trip, the incoming leg is parent stay -> day
    // trip city (she's out from the parent, not in from the previous stop).
    let incomingFrom: LatLng | undefined = here ? previous : undefined;
    let incomingTo: LatLng | undefined = here;
    for (const city of cities) {
      for (const visit of city.visits) {
        if (!visit.is_day_trip || !visit.parent_visit_id) continue;
        if (getVisitStatus(visit, city.timezone, now) !== "current") continue;
        const parentCity = cities.find((c) => c.visits.some((v) => v.id === visit.parent_visit_id));
        if (parentCity) {
          incomingFrom = parentCity;
          incomingTo = city;
        }
      }
    }

    // Between stays (no current one) there's nothing to be "incoming" to, so
    // just show the leg from the last stop to the next.
    const outgoingFrom = here ?? previous;

    // Every leg still to come, one feature per leg so "line-center" puts one
    // arrow on each rather than spacing them along the whole path.
    const upcomingPath: LatLng[] = [
      ...(outgoingFrom ? [outgoingFrom] : []),
      ...future.map((x) => x.data),
    ];

    const legFeatures = (from: LatLng | undefined, to: LatLng | undefined) =>
      from && to && (from.lng !== to.lng || from.lat !== to.lat)
        ? [
            {
              type: "Feature" as const,
              properties: {},
              geometry: {
                type: "LineString" as const,
                coordinates: subdivideLine([from.lng, from.lat], [to.lng, to.lat]),
              },
            },
          ]
        : [];

    const currentEntry = current ? { city: current.data } : null;

    map.on("load", () => {
      map.addSource("route-incoming", {
        type: "geojson",
        data: { type: "FeatureCollection", features: legFeatures(incomingFrom, incomingTo) },
      });
      map.addLayer({
        id: "route-incoming",
        type: "line",
        source: "route-incoming",
        paint: {
          "line-color": "#8F9296",
          "line-width": 1.75,
        },
      });

      map.addSource("route-upcoming", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: upcomingPath.slice(0, -1).flatMap((c, i) => legFeatures(c, upcomingPath[i + 1])),
        },
      });
      map.addLayer({
        id: "route-upcoming",
        type: "line",
        source: "route-upcoming",
        paint: {
          "line-color": "#2C4A7C",
          "line-width": 1.75,
          "line-dasharray": [0, 4, 3],
        },
      });

      // Small triangular arrow icon, repeated along the dashed line to show direction of travel.
      const arrowSize = 20;
      const arrowCanvas = document.createElement("canvas");
      arrowCanvas.width = arrowSize;
      arrowCanvas.height = arrowSize;
      const arrowCtx = arrowCanvas.getContext("2d")!;
      arrowCtx.fillStyle = "#2C4A7C";
      arrowCtx.beginPath();
      arrowCtx.moveTo(3, 5);
      arrowCtx.lineTo(17, 10);
      arrowCtx.lineTo(3, 15);
      arrowCtx.closePath();
      arrowCtx.fill();
      if (!map.hasImage("route-arrow")) {
        map.addImage("route-arrow", arrowCtx.getImageData(0, 0, arrowSize, arrowSize), {
          pixelRatio: 2,
        });
      }

      map.addLayer({
        id: "route-upcoming-arrows",
        type: "symbol",
        source: "route-upcoming",
        layout: {
          "symbol-placement": "line-center",
          "icon-image": "route-arrow",
          "icon-size": 1.4,
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });

      if (currentEntry) {
        map.flyTo({
          center: [currentEntry.city.lng, currentEntry.city.lat],
          zoom: 4,
          duration: 4000,
          essential: true,
        });
      }
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};

    const now = new Date();

    // In "travels" mode, only show cities with a visit inside the trip
    // window (plus the personal/home pin, which is always shown). In
    // "all-time" mode, every city with any visit shows, using its overall
    // representative visit (which may be historic).
    const visibleCities = cities.filter((city) => {
      if (city.pin_type === "personal") return true;
      if (city.visits.length === 0) return false;
      if (mode === "all-time") return true;
      return city.visits.some((v) => isWithinTrip(v, trip));
    });

    // Guards against two cities in different timezones both reading
    // "current" during the changeover window between them - see
    // getCanonicalCurrentTrip's own comment for why this is necessary
    // rather than each city just checking its own timezone.
    const canonicalCurrent = getCanonicalCurrentTrip(cities, trip, now);

    visibleCities.forEach((city) => {
      const visitsForStatus =
        mode === "travels" && city.pin_type !== "personal"
          ? city.visits.filter((v) => isWithinTrip(v, trip))
          : city.visits;
      const representativeVisit = pickRepresentativeVisit(visitsForStatus, city.timezone, now);
      const status: PinStatus = getArbitratedPinStatus(city, representativeVisit, canonicalCurrent, now);

      const el = document.createElement("div");
      el.className = "kara-pin";
      el.innerHTML = pinSvg(status, statusColor[status]);
      el.style.width = "28px";

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectCity(city);
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([city.lng, city.lat])
        .addTo(map);

      // The current city should always read as "here I am" even when
      // another pin overlaps it, regardless of which was added to the map
      // first.
      marker.getElement().style.zIndex = status === "current" ? "10" : "1";

      markersRef.current[city.id] = marker;
    });

    return () => {
      Object.values(markersRef.current).forEach((m) => m.remove());
    };
  }, [cities, trip, mode, onSelectCity]);

  // The popup covers the right side of the map on desktop and the bottom on
  // mobile. Padding shifts the map's visual centre into the part that's still
  // visible, so the selected pin sits in the middle of that instead of
  // against the panel edge. Reset to zero when the popup closes.
  const hadPaddingRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!selectedCityId) {
      if (hadPaddingRef.current) {
        hadPaddingRef.current = false;
        map.easeTo({ padding: { top: 0, right: 0, bottom: 0, left: 0 }, duration: 400 });
      }
      return;
    }

    const city = cities.find((c) => c.id === selectedCityId);
    if (!city) return;

    const panel = document.querySelector<HTMLElement>("[data-city-popup]");
    const isDesktop = window.matchMedia("(min-width: 640px)").matches;
    const target = {
      center: [city.lng, city.lat] as [number, number],
      zoom: Math.max(map.getZoom(), 4),
      duration: 800,
    };

    if (isDesktop) {
      hadPaddingRef.current = true;
      map.easeTo({
        ...target,
        padding: { top: 0, left: 0, bottom: 0, right: panel ? panel.offsetWidth : 0 },
      });
      return;
    }

    // On mobile the sheet covers most of the screen, so a bottom padding that
    // big shrinks the globe to fit the sliver left over (it renders as a small
    // disc with a visible edge). An offset moves the pin up into the exposed
    // strip below the header without resizing the globe.
    const HEADER_PX = 56;
    const sheetHeight = panel ? panel.offsetHeight : 0;
    map.easeTo({
      ...target,
      padding: { top: 0, left: 0, bottom: 0, right: 0 },
      offset: [0, (HEADER_PX - sheetHeight) / 2],
    });
  }, [selectedCityId, cities]);

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}
