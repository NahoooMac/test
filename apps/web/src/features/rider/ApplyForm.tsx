import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bike } from 'lucide-react';
import type { RiderProfile, VehicleType } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { sessionQueryKey, useSession } from '../../lib/session.tsx';
import { Button, ChoiceGroup, Notice, TextField } from '../../ui/index.ts';
import { MotorcycleIcon } from '../deliveries/MotorcycleIcon.tsx';

export function ApplyForm() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: user } = useSession();
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [vehicle, setVehicle] = useState<VehicleType>('motorcycle');
  const [plate, setPlate] = useState('');

  const apply = useMutation({
    mutationFn: () =>
      api<RiderProfile>('/rider/apply', {
        method: 'POST',
        body: { fullName, vehicleType: vehicle, plateNumber: plate.trim() || undefined },
      }),
    // The account is now a rider account: reload the session so the rider area opens.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
  });

  const fields = apply.error instanceof ApiRequestError ? apply.error.fields : undefined;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    apply.mutate();
  };

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 pt-8 pb-safe"
    >
      <div className="animate-fade-in">
        <span className="mb-5 flex size-16 items-center justify-center rounded-[var(--radius-xl)] bg-accent-soft text-accent-soft-ink shadow-[var(--shadow-sm)]">
          <Bike className="size-8" aria-hidden />
        </span>
        <h1 className="text-[32px] leading-[1.1] font-bold tracking-tight">
          {t('rider.apply.title')}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{t('rider.apply.subtitle')}</p>
      </div>
      <TextField
        label={t('rider.apply.fullName')}
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        error={fields?.fullName}
        autoComplete="name"
        maxLength={80}
      />
      <ChoiceGroup
        legend={t('rider.apply.vehicle')}
        value={vehicle}
        onChange={setVehicle}
        choices={[
          {
            value: 'motorcycle',
            label: t('booking.vehicles.motorcycle'),
            icon: <MotorcycleIcon />,
          },
          {
            value: 'bicycle',
            label: t('booking.vehicles.bicycle'),
            icon: <Bike className="size-5" aria-hidden />,
          },
        ]}
      />
      {vehicle === 'motorcycle' && (
        <TextField
          label={t('rider.apply.plate')}
          hint={t('rider.apply.plateHint')}
          value={plate}
          onChange={(e) => setPlate(e.target.value.toUpperCase())}
          error={fields?.plateNumber}
          autoCapitalize="characters"
          maxLength={15}
        />
      )}
      {apply.isError && !fields && <Notice tone="danger">{apply.error.message}</Notice>}
      <div className="mt-auto">
        <Button type="submit" size="lg" block loading={apply.isPending}>
          {t('rider.apply.submit')}
        </Button>
      </div>
    </form>
  );
}
