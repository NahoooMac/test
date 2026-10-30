import type { Config } from '../../config/env.ts';
import { FakeGeoProvider } from './fake.ts';
import { YandexGeoProvider } from './yandex.ts';
import type { GeoProvider } from './types.ts';

export * from './types.ts';

export function createGeoProvider(config: Config): GeoProvider {
  if (config.YANDEX_GEOCODER_KEY && config.YANDEX_GEOSUGGEST_KEY) {
    return new YandexGeoProvider({
      geocoderKey: config.YANDEX_GEOCODER_KEY,
      suggestKey: config.YANDEX_GEOSUGGEST_KEY,
    });
  }
  return new FakeGeoProvider();
}
