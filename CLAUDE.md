# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Single-user physical precious-metals asset ledger (gold/silver bullion). pnpm workspace monorepo:
`packages/shared` (pure Decimal math) → `apps/api` (NestJS + Prisma + PostgreSQL) and `apps/web`
(Vite + React + TanStack Query + Tailwind), fronted by an Nginx gateway in `infra/gateway`.

`01_PRODUCT_REQUIREMENTS.md` is the authoritative spec (Traditional Chinese) and **must not be
modified**. Code and comments cite it as `PRD §N`; when a behavior looks arbitrary, the section
number in the nearby comment is the explanation. `README.md` holds the full endpoint table,
env-var reference, and the rationale behind each design decision — read it before changing
allocation, attachments, passkeys, price providers, or valuation.

## Prerequisites before any check runs

Two generated artifacts are required and neither is committed. A fresh clone fails `typecheck`,
`test`, and `build` without them:

```bash
pnpm install --frozen-lockfile
pnpm --filter @bullion-ledger/shared build      # api/web resolve @bullion-ledger/shared via dist/
pnpm --filter @bullion-ledger/api prisma:generate # API code imports enums from @prisma/client
```

Symptoms when skipped: `Failed to resolve entry for package "@bullion-ledger/shared"`, or
`TypeError: Cannot read properties of undefined (reading 'DRAFT')` in API tests. Rebuild
`packages/shared` after editing it; Compose runs watchers for it inside both app containers.

## Commands

```bash
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build   # full gate

# Single test file / single case (vitest, run from the repo root)
pnpm --filter @bullion-ledger/api  exec vitest run test/purchase-domain.test.ts
pnpm --filter @bullion-ledger/web  exec vitest run test/dashboard-model.test.ts -t 'premium'
pnpm --filter @bullion-ledger/shared exec vitest run test/allocation.test.ts

pnpm --filter @bullion-ledger/api dev    # NestJS watch, :3000
pnpm --filter @bullion-ledger/web dev    # Vite, :5173, proxies /api → :3000
pnpm --filter @bullion-ledger/api prisma:migrate:dev   # new migration
pnpm --filter @bullion-ledger/api prisma:seed          # idempotent metals + org catalog

docker compose --env-file .env up --build -d   # full stack; only the gateway publishes 127.0.0.1:5173
```

**The whole test suite is unit tests with mocked Prisma/S3 — no PostgreSQL, Redis, or MinIO
required.** There is no e2e/integration layer; `apps/api/test/*.test.ts` construct services with
hand-built `prisma` doubles. Keep it that way when adding tests.

## Architecture

**Three processes, one NestJS codebase.** `main.ts` (HTTP), `worker.main.ts` (BullMQ consumer),
`scheduler.main.ts` (repeatable job definitions only). The split is deliberate: the schedule is
declared exactly once regardless of worker count, and only the worker is attached to the `egress`
Docker network, so the worker is the sole process that may reach a third-party API. The `backend`
network is `internal`.

**Dependency direction.** `apps/*` depend on `packages/shared`; nothing depends on `apps/*`.
Cross-boundary money/weight rules (`MONEY_SCALE`, `MAX_MONEY`, `MONEY_INPUT_RE`, `WEIGHT_INPUT_RE`,
`GRAMS_PER_UNIT`, allocation) live in `shared` and are imported by both API DTOs and web forms —
do not restate a limit or a regex locally.

**Decimal, never float.** Grams are the canonical stored weight; money is `NUMERIC(18,4)` allocated
at 2 dp; weights are `NUMERIC(18,9)`. Values cross the HTTP boundary as **strings**, are parsed with
`decimal.js`, and unit conversion happens only at trust boundaries.

**Pure domain functions.** Computation that must be deterministic is extracted away from services:
`purchases/purchase-domain.ts`, `purchases/purchase-summary.ts`, `movements/`'s domain helpers,
`shared/src/allocation.ts`. These take plain inputs and are the natural place for new business
rules and their tests.

**Security is global, opt-out per route.** `common/security-guard.module.ts` registers `CsrfGuard`
(state-changing routes, same-origin check) and `AuthGuard` (every route) as `APP_GUARD`; a route
becomes public only via `@Public()`. `main.ts` applies a whitelisting `ValidationPipe` with
`forbidNonWhitelisted`, so every accepted field needs a class-validator decorator in a DTO.
All env-derived security settings are read in one place: `config/runtime.config.ts`.

**Concurrency patterns already in use — follow them rather than inventing new ones.** Single writer
per critical section via `pg_advisory_xact_lock` (first-run init, custom organization creation) or
`SELECT … FOR UPDATE` inside a `$transaction` (intake finalization, attachment quota accounting).
Mutations that a client may retry take an `Idempotency-Key` and store only its SHA-256 plus a
canonical request digest. Uniqueness is enforced by database constraints (e.g. duplicate price
ticks, `Purchase.sourceIntakeId`), not read-then-write checks. Audit rows are written with
`AuditService.recordInTransaction(tx, …)` so the mutation and its audit entry commit together.

**Module boundaries that must not be crossed.** Only `price-providers/` talks to a market API;
only `storage/` talks to MinIO, and signed reads are addressed by attachment id + variant, never by
a caller-supplied object key. Attachment originals are immutable — crops and document scans are
new revisioned variants.

**Web screens split view from logic.** Most screens are `screens/X.tsx` (JSX) plus
`screens/x-model.ts` (pure functions: formatting, validation, state reduction, UI copy). Same
pattern in `purchase-wizard/` (`model.ts`, `validation.ts`, `storage.ts`, `media-processing.ts`).
Tests target the `-model` files because the vitest environment is **node, not jsdom** — component
tests assert against `renderToStaticMarkup` output; there is no Testing Library and no DOM.
Put new logic in a model file so it stays testable.

## Conventions

- Relative TypeScript imports carry a `.js` extension in both `apps/api` and `apps/web`
  (`./purchase-form.js`), matching the NodeNext-style resolution the build expects.
- User-facing copy is **Traditional Chinese**; identifiers, comments, and commit messages are English.
- Comments explain *why* (usually citing a PRD section or a race/rounding hazard), not *what*.
- TypeScript is strict with `noUncheckedIndexedAccess`; `any` is an ESLint warning to avoid, not a tool.
- Prettier: 100 cols, single quotes, trailing commas. Run `pnpm format` rather than hand-aligning.
- A withheld value is expressed as `null` plus a machine-readable reason code (see the dashboard's
  `ValuationNotice`), never as `0`, `Infinity`, or a guess.
