# Implementation sequence and checkpoints
1. Audit folder, lock stack, initialize actual app, baseline CI, tokens/brand, schema design and local isolated DB. Checkpoint foundation.
2. Auth/session, workspace membership, RLS bootstrap, migrations, quotas, safe sandbox provisioning/expiry and private sign-in. Integration tests before CRUD. Checkpoint access.
3. Leads/contacts/companies CRUD, validation and details, atomic conversion; DB tests. Checkpoint lifecycle.
4. Deals/stages/history, DnD + keyboard, tasks/activity, concurrency. Checkpoint pipeline.
5. Reporting/forecast and follow-up queue, global search, CSV import/export, settings/member invites. Checkpoint core features.
6. Premium landing and hybrid app visual refinement, mobile/accessibility and error states. Optional AI only if all core gates pass and policy/usage permit. Checkpoint UI.
7. Full local risk-based suite, performance benchmark, fix release blockers, docs/license audit. Checkpoint release candidate.
8. Dedicated free deployment and public clean GitHub publication, actual hosted tests and screenshots, final verdict. Record SHA and known limitations.

Every checkpoint: update PROGRESS.md; git commit scoped changes, record verified tests. Do not spend remaining usage polishing optional features before core. When interrupted use CONTINUE_PROMPT.md. Do not recreate working resources.
