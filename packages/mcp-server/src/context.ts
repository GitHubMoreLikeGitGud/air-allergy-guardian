import { ForecastSource, geocodePlace, type FetchLike } from "./openmeteo.js";
import { HouseholdStore } from "./store.js";
import type { Home } from "./types.js";

export interface AppContext {
  store: HouseholdStore;
  forecasts: ForecastSource;
  geocode: (place: string) => Promise<Home | null>;
  now: () => Date;
}

export interface ContextOptions {
  dataFile: string;
  seedFile?: string | null;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export function createContext(opts: ContextOptions): AppContext {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url) => fetch(url));
  const now = opts.now ?? (() => new Date());
  return {
    store: new HouseholdStore(opts.dataFile, opts.seedFile ?? null),
    forecasts: new ForecastSource(fetchImpl, now),
    geocode: (place) => geocodePlace(place, fetchImpl),
    now
  };
}
