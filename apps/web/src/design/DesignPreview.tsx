// Development-only catalogue of the design system. Not shipped in production builds.
// All delivery details shown here are EXAMPLE DATA for layout review.
import { useEffect, useState, type ReactNode } from 'react';
import {
  Banknote,
  Bike,
  ChevronLeft,
  LocateFixed,
  MessageSquare,
  Phone,
  Search,
} from 'lucide-react';
import {
  Badge,
  Button,
  ChoiceGroup,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  Notice,
  OtpInput,
  Panel,
  PlateBadge,
  Sheet,
  Skeleton,
  StatusProgress,
  Stepper,
  TextField,
  Timeline,
  cn,
  useToast,
} from '../ui/index.ts';
import { Wordmark } from '../surfaces/Wordmark.tsx';

type Accent = 'green' | 'amber';
type Theme = 'light' | 'dark';

export default function DesignPreview() {
  const [theme, setTheme] = useState<Theme>('light');
  const [accent, setAccent] = useState<Accent>('green');

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    if (accent === 'amber') root.dataset.accent = 'amber';
    else delete root.dataset.accent;
    return () => {
      delete root.dataset.accent;
    };
  }, [theme, accent]);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-4 border-b border-line bg-surface/95 px-6 py-3 backdrop-blur">
        <Wordmark suffix="Design system" />
        <div className="ml-auto flex flex-wrap gap-3">
          <Segmented label="Theme" value={theme} onChange={setTheme} options={['light', 'dark']} />
          <Segmented
            label="Accent"
            value={accent}
            onChange={setAccent}
            options={['green', 'amber']}
          />
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-14 px-6 py-10">
        <Section title="Screens" note="Composed with example data — not wired to the API.">
          <div className="flex flex-wrap gap-8">
            <PhoneFrame caption="Booking · step 3">
              <BookingExample />
            </PhoneFrame>
            <PhoneFrame caption="Live tracking">
              <TrackingExample />
            </PhoneFrame>
            <PhoneFrame caption="Rider · active job">
              <RiderJobExample />
            </PhoneFrame>
          </div>
        </Section>

        <Section title="Colour">
          <Swatches />
        </Section>

        <Section title="Type">
          <div className="flex flex-col gap-3">
            <p className="text-[28px] leading-tight font-bold tracking-tight">
              Send a parcel across Addis
            </p>
            <p className="text-xl font-semibold">Section heading · በአዲስ አበባ ውስጥ እቃ ይላኩ</p>
            <p className="text-base text-ink-2">
              Body text for descriptions and helper copy. ስልክ ቁጥርዎን ያስገቡ።
            </p>
            <p className="text-sm text-ink-3">Secondary · timestamps · captions</p>
            <p className="text-4xl font-bold tabular">
              12 <span className="text-base font-medium text-ink-3">min</span>
            </p>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger-soft">Cancel delivery</Button>
            <Button variant="danger">Mark failed</Button>
            <Button loading>Saving</Button>
            <Button disabled>Disabled</Button>
            <IconButton label="Back">
              <ChevronLeft className="size-5" aria-hidden />
            </IconButton>
          </div>
          <div className="mt-4 max-w-sm">
            <Button size="lg" block>
              Confirm booking
            </Button>
          </div>
        </Section>

        <Section title="Form controls">
          <FormExamples />
        </Section>

        <Section title="Status">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral" dot>
                Requested
              </Badge>
              <Badge tone="info" dot>
                Assigned
              </Badge>
              <Badge tone="accent" dot>
                Picked up
              </Badge>
              <Badge tone="success" dot>
                Delivered
              </Badge>
              <Badge tone="warning" dot>
                Returning
              </Badge>
              <Badge tone="danger" dot>
                Failed
              </Badge>
              <PlateBadge>3-A12345</PlateBadge>
            </div>
            <div className="max-w-md">
              <Stepper steps={['Route', 'Parcel', 'Vehicle', 'Confirm']} current={2} />
            </div>
            <div className="max-w-md">
              <StatusProgress
                stages={['Assigned', 'At pickup', 'Picked up', 'At drop-off', 'Delivered']}
                current={2}
              />
            </div>
          </div>
        </Section>

        <Section title="Feedback">
          <FeedbackExamples />
        </Section>

        <Section title="Table">
          <TableExample />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-5 flex items-baseline gap-3 border-b border-line pb-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {note && <p className="text-sm text-ink-3">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: T[];
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2 text-sm">
      <span className="text-ink-3">{label}</span>
      <div className="flex rounded-full bg-surface-2 p-0.5">
        {options.map((o) => (
          <button
            key={o}
            aria-pressed={o === value}
            onClick={() => onChange(o)}
            className={cn(
              'h-8 rounded-full px-3 font-semibold capitalize',
              o === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-3',
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function PhoneFrame({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="flex flex-col gap-2">
      <div className="relative h-[680px] w-[360px] overflow-hidden rounded-[28px] border border-line-strong bg-canvas shadow-xl">
        {children}
      </div>
      <figcaption className="text-center text-sm text-ink-3">{caption}</figcaption>
    </figure>
  );
}

/** Neutral stand-in for the Yandex map until keys are available. */
function MapPlaceholder({ children }: { children?: ReactNode }) {
  return (
    <div
      className="absolute inset-0 bg-surface-2"
      style={{
        backgroundImage:
          'linear-gradient(var(--c-line) 1px, transparent 1px), linear-gradient(90deg, var(--c-line) 1px, transparent 1px)',
        backgroundSize: '44px 44px',
      }}
    >
      <span className="absolute top-1/2 left-1/2 -translate-1/2 rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink-3">
        Map · Yandex (Phase 4)
      </span>
      {children}
    </div>
  );
}

function BookingExample() {
  const [vehicle, setVehicle] = useState<'motorcycle' | 'bicycle'>('motorcycle');
  const [payer, setPayer] = useState<'sender' | 'receiver'>('sender');
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <IconButton label="Back">
          <ChevronLeft className="size-5" aria-hidden />
        </IconButton>
        <div className="flex-1">
          <Stepper steps={['Route', 'Parcel', 'Vehicle']} current={2} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4">
        <Panel className="mb-4 p-3">
          <RouteSummary from="Bole Medhanialem" to="Piassa, Arada" />
        </Panel>
        <div className="flex flex-col gap-5">
          <ChoiceGroup
            legend="Vehicle"
            columns={1}
            value={vehicle}
            onChange={setVehicle}
            choices={[
              {
                value: 'motorcycle',
                label: 'Motorcycle',
                description: 'Faster · up to 20 kg',
                icon: <MotorcycleIcon />,
                aside: <Price value="185.00" eta="22 min" />,
              },
              {
                value: 'bicycle',
                label: 'Bicycle',
                description: 'Short trips · up to 8 kg',
                icon: <Bike className="size-5" aria-hidden />,
                aside: <Price value="120.00" eta="35 min" />,
              },
            ]}
          />
          <ChoiceGroup
            legend="Who pays the rider?"
            value={payer}
            onChange={setPayer}
            choices={[
              { value: 'sender', label: 'Sender', description: 'At pickup' },
              { value: 'receiver', label: 'Receiver', description: 'At drop-off' },
            ]}
          />
          <p className="flex items-center gap-2 text-sm text-ink-2">
            <Banknote className="size-4" aria-hidden /> Cash, Telebirr or CBE Birr — paid directly
            to the rider.
          </p>
        </div>
      </div>
      <div className="border-t border-line bg-surface px-4 pt-3 pb-4">
        <Button size="lg" block>
          Review booking · 185.00 ETB
        </Button>
      </div>
    </div>
  );
}

function TrackingExample() {
  return (
    <div className="relative h-full">
      <MapPlaceholder />
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-4">
        <IconButton label="Back">
          <ChevronLeft className="size-5" aria-hidden />
        </IconButton>
        <span className="flex h-11 flex-1 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold shadow-sm">
          <span className="size-2 rounded-full bg-accent" aria-hidden />
          Rider on the way to drop-off
        </span>
      </div>
      <Sheet className="absolute inset-x-0 bottom-0" label="Delivery status">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold">Picked up</h3>
            <p className="text-sm text-ink-2">Abebe is 3.1 km from the drop-off</p>
          </div>
          <div className="rounded-xl bg-accent-soft px-3 py-1.5 text-right text-accent-soft-ink">
            <span className="block text-2xl leading-none font-bold tabular">11</span>
            <span className="text-xs font-semibold">min</span>
          </div>
        </div>
        <div className="mt-4">
          <StatusProgress
            stages={['Assigned', 'Pickup', 'Picked up', 'Drop-off', 'Done']}
            current={3}
          />
        </div>
        <Panel className="mt-4 flex items-center gap-3 p-3">
          <span className="flex size-11 items-center justify-center rounded-full bg-surface-2 font-bold text-ink-2">
            AT
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Abebe T.</p>
            <p className="text-sm text-ink-3">Motorcycle · Bajaj Boxer</p>
          </div>
          <PlateBadge>3-A12345</PlateBadge>
        </Panel>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" icon={<Phone className="size-4" aria-hidden />}>
            Call
          </Button>
          <Button variant="secondary" icon={<MessageSquare className="size-4" aria-hidden />}>
            SMS
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function RiderJobExample() {
  return (
    <div data-theme="dark" className="relative h-full bg-canvas text-ink">
      <MapPlaceholder />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
        <Badge tone="success" dot>
          Online
        </Badge>
        <IconButton label="Recenter">
          <LocateFixed className="size-5" aria-hidden />
        </IconButton>
      </div>
      <Sheet
        className="absolute inset-x-0 bottom-0"
        label="Active job"
        footer={
          <Button size="lg" block>
            Parcel picked up
          </Button>
        }
      >
        <div className="flex items-center justify-between">
          <Badge tone="info" dot>
            At pickup
          </Badge>
          <span className="text-sm text-ink-3 tabular">#K7Q2</span>
        </div>
        <div className="mt-3">
          <RouteSummary from="Bole Medhanialem" to="Piassa, Arada" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="Distance" value="6.2 km" />
          <Stat label="Your earning" value="157.25" />
          <Stat label="Payer" value="Sender" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" icon={<Phone className="size-4" aria-hidden />}>
            Sender
          </Button>
          <Button variant="secondary" icon={<Phone className="size-4" aria-hidden />}>
            Receiver
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function RouteSummary({ from, to }: { from: string; to: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center pt-1.5" aria-hidden>
        <span className="size-2.5 rounded-full border-2 border-ink" />
        <span className="my-1 w-px flex-1 bg-line-strong" />
        <span className="size-2.5 rounded-sm bg-accent" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <p className="text-xs text-ink-3">Pickup</p>
          <p className="truncate text-[15px] font-medium">{from}</p>
        </div>
        <div>
          <p className="text-xs text-ink-3">Drop-off</p>
          <p className="truncate text-[15px] font-medium">{to}</p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2 py-2">
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className="text-sm font-semibold tabular">{value}</p>
    </div>
  );
}

function Price({ value, eta }: { value: string; eta: string }) {
  return (
    <span className="text-right">
      <span className="block text-[15px] font-bold tabular">{value}</span>
      <span className="block text-xs text-ink-3">ETB · {eta}</span>
    </span>
  );
}

function MotorcycleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="5" cy="16" r="3" />
      <circle cx="19" cy="16" r="3" />
      <path d="M8 16h5l3-6h-4l-2 3H7" />
      <path d="M15 6h2l2 4" />
    </svg>
  );
}

function FormExamples() {
  const [otp, setOtp] = useState('482');
  return (
    <div className="grid max-w-3xl gap-6 md:grid-cols-2">
      <TextField
        label="Phone number"
        prefix="+251"
        placeholder="91 123 4567"
        hint="Ethio Telecom or Safaricom number"
      />
      <TextField
        label="Phone number"
        prefix="+251"
        defaultValue="11 551 2345"
        error="Use a mobile number starting with 9 or 7."
      />
      <TextField
        label="Search address or landmark"
        placeholder="e.g. Edna Mall, Bole"
        prefix={<Search className="size-4" aria-hidden />}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Verification code</span>
        <OtpInput label="Verification code digit" value={otp} onChange={setOtp} />
        <p className="text-sm text-ink-3">
          Resend in <span className="tabular">0:42</span>
        </p>
      </div>
    </div>
  );
}

function FeedbackExamples() {
  const toast = useToast();
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-3">
        <Notice tone="info">The rider has arrived. A 40 ETB fee applies if you cancel now.</Notice>
        <Notice tone="warning">Receiver not answering — call attempt 2 of 3.</Notice>
        <Notice tone="danger">That code has expired. Request a new one.</Notice>
        <Notice tone="success">Payment of 185.00 ETB recorded.</Notice>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => toast('Delivery booked', 'success')}>
            Success toast
          </Button>
          <Button variant="secondary" onClick={() => toast('Could not reach the server', 'danger')}>
            Error toast
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <Panel>
          <EmptyState
            title="No deliveries yet"
            body="Your sent and received parcels will appear here."
            action={<Button>Send a parcel</Button>}
          />
        </Panel>
        <Panel>
          <ErrorState
            offline
            title="You're offline"
            body="We'll keep trying. Your rider can still see the job."
            action={<Button variant="secondary">Try again</Button>}
          />
        </Panel>
        <Panel className="flex flex-col gap-3 p-4">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </Panel>
        <Panel className="p-4">
          <Timeline
            items={[
              { id: '1', title: 'Booked', time: '10:02', state: 'done' },
              {
                id: '2',
                title: 'Rider assigned',
                detail: 'Abebe T. · 3-A12345',
                time: '10:04',
                state: 'done',
              },
              { id: '3', title: 'Picked up', time: '10:19', state: 'current' },
              { id: '4', title: 'Delivered', state: 'upcoming' },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

interface ExampleRow {
  code: string;
  status: { label: string; tone: 'info' | 'accent' | 'success' | 'danger' };
  route: string;
  vehicle: string;
  fare: string;
}

function TableExample() {
  const rows: ExampleRow[] = [
    {
      code: 'K7Q2',
      status: { label: 'Picked up', tone: 'accent' },
      route: 'Bole → Arada',
      vehicle: 'Motorcycle',
      fare: '185.00',
    },
    {
      code: 'P3M9',
      status: { label: 'Assigned', tone: 'info' },
      route: 'Kirkos → Yeka',
      vehicle: 'Bicycle',
      fare: '95.00',
    },
    {
      code: 'D8X1',
      status: { label: 'Delivered', tone: 'success' },
      route: 'Lideta → Bole',
      vehicle: 'Motorcycle',
      fare: '210.00',
    },
    {
      code: 'F2C6',
      status: { label: 'Failed', tone: 'danger' },
      route: 'Gullele → Kolfe',
      vehicle: 'Motorcycle',
      fare: '160.00',
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      <DataTable<ExampleRow>
        caption="Example deliveries"
        rows={rows}
        rowKey={(r) => r.code}
        onRowClick={() => {}}
        columns={[
          {
            key: 'code',
            header: 'Code',
            cell: (r) => <span className="font-mono font-semibold">{r.code}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <Badge tone={r.status.tone} dot>
                {r.status.label}
              </Badge>
            ),
          },
          { key: 'route', header: 'Route', cell: (r) => r.route },
          { key: 'vehicle', header: 'Vehicle', cell: (r) => r.vehicle },
          { key: 'fare', header: 'Fare (ETB)', align: 'right', cell: (r) => r.fare },
        ]}
      />
      <DataTable<ExampleRow>
        caption="Loading state"
        rows={[]}
        loading
        rowKey={(r) => r.code}
        columns={[
          { key: 'code', header: 'Code', cell: (r) => r.code },
          { key: 'status', header: 'Status', cell: (r) => r.status.label },
          { key: 'fare', header: 'Fare', align: 'right', cell: (r) => r.fare },
        ]}
      />
    </div>
  );
}

function Swatches() {
  const groups: Array<[string, string[]]> = [
    ['Surfaces', ['canvas', 'surface', 'surface-2', 'line', 'line-strong']],
    ['Text', ['ink', 'ink-2', 'ink-3']],
    ['Accent', ['accent', 'accent-hover', 'accent-soft', 'accent-soft-ink']],
    ['Status', ['success', 'warning', 'danger', 'info']],
  ];
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {groups.map(([name, tokens]) => (
        <div key={name}>
          <p className="mb-2 text-sm font-medium text-ink-2">{name}</p>
          <div className="flex flex-wrap gap-2">
            {tokens.map((tk) => (
              <div key={tk} className="w-24">
                <div
                  className="h-12 rounded-lg border border-line"
                  style={{ background: `var(--c-${tk})` }}
                />
                <p className="mt-1 font-mono text-[11px] text-ink-3">{tk}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
