import { useQuery } from '@tanstack/react-query';
import type { LatLng, NearbyRider } from '@dp/shared';
import { api } from '../../lib/api.ts';
import type { MapMarker } from '../../map/MapView.tsx';

/**
 * Free riders near `at`, as background 3D markers for the booking map. The server only returns
 * approximate, anonymous positions. The point is rounded (~100 m) so small pans don't refetch.
 */
export function useNearbyRiders(at: LatLng | null | undefined): MapMarker[] {
  const lat = at ? Math.round(at.lat * 1000) / 1000 : null;
  const lng = at ? Math.round(at.lng * 1000) / 1000 : null;
  const q = useQuery({
    queryKey: ['geo', 'nearby-riders', lat, lng],
    queryFn: () => api<NearbyRider[]>(`/geo/nearby-riders?lat=${lat}&lng=${lng}`),
    enabled: lat !== null && lng !== null,
    refetchInterval: 20_000,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
  return (q.data ?? []).map((r) => ({
    id: `nr-${r.key}`,
    kind: 'rider' as const,
    point: { lat: r.lat, lng: r.lng },
    vehicleType: r.vehicleType,
    heading: r.heading,
    ambient: true,
  }));
}
