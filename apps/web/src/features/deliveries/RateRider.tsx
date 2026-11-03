import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import type { MyRating } from '@dp/shared';
import { api } from '../../lib/api.ts';
import { Button, cn, Notice, Panel } from '../../ui/index.ts';

/** One rating per completed delivery. Shown on the customer's delivery page once it is delivered. */
export function RateRider({ deliveryId }: { deliveryId: string }) {
  const qc = useQueryClient();
  const key = ['deliveries', deliveryId, 'rating'];
  const mine = useQuery({ queryKey: key, queryFn: () => api<MyRating | null>(`/deliveries/${deliveryId}/rating`) });
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const send = useMutation({
    mutationFn: () =>
      api<MyRating>(`/deliveries/${deliveryId}/rating`, {
        method: 'POST',
        body: { stars, ...(comment.trim() ? { comment: comment.trim() } : {}) },
      }),
    onSuccess: (r) => qc.setQueryData(key, r),
  });

  if (mine.isPending) return null;
  const done = mine.data;
  return (
    <Panel className="p-4">
      <p className="font-semibold">{done ? 'Your rating' : 'How was your rider?'}</p>
      <div className="mt-2 flex gap-1" role={done ? undefined : 'radiogroup'} aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = n <= (done ? done.stars : stars);
          return (
            <button
              key={n}
              type="button"
              disabled={!!done}
              role={done ? undefined : 'radio'}
              aria-checked={done ? undefined : stars === n}
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              onClick={() => setStars(n)}
              className="p-1 disabled:cursor-default"
            >
              <Star className={cn('size-8', on ? 'fill-warning text-warning' : 'text-line-strong')} aria-hidden />
            </button>
          );
        })}
      </div>
      {done ? (
        done.comment && <p className="mt-2 text-sm text-ink-2">“{done.comment}”</p>
      ) : (
        stars > 0 && (
          <div className="mt-3 flex flex-col gap-3">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Add a comment (optional)"
              className="rounded-[var(--radius-md)] border border-line-strong bg-surface p-3 text-sm"
            />
            {send.error && <Notice tone="danger">{send.error.message}</Notice>}
            <Button loading={send.isPending} onClick={() => send.mutate()}>
              Send rating
            </Button>
          </div>
        )
      )}
    </Panel>
  );
}
