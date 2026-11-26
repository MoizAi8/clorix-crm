# Logical PostgreSQL data model
Use UUID PK, timestamptz UTC, created_at/updated_at, workspace_id NOT NULL on tenant entities; compound UNIQUE(workspace_id,id) and composite FKs to prevent cross-tenant references. Use explicit foreign key delete actions; prefer archive for historical business records. All currency values integer minor units (bigint/numeric exact) and serialized as strings, never floating JS math. One workspace currency (USD default); once deals exist currency immutable for MVP. Workspace time zone IANA. Enforce constraints in DB + service. Actual migration/schema files produced by Codex.

| Table | Fields / rules |
|---|---|
| users/sessions/accounts/verification | library schema; session expiry/revocation; no plaintext credentials |
| workspaces | id, name, currency, timezone, kind(private/sandbox), expires_at nullable, created_by; version; sandbox expiry required |
| memberships | workspace_id,user_id,role(owner/member), unique pair, status; preserve last owner |
| invites | workspace_id, token_hash unique, intended_email optional, role, expires_at, used_at, revoked_at, created_by |
| companies | name required, normalized domain optional, industry, website, notes optional, archived_at, version |
| contacts | name, normalized email optional, phone optional, company_id nullable, title, owner_member_id, archived_at, version |
| leads | name, email/phone optional, source, status(new/contacted/qualified/disqualified/converted), company_name optional, owner_member_id, converted_contact_id/deal_id nullable, archived_at, version |
| pipeline_stages | name, kind(open/won/lost), sort_order, default probability 0–100; default stages seeded once per workspace |
| deals | title, stage_id, company_id/contact_id/lead_id optional, owner_member_id, amount_minor nonnegative, expected_close_date, actual_closed_at nullable, lost_reason nullable, rank, archived_at, version |
| deal_stage_events | deal_id, from_stage_id, to_stage_id, actor_member_id, event_at, from/to status snapshot, amount snapshot; append-only |
| tasks | title, description optional, owner_member_id, due_at, priority, status, completed_at, related record (validated FK fields), archived_at, version |
| activities | kind(call/meeting/email/note/system), summary, occurred_at, actor_member_id, linked lead/contact/company/deal/task nullable as explicit composite FKs; append-only system events |
| idempotency_keys | workspace_id, operation, key_hash, request_hash, result_ref, expires_at; unique scoped key |
| quotas/rate_limits | scope_hash, window, count, expires_at; atomic upsert; no raw IP |
| audit_events | workspace_id, actor, event_type, resource_type/id, metadata safe no raw content; append-only |

Indexes: workspace+archived/status, workspace+updated_at/id, workspace+owner/status, workspace+stage/rank, workspace+closed_at, workspace+task due/status, workspace+activity occurred_at, normalized email/domain per workspace as nonunique lookup unless product policy defines unique; indexed search where useful. Partial indexes for active records, unique lead conversion constraint/idempotency. Explicit max text lengths and check constraints. Use nullable relationship IDs only when valid; no polymorphic unvalidated IDs. Preserve audit and stage events on archive. Tenant tables forced RLS; auth/rate-limit exceptions documented and narrowly privileged. Test direct SQL isolation with runtime role and composite FKs.

Seed synthetic dataset per sandbox (e.g. 8 companies, 12 contacts, 12 leads, 10 deals, 8 tasks with coherent dates, amounts and stages). Use deterministic relative dates and totals; no real contact info; `.example` domain. Do not insert real prospect lists. Data lifecycle: archive individual records, safe delete draft records only if no dependencies; workspace deletion/expiration via scoped transactional cleanup, cascades verified in tests.
