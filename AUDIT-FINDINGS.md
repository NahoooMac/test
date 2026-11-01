# Phase 1 — Audit Findings & Implementation Plan

## 1. Routes & Pages Inventory

### Customer Surface (`/*`)
| Route | Component | Description |
|-------|-----------|-------------|
| `/sign-in` | `SignIn` (lazy) | Phone OTP login with RouteMotif decoration |
| `/` | `CustomerHome` | Map (38dvh) + greeting + send-parcel CTA + active/recent deliveries |
| `/send` | `BookingFlow` | 4-step wizard: route → parcel → vehicle → confirm |
| `/deliveries` | `DeliveryList` | Delivery cards with status badges |
| `/deliveries/:id` | `DeliveryDetail` | Live map, rider card, timeline, cancel flow |
| `/account` | `AccountScreen` | User profile |

### Rider Surface (`/rider/*`)
| Route | Component | Description |
|-------|-----------|-------------|
| `/rider/sign-in` | `RiderSignIn` (lazy) | Phone OTP login |
| `/rider` | `RiderHomeScreen` | Online/offline toggle, offer cards, active job |
| `/rider/earnings` | `RiderEarnings` | Today summary, ledger, job history |
| `/rider/account` | `RiderAccount` | Profile |

**Rider sub-components:** `OfferCard` (full-screen countdown + accept/decline), `ActiveJob` (map + status steps + call/navigate + payment panel), `ApplyForm` (rider application for customers).

### Admin Surface (`/admin/*`)
| Route | Component | Description |
|-------|-----------|-------------|
| `/admin/sign-in` | `AdminSignIn` (lazy) | Split layout with sub-cities sidebar |
| `/admin` | `LiveOps` | Stats cards, rider/pickup map, online riders, open deliveries |
| `/admin/riders` | `RiderManagement` | Rider list, approval workflow |
| `/admin/deliveries` | `DeliveryManagement` | DataTable with filters |
| `/admin/deliveries/:id` | `AdminDeliveryDetail` | Detail view |
| `/admin/reconciliation` | `Reconciliation` | Financial reconciliation |
| `/admin/pricing` | `PricingConfig` | Pricing management |
| `/admin/users` | `UserManagement` | User admin |

### Public
| Route | Component | Description |
|-------|-----------|-------------|
| `/t/:code` | `TrackPage` | Public tracking, SSE live updates, no auth required |

---

## 2. Shared Components & Design Tokens

### UI Component Library (`apps/web/src/ui/`)
- **Button** — 4 variants (primary/secondary/ghost/danger), 3 sizes, loading state, icon slot
- **Badge** — tonal/outline variants, size options
- **Field / TextField** — label, helper, error, prefix/suffix
- **Sheet / Panel** — bottom sheet, flat panel card
- **DataTable** — sortable columns, pagination
- **Stepper** — horizontal step indicator
- **ChoiceGroup** — radio-like card selection
- **Timeline** — vertical event list
- **StatusProgress** — horizontal status bar with active step
- **Toast** — auto-dismiss notifications
- **Spinner** — loading indicator
- **OtpInput** — 6-digit code entry
- **States** — EmptyState, ErrorState, Notice, Skeleton
- **IconButton** — round icon-only button
- **Wordmark** — brand placeholder (rounded-lg icon + APP_NAME)

### Design Tokens (`apps/web/src/styles/index.css`)
- **Architecture:** CSS custom properties on `:root`, mapped to Tailwind v4 via `@theme inline`
- **Color system:** Semantic naming (`--c-canvas`, `--c-surface`, `--c-ink`, `--c-accent`, `--c-line`, etc.)
- **Light theme:** canvas `#f5f3ee` (warm off-white), surface `#ffffff`, ink `#15171a`, accent `#0e6b4a` (green)
- **Dark theme:** via `data-theme="dark"` — canvas `#0f1113`, surface `#181b1f`, accent `#3dbd8a`
- **Accent variants:** Green (default) + amber alternative available
- **Contrast:** WCAG AA verified (ink-3 ≥ 4.5:1)
- **Typography:** Inter Variable + Noto Sans Ethiopic (Amharic), feature settings cv11/ss01
- **Utilities:** `tabular` (tabular-nums), `pb-safe` (safe area inset)

### Fonts
- Inter Variable (Latin)
- Noto Sans Ethiopic (Amharic — i18n via react-i18next, en + am locales)

---

## 3. Map Component & SDK

### Current Implementation (`apps/web/src/map/`)
- **SDK:** Yandex Maps JavaScript API **v2.1** (loaded via `api-maps.yandex.ru/2.1/`)
- **Key:** `VITE_YANDEX_JS_KEY` environment variable (v2.1 key verified working; v3 key rejected)
- **Coordinate order:** `[lat, lng]` (Yandex convention)
- **Component:** `MapView.tsx` — single React component, creates map once in `useEffect`, updates markers/lines via `overlayKey` effect
- **Fallback:** Grid pattern with "Map unavailable" message when SDK fails to load

### Markers (Current)
| Type | Implementation |
|------|---------------|
| **Pickup** | Circle with border (inline SVG) |
| **Dropoff** | Pin SVG (teardrop shape) |
| **Rider (plain)** | Small circle |
| **Rider (motorcycle)** | 2D SVG teardrop (green) with drop-shadow via `ymaps.templateLayoutFactory.createClass()` |
| **Rider (bicycle)** | 2D SVG teardrop (blue) with drop-shadow |

### Route Display — **BROKEN**
- Uses `ymaps.Polyline` with **exactly 2 coordinates** (pickup + dropoff)
- Draws a **straight line**, NOT a road-following route
- **No routing API is called** — the `line` prop is just `[LatLng, LatLng]`
- No waypoints, no turn data, no distance along road

### 3D Vehicle Support — **NONE**
- Yandex Maps v2.1 has **no native 3D model rendering**
- All markers are 2D SVG placemarks
- No Three.js, WebGL, or canvas overlay exists in the codebase

---

## 4. Tracking & Live Updates

- **SSE (Server-Sent Events):** `LiveBridge` component wraps `EventSource` for real-time updates
- **TrackPage:** Public tracking uses SSE for location + delivery status events
- **DeliveryDetail:** Customer view subscribes to rider location updates
- **ActiveJob:** Rider view shows live map with marker updates
- **LiveOps (Admin):** Map with online rider positions, GPS age display

---

## 5. Real vs. Simulated Data

- **All data is real** — API calls to Fastify backend, Drizzle ORM to Postgres/PGlite
- **Demo mode** (dev only, `--demo` flag): hardcoded OTPs, bot creates/accepts deliveries
- **No mock data in production code paths**
- **No storybook or component playground**

---

## 6. Tests & Build Status

### Tests
- `packages/shared/src/phone.test.ts` — phone number validation
- `packages/shared/src/money.test.ts` — money formatting
- `apps/api/test/health.test.ts` — API health endpoint
- **No frontend (web) tests exist**

### Build Status
- **TypeScript:** All three workspaces pass `tsc --noEmit` cleanly (shared, api, web)
- **No lint errors** blocking build

---

## 7. Key Findings Summary

1. **Route rendering is broken** — straight-line Polyline, no routing API integration
2. **No 3D vehicle support** — all markers are flat SVG; Yandex v2.1 has no 3D API
3. **Design system is solid** — semantic tokens, light/dark themes, WCAG AA contrast; enhancement possible without rewrite
4. **Component library is consistent** — shared UI components used across all surfaces; improvements cascade naturally
5. **No frontend tests** — changes must be manually verified
6. **Codebase is clean** — well-organized, consistent patterns, clear separation of concerns
7. **All constraints safe** — auth, business logic, API contracts, DB schema all untouched by UI changes

---

## 8. Page-by-Page Implementation Plan

### Phase 2 — Design System Enhancement
**Goal:** Elevate tokens, spacing scale, shadows, and shared components to premium quality before touching pages.

1. **Refine color tokens** — adjust canvas warmth, add elevation shadows (shadow-sm through shadow-xl), enhance surface layering
2. **Typography scale** — tighten heading weights, add fluid type scaling, improve number formatting
3. **Spacing & radius** — consistent 4px grid, refine border-radius scale (lg → 2xl for cards)
4. **Motion tokens** — add transition durations and easings as custom properties
5. **Component upgrades:**
   - `Button` — refine press states, add shimmer on primary, improve focus ring
   - `Badge` — add subtle gradients, improve contrast
   - `Panel/Sheet` — add elevation shadows, refine border treatment
   - `DataTable` — improve header styling, row hover, empty state
   - `StatusProgress` — animate active step, improve milestone markers
   - `Toast` — add slide-in animation, icon treatment
   - `OtpInput` — larger cells, better focus animation

### Phase 3 — Page-by-Page Redesign

#### 3a. Auth Pages (Customer + Rider + Admin Sign-In)
- Premium landing feel with animated RouteMotif
- Larger OTP input with smooth focus transitions
- Brand-forward header with refined wordmark
- Admin sign-in: improve split layout, sub-cities sidebar polish

#### 3b. Customer Surface
- **CustomerHome:** Hero map section with gradient overlay, animated send-parcel CTA, card-based delivery list with status indicators, improved greeting with time-of-day context
- **BookingFlow:** Larger step indicators, address cards with subtle shadows, improved vehicle selection with visual icons, clearer pricing breakdown, refined confirm step with order summary
- **LocationPicker:** Better search result cards, improved pin-on-map with address preview, smoother transitions between search and map modes
- **DeliveryList:** Card redesign with route visualization, better status badges, pull-to-refresh feel
- **DeliveryDetail:** Full-bleed map, floating rider card, improved timeline with icons, better share/cancel UX

#### 3c. Rider Surface
- **RiderHomeScreen:** Prominent online/offline switch with animation, GPS status indicator, earnings preview card
- **OfferCard:** Dramatic earning display, route preview, pulsing countdown, large action buttons
- **ActiveJob:** Full-screen map with floating status bar, step-by-step pickup/dropoff cards, improved call/navigate buttons
- **RiderEarnings:** Summary cards with trend indicators, improved ledger table

#### 3d. Admin Surface
- **LiveOps:** Dashboard-grade stat cards with trend arrows, full-width map, improved rider/delivery tables
- **Sidebar:** Refined navigation with active indicators, collapsible on mobile
- **DataTables:** Improved filters, better pagination, row actions
- **All admin pages:** Consistent header treatment, breadcrumbs where applicable

#### 3e. Public Tracking
- **TrackPage:** Full-screen map with floating status card, improved progress bar, rider info card, branded header

#### 3f. Shared / Navigation
- **Bottom tabs (customer/rider):** Refined icons, active indicator animation, safe-area handling
- **Wordmark:** Enhanced brand placeholder
- **Error/Empty states:** Illustrated placeholders

### Phase 4 — Route & 3D Map

#### 4a. Fix Route Rendering
- **Approach:** Use `ymaps.route()` (Yandex v2.1 built-in routing) to get road-following geometry
- **Integration:** Replace the 2-point `ymaps.Polyline` with the routed polyline from `ymaps.route()`
- **Affected components:** `MapView.tsx` (line rendering), `BookingFlow` (preview), `DeliveryDetail`, `ActiveJob`, `TrackPage`
- **Fallback:** If routing API fails, keep the straight-line polyline as degraded experience

#### 4b. 3D Vehicle Models
- **Approach:** Synchronized canvas overlay on top of Yandex Maps tile layer
- **Technology:** Three.js or lightweight WebGL renderer overlaid on the map container
- **Models:** Low-poly motorcycle and bicycle GLTF/GLB models (small file size for mobile)
- **Animation:** Smooth interpolation between GPS updates, heading rotation based on bearing
- **Camera:** Follow mode for active delivery tracking, smooth zoom transitions
- **Performance:** LOD (level of detail) — show 3D only when zoomed in enough, fall back to 2D markers at city scale
- **Mobile:** Touch-friendly, battery-conscious — reduce animation frame rate on low battery

### Phase 5 — Testing
- Walk through every user flow (customer booking, rider accept/pickup/deliver, admin operations, public tracking)
- Verify responsive behavior at mobile (375px), tablet (768px), desktop
- Test light and dark themes
- Verify i18n (English + Amharic)
- Check SSE live updates still work
- Verify demo mode flows

### Phase 6 — Final Report
- Summary of all changes made
- Before/after comparisons
- Known limitations
- Recommendations for future work
