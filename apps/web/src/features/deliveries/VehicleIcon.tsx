import type { VehicleType } from '@dp/shared';
import { Bike } from 'lucide-react';
import { MotorcycleIcon } from './MotorcycleIcon.tsx';
import { ScooterIcon } from './ScooterIcon.tsx';

export function VehicleIcon({ type, className = 'size-5' }: { type: VehicleType; className?: string }) {
  switch (type) {
    case 'motorcycle':
      return <MotorcycleIcon className={className} />;
    case 'scooter':
      return <ScooterIcon className={className} />;
    case 'bicycle':
      return <Bike className={className} aria-hidden />;
  }
}
