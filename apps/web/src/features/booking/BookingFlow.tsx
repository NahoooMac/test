import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowDownUp, Banknote, Bike, ChevronLeft } from 'lucide-react';
import {
  formatPhone,
  normalizeEthiopianPhone,
  type CreateDeliveryInput,
  type Delivery,
  type ParcelSize,
  type Payer,
  type PaymentMethod,
  type Place,
  type Quote,
  type VehicleType,
} from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { useSession } from '../../lib/session.tsx';
import { MapView } from '../../map/MapView.tsx';
import {
  Button,
  ChoiceGroup,
  IconButton,
  Notice,
  Panel,
  Skeleton,
  Stepper,
  TextField,
} from '../../ui/index.ts';
import { MotorcycleIcon } from '../deliveries/MotorcycleIcon.tsx';
import { LocationPicker } from './LocationPicker.tsx';

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
  const [vehicle, setVehicle] = useState<VehicleType | undefined>();
  const [payer, setPayer] = useState<Payer>('sender');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [touched, setTouched] = useState(false);
  // One key per booking attempt: retries and double taps can never create two deliveries.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

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

  const markers = [
    ...(pickup ? [{ id: 'p', point: pickup, kind: 'pickup' as const }] : []),
    ...(dropoff ? [{ id: 'd', point: dropoff, kind: 'dropoff' as const }] : []),
  ];

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
            <MapView
              className="mb-4 h-56 rounded-[var(--radius-lg)] border border-line shadow-[var(--shadow-sm)]"
              markers={markers}
              line={pickup && dropoff ? [pickup, dropoff] : null}
              fit={markers.length > 1}
              center={pickup ?? dropoff ?? undefined}
              interactive={false}
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
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-4">
              <h1 className="text-[22px] font-bold tracking-tight">{t('booking.parcelTitle')}</h1>
              <TextField
                label={t('booking.description')}
                placeholder={t('booking.descriptionPlaceholder')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                error={
                  touched && description.trim().length < 2
                    ? t('booking.descriptionRequired')
                    : undefined
                }
                maxLength={200}
              />
              <ChoiceGroup
                legend={t('booking.size')}
                columns={3}
                value={size}
                onChange={setSize}
                choices={(['small', 'medium', 'large'] as const).map((s) => ({
                  value: s,
                  label: t(`booking.sizes.${s}`),
                  description: t(`booking.sizeHints.${s}`),
                }))}
              />
            </section>
            <ContactFields
              title={t('booking.sender')}
              where={pickup?.name}
              value={sender}
              onChange={setSender}
              nameError={nameError(sender.name)}
              phoneError={phoneError(sender.phone)}
            />
            <ContactFields
              title={t('booking.receiver')}
              where={dropoff?.name}
              value={receiver}
              onChange={setReceiver}
              nameError={nameError(receiver.name)}
              phoneError={phoneError(receiver.phone)}
            />
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
                    icon:
                      o.vehicleType === 'motorcycle' ? (
                        <MotorcycleIcon />
                      ) : (
                        <Bike className="size-5" aria-hidden />
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
                label={t('booking.vehicleTitle')}
                value={`${t(`booking.vehicles.${chosen.vehicleType}`)} · ~${chosen.etaMin} min`}
              />
              <Row
                label={t('booking.payerTitle')}
                value={`${t(`booking.payers.${payer}`)} · ${t(`booking.methods.${method}`)}`}
              />
              <div className="flex items-baseline justify-between px-4 py-4">
                <span className="font-semibold">{t('booking.fare')}</span>
                <span className="text-[26px] font-bold tracking-tight tabular">
                  {chosen.fare} <span className="text-sm font-medium text-ink-3">ETB</span>
                </span>
              </div>
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

function ContactFields({
  title,
  where,
  value,
  onChange,
  nameError,
  phoneError,
}: {
  title: string;
  where?: string | undefined;
  value: Contact;
  onChange: (c: Contact) => void;
  nameError?: string | undefined;
  phoneError?: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {where && <p className="truncate text-sm text-ink-3">{where}</p>}
      </div>
      <TextField
        label={t('booking.name')}
        autoComplete="off"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        error={nameError}
        maxLength={80}
      />
      <TextField
        label={t('booking.phone')}
        prefix="+251"
        type="tel"
        inputMode="tel"
        placeholder="91 123 4567"
        value={value.phone}
        onChange={(e) => onChange({ ...value, phone: e.target.value })}
        error={phoneError}
      />
      <TextField
        label={t('booking.notes')}
        placeholder={t('booking.notesPlaceholder')}
        value={value.notes}
        onChange={(e) => onChange({ ...value, notes: e.target.value })}
        maxLength={300}
      />
    </section>
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
