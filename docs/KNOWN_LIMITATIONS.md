# Clorix evaluation scope

- Personal, non-commercial use with fictional records. The public sandbox expires after 24 hours. Anonymous sessions cannot be recovered after cookie loss or logout. Free providers can throttle or cold-start.
- Account registration uses an operator-issued email-scoped invitation. Team links require an existing private Clorix account. Email delivery and password recovery are outside this release.
- One fixed currency per workspace after the first deal. Booked deal value, invoiced amounts and recorded collections are separate measures. Historical customer health replay is unavailable. Activity logs are append-only.
- Follow-up, risk and forecasting use deterministic rules. The Gemini lab requires a private reviewer approval, an eligible region and explicit consent for fixed fictional examples. Editable CRM records stay inside Clorix.
- Workspace owners run workflow evaluation on demand. Tasks and notifications are delivered inside Clorix. Email templates create drafts for manual use. Payments are recorded manually. Billing PDFs use standard Latin fonts.
- Private attachments allow PDF, PNG, JPEG and UTF-8 text up to 256 KB per file and 2 MB per workspace. Public sandbox uploads are disabled. Audit logs record actions and resource identifiers for workspace owners.
- Commercial search ranks exact, prefix and substring matches. Report drill-down is available for lead source, deal stage, booked month, invoice status and support status. Developer credentials, external webhook delivery, FX, and native mobile apps are deferred.
- Authentication uses Better Auth's PostgreSQL adapter. Its auth tables have separate runtime grants because the adapter validates sessions before tenant context is established. CRM tables enforce membership and tenant scope with forced RLS. The app relies on parameterized server-owned queries and protecting the runtime connection.
- The pipeline displays up to 1,000 deals and the relationship picker up to 1,000 active records per type. Lists use cursor pagination. Bulk CSV limits and sandbox record limits are documented separately.
- No trademark clearance or Clorix source license approval has been recorded. Passing the portfolio checks does not establish commercial or enterprise readiness.
