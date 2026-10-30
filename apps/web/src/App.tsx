import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './ui/index.ts';
import { FullScreenLoader } from './lib/session.tsx';

// Each surface is its own lazily-loaded bundle: admin code never ships to a customer's phone.
const CustomerApp = lazy(() => import('./surfaces/customer/CustomerApp.tsx'));
const RiderApp = lazy(() => import('./surfaces/rider/RiderApp.tsx'));
const AdminApp = lazy(() => import('./surfaces/admin/AdminApp.tsx'));
const DesignPreview = import.meta.env.DEV ? lazy(() => import('./design/DesignPreview.tsx')) : null;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<FullScreenLoader />}>
            <Routes>
              <Route path="/rider/*" element={<RiderApp />} />
              <Route path="/admin/*" element={<AdminApp />} />
              {DesignPreview && <Route path="/design" element={<DesignPreview />} />}
              <Route path="/*" element={<CustomerApp />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
