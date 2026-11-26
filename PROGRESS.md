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

## Clorix 2.0 staging acceptance — 2026-11-27 PKT

- Staged commit 0608edf on both Vercel projects. Six hosted browser journeys passed against Neon, including sandbox isolation, private attachments, workflow task and notification writes, quotation-to-invoice conversion, partial payment, PDF download, support/calendar/team goals and productivity on mobile.
- Verified the locally saved `CLORIX_GEMINI_API_KEY`. The exact variable was absent from the staging engine's Production listing, so it was added as sensitive. Activated the Google-listed free model `gemini-3.5-flash-lite` for the approved fictional reviewer flow.
- Fixed the Gemini request timeout that the provider rejected, and constrained response references to the selected fixture. Genuine inference through the local Clorix service passed in 2.072 seconds. Hosted Gemini verification is next.
- Aligned the PostgreSQL audit-read policy with the application owner check so guest workspace owners can verify audit events belonging to their own synthetic sandbox.

## Clorix 2.0 production release — 2026-11-27 PKT

- **GO for personal portfolio evaluation with fictional data.** The original frontend and no-invite sandbox now use Clorix 2.0 at https://clorix-crm.vercel.app. Production FastAPI health is https://clorix-engine-live.vercel.app/health. Both production deployments were built from `4c11caff307854402e540d051a80c1efc09f0826`.
- Verified a pre-upgrade PostgreSQL 18 custom archive with its catalog, full readback and SHA-256. The archive remains ignored locally. Applied migrations 007–013 to the existing production database. The pooled gateway sees zero records without tenant context, and 44 non-owned tables enforce forced RLS. The engine role has no authentication table access, schema creation or RLS bypass.
- Passed 128 Python, 39 TypeScript unit, 16 TypeScript PostgreSQL, one live cross-language and seven local production-browser checks. Six hosted staging journeys and four focused staging reruns passed. GitHub Actions passed on the deployed SHA. The production npm audit reported zero advisories.
- Hosted browser verification covered database-written workflow tasks and notifications, billing transitions, partial payments, PDF downloads, support, calendar, team goals, productivity, mobile layout and isolated attachments. Production passed synthetic no-invite admission with secure cookies, signed Python analytics on desktop and mobile, and a private Gemini conversation that persisted across reload.
- The exact `CLORIX_GEMINI_API_KEY` was verified in the local configuration and both engine projects. The approved `gemini-3.5-flash-lite` model returned genuine structured responses locally and on both hosted paths. The measured invocation took 2.072 seconds locally, 2.165 seconds on the staging engine and 3.121 seconds through the production browser. The production advanced analytics request measured 1.104 seconds. These are individual observed timings.
- The production sandbox denies Gemini. The approved private reviewer uses a fictional workspace and explicit consent. The production smoke fixture was cleaned up, and reviewer sign-in details remain in an ignored local file.
- External developer API credentials and outbound webhooks are deferred. Internal event history and task and notification delivery are verified. See the architecture, formulas and remaining limits in `docs/CLORIX_2_ENGINE.md` and `docs/KNOWN_LIMITATIONS.md`.

## Public sandbox accessibility fix — 2026-11-27 PKT

- Reproduced HTTP 429 with `quota` and a fixed 86,400-second Retry-After. Production had a full five-start network bucket, five of 90 global starts, and zero active workspaces. Vercel logs confirmed repeated sandbox 429s. Previous hosted runs could charge the same production allowance, and the retained logs lack per-start attribution.
- Raised the public network allowance to 12. Retained the 90-start global limit, 30 active slots, 24-hour expiry and 500-record workspace cap. Current production storage measured about 11.4 MiB. No production quota records were reset.
- Migration 014 adds a browser-keyed retry receipt and atomic sandbox admission. Reopens, retries and duplicate requests reuse the existing session. Network, global and capacity denials return distinct error codes and actual remaining durations. Hosted browser suites are restricted to staging.
- Captured and verified a fresh pre-migration recovery archive. Local PostgreSQL confirmed atomic quota and session behavior, revoked-session denial, isolated verified network identities and intact tenant boundaries.
- Verified the prior production smoke start in Vercel logs shortly before the repeated 429s. The public quota path included that test traffic. Retained logs cannot attribute every start, and distinct verified IPs had distinct buckets in regression testing.
- Passed 39 TypeScript unit checks, 19 database checks, four local browser journeys, three staging browser journeys and GitHub CI for the fix. Staging also returned an actual `sandbox_daily` HTTP 429 with 89 seconds remaining and displayed retry guidance. The production target is rejected by the automated hosted browser runner.
- Vercel confirmed the live frontend is READY on `e9fe610517891787984fee33072f846c3da1375c` with migration 014. A fresh production browser received HTTP 200 and created one workspace and receipt despite a double-click. Refresh and revisiting the sandbox opened the same workspace. The first positive smoke returned HTTP 200 before the verifier lost the response across navigation. The later test cleaned up its own workspace. The earlier untracked test workspace expires under the normal 24-hour policy. Safe verification evidence is in `artifacts/visual-qa/sandbox-access-production.json`.
