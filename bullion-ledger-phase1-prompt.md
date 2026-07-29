# Bullion Ledger — OpenCode Phase 1 Implementation Task

You are the primary implementation agent for Bullion Ledger. Work directly in:

`/Users/brian/Documents/projects/Bullion Ledger`

First read `01_PRODUCT_REQUIREMENTS.md` completely. Preserve it unchanged. This is a greenfield workspace with no existing code and no Git repository.

Implement the first production-minded, executable, tested Phase 1 milestone. Do not stop after planning and do not create a superficial demo scaffold.

## Required scope

1. Create a Node.js + TypeScript monorepo with one consistent package manager and strict TypeScript settings.
2. Create a React + Vite frontend and a NestJS API using Prisma + PostgreSQL. Establish clean boundaries for BullMQ/Redis and private MinIO object storage.
3. Add Docker Compose development infrastructure for frontend, API, PostgreSQL, Redis, MinIO, MinIO initialization, and appropriate health checks. Add `.env.example`; never add real secrets.
4. Design a Prisma schema for the Phase 1 domain: the single user, sessions, passkeys, metals, product definitions, purchases and purchase items, assets, attachments, spot/FX snapshots, and audit foundations. Store financial values, weights, exchange rates, and ratios as Decimal/NUMERIC. Store timestamps in UTC.
5. Implement one complete vertical slice covering:
   - precise Decimal weight conversion for g, kg, troy oz, and Taiwan qian;
   - purity and fine-metal-weight calculation;
   - product definition management;
   - atomic purchase creation;
   - asset generation from purchase items;
   - MANUAL, subtotal-proportional, weight-proportional, and equal cost allocation;
   - preservation of the allocation method and exact allocated results;
   - a basic dashboard summary backed by real API data.
6. Validate quantities, money totals, currency codes, purity, units, and allocation invariants at the API boundary. Handle rounding remainders deterministically so allocations reconcile exactly to the transaction total.
7. Implement the secure foundation for one-time single-user initialization and username/password session login: Argon2id, HttpOnly cookies, environment-aware Secure cookies, SameSite, login throttling/temporary lockout, no public registration, and no sensitive logging. Initialization must be race-safe. If WebAuthn cannot be implemented completely and reliably in this milestone, provide a real module boundary and data model but never fake a successful flow.
8. Build usable frontend screens for initialization/login, dashboard, product definitions, and purchase entry with unit switching. Connect to the real API and include loading, validation, empty, and error states; do not present mock data as live data.
9. Add unit and integration tests for conversions, Decimal calculations, allocation/remainders, authentication logic, and purchase transaction behavior.
10. Add a README with exact install, environment, migration, seed/bootstrap, development, lint, typecheck, test, build, and Docker commands. Clearly list PRD items not yet implemented in this milestone.

## Engineering constraints

- Use Decimal arithmetic for final financial and measurement calculations; do not rely on JavaScript floating point.
- Keep TypeScript strict and avoid `any`, swallowed errors, duplicate contracts, fake implementations, and empty TODO-only modules.
- Use DTO validation with class-validator or Zod at trust boundaries.
- Keep transactions atomic and operations idempotent where retries are plausible.
- Do not hard-code unresolved PRD choices such as the first market-price provider or visual branding.
- Do not expose MinIO objects publicly or put secrets in source control/logs.
- Do not modify the PRD and do not create a Git commit.
- Install dependencies as needed, then run formatting, lint, typecheck, tests, and builds. Fix all failures you can reproduce before finishing.
- If an external service or network restriction prevents a check, finish the implementation and report the exact unverified command and reason.

At completion, summarize implemented behavior, important design decisions, commands actually run with their outcomes, and known remaining work.
