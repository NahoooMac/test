import type { LatLng, Place, PlaceSuggestion } from '@dp/shared';

/** Address search and reverse geocoding. API keys never leave the server. */
export interface GeoProvider {
  readonly name: string;
  /** Autocomplete: names and areas only, no coordinates (cheap, called while typing). */
  suggest(query: string): Promise<PlaceSuggestion[]>;
  /** Coordinates for a suggestion the user picked. */
  resolve(ref: string): Promise<Place | null>;
  /** Name of the place under a map pin. */
  reverse(point: LatLng): Promise<Place | null>;
}

export class GeoProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
