# Progress — initial checkpoint
Date: 2026-11-26. Status: pre-development kit only. No app code, schema migrations, tests, repository publication, infrastructure provisioning or hosted deployment verified yet.

| Milestone | Status | Evidence |
|---|---|---|
| Brand + hybrid design | Approved | DESIGN_SYSTEM.md; reference assets |
| Foundation/auth/DB | Pending | — |
| Core CRM workflows | Pending | — |
| Pipeline/tasks/reports/CSV | Pending | — |
| Landing and responsive QA | Pending | — |
| Local/hosted security and tests | Pending | — |
| Public evaluation sandbox | Pending | — |
| GitHub/Vercel release | Pending | — |

After each milestone record UTC timestamp, branch/SHA, changed modules, commands, actual pass/fail counts, known issues, migration state and exact next task. Never record secret values. Final release verdict: NOT YET IMPLEMENTED.

## Foundation in progress — 2026-11-26 15:29:47Z

- Audited kit and preserved source checkpoint 4344d98. Reference PNGs are local and excluded from publication.
- Verified signed-in GitHub owner MoizAi8 and Vercel CLI access. Target repo/project was not found. No infrastructure changes yet.
- Installing the pinned stack and preparing an isolated PostgreSQL 17 cluster. No tests run yet.

## Local CRM implementation — 2026-11-26 16:06:58Z

- Implemented Better Auth sessions, invite-based private registration, synthetic sandbox provisioning, CRM records, conversion, pipeline, tasks, reporting, search, CSV, settings, and the approved light workspace.
- Provisioned dedicated Neon Free and Vercel resources. Applied Neon migrations 001–004 through the direct owner credential and removed that connection from Vercel production. Runtime secrets configured through stdin.
- Initial production build, 39 unit checks and 12 PostgreSQL checks passed. The browser journey confirmed conversion, pipeline movement and exact won value. Broader browser and strengthened RLS checks are running before publication.

## Database checkpoint — 2026-11-26 16:08:31Z

- Local PostgreSQL 17.10 passed 15 integration checks, including pool context isolation, role revocation, capacity, concurrent quotas and lifecycle conflicts. All six additive SQL migrations are applied locally and on the dedicated Neon database.
- Warm route-handler benchmark over 50 authenticated samples each reported p95 of 10.3 ms for search and 55.7 ms for dashboard. Measurements use the isolated synthetic dataset and include PostgreSQL.
- The patched CSV dependency cleared the production npm audit. Final local browser acceptance and publication remain pending.

## Verified source checkpoint — 2026-11-26 16:12:27Z

- Source commit c334f1d437e5b1d3a45542d8a42d84236f2d3f23 passed lint, strict type checking, production build, 39 unit, 15 PostgreSQL and 3 production-browser tests. Browser checks include an optimistic rollback, a local accessibility scan, five viewport widths, CSV, real analytics, isolation and private sign-in persistence.
- The restricted Neon pool returned zero rows with no tenant context. Verified 13 forced-RLS non-owned tables, no superuser, no RLS bypass, no DDL and no arbitrary workspace bootstrap grant.
- Reviewed the current Vercel Hobby scope and explicitly provisioned Neon Free. The dedicated Vercel app uses Node 24 and only the pooled connection, two app secrets and its canonical origin. Source publication and production deployment are in progress.

## Hosted release — 2026-11-26 16:21:01Z

- **GO for fictional-data portfolio evaluation.** The public app is https://clorix-crm.vercel.app and the verified repository is https://github.com/MoizAi8/clorix-crm.
- Deployed SHA: 528b097ad965c8a61cef2e5b65a497ca94497946. Vercel production is READY and the canonical alias, landing source link and database health returned successfully.
- GitHub Actions passed on the deployed SHA at https://github.com/MoizAi8/clorix-crm/actions/runs/45857389951. Final acceptance totals are 39 unit, 15 PostgreSQL, 3 local production-browser and 2 hosted browser journeys. The production dependency audit reported zero vulnerabilities.
- Hosted checks covered no-invite sandbox isolation and persistence, qualification/conversion, drag and keyboard stage moves, task and activity writes, exact reports, search, CSV, private registration and re-login, and secure cookies. Early browser assertions were corrected to wait for logout and for committed stage updates. The final suites passed.
- PostgreSQL migrations 001–006 applied in the local test database and on Neon. Verified the restricted pooled login with 13 forced-RLS non-owned tables, no tenant access without context, no DDL, and no broad bootstrap permission.
- The dedicated deployment uses Vercel Hobby and Neon Free. The hosted quota allows 5 sandbox starts per network per 24 hours, 90 globally, and 30 active workspaces. Each workspace expires after 24 hours and uses fictional data.
- Warm local p95: search 10.3 ms and dashboard 55.7 ms, 50 authenticated samples each. Final hosted mobile-emulated landing LCP was 796 ms on first navigation and 124–148 ms on three warm navigations. CLS was 0 in all four. Results are for the measured environment.
- Hosted browser screenshots and JSON evidence are in artifacts/visual-qa. Credentials, account invites and raw reports remain in ignored local files. Optional Gemini is deferred. See docs/KNOWN_LIMITATIONS.md for the release scope.
- Verified cleanup of the two owned hosted sandbox fixtures and one private fixture. Local Clorix test processes were stopped, with the database files retained.

## Clorix 2.0 Phase A — 2026-11-26 16:47:37Z

- Working branch clorix-2.0 starts from release evidence commit 9948d6e. Production remains on 528b097.
- Added the locked Python 3.12 FastAPI service, short-lived action-bound gateway authorization, Psycopg tenant-scoped transactions and a distinct read-only engine role. Verified role restrictions and denial after membership revocation.
- Passed 19 Python tests, one live Next.js-to-FastAPI test, 39 existing unit tests and 15 existing PostgreSQL checks. The ordinary TypeScript regression command skips the dedicated engine test, which passed through its separate live runner. FastAPI's upstream test client emits an HTTPX deprecation warning.
- Local imports lint was corrected. Added isolated CI wiring. No production database changes or promotion. Next scope is the Phase B sales and workflow modules.

## Clorix 2.0 Phase B checkpoint — 2026-11-26 17:07:24Z

- Added migrations 007–008, custom pipelines, explainable lead and customer scores, deal-risk forecasting, targets, saved lead/customer profiles, workflow definitions and run history, and an in-app inbox. The evaluation action performs bounded manual processing instead of scheduling.
- Verified 47 Python checks, one live cross-language integration scenario covering idempotent profile writes and a real workflow, 15 existing PostgreSQL checks, and the three existing browser journeys. A focused rerun of the new production-browser scenario passed. Its initial run identified ambiguous workflow control labels, which were corrected.
- Created an empty Neon staging database and dedicated Vercel Hobby FastAPI project. API secrets are stored only in ignored local files and the isolated service configuration. The Clorix 1.0 database and live frontend were not migrated or redeployed.
- Next phase starts with catalog, exact quotation/invoice totals and PDF output.

## Clorix 2.0 Phase C checkpoint — 2026-11-26 17:29:35Z

- Implemented catalog snapshots, quotation and invoice lifecycle, exact pricing, recorded payments, branded PDFs, support tickets and internal notes, calendar views, and monthly team targets. Added migrations 009–010 on local and staging databases. Extended diagnosis and rules for support, quotation and invoice events.
- Passed 69 Python tests, one live Next.js-to-FastAPI scenario and six local production-browser tests, including the legacy suite and three upgrade journeys. Verified concurrent payment rejection, exact minor units, downloadable PDF content and document page renders.
- The first hosted database handshake exposed a missing libpq CA source. The staged engine configuration now requests the system trust roots with full verification. Rebuild and hosted tests are next. The original production connection, alias and main branch remain unchanged.
- Next phase covers restricted Gemini Copilot, productivity tools and release verification.

## Clorix 2.0 productivity checkpoint — 2026-11-27 PKT

- Continued from Phase C. Support tickets and internal notes, the sales calendar, team targets, billing flows and PDF renders had already passed the dedicated browser suite.
- Added campaigns with lead attribution, email templates and drafts, typed custom fields, saved views and reports, and owner audit history. Applied migrations 011–012 to the dedicated local and Neon staging databases and reapplied role-specific grants.
- Added a private allowlisted Gemini lab with regional and consent controls, fictional prompts, quotas, history and deletion. A mocked provider verified the lifecycle. No live Gemini key or approved reviewer has been configured for this checkpoint.
- Passed 105 Python checks and the live local Next.js-to-FastAPI test. The suite fixed a UTC date boundary in the payment fixture. Rotated the two isolated local credentials that appeared in a prior fixture failure and added output redaction to the harness.
- Hosted Vercel logs showed an incomplete CA trust store. The staged engine now supplies a bundled CA store for libpq's hostname-verified connection. The hosted database and productivity browser checks remain pending.

## Clorix 2.0 release candidate — 2026-11-27 PKT

- Hosted FastAPI checkpoint 3462223 passed a signed workspace read, tenant-scoped intelligence and a persisted Neon profile write. The endpoint rejected unauthenticated workspace requests. Recorded the measurements in `artifacts/visual-qa/staging-engine-verification.json`.
- Added mapped CSV import and filtered export for the core record types, commercial and support results in the command palette, printable report charts and authorized report drill-down. Added bounded private attachments with forced downloads and no sandbox uploads. Applied migration 013 in both isolated environments.
- The local runner passed 128 Python checks, 39 TypeScript unit checks, 16 TypeScript PostgreSQL checks, one live Next.js-to-FastAPI check and seven production-browser journeys. Verified uploads and bytes, search navigation and the new productivity workflow. The optional Gemini key and reviewer setup remain pending.
- Vercel staging uses a separate frontend with the dedicated Neon staging database and staged FastAPI service. The staged frontend and latest engine bundle still require hosted browser acceptance before production promotion.
