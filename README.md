# Bullion Ledger — Phase 1

Single-user physical precious-metals asset ledger with a mobile-first intake
wizard, private non-destructive photo/document archiving, organization catalog,
atomic purchase creation, asset generation, and dashboard summary.

---

## Requirements

- Node.js 24 LTS
- pnpm 11.17.0 (the version pinned by `packageManager`)
- For local development: PostgreSQL 16, Redis 7, and an S3-compatible MinIO server

## Quick start (checks only)

```bash
corepack enable
pnpm install --frozen-lockfile

# Build the shared Decimal library before package-level checks
pnpm --filter @bullion-ledger/shared build

# Run all checks
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

All five commands must pass before a release.

---

## Docker Compose (full dev environment)

```bash
# Copy the development template
cp .env.example .env

# Generate a SESSION_SECRET, then edit .env and replace every example secret.
openssl rand -hex 48
# Required: POSTGRES_PASSWORD, SESSION_SECRET, MINIO_ACCESS_KEY,
# and MINIO_SECRET_KEY.

# Start all services
docker compose --env-file .env up --build -d

# Follow gateway, startup, and migration logs
docker compose logs -f gateway api web

# Stop
docker compose down

# Wipe volumes (fresh DB, MinIO, Redis)
docker compose down -v
```

Only the gateway publishes a host port:

- Application, API, and signed objects: `http://127.0.0.1:5173`
- Readiness through the gateway: `http://127.0.0.1:5173/api/health/ready`

Web, API, PostgreSQL, Redis, and MinIO have no host port mapping. The gateway
uses separate `gateway-web`, `gateway-api`, and `gateway-storage` networks, so
those upstream containers cannot directly reach one another. PostgreSQL and
Redis are reachable only through the internal `backend` network. MinIO Console
is intentionally not public. Use `docker compose exec` for local administration,
or a temporary localhost-only Compose override when a GUI database/object
storage tool is genuinely needed.

The gateway also preserves Vite HMR for this development stack and proxies the
private bucket path without rewriting its Host, URI, or signed query string.
This is required for MinIO SigV4 attachment links to remain valid.

The API container waits for PostgreSQL, Redis, and MinIO, then generates the
Prisma client, runs `prisma migrate deploy`, and runs the idempotent seed. The
seed inserts or updates XAU (Gold), XAG (Silver), and a curated catalog of 91
mints, refiners, manufacturers, issuers, assayers and bullion brands with 214
search aliases. Readiness returns HTTP 200
only while PostgreSQL, Redis, and the private MinIO bucket are all reachable.

For a real domain, set `GATEWAY_BIND_ADDRESS`, `GATEWAY_PORT`,
`GATEWAY_SERVER_NAME`, and the exact browser-facing `PUBLIC_ORIGIN`. Also set
`WEBAUTHN_RP_ID` to the hostname only. If one controlled TLS proxy is added in
front, set `GATEWAY_TRUST_PROXY_HOPS=2`, preserve the original Host, and prevent
clients from bypassing that proxy. Production must use HTTPS, secure
cookies, and a disabled HTTP initialization endpoint. This Compose file remains
a development stack and its gateway listens on HTTP only; terminate TLS at one
controlled external edge, or add a reviewed production override with
certificates, production image targets, and no source mounts/watchers. Setting
`NODE_ENV=production` alone does not convert this development stack into a
production deployment.

### Apple Web App installation

The production web build includes a standalone manifest, Mac Safari pinned-tab
artwork, regular and maskable install icons, iPhone/iPad touch-icon sizes,
safe-area handling, and a user-confirmed service-worker update flow.

- On macOS Safari, choose **File → Add to Dock**.
- On iPhone or iPad, open the HTTPS site, tap **Share**, then **Add to Home Screen**.
- `http://127.0.0.1:5173` is only usable on the same Mac. An iPhone or iPad needs
  a device-reachable HTTPS origin with `PUBLIC_ORIGIN`, `CSRF_ALLOWED_ORIGINS`,
  secure cookies, and `WEBAUTHN_RP_ID` configured for that hostname.
- The service worker caches only the application shell and reviewed static
  assets. Authentication, inventory, attachments, and final submission remain
  online-only; local intake drafts can still be edited while temporarily
  offline and synchronized after connectivity returns.

---

## Local development (no Docker)

Run every command below from the repository root. The example uses POSIX shell
syntax (`zsh`/`bash`) and expects PostgreSQL, Redis, and MinIO at the URLs in
`.env`.

```bash
# 1. Copy and edit env
cp .env.example .env

# 2. Export it for Prisma CLI. Nest also discovers this root file itself.
set -a
. ./.env
set +a

# 3. Install
corepack enable
pnpm install --frozen-lockfile

# 4. Build shared lib
pnpm --filter @bullion-ledger/shared build

# 5. Create the database first, then generate, migrate, and seed
pnpm --filter @bullion-ledger/api prisma:generate
pnpm --filter @bullion-ledger/api prisma:migrate:deploy
pnpm --filter @bullion-ledger/api prisma:seed

# 6. Start API (NestJS watch mode)
pnpm --filter @bullion-ledger/api dev

# 7. In a separate terminal, start web (Vite dev)
pnpm --filter @bullion-ledger/web dev
```

When editing `packages/shared` outside Compose, rebuild it before consuming the
change. Compose runs shared-package watchers in both application containers.

---

## Commands reference

| Command | Description |
|---|---|
| `pnpm install --frozen-lockfile` | Install the exact reviewed dependency graph |
| `pnpm build` | Build all packages (shared → api → web) |
| `pnpm typecheck` | TypeScript strict type-check on all packages |
| `pnpm lint` | ESLint (typescript-eslint) on all packages |
| `pnpm test` | Run all Vitest suites |
| `pnpm format` | Prettier auto-format |
| `pnpm format:check` | Verify formatting without writing files |
| `pnpm --filter @bullion-ledger/shared build` | Build shared library only |
| `pnpm --filter @bullion-ledger/api dev` | Start API watch mode |
| `pnpm --filter @bullion-ledger/web dev` | Start web dev server |
| `pnpm --filter @bullion-ledger/api prisma:migrate:deploy` | Apply committed migrations |
| `pnpm --filter @bullion-ledger/api prisma:seed` | Idempotently seed XAU, XAG, and the organization catalog |

---

## API endpoints (Phase 1)

### Auth (public except session)
| Method | Path | Description |
|---|---|---|
| GET | `/api/health/live` | Liveness check |
| GET | `/api/health/ready` | Readiness (PostgreSQL, Redis, MinIO) |
| GET | `/api/auth/init-status` | Check if initialized |
| POST | `/api/auth/init` | One-time single-user init (public) |
| POST | `/api/auth/login` | Username + password login |
| POST | `/api/auth/logout` | Destroy session |
| GET | `/api/auth/session` | Current session info |
| POST | `/api/auth/logout-all-others` | Revoke every other session |
| POST | `/api/auth/change-password` | Change password (re-auth required) |
| POST | `/api/auth/change-username` | Change username (re-auth required) |

### Passkeys / WebAuthn
| Method | Path | Description |
|---|---|---|
| GET | `/api/auth/passkey/status` | Whether this deployment has passkeys configured (public) |
| POST | `/api/auth/passkey/register/options` | Issue a registration challenge |
| POST | `/api/auth/passkey/register/verify` | Verify the attestation and store the credential |
| POST | `/api/auth/passkey/login/options` | Issue a login challenge (public) |
| POST | `/api/auth/passkey/login/verify` | Verify the assertion and open a session (public) |
| POST | `/api/auth/passkey/reauth/options` | Issue a step-up challenge |
| POST | `/api/auth/passkey/reauth/verify` | Elevate this session for one sensitive change |
| GET | `/api/auth/passkeys` | List registered passkeys |
| PATCH | `/api/auth/passkeys/:id` | Rename a passkey |
| DELETE | `/api/auth/passkeys/:id` | Delete a passkey |

### Domain
| Method | Path | Description |
|---|---|---|
| GET | `/api/metals` | List metals (XAU, XAG) |
| GET | `/api/product-definitions` | List product definitions |
| GET | `/api/product-definitions/:id` | Get product definition |
| POST | `/api/product-definitions` | Create product definition |
| GET | `/api/organizations` | Search canonical organizations and aliases by role |
| POST | `/api/organizations` | Create a user-curated organization with duplicate protection |
| GET | `/api/purchases` | List purchases |
| GET | `/api/purchases/:id` | Get purchase with items/assets |
| POST | `/api/purchases` | Create purchase atomically; requires `Idempotency-Key` |
| PATCH | `/api/purchases/:id` | Correct transaction metadata (dealer, branch, order/invoice number, payment method, notes) and the currency |
| POST | `/api/purchase-intakes` | Create/resume a user-owned wizard draft |
| GET | `/api/purchase-intakes` | List the current user's wizard drafts |
| GET | `/api/purchase-intakes/:id` | Read a wizard draft and active attachments |
| PATCH | `/api/purchase-intakes/:id` | Version-checked autosave; stale versions return 409 |
| DELETE | `/api/purchase-intakes/:id` | Soft-cancel a draft |
| POST | `/api/purchase-intakes/:id/finalize` | Atomically finalize one intake into one purchase |
| POST | `/api/purchase-intakes/:id/attachments/upload` | Same-origin bounded raw binary upload |
| POST | `/api/attachments/:id/variants/upload` | Upload a validated revisioned crop/scan derivative |
| PATCH | `/api/attachments/:id/review` | Confirm crop/scan recipe and metadata |
| GET | `/api/attachments/:id/url` | Issue an authorized short-lived variant URL |
| DELETE | `/api/attachments/:id` | Soft-delete attachment metadata |
| GET | `/api/assets` | List held assets |
| PATCH | `/api/assets/:id` | Version-checked holding edit; descriptive fields become per-lot overrides |
| GET | `/api/assets/:assetId/attachments` | Photos on the holding plus the documents its purchase carries |
| POST | `/api/assets/:assetId/attachments/upload` | Same-origin bounded raw binary upload onto a holding |
| GET | `/api/dashboard/summary` | Dashboard summary (cost, holdings by metal) |
| PATCH | `/api/dashboard/preferences` | Save the current user's Dashboard weight unit |

### Market data
| Method | Path | Description |
|---|---|---|
| GET | `/api/market/latest` | Latest price per metal, converted to the display currency |
| GET | `/api/market/history` | Stored time series for the chart |
| GET | `/api/market/providers/status` | Provider health and supported metals |
| POST | `/api/market/manual-price` | Record a hand-entered price (PRD §9 fallback) |
| POST | `/api/market/backfill` | Queue a dated-series backfill (202; runs on the worker) |
| POST | `/api/market/sync` | Fetch now instead of waiting for the next tick |

---

## Project structure

```
compose.yaml         Gateway, internal backend, and worker-only egress networks
infra/
  gateway/
    default.conf.template  Web, API, and signed-object reverse proxy

packages/
  shared/           Pure decimal math: units, purity, allocation, money
    src/
      units.ts      Weight conversion (g/kg/oz/qian), gram canonical
      prices.ts     Price-per-gram normalization, source types, melt value
      purity.ts     Fine weight = gross × purity
      allocation.ts Largest-remainder cost allocation (4 methods)
      money.ts      Currency codes, quantize, scale
      identifiers.ts Shared client draft-id contract
    test/            Decimal conversion, purity, money, and allocation tests

apps/
  api/              NestJS + Prisma + Postgres
    prisma/
      schema.prisma  Models: AppUser, UserSession, UserPasskey,
                     WebAuthnChallenge, Metal, Organization and
                     aliases/capabilities, ProductDefinition and organization
                     roles, PurchaseIntake, Purchase, PurchaseItem and
                     organization snapshots, Asset, Attachment,
                     AttachmentVariant, SpotPriceSnapshot, FxRateSnapshot,
                     AuditLog, SystemSetting
      catalog/       Versioned canonical organization seed data and aliases
      migrations/    Initial schema, organization catalog, intake/attachment MVP,
                     primary organization snapshot provenance, and passkey
                     ceremonies
      seed.ts        Seeds XAU, XAG, 91 organizations, and 214 search aliases
    src/
      main.ts       NestJS bootstrap
      app.module.ts
      config/
      common/
        decorators/
        filters/
        middleware/
        auth.guard.ts  Session authentication guard
        csrf.guard.ts  Same-origin/CSRF guard
      auth/         Init, login, session (Argon2id, HttpOnly, throttle)
      organizations/ Canonical/alias search and guarded custom organizations
      products/     Product definition CRUD
      purchases/    Atomic purchase + allocation + asset generation
        purchase-domain.ts  Pure purchase computation function
      purchase-intakes/  Resumable/versioned mobile wizard drafts and finalization lock
      attachments/  Bounded originals, revisioned derivatives, review, signed reads
      assets/       Asset read
      dashboard/    Summary endpoint
      queue/        Redis readiness probe
      jobs/         BullMQ queue, repeatable schedule, and price processor
      price-providers/  Market API adapters and failover registry
      market-prices/    Snapshot storage, normalization, purchase-time capture
      webauthn/     Passkey ceremonies, single-use challenges, credential CRUD
      storage/      MinIO boundary (private bucket, signed URLs)
      metals/       Metal list
      audit/        Append-only audit log
    test/            Auth, catalog, intake, attachment, transaction, health,
                     idempotency, storage, and domain tests

  web/              Vite + React + TanStack Query + Tailwind
    public/          PWA manifest, conservative service worker, and install icons
    scripts/
      generate-pwa-icons.mjs  Rebuild raster icons from the reviewed SVG source
    src/
      App.tsx       Shell with nav + logout
      ThemeProvider.tsx  Browser-default theme resolution and persistence
      ThemeSwitcher.tsx Accessible compact single-button theme toggle
      api.ts        Fetch wrapper + types
      webauthn.ts   base64url transcoding and navigator.credentials wrappers
      passkeys.ts   The three passkey ceremonies as single calls
      units.ts      Display helpers (formatGrams, formatMoney)
      purchase-wizard/
        PurchaseWizard.tsx  Six-step mobile-first wizard shell and navigation
        steps.tsx    Transaction, item/weight, cost, and review steps
        media.tsx    Camera/library inputs, crop editor, document corner editor
        auto-detection.ts    On-device object/document boundary detection
        media-processing.ts Perspective correction and normalized JPEG rendering
        organization-search.tsx Role-aware mint/refiner/brand comboboxes
        storage.ts   Strict versioned local draft parsing and autosave
      screens/
        InitGate.tsx  Health + init-status gate
        Init.tsx      One-time init form
        Login.tsx     Username/password form plus passkey sign-in
        Settings.tsx  Username, password, passkey and session management
        Dashboard.tsx Summary cards + metal breakdown + unit switcher
        Assets.tsx    Searchable held-inventory cards/table
        Products.tsx  Product template list + validated create form
        Purchase.tsx  Server/local draft sync, upload pipeline, and finalization
    test/           API, forms, wizard navigation/storage/media processing,
                    recovery, idempotency, and theme tests
```

---

## Key design decisions

### Allocation (largest-remainder method)
All four methods (MANUAL, SUBTOTAL_PROPORTIONAL, WEIGHT_PROPORTIONAL, EQUAL) use the largest-remainder (Hamilton) method to distribute remainder cents deterministically. Tie-break: descending fractional remainder, then ascending index. This guarantees:
- `sum(allocatedCosts)` = `totalAmount` exactly at `MONEY_SCALE` (2 decimals)
- Deterministic output for identical inputs
- No floating-point drift

### Race-safe init
First-run initialization uses a `pg_advisory_xact_lock()` so two concurrent init requests cannot both create a user.

In production, HTTP initialization is disabled unless `ALLOW_HTTP_INIT=true` is
explicitly supplied. Bootstrap only behind a TLS reverse proxy, enable that flag
for the short initialization window, initialize the owner account, set it back
to `false`, and restart the API. Production refuses `COOKIE_SECURE=false`.

### Idempotent, atomic purchase writes

`POST /api/purchases` requires an opaque `Idempotency-Key` header. Only its
SHA-256 digest and a canonical request digest are stored. Replaying the same key
and payload returns the original purchase; reusing it for a different payload
returns HTTP 409. The purchase, line items, generated assets, allocation results,
and audit record commit in one database transaction.

### Wizard drafts and private attachment uploads

The mobile purchase wizard stores a stable client-generated draft id in a
user-owned `PurchaseIntake`. Autosaves include the last observed `version`; a
stale update returns HTTP 409 instead of overwriting newer data. Finalization
uses both the normal idempotency key and a unique `Purchase.sourceIntakeId`, so
one intake cannot create two ledger purchases even if a retry uses a new key.
Purchase, items, assets, organization snapshots, attachment reassignment,
intake completion, and audit rows share one Prisma transaction.

Attachment bytes are sent directly to the same-origin API rather than from the
browser to MinIO. The server bounds the body before buffering, verifies the
signature, declared MIME, size, dimensions and SHA-256, writes a server-created
private object key, and then creates metadata plus an immutable `ORIGINAL`
variant. Images default to 25 MiB, PDFs to 50 MiB, and total retained attachment
storage in one intake to 250 MiB; the values are configurable in `.env.example`. The
intake limit covers retained originals plus every derivative, including objects
whose attachment metadata was soft-deleted, so delete/re-upload cycles cannot
bypass storage accounting. Original files are retained while crop/document
recipes and later derivatives remain revisioned and non-destructive. Signed
reads accept only an authorized attachment id and variant, never a
caller-provided storage key.

All non-original revisions on one attachment share configurable count and byte
quotas (20 revisions and 100 MiB by default). The API serializes quota checks on
the owning database row before writing a derivative to private object storage;
if the metadata transaction fails after that write, it removes the orphaned
object. Intake-wide retained-byte checks are likewise serialized on the draft
intake. An attachment stays mutable while it belongs to something its owner
still holds — a draft intake, a holding, or a purchase — so an invoice can be
re-typed, re-captioned, re-scanned or removed long after finalization. The
ORIGINAL variant is never replaced either way; only metadata and new revisions
move. An attachment that belongs to none of the three (detached or already
soft-deleted) is frozen, and immutable reads remain available to the owner.

The browser performs an initial foreground crop or document-corner detection
on-device, then lets the user adjust touch-friendly control points. Confirmed
product crops and perspective-corrected document scans are rendered as
normalized JPEG derivatives and uploaded as revisioned `CROPPED` or
`SCAN_COLOR` variants. The immutable original is always retained. HEIC/HEIF is
accepted only when the current browser can decode it into a derivative; otherwise
the picker asks for JPEG, PNG, or WebP before anything is uploaded.

### Holding edits and per-lot overrides

A holding's descriptive fields (name, form, brand, country, year/version)
resolve in three steps: this lot's own override, then the linked
`ProductDefinition` so catalog corrections reach inventory, then the
`PurchaseItem` snapshot taken at buy time. Editing one holding writes an
override on the `Asset` row — it does not rewrite the catalog (which would move
every other lot of the same product) or the purchase snapshot (which is a
historical record). Submitting the inherited value back, or clearing the field,
drops the override and restores inheritance.

Transaction metadata is shared by the whole purchase and is edited through
`PATCH /api/purchases/:id`. `purchasedAt`, the amounts and the allocation method
are deliberately not editable there: they are inputs to the committed allocation
and to the purchase-time spot snapshot (PRD §9), so changing one in place would
silently invalidate stored premium and melt figures.

### Correcting the currency

Choosing the wrong currency at entry mislabels amounts that were themselves
correct, so `currency` is the one figure-adjacent field `PATCH /api/purchases/:id`
does accept. Changing it relabels the purchase and every holding it produced
**without converting a single number** — the digits were right, the code was not.
Leaving the lots on the old code would read as a genuinely multi-currency ledger
and suppress the dashboard's P&L (PRD §10.4), so they move together in one
transaction.

The stored `PurchasePriceSnapshot` is expressed in the old currency and is not
convertible after the fact — the rate that applied on the purchase date is what
matters — so the row is deleted and a fresh snapshot is queued on the worker.
Until it lands, the purchase is simply one of the "awaiting market data" counts
the dashboard already reports.

A holding that came from no purchase (a received gift) has no transaction to
follow, so `PATCH /api/assets/:id` relabels it directly. The same endpoint
refuses `currency` for a purchased lot and says where to change it instead.

Documents uploaded through the purchase wizard stay on the `Purchase` and are
shared by every lot from it, while photos are reassigned to their holding.
`GET /api/assets/:assetId/attachments` returns both, tagged by `purchaseId` /
`assetId`, so the holding editor can show an invoice and say that removing it
affects the other lots too.

### Inventory: list, holding, editor

持有庫存 is three views behind one screen, each addressable in the URL so the
back button, a reload and a shared link all behave:

- `?screen=inventory` — the list.
- `&asset=<id>` — one holding in full: a photo gallery over every stored
  photo, every physical and financial figure, the transaction it came from, and
  every document with an inline preview. A row can only ever carry a summary, so
  this is where checking a holding happens rather than inside the editor.
- `&assetStep=<step>` — the editor, as a full-screen wizard.

The editor covers the page (`fixed inset-0`, `h-dvh`) with a pinned header and
action bar: the page itself cannot scroll, and only the current panel's body can
move, and only when a panel genuinely overflows a short screen. Keeping that
rare is what the eight small steps are for — 交易資訊, 商品描述, 規格, 成本與幣別,
保管與證書, 照片, 文件, 確認 — instead of three dense ones. Eight steps will not
fit a phone as a button strip at any wrap, so the header names the current step
and shows a progress bar; movement is 上一步／下一步, and each step is its own
history entry.

### One wizard chrome

Every multi-step flow — 新增入庫, the holding editor, and 商品規格 — renders
through `WizardShell`. It covers the page (`fixed inset-0`, `h-dvh`), pins the
step name, progress bar and action bar, locks the body behind it, and leaves the
current panel's body as the only scrollable region. Sharing it is what stops the
app having two answers to "where is the Next button".

商品規格庫 opened on an eight-field create form that was permanently expanded
above the catalogue, and edited through an inline card that shoved the list
rows around. Both are now that wizard (名稱與金屬 → 品牌與來源 → 純度與重量 →
確認), and the page opens on the catalogue itself. Each step validates only its
own fields; the review step validates all of them — faulting a step for a field
the user has not reached yet is how a wizard traps someone with no way forward.

收到贈與 is a bottom sheet with the same shape as the disposal dialog rather
than a nine-field form pushing 異動紀錄 off the screen.

### Phone layout

Checked by measuring the running app at 320/360/390px, not by reading CSS.
`body` is `overflow-x: hidden`, so overflow here never shows as a sideways
scroll — content is silently clipped, which is why these need measuring.

- `--app-gutter` (1rem, 0.75rem below 380px) feeds every page gutter. A date
  control sizes itself from its locale's format and iOS Safari will not shrink
  one below that; in zh-TW the value is long enough that the three date fields
  in the app had 5px, 0px and -1px of room at 320px. They also carry
  `-webkit-appearance: none` plus `::-webkit-date-and-time-value { min-width: 0 }`,
  without which the value element re-inflates the control.
- The tab bar's overflow sheet is a sibling stacked above the bar inside one
  fixed container rather than a box offset by `--app-bottom-nav`. That variable
  is the bar's content height and excludes the home indicator the bar adds
  itself, so offsetting by it hid the sheet's last row behind the bar.
- A wizard title needs `basis-32`, not `flex-1` alone: a zero basis let the
  status pills beside it take the whole row and the title rendered at 0px.

### Zoom lock

The app is held at 1x on touch devices by three mechanisms, because no single
one covers every browser: `maximum-scale=1, user-scalable=no` in the viewport
meta (Chrome, and iOS once installed to the home screen); `touch-action:
pan-x pan-y` on the document, which scrolls but declines pinch and
double-tap-to-zoom (`manipulation` alone would still permit a pinch); and
cancelling iOS Safari's proprietary `gesture*` events in `zoom-lock.ts`, since
it has ignored `user-scalable=no` in a browser tab since iOS 10.

`viewport-fit=cover` stays: dropping it letterboxes a notched phone and strips
every safe-area inset the layout depends on. Focus-zoom and text inflation were
already handled — every control is 16px under `any-pointer: coarse`, and
`-webkit-text-size-adjust` is pinned at 100%.

This is a deliberate accessibility trade-off (WCAG 1.4.4) that suits a
single-user ledger. It also means asset photos cannot be pinched; exempting the
gallery would be a `touch-action: auto` on the image plus skipping the gesture
cancel inside it.

### Organization catalog

Products and purchase snapshots distinguish `BRAND`, `ISSUER`, `REFINER`,
`MINT`, `MANUFACTURER`, and `ASSAYER` instead of treating every visible name as
the manufacturer. Search matches canonical names, localized names, acronyms,
trade names, and historical names. Catalog product attribution is authoritative;
custom products can keep linked or user-reported organization snapshots,
including the selected primary organization for each role. Custom organization
creation serializes its cross-table alias uniqueness check to prevent concurrent
duplicate aliases.

### Phone navigation

Seven destinations in a two-column header grid put four rows of buttons above
every screen's own content on a phone. Navigation now lives in a five-column bar
in the thumb zone: four destinations plus an overflow sheet holding the rest,
with the overflow button labelled with the current screen when the active
destination is inside it. The header keeps only the app name and the account
controls, and the desktop bar is unchanged.

`--app-bottom-nav` (0 above the `sm` breakpoint, 3.5rem below it) is the single
source for the bar's height. Page padding and the wizards' sticky action bars
both read it, so the bar can never cover page content or sit on top of a Next
button. Wide tables (異動紀錄, 市場歷史交易) render as cards below `lg` instead of
scrolling sideways, and the wizard step strips wrap to two rows of three.

### Responsive theme

The UI defaults to the browser/OS color-scheme setting and uses one compact
button to switch between Light and Dark. Returning to the system's current
theme restores automatic system following. Theme transitions respect
`prefers-reduced-motion`. Layouts are responsive for phone, tablet, and desktop,
with touch-sized controls and mobile card alternatives for wide tables.

### PWA shell

The production web build includes a manifest, install metadata, standalone
theme colors and a conservative service worker. It caches only the application
shell and static assets; API responses, attachment routes and signed object URLs
are explicitly excluded. Wizard data remains available through versioned local
autosave while authenticated system drafts provide cross-device recovery. When
the same draft exists in both places, content timestamps choose the newer copy
instead of letting stale local state overwrite another device's work.

### Passkeys and step-up re-authentication

Registration, login and step-up are each a two-call ceremony: the server issues
a challenge it stores itself, then verifies the authenticator response against
that exact stored value. `WebAuthnChallenge.consumedAt` is set by a conditional
update, so a challenge is single-use even under concurrent verifies, and a
challenge issued for one purpose (or one user) cannot be redeemed for another.
User verification is `required` in both directions, which is what makes Touch ID
/ Face ID — rather than mere user presence — the thing being asserted. The
server stores only the credential id, public key, counter and transports; it
never receives biometric data.

Login requests no `allowCredentials`, so the platform offers whatever
discoverable passkey it holds and the user can sign in without typing a
username. Failed assertions are charged to the same bounded throttle as password
logins.

Changing the username or password requires re-authentication (PRD §4.3): either
the current password, or a passkey step-up already completed on that session.
The elevation is stored per-session, expires in five minutes, and is cleared as
it is claimed — one prompt authorizes exactly one change. Supplying a wrong
current password fails outright rather than falling back to a stored elevation.
Username + password always remains the recovery path, so deleting the last
passkey never locks the account out.

Passkeys need a secure origin whose host is a registrable domain. `localhost` is
fine; a bare IP is not, so use `http://localhost:5173` rather than
`http://127.0.0.1:5173` when testing Touch ID locally, and keep
`WEBAUTHN_RP_ID` matched to the hostname in `PUBLIC_ORIGIN`. Use the optional
`WEBAUTHN_ORIGIN` override only when the deployment genuinely has multiple
browser-facing origins.

### Price providers

Nothing outside `price-providers/` talks to a market API. Three keyless adapters
ship, and the registry tries the configured `PRICE_PROVIDER` first, then the
remaining capable ones:

| Provider | Supplies | Notes |
|---|---|---|
| `gold-api` | XAU/XAG spot, USD per troy ounce | Default. Updates continuously, so the 5-minute schedule is usable |
| `exchangerate-api` | USD→TWD | Free keyless tier of exchangerate-api.com; refreshes about daily |
| `currency-api` | spot, FX, **daily history** | jsDelivr-hosted dataset with dated endpoints, used for chart backfill and as a fallback |

A provider that throws *or returns an empty result* is treated as a miss, so a
silently-degraded upstream still fails over. Every attempt updates
`PriceProviderStatus`; a provider that has never succeeded is never reported
healthy.

Quotes are stored exactly as received **and** normalized to price-per-gram, so
valuation never re-derives a conversion. The PRD §12.2 source types (`SPOT`,
`BENCHMARK`, `DEALER_SELL`, `DEALER_BUYBACK`, `MANUAL`) live in separate rows and
are never merged. Duplicate ticks are rejected by the database unique
constraint rather than a read-then-write check, so concurrent workers cannot
both insert.

Conversion into the display currency is applied only when the quote is in
`PRICE_BASE_CURRENCY`; an unexpected quote currency yields `null` rather than a
number produced by the wrong rate.

### Purchase-time snapshot

Recording a purchase enqueues an immediate snapshot (PRD §9). The result is a
flat copy — quote, FX rate, per-gram and per-台錢 price, melt value, premium paid
and premium rate — not a join to live price rows: what you paid over melt on a
given day is a historical fact and must not move when today's spot does. Metals
with no usable price are reported as skipped and retried by the worker rather
than guessed at.

### Scheduling

`scheduler` owns the repeatable job definitions and `worker` executes them, kept
as separate processes so the schedule is declared exactly once no matter how many
workers run — scaling workers can never multiply the request rate against a
third-party API. Intervals come from `PRICE_SYNC_INTERVAL_MS` and the
`PRICE_*_CRON` variables; an out-of-range interval is ignored rather than turned
into an accidental request flood.

`backend` is an `internal` network with no route off the host. The worker is
therefore also attached to a dedicated `egress` network, since it is the only
process that calls an upstream API; the scheduler gets no egress at all.

On startup the scheduler queues a `PRICE_BACKFILL_DAYS` history backfill (90 by
default, `0` disables). Backfill costs one upstream request per **missing** day —
days already stored are subtracted before any network call — so repeating it on
every restart is nearly free. It always runs on the worker, never inline in a
request, and reconciles pending purchase snapshots afterwards, since newly
backfilled history is usually exactly what an unvalued purchase was waiting for.

### Dashboard valuation

Intrinsic value is `fine weight × price per gram` in the display currency
(PRD §10.2), with P&L and return rate derived from it (§10.4, §10.7). Three
things are deliberately withheld rather than guessed:

- a metal with no price is **excluded from the total and named**, not treated as
  worthless, and P&L is suppressed while the total is knowingly incomplete;
- P&L is not reported at all unless every cost sits in the **same currency** as
  the valuation — mixing a TWD cost with a USD value would look authoritative
  and mean nothing;
- return rate is `null` against zero cost, not infinity.

Each absent figure is accompanied by the reason it is absent, alongside the
count of purchases still awaiting market data and the age of the prices used.

---

## PRD items not implemented in Phase 1
- Historical price chart UI and buy-point markers (the data layer is in place)
- Premium analysis UI, realized gain/loss
- Partial sale, full sale, asset movements
- Dealer management and dealer quotes
- Storage location management
- Valuation rules and valuation snapshots
- Backup/restore
- CSS visual branding (unresolved per PRD §31)

---

## Environment variables

See `.env.example` for all variables with documentation. Never commit `.env`.
`SESSION_SECRET` must be at least 32 characters. Generate with:

```bash
openssl rand -hex 48
```

The production web image keeps source maps disabled. To build a private image
with source maps intentionally enabled:

```bash
docker build \
  --target prod \
  --build-arg GENERATE_SOURCEMAP=true \
  -f apps/web/Dockerfile \
  -t bullion-ledger-web .
```
