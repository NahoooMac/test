import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Wallet, X } from 'lucide-react';

interface PaymentDue {
  kind: 'payment_due';
  deliveryId: string | null;
  code: string;
  fare: string;
  link: string;
}

/**
 * In-app notice for the selected payer: the rider reached the destination and this is the final
 * price. Links to the delivery (sender) or its tracking page (receiver with an account).
 */
export function PaymentNotice() {
  const [notice, setNotice] = useState<PaymentDue | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<Record<string, unknown>>).detail;
      if (d?.kind === 'payment_due') setNotice(d as unknown as PaymentDue);
    };
    window.addEventListener('dp:notice', on);
    return () => window.removeEventListener('dp:notice', on);
  }, []);
  if (!notice) return null;
  return (
    <div role="status" className="sticky top-0 z-40 px-3 pt-3">
      <div className="flex items-center gap-3 rounded-[var(--radius-lg)] bg-accent px-4 py-3 text-white shadow-[var(--shadow-lg)]">
        <Wallet className="size-5 shrink-0" aria-hidden />
        <Link
          to={notice.deliveryId ? `/deliveries/${notice.deliveryId}` : notice.link}
          onClick={() => setNotice(null)}
          className="flex-1 text-sm"
        >
          <span className="block font-semibold">Delivery #{notice.code} has arrived</span>
          <span className="block">
            Amount to pay the rider: <b className="tabular">{notice.fare} ETB</b>
          </span>
        </Link>
        <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="p-1">
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
