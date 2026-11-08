import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownUp,
  Banknote,
  Bike,
  ChevronLeft,
  FileText,
  KeyRound,
  LocateFixed,
  Package,
  Plus,
  Shirt,
  Smartphone,
  UserRound,
  UtensilsCrossed,
} from 'lucide-react';
import {
  formatPhone,
  isInAddis,
  normalizeEthiopianPhone,
  type CreateDeliveryInput,
  type Delivery,
  type LatLng,
  type ParcelSize,
  type Payer,
  type PaymentMethod,
  type Place,
  type Quote,
  type VehicleType,
} from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { getPosition, type GeoProblem } from '../../lib/geo.ts';
import { useSession } from '../../lib/session.tsx';
import { uuid } from '../../lib/uuid.ts';
import { MapView } from '../../map/MapView.tsx';
import { VehicleHero } from '../../map/VehicleHero.tsx';
import {
  Button,
  ChoiceGroup,
  IconButton,
  Notice,
  Panel,
  Skeleton,
  Spinner,
  Stepper,
  TextField,
  cn,
} from '../../ui/index.ts';
import { MotorcycleIcon } from '../deliveries/MotorcycleIcon.tsx';
import { ScooterIcon } from '../deliveries/ScooterIcon.tsx';
import { LocationPicker } from './LocationPicker.tsx';
import { useNearbyRiders } from './nearbyRiders.ts';

interface Contact {
  name: string;
  phone: string;
  notes: string;
}

const STEPS = ['route', 'parcel', 'vehicle', 'confirm'] as const;

const displayPhone = (v: string) => {
  const r = normalizeEthiopianPhone(v);
  return r.ok ? formatPhone(r.e164) : v;
};

export function BookingFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user } = useSession();

  const [step, setStep] = useState(0);
  const [picking, setPicking] = useState<'pickup' | 'dropoff' | null>(null);
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [description, setDescription] = useState('');
  const [size, setSize] = useState<ParcelSize>('small');
  const [sender, setSender] = useState<Contact>({
    name: user?.fullName ?? '',
    phone: user ? formatPhone(user.phone).replace('+251 ', '') : '',
    notes: '',
  });
  const [receiver, setReceiver] = useState<Contact>({ name: '', phone: '', notes: '' });
  const [kind, setKind] = useState<ParcelKind | null>(null);
  // Folded when the account already supplies a valid name and phone; it never folds mid-typing.
  const [senderOpen, setSenderOpen] = useState(
    () => !(sender.name.trim().length >= 2 && normalizeEthiopianPhone(sender.phone).ok),
  );
  const location = useLocation();
  const [vehicle, setVehicle] = useState<VehicleType | undefined>(
    () => (location.state as { vehicle?: VehicleType } | null)?.vehicle,
  );
  const [payer, setPayer] = useState<Payer>('sender');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [touched, setTouched] = useState(false);
  // One key per booking attempt: retries and double taps can never create two deliveries.
  const [idempotencyKey] = useState(() => uuid());
  const [geo, setGeo] = useState<GeoState>('idle');
  const [here, setHere] = useState<LatLng | null>(null);

  // Ask for the user's location as soon as they start, and use it as the pickup.
  const locate = async () => {
    setGeo('locating');
    const r = await getPosition();
    if (!r.ok) return setGeo(r.problem);
    setHere(r.point);
    if (!isInAddis(r.point)) return setGeo('outside');
    try {
      const place = await api<Place | null>(
        `/geo/reverse?lat=${r.point.lat.toFixed(6)}&lng=${r.point.lng.toFixed(6)}`,
      );
      if (place) setPickup((current) => current ?? place);
      setGeo(place ? 'done' : 'unavailable');
    } catch {
      setGeo('unavailable');
    }
  };
  useEffect(() => {
    if (!pickup) void locate();
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quote = useQuery({
    queryKey: ['quote', pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng],
    queryFn: () =>
      api<Quote>('/deliveries/quote', {
        method: 'POST',
        body: {
          pickup: { lat: pickup!.lat, lng: pickup!.lng },
          dropoff: { lat: dropoff!.lat, lng: dropoff!.lng },
        },
      }),
    enabled: !!pickup && !!dropoff && step >= 2,
    staleTime: 5 * 60_000,
  });
  const chosen = quote.data?.options.find((o) => o.vehicleType === vehicle && o.available);

  const create = useMutation({
    mutationFn: (body: CreateDeliveryInput) =>
      api<Delivery>('/deliveries', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.setQueryData(['delivery', d.id], d);
      navigate(`/deliveries/${d.id}`, { replace: true });
    },
  });

  const phoneError = (v: string) => {
    if (!touched) return undefined;
    const r = normalizeEthiopianPhone(v);
    return r.ok ? undefined : t(`auth.phoneErrors.${r.reason}`);
  };
  const nameError = (v: string) =>
    touched && v.trim().length < 2 ? t('booking.nameRequired') : undefined;

  const stepValid = [
    !!pickup && !!dropoff,
    description.trim().length >= 2 &&
      sender.name.trim().length >= 2 &&
      receiver.name.trim().length >= 2 &&
      normalizeEthiopianPhone(sender.phone).ok &&
      normalizeEthiopianPhone(receiver.phone).ok,
    !!chosen,
    true,
  ];

  const next = () => {
    setTouched(true);
    if (!stepValid[step]) return;
    setTouched(false);
    setStep((s) => s + 1);
  };

  const submit = () => {
    if (!pickup || !dropoff || !vehicle) return;
    create.mutate({
      pickup: {
        lat: pickup.lat,
        lng: pickup.lng,
        address: pickup.name,
        subCity: pickup.subCity,
        contactName: sender.name,
        contactPhone: sender.phone,
        notes: sender.notes,
      },
      dropoff: {
        lat: dropoff.lat,
        lng: dropoff.lng,
        address: dropoff.name,
        subCity: dropoff.subCity,
        contactName: receiver.name,
        contactPhone: receiver.phone,
        notes: receiver.notes,
      },
      vehicleType: vehicle,
      payer,
      preferredPaymentMethod: method,
      parcel: { description, size },
    });
  };

  const nearby = useNearbyRiders(picking ? null : (pickup ?? here));

  if (picking) {
    return (
      <LocationPicker
        title={picking === 'pickup' ? t('booking.choosePickup') : t('booking.chooseDropoff')}
        initial={picking === 'pickup' ? pickup : dropoff}
        onClose={() => setPicking(null)}
        onPick={(p) => {
          if (picking === 'pickup') setPickup(p);
          else setDropoff(p);
          setPicking(null);
        }}
      />
    );
  }

  const stops = [
    ...(pickup ? [{ id: 'p', point: pickup, kind: 'pickup' as const }] : []),
    ...(dropoff ? [{ id: 'd', point: dropoff, kind: 'dropoff' as const }] : []),
  ];
  // Free riders near the pickup (or the customer, before a pickup is set): background markers.
  const markers = [...nearby, ...stops];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="flex items-center gap-3 px-4 pt-5 pb-3">
        <IconButton
          label={t('common.back')}
          onClick={() => (step === 0 ? navigate('/') : setStep(step - 1))}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </IconButton>
        <div className="min-w-0 flex-1">
          <Stepper steps={STEPS.map((s) => t(`booking.steps.${s}`))} current={step} />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-6">
        {step === 0 && (
          <>
            <LocationBanner state={geo} onRetry={() => void locate()} />
            <MapView
              className="mb-4 h-[40vh] min-h-[220px] rounded-[var(--radius-lg)] border border-line shadow-[var(--shadow-sm)]"
              markers={markers}
              line={pickup && dropoff ? [pickup, dropoff] : null}
              labels={pickup && dropoff ? { pickup: t('booking.pickup'), dropoff: t('booking.dropoff') } : undefined}
              fit={stops.length > 1}
              center={pickup ?? dropoff ?? here ?? undefined}
              zoom={pickup || here ? 15 : 13}
            />
            <Panel className="relative">
              <StopButton
                label={t('booking.pickup')}
                place={pickup}
                placeholder={t('booking.choosePickup')}
                dot="pickup"
                onClick={() => setPicking('pickup')}
              />
              <div className="mx-4 border-t border-line" />
              <StopButton
                label={t('booking.dropoff')}
                place={dropoff}
                placeholder={t('booking.chooseDropoff')}
                dot="dropoff"
                onClick={() => setPicking('dropoff')}
              />
              <IconButton
                label={t('booking.swap')}
                className="absolute top-1/2 right-3 size-10 -translate-y-1/2"
                disabled={!pickup && !dropoff}
                onClick={() => {
                  setPickup(dropoff);
                  setDropoff(pickup);
                }}
              >
                <ArrowDownUp className="size-4" aria-hidden />
              </IconButton>
            </Panel>
          </>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-7">
            {/* 1. What: one tap for the common cases, typing only for "something else". */}
            <section className="flex flex-col gap-3">
              <h1 className="text-[22px] font-bold tracking-tight">{t('booking.parcelTitle')}</h1>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('booking.parcelTitle')}>
                {PARCEL_KINDS.map(({ kind: k, icon: Icon }) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    onClick={() => {
                      setKind(k);
                      setDescription(k === 'other' ? '' : t(`booking.kinds.${k}`));
                    }}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-[var(--radius-lg)] border px-2 py-3 text-sm font-medium',
                      'transition-colors duration-[var(--dur-fast)]',
                      kind === k
                        ? 'border-accent bg-accent-soft text-accent-soft-ink'
                        : 'border-line bg-surface text-ink-2 hover:border-line-strong',
                    )}
                  >
                    <Icon className="size-6" aria-hidden />
                    {t(`booking.kinds.${k}`)}
                  </button>
                ))}
              </div>
              {kind === 'other' && (
                <TextField
                  label={t('booking.description')}
                  placeholder={t('booking.otherPlaceholder')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  autoFocus
                  maxLength={200}
                />
              )}
              {touched && description.trim().length < 2 && (
                <p role="alert" className="text-sm font-medium text-danger">
                  {t('booking.descriptionRequired')}
                </p>
              )}
            </section>

            {/* 2. How big. */}
            <ChoiceGroup
              legend={t('booking.howBig')}
              columns={3}
              value={size}
              onChange={setSize}
              choices={(['small', 'medium', 'large'] as const).map((s) => ({
                value: s,
                label: t(`booking.sizes.${s}`),
                description: t(`booking.sizeHints.${s}`),
              }))}
            />

            {/* 3. Who receives it: the only contact most people need to type. */}
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-lg font-semibold">{t('booking.receiverTitle')}</h2>
                <p className="text-sm text-ink-3">{t('booking.receiverHint')}</p>
              </div>
              <TextField
                label={t('booking.name')}
                autoComplete="off"
                value={receiver.name}
                onChange={(e) => setReceiver({ ...receiver, name: e.target.value })}
                error={nameError(receiver.name)}
                maxLength={80}
              />
              <PhoneField
                value={receiver.phone}
                onChange={(phone) => setReceiver({ ...receiver, phone })}
                error={phoneError(receiver.phone)}
              />
              <OptionalNotes
                value={receiver.notes}
                onChange={(notes) => setReceiver({ ...receiver, notes })}
              />
            </section>

            {/* 4. Pickup contact: filled from the account, so it stays folded unless it needs fixing. */}
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">{t('booking.pickupContact')}</h2>
              {senderOpen ? (
                <>
                  <TextField
                    label={t('booking.name')}
                    autoComplete="name"
                    value={sender.name}
                    onChange={(e) => setSender({ ...sender, name: e.target.value })}
                    error={nameError(sender.name)}
                    maxLength={80}
                  />
                  <PhoneField
                    value={sender.phone}
                    onChange={(phone) => setSender({ ...sender, phone })}
                    error={phoneError(sender.phone)}
                  />
                </>
              ) : (
                <Panel className="flex items-center gap-3 p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-ink">
                    <UserRound className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {sender.name} <span className="font-normal text-ink-3">({t('booking.you')})</span>
                    </span>
                    <span className="block text-sm text-ink-3 tabular">{displayPhone(sender.phone)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSenderOpen(true)}
                    className="h-10 shrink-0 px-2 text-sm font-semibold text-accent"
                  >
                    {t('booking.change')}
                  </button>
                </Panel>
              )}
              <OptionalNotes
                value={sender.notes}
                onChange={(notes) => setSender({ ...sender, notes })}
              />
            </section>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-6">
            <section>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h1 className="text-[22px] font-bold tracking-tight">{t('booking.vehicleTitle')}</h1>
                {quote.data && (
                  <span className="text-sm text-ink-3 tabular">
                    {t('booking.distance', { km: quote.data.distanceKm.toFixed(1) })}
                  </span>
                )}
              </div>
              {quote.isPending && (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              )}
              {quote.isError && (
                <Notice tone="danger">
                  {t('booking.quoteError')}{' '}
                  <button className="font-semibold underline" onClick={() => quote.refetch()}>
                    {t('common.retry')}
                  </button>
                </Notice>
              )}
              {quote.data && (
                <ChoiceGroup
                  legend={t('booking.vehicleTitle')}
                  hideLegend
                  columns={1}
                  value={vehicle}
                  onChange={setVehicle}
                  choices={quote.data.options.map((o) => ({
                    value: o.vehicleType,
                    label: t(`booking.vehicles.${o.vehicleType}`),
                    description: o.unavailableReason ?? t(`booking.vehicleHints.${o.vehicleType}`),
                    icon: (
                      <VehicleHero
                        kind={o.vehicleType}
                        rider={false}
                        width={120}
                        height={90}
                        className="w-9"
                      />
                    ),
                    disabled: !o.available,
                    aside: (
                      <span className="text-right">
                        <span className="block text-[15px] font-bold tabular">{o.fare}</span>
                        <span className="block text-xs text-ink-3 tabular">
                          ETB · ~{o.etaMin} min
                        </span>
                      </span>
                    ),
                  }))}
                />
              )}
            </section>
            <ChoiceGroup
              legend={t('booking.payerTitle')}
              value={payer}
              onChange={setPayer}
              choices={(['sender', 'receiver'] as const).map((p) => ({
                value: p,
                label: t(`booking.payers.${p}`),
                description: t(`booking.payerHints.${p}`),
              }))}
            />
            <ChoiceGroup
              legend={t('booking.methodTitle')}
              columns={3}
              value={method}
              onChange={setMethod}
              choices={(['cash', 'telebirr', 'cbe_birr'] as const).map((m) => ({
                value: m,
                label: t(`booking.methods.${m}`),
              }))}
            />
            <p className="flex items-center gap-2 text-sm text-ink-2">
              <Banknote className="size-4 shrink-0" aria-hidden />
              {t('booking.directPayment')}
            </p>
          </div>
        )}

        {step === 3 && chosen && pickup && dropoff && (
          <div className="flex flex-col gap-4">
            <h1 className="text-[22px] font-bold tracking-tight">{t('booking.confirmTitle')}</h1>

            {/* Fare hero */}
            <div className="relative overflow-hidden rounded-[var(--radius-xl)] bg-accent-soft p-5 shadow-[var(--shadow-sm)]">
              <div className="absolute -top-8 -right-8 size-32 rounded-full bg-accent/10" aria-hidden />
              <div className="relative flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold tracking-wide text-accent-soft-ink/70 uppercase">{t('booking.fare')}</p>
                  <p className="mt-1 text-[36px] font-bold tracking-tight text-accent-soft-ink tabular">
                    {chosen.fare} <span className="text-base font-semibold">ETB</span>
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-accent-soft-ink">
                    {chosen.vehicleType === 'motorcycle' ? (
                      <MotorcycleIcon className="size-4" />
                    ) : chosen.vehicleType === 'scooter' ? (
                      <ScooterIcon className="size-4" />
                    ) : (
                      <Bike className="size-4" aria-hidden />
                    )}
                    {t(`booking.vehicles.${chosen.vehicleType}`)}
                  </span>
                  <span className="text-xs text-accent-soft-ink/70 tabular">~{chosen.etaMin} min</span>
                </div>
              </div>
            </div>

            <Panel className="p-4">
              <RouteLines
                from={pickup.name}
                fromSub={`${sender.name} · ${displayPhone(sender.phone)}`}
                to={dropoff.name}
                toSub={`${receiver.name} · ${displayPhone(receiver.phone)}`}
              />
            </Panel>
            <Panel className="divide-y divide-line">
              <Row
                label={t('booking.parcelTitle')}
                value={`${description} · ${t(`booking.sizes.${size}`)}`}
              />
              <Row
                label={t('booking.payerTitle')}
                value={`${t(`booking.payers.${payer}`)} · ${t(`booking.methods.${method}`)}`}
              />
            </Panel>
            <Notice tone="info">
              {t('booking.cancelPolicy', {
                fee: chosen.cancellationFeeAfterArrival.replace('.00', ''),
              })}
            </Notice>
            {create.isError && (
              <Notice tone="danger">
                {create.error instanceof ApiRequestError
                  ? create.error.message
                  : t('errors.genericTitle')}
              </Notice>
            )}
          </div>
        )}
      </main>

      <footer className="sticky bottom-0 border-t border-line bg-surface/95 backdrop-blur-md px-4 pt-3 pb-safe">
        {step < 3 ? (
          <Button size="lg" block onClick={next} disabled={step === 2 && !chosen}>
            {t('booking.continue')}
          </Button>
        ) : (
          <Button size="lg" block onClick={submit} loading={create.isPending}>
            {t('booking.book', { fare: chosen?.fare ?? '' })}
          </Button>
        )}
      </footer>
    </div>
  );
}

function StopButton({
  label,
  place,
  placeholder,
  dot,
  onClick,
}: {
  label: string;
  place: Place | null;
  placeholder: string;
  dot: 'pickup' | 'dropoff';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 py-3 pr-16 pl-4 text-left"
    >
      <span
        aria-hidden
        className={
          dot === 'pickup'
            ? 'size-3 shrink-0 rounded-full border-[3px] border-ink'
            : 'size-3 shrink-0 rounded-sm bg-accent'
        }
      />
      <span className="min-w-0">
        <span className="block text-xs text-ink-3">{label}</span>
        <span
          className={
            place
              ? 'block truncate text-[15px] font-semibold'
              : 'block truncate text-[15px] text-ink-3'
          }
        >
          {place ? place.name : placeholder}
        </span>
        {place && <span className="block truncate text-sm text-ink-3">{place.description}</span>}
      </span>
    </button>
  );
}

type GeoState = 'idle' | 'locating' | 'done' | 'outside' | GeoProblem;

/** What the location prompt is doing, shown above the route map. */
function LocationBanner({ state, onRetry }: { state: GeoState; onRetry: () => void }) {
  const { t } = useTranslation();
  if (state === 'idle') return null;
  if (state === 'locating') {
    return (
      <p className="mb-3 flex items-center gap-2 rounded-[var(--radius-lg)] bg-accent-soft px-4 py-3 text-sm font-medium text-accent-soft-ink">
        <Spinner className="size-4" />
        {t('booking.geo.locating')}
      </p>
    );
  }
  if (state === 'done') {
    return (
      <p className="mb-3 flex items-center gap-2 rounded-[var(--radius-lg)] bg-success-soft px-4 py-3 text-sm font-medium text-success">
        <LocateFixed className="size-4 shrink-0" aria-hidden />
        {t('booking.geo.done')}
      </p>
    );
  }
  return (
    <Notice tone="warning" className="mb-3">
      <span className="block">{t(`booking.geo.${state}`)}</span>
      {state !== 'insecure' && state !== 'unsupported' && (
        <button type="button" onClick={onRetry} className="mt-1 font-semibold underline">
          {t('booking.geo.retry')}
        </button>
      )}
    </Notice>
  );
}

type ParcelKind = 'documents' | 'food' | 'clothes' | 'electronics' | 'keys' | 'other';

const PARCEL_KINDS: { kind: ParcelKind; icon: typeof FileText }[] = [
  { kind: 'documents', icon: FileText },
  { kind: 'food', icon: UtensilsCrossed },
  { kind: 'clothes', icon: Shirt },
  { kind: 'electronics', icon: Smartphone },
  { kind: 'keys', icon: KeyRound },
  { kind: 'other', icon: Package },
];

function PhoneField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <TextField
      label={t('booking.phone')}
      prefix="+251"
      type="tel"
      inputMode="tel"
      autoComplete="off"
      placeholder="91 123 4567"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
    />
  );
}

/** Notes for the rider stay hidden behind a link until someone wants them. */
function OptionalNotes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(value.length > 0);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 items-center gap-1.5 self-start text-sm font-semibold text-accent"
      >
        <Plus className="size-4" aria-hidden />
        {t('booking.addNotes')}
      </button>
    );
  }
  return (
    <TextField
      label={t('booking.notes')}
      placeholder={t('booking.notesPlaceholder')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={value.length === 0}
      maxLength={300}
    />
  );
}

export function RouteLines({
  from,
  fromSub,
  to,
  toSub,
}: {
  from: string;
  fromSub?: string;
  to: string;
  toSub?: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center pt-1.5" aria-hidden>
        <span className="size-2.5 rounded-full border-2 border-ink" />
        <span className="my-1 w-px flex-1 bg-line-strong" />
        <span className="size-2.5 rounded-sm bg-accent" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Stop title={from} sub={fromSub} />
        <Stop title={to} sub={toSub} />
      </div>
    </div>
  );
}

function Stop({ title, sub }: { title: string; sub?: string | undefined }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[15px] font-semibold">{title}</p>
      {sub && <p className="truncate text-sm text-ink-3 tabular">{sub}</p>}
    </div>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <span className="shrink-0 text-sm text-ink-3">{label}</span>
      <span className="min-w-0 text-right text-[15px] font-medium">{value}</span>
    </div>
  );
}
