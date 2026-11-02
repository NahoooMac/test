import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { RiderProfile, VehicleType } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { sessionQueryKey, useSession } from '../../lib/session.tsx';
import { VehicleHero } from '../../map/VehicleHero.tsx';
import { Button, ChoiceGroup, Notice, TextField } from '../../ui/index.ts';

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
        <VehicleHero kind={vehicle} rider width={320} height={220} className="mb-4 w-48" />
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
        choices={(['motorcycle', 'bicycle', 'scooter'] as const).map((v) => ({
          value: v,
          label: t(`booking.vehicles.${v}`),
          icon: <VehicleHero kind={v} rider={false} width={120} height={90} className="w-9" />,
        }))}
      />
      {(vehicle === 'motorcycle' || vehicle === 'scooter') && (
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
