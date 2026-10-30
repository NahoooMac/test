// Provider behaviour with recorded-shape Yandex responses (mocked HTTP; no quota used).
import { describe, expect, it } from 'vitest';
import { YandexGeoProvider } from '../src/integrations/maps/yandex.ts';

const geocoderBody = {
  response: {
    GeoObjectCollection: {
      featureMember: [
        {
          GeoObject: {
            name: 'Meskel Square',
            Point: { pos: '38.761397 9.010576' },
            metaDataProperty: {
              GeocoderMetaData: {
                Address: {
                  Components: [
                    { kind: 'country', name: 'Ethiopia' },
                    { kind: 'province', name: 'Addis Ababa' },
                    { kind: 'area', name: 'Addis Ababa' },
                    { kind: 'district', name: 'Kirkos' },
                    { kind: 'district', name: 'Kebele 63' },
                    { kind: 'other', name: 'Meskel Square' },
                  ],
                },
              },
            },
          },
        },
      ],
    },
  },
};

const suggestBody = {
  results: [
    {
      title: { text: 'Edna Mall' },
      subtitle: { text: 'Shopping mall · Addis Ababa, Bole, Kebele 30' },
      uri: 'ymapsbm1://org?oid=1',
    },
    { title: { text: 'No uri, skipped' } },
  ],
};

function provider(handler: (url: URL) => Response) {
  const seen: URL[] = [];
  const p = new YandexGeoProvider({
    geocoderKey: 'g-key',
    suggestKey: 's-key',
    fetch: async (u) => {
      const url = new URL(String(u));
      seen.push(url);
      return handler(url);
    },
  });
  return { p, seen };
}

describe('YandexGeoProvider', () => {
  it('suggests landmarks restricted to Addis, with sub-city', async () => {
    const { p, seen } = provider(() => Response.json(suggestBody));
    const out = await p.suggest('Edna Mall');
    expect(out).toEqual([
      {
        ref: 'ymapsbm1://org?oid=1',
        name: 'Edna Mall',
        description: 'Shopping mall · Addis Ababa, Bole, Kebele 30',
        subCity: 'bole',
      },
    ]);
    expect(seen[0]!.host).toBe('suggest-maps.yandex.ru');
    expect(seen[0]!.searchParams.get('strict_bounds')).toBe('1');
    expect(seen[0]!.searchParams.get('apikey')).toBe('s-key');
    await p.suggest('edna mall ');
    expect(seen).toHaveLength(1); // cached
  });

  it('resolves a suggestion to coordinates with a clean description', async () => {
    const { p, seen } = provider(() => Response.json(geocoderBody));
    const place = await p.resolve('ymapsbm1://org?oid=1');
    expect(place).toMatchObject({
      name: 'Meskel Square',
      description: 'Addis Ababa, Kirkos, Kebele 63',
      subCity: 'kirkos',
      lat: 9.010576,
      lng: 38.761397,
      inServiceArea: true,
    });
    expect(seen[0]!.searchParams.get('uri')).toBe('ymapsbm1://org?oid=1');
    expect(seen[0]!.searchParams.get('apikey')).toBe('g-key');
  });

  it('reverse geocoding keeps the exact pin and caches nearby lookups', async () => {
    const { p, seen } = provider(() => Response.json(geocoderBody));
    const a = await p.reverse({ lat: 9.01051, lng: 38.76141 });
    await p.reverse({ lat: 9.01052, lng: 38.76142 });
    expect(a).toMatchObject({ lat: 9.01051, lng: 38.76141, subCity: 'kirkos' });
    expect(seen).toHaveLength(1);
  });

  it('turns auth and quota failures into provider errors', async () => {
    await expect(
      provider(() => new Response('', { status: 403 })).p.suggest('x y'),
    ).rejects.toMatchObject({
      code: 'AUTH',
    });
    await expect(
      provider(() => new Response('', { status: 429 })).p.suggest('x y'),
    ).rejects.toMatchObject({
      code: 'QUOTA',
    });
  });
});
