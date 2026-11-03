// Data hooks and copy for the rider's pool, wallet, standing, work areas and history screens.
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  DeliveryHistoryDetail,
  DeliveryHistoryRow,
  RiderPool,
  RiderPreferences,
  RiderStanding,
  RiderWallet,
} from '@dp/shared';
import { api } from '../../lib/api.ts';

export const riderKeys = {
  pool: ['rider', 'pool'] as const,
  wallet: ['rider', 'wallet'] as const,
  standing: ['rider', 'standing'] as const,
  preferences: ['rider', 'preferences'] as const,
  history: (group: string) => ['rider', 'history', group] as const,
  historyDetail: (id: string) => ['rider', 'history', 'detail', id] as const,
};

export const usePool = () =>
  useQuery({
    queryKey: riderKeys.pool,
    queryFn: () => api<RiderPool>('/rider/pool'),
    refetchInterval: 15_000,
  });
export const useWallet = () =>
  useQuery({ queryKey: riderKeys.wallet, queryFn: () => api<RiderWallet>('/rider/wallet') });
export const useStanding = () =>
  useQuery({ queryKey: riderKeys.standing, queryFn: () => api<RiderStanding>('/rider/standing') });
export const usePreferences = () =>
  useQuery({ queryKey: riderKeys.preferences, queryFn: () => api<RiderPreferences>('/rider/preferences') });
export const useHistory = (group: 'all' | 'completed' | 'unsuccessful') =>
  useQuery({
    queryKey: riderKeys.history(group),
    queryFn: () => api<DeliveryHistoryRow[]>(`/rider/history${group === 'all' ? '' : `?group=${group}`}`),
  });
export const useHistoryDetail = (id: string) =>
  useQuery({
    queryKey: riderKeys.historyDetail(id),
    queryFn: () => api<DeliveryHistoryDetail>(`/rider/history/${id}`),
  });

const en = {
  nav: { jobs: 'Jobs', history: 'History', wallet: 'Wallet' },
  pool: {
    title: 'Available jobs',
    subtitle: 'Jobs waiting for a rider in your areas. First to accept gets it.',
    empty: 'No jobs waiting right now. New ones appear here automatically.',
    accept: 'Accept job',
    gone: 'Another rider took this job.',
    toPickup: 'to pickup',
    trip: 'trip',
    earn: 'You earn',
    fare: 'Fare',
    commission: 'Commission',
    waiting: 'Waiting',
    nearHome: 'Near home',
    instructions: 'Instructions',
    receiverPays: 'Receiver pays',
    blocked: {
      not_approved: 'Your account must be approved before you can take jobs.',
      busy: 'Finish your current job before taking another.',
      wallet: 'Top up your wallet to accept jobs. You can stay online meanwhile.',
    } as Record<string, string>,
    areasHint: 'Showing jobs in all areas. Choose your areas to see only nearby work.',
    setAreas: 'Choose areas',
  },
  wallet: {
    title: 'Commission wallet',
    balance: 'Balance',
    minimum: 'Minimum to take jobs',
    limit: 'Debt limit',
    explain:
      'Commission (15% motorcycle, 10% bicycle) is deducted only when a delivery is completed. Keep a balance above the minimum to accept new jobs.',
    low: 'Your balance is too low to accept new jobs.',
    atLimit: 'You have reached the debt limit. Top up to accept new jobs.',
    lowShort: 'Wallet low — top up to accept jobs',
    topUp: 'Top up',
    topUpTitle: 'Top up with Telebirr or CBE Birr',
    topUpSteps:
      'Send the money to the company account, then enter the amount and the transaction ID from the confirmation SMS. Your balance updates after we verify the transfer.',
    amount: 'Amount (ETB)',
    method: 'Paid with',
    reference: 'Transaction ID',
    submit: 'Submit for verification',
    submitted: 'Submitted. We will verify it shortly.',
    topups: 'Top-up requests',
    ledger: 'Wallet history',
    noEntries: 'No wallet activity yet.',
    statuses: { pending: 'Checking', verified: 'Added', rejected: 'Not verified' },
    types: { commission: 'Commission', settlement: 'Top-up', adjustment: 'Adjustment' },
    earnings: 'Earnings summary',
  },
  standing: {
    title: 'Points & rating',
    points: 'Points',
    pointsHint: 'Start at 50 · +1 per completed delivery · −3 when you cancel or give back a job.',
    rating: 'Rating',
    noRating: 'No ratings yet',
    ratings: (n: number) => `${n} rating${n === 1 ? '' : 's'}`,
    history: 'Points history',
    types: {
      initial: 'Starting points',
      completion: 'Delivery completed',
      rider_cancellation: 'Cancelled job',
      adjustment: 'Correction by support',
    },
  },
  areas: {
    title: 'Work areas',
    link: 'Work areas & home',
    subtitle: 'Choose the sub-cities where you want jobs. Leave all unselected to get jobs everywhere.',
    all: 'All areas',
    home: 'Home location (optional)',
    homeHint:
      'Helps us offer jobs near home first. Private: never shown to customers or other riders.',
    setHome: 'Set home here',
    moveMap: 'Move the map so the pin is on your home.',
    radius: 'Prefer jobs within',
    clearHome: 'Remove home',
    save: 'Save',
    saved: 'Saved',
  },
  history: {
    title: 'My delivery history',
    filters: { all: 'All', completed: 'Completed', unsuccessful: 'Cancelled / failed' },
    empty: 'Your finished deliveries will appear here.',
    detail: 'Delivery details',
    actualRoute: 'Route travelled',
    planned: 'Planned route',
    noRoute: 'No GPS route was recorded for this delivery.',
    distance: 'Distance',
    recorded: 'recorded',
    plannedKm: 'planned',
    duration: 'Duration',
    fare: 'Fare',
    commission: 'Commission deducted',
    net: 'Rider earning',
    fee: 'Cancellation fee',
    timeline: 'Timeline',
    reason: 'Reason',
    rating: 'Customer rating',
    replay: 'Replay route',
    pause: 'Pause',
    stages: { to_pickup: 'To pickup', to_dropoff: 'To drop-off', returning: 'Returning' },
  },
};

type Copy = typeof en;

/** Copy for these screens. Amharic falls back to English until translated. */
export function useRiderCopy(): Copy {
  useTranslation();
  return en;
}

/** "12 min ago" style label. */
export function ago(iso: string, now = Date.now()) {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ${min % 60} min` : `${Math.floor(h / 24)} d`;
}
