import type { ReactNode } from 'react';
import { VehicleHero } from '../../map/VehicleHero.tsx';
import type { VehicleKind } from '../../map/vehicle3d.ts';
import { CitySkyline } from '../../ui/index.ts';
import { Wordmark } from '../../surfaces/Wordmark.tsx';
import { LanguageToggle } from './LanguageToggle.tsx';

/** Mobile sign-in layout: brand row, skyline with a 3D rider, then the step heading and form. */
export function AuthScaffold({
  vehicle,
  badge,
  heading,
  form,
}: {
  vehicle: VehicleKind;
  badge?: ReactNode;
  heading: ReactNode;
  form: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-surface px-6 pt-5 pb-safe">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2.5">
          <Wordmark />
          {badge}
        </span>
        <LanguageToggle />
      </header>
      <div className="relative mt-4 mb-6 h-[30dvh] max-h-64 min-h-44">
        <div className="absolute inset-x-0 bottom-3 h-3 rounded-[50%] bg-ink/5 blur-sm" aria-hidden />
        <CitySkyline className="absolute inset-x-0 bottom-3 h-[78%] w-full" />
        <VehicleHero
          kind={vehicle}
          className="absolute bottom-0 left-1/2 h-[92%] -translate-x-1/2"
        />
      </div>
      <div className="flex flex-1 flex-col">
        <div className="animate-fade-in">{heading}</div>
        <div className="mt-7 mb-2 flex flex-1 flex-col justify-end animate-fade-in">{form}</div>
      </div>
    </main>
  );
}
