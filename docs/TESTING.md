# Testing strategy — correctness over count
Target ~150–200 meaningful checks if resources permit, but do not invent counts or block solely on arbitrary count. All core acceptance gates in RELEASE_CHECKLIST mandatory. Categorize real unit/integration/browser/live checks; mocked provider tests separately. CI clean install, lint/typecheck, unit, real PostgreSQL integration and production build; browser suite with isolated DB. Do not use SQLite as substitute for Postgres RLS/concurrency. Use synthetic fixtures only.

| Suite | Suggested target | Coverage |
|---|---:|---|
| Unit | 65–85 | validation boundaries, exact money, stage state, date/timezone, win rate, forecast, search/filter parsing, CSV escaping, rate-limit decisions |
| PostgreSQL integration | 45–65 | migrations, all CRUD, FK constraints, conversion atomicity/idempotency, transition races, archive, analytics consistency, RLS, quotas, import atomicity, invites, expiry |
| Production browser | 15–20 | sandbox, login/logout, lead conversion, DnD and keyboard move, task, CSV, search, reports, mobile, accessibility, error/empty states |
| Hosted acceptance | 15–20 | staging core flows, two independent sessions, persistence, access, analytics, safe cleanup, screenshots, health |

## Essential negative and edge cases
1. Invalid email/phone/name, extreme text, invalid IDs/date/timezone, negative/overflow amount, stale version, invalid stage, lost reason missing, zero denominator, daylight/time zone boundaries, archive history, reopen metric correction.
2. Two concurrent conversions produce one deal; duplicate idempotency key with different body rejected; two stage moves stale conflict; failed transaction leaves state unchanged; import duplicate/invalid preview and checksum mismatch; CSV formula injection with leading tabs/whitespace.
3. Nonmember direct IDs for each entity and search/report/export; member cannot manage roles/invites; last owner guard; expired/reused/revoked invite; unauthenticated/private endpoints; no-context DB policy; pooled connection reuse cannot leak; cross-tenant composite FK rejection; guest expired; quotas atomic under concurrency; sandbox cannot invite or send AI.
4. Browser at 390/768/1440 widths; keyboard-only nav, dialog focus, DnD alternative, axe checks, reduced motion, error and empty state, offline/network failure and optimistic rollback. Confirm text contrast, charts table equivalent, no layout overflow, no broken CTA or placeholder nav.
5. Actual analytics deltas calculated from fixture amounts and date range; DB persistence after reload/sign-in. Report counts exactly. Optional lab if enabled: blocked free-form inputs/real records, ineligible users, quotas, timeout, actual provider response only with fixed sample; mock and hosted counts separate.

## Performance evidence
Seed isolated test DB with ~1,000 leads, 500 contacts, 200 companies, 500 deals, 1,000 activities/tasks, coherent relations. Run 50 authenticated search and dashboard queries at modest concurrency (1–3), report local warm p50/p95, cold separately and sample size; suggested warm search p95 <250ms, dashboard p95 <500ms; investigate slow query plans and add indexes if needed. Run automated hosted acceptance on the dedicated staging app and staging database. Use a single ordinary sandbox start for a production release smoke check. Report hosted cold starts separately. Measure landing Lighthouse/Playwright representative device, actual values. No unsupported scale claims.

## Evidence
Save sanitized test outputs, command list, CI URL, deployment SHA, desktop/mobile screenshots under artifacts/visual-qa, benchmark JSON with environment/dataset/measurement, limitations. Record failure and rerun affected suite; never fabricate results. See RELEASE_CHECKLIST for mandatory scenarios.
