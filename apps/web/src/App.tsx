import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './ui/index.ts';
import { FullScreenLoader, sessionQueryKey, useSession } from './lib/session.tsx';
import { useLiveEvents } from './lib/live.ts';
import { clearPersisted, persistQueries } from './lib/persist.ts';

// Each surface is its own lazily-loaded bundle: admin code never ships to a customer's phone.
const CustomerApp = lazy(() => import('./surfaces/customer/CustomerApp.tsx'));
const RiderApp = lazy(() => import('./surfaces/rider/RiderApp.tsx'));
const AdminApp = lazy(() => import('./surfaces/admin/AdminApp.tsx'));
const TrackPage = lazy(() => import('./features/tracking/TrackPage.tsx'));
const DesignPreview = import.meta.env.DEV ? lazy(() => import('./design/DesignPreview.tsx')) : null;

const queryClient = new QueryClient({
  defaultOptions: {
    // gcTime matches the saved copy's lifetime, so restored data is not dropped before it's used.
    queries: { refetchOnWindowFocus: false, gcTime: 7 * 24 * 3600_000 },
  },
});
persistQueries(queryClient);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <LiveBridge />
          <Suspense fallback={<FullScreenLoader />}>
            <Routes>
              <Route path="/rider/*" element={<RiderApp />} />
              <Route path="/admin/*" element={<AdminApp />} />
              {/* Public, no sign-in: the link a sender shares with the receiver. */}
              <Route path="/t/:code" element={<TrackPage />} />
              {DesignPreview && <Route path="/design" element={<DesignPreview />} />}
              <Route path="/*" element={<CustomerApp />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

/** One live-update stream for whoever is signed in, on every surface. */
function LiveBridge() {
  const session = useSession();
  useLiveEvents(!!session.data);
  // Session ended (expired, revoked, signed out elsewhere): drop that person's saved data.
  const signedOut = session.isSuccess && session.data === null;
  useEffect(() => {
    if (!signedOut) return;
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== sessionQueryKey[0] });
    clearPersisted();
  }, [signedOut]);
  return null;
}
