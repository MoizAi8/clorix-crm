# Portfolio release gate — all mandatory
Record PASS/FAIL/NOT RUN + evidence path or command and deployed SHA. No pass before testing. Optional AI/enterprise features are not mandatory and must be hidden or documented if absent.

- [ ] Landing and branding approved: dark cinematic hero, alternating light sections, white workspace/dark sidebar; all CTA/links work; no fake claims.
- [ ] Public no-invite sandbox creates isolated real DB workspace with labeled data, caps/TTL and safe recovery/error; two sessions independent; refresh persists.
- [ ] Private login/logout and configured account creation work; team invite/roles authorized in private workspace; last owner protected.
- [ ] Lead create/edit/filter/qualify/convert; repeat conversion idempotent; related contact/company/deal persist.
- [ ] Contact/company create/edit/archive and details/links work; scoped relationship validation.
- [ ] Deal create/edit/move via DnD and keyboard menu; won/lost/reopen, version conflict and history consistent.
- [ ] Tasks create/complete/reopen, overdue list and manual activity timeline persist.
- [ ] Dashboard/report actual exact totals, date filters, empty states, forecast, zero denominator and archive/reopen rules.
- [ ] Global search keyboard access and authorized results; CSV preview/commit/errors/duplicate policy/export safe.
- [ ] Settings/role actions function; no unsupported password reset or external sending UI.
- [ ] Auth/session/CSRF/validation/rate limits verified; runtime nonowner RLS and no cross-tenant data or export; secrets absent.
- [ ] Database migrations and test isolation verified; sandbox expiration cleanup tested; no unexpected destructive operations.
- [ ] Production build, unit, real integration, browser suites pass; actual counts and failures recorded; no critical/high core blocker.
- [ ] Mobile/desktop/tablet, keyboard, reduced motion, accessibility and visual QA completed; screenshots sanitized.
- [ ] Search/report benchmark measured and bottlenecks documented; no unsupported performance claims.
- [ ] Dedicated free resources only; current provider terms checked; public repo clean, license status clear; hosted deployed SHA and fresh acceptance recorded.
- [ ] README has real setup, access instructions, features, limitations, evidence, live URL; no private invite or credentials.

Verdict GO = all mandatory gates pass for non-commercial synthetic portfolio evaluation. NO-GO = any gate fails or is unverified. Commercial/enterprise readiness separate. Report optional items as deferred, not failed core features.
