# Proposed HTTP contract
Use `/api/v1` route handlers or equivalent typed server actions for app-only calls; preserve semantics and document actual routes. All private responses no-store. JSON success `{data,meta?}`; error `{error:{code,message,fields?,requestId}}`; never raw SQL or secrets. HTTP 400/422 validation, 401 unauthenticated, 403 role denial, 404 inaccessible object (avoid enumeration), 409 stale version/duplicate conflict, 429 quota with Retry-After, 503 dependency unavailable. Auth library endpoints separate. Use same service for RSC and API. Workspace context path/header selected by server-verified membership; never trust body workspace_id.

| Method + path relative to /api/v1 | Contract |
|---|---|
| POST /sandbox | explicit creation/reuse, rate-limited, returns session/workspace via supported auth flow |
| GET /workspaces; PATCH /workspaces/:id | scoped membership list; owner settings with version |
| GET /members; POST /invites; POST /invites/accept; DELETE /invites/:id; PATCH /members/:id | scoped owner actions/acceptance, hashed expiring token, role checks |
| GET/POST /leads; GET/PATCH/DELETE /leads/:id | list/create/detail/update/archive, status/owner/source filters |
| POST /leads/:id/convert | version + idempotency key + selected contact/company/new deal, transactional result |
| GET/POST /contacts; GET/PATCH/DELETE /contacts/:id | scoped CRUD/archive |
| GET/POST /companies; GET/PATCH/DELETE /companies/:id | scoped CRUD/archive |
| GET/POST /deals; GET/PATCH/DELETE /deals/:id | amount_minor string, stage, relationships, version |
| GET /pipeline; POST /deals/:id/move | targetStageId, before/after optional, expectedVersion, reason for lost; returns stage/version and refreshed totals |
| GET/POST /tasks; GET/PATCH/DELETE /tasks/:id | filters; completion/reopen with version |
| GET/POST /activities; GET /activities/:id | scoped timeline/log, system events read-only |
| GET /dashboard; GET /reports | date range and timezone validated; same metric contract |
| GET /search?q= | trimmed 2–100 chars; bounded per-type results and stable tie-break |
| POST /imports/preview; POST /imports/commit | CSV multipart bounded; preview errors, duplicate choices, checksum/token, commit idempotent |
| GET /exports/:entity | role scoped CSV with filters, safe cell handling, capped rows |
| GET /health | minimal service status, no internal DB names or credentials |
| POST /ai/sample-insight | optional, fixed sample ID only; eligibility and quota enforced |

List parameters q/status/owner/source/sort/cursor/limit (default 25, max 100). Allowlist sorts and filters, parameterized query, deterministic cursor by sort+id. Mutations reject unknown sensitive fields, require expectedVersion where concurrent updates possible. Use idempotency key for conversion/import/provisioning; compare request hash. Strict Zod schemas, body size caps, safe error states and audit. Document sample requests with fictional data in README after implementation.

## Implemented routes

The deployed app uses the tenant-scoped routes above with these concrete shapes.

- Account actions use POST /access/sandbox, /access/login, /access/register and /access/logout. Session cookies come from Better Auth. The public sandbox accepts a synthetic-data acknowledgement and reuses an active session.
- GET /workspaces returns the caller’s memberships. GET/PATCH /settings reads or updates the selected workspace. PATCH /profile updates the caller’s name. GET /options and GET /stages supply scoped record selectors.
- Use the optional X-Clorix-Workspace header to select an active membership. List pagination uses the after identifier from response metadata. Sort options are recent, oldest and name. DELETE archives business records, POST /:entity/:id/restore restores them and DELETE /leads/:id/purge is restricted to archived, unlinked new leads.
- Import endpoints accept JSON with entity, duplicate policy and bounded CSV text. Commit adds the signed preview token and request UUID. Export accepts the same scoped filters as the matching list.
- Dates on reports are workspace-local and include both entered dates. The end of the final date is represented as the next local midnight. Mutation field names are snake_case, including expected_version and amount_minor.
