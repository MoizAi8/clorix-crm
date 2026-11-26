# Clorix evaluation scope

- Personal, non-commercial use with fictional records. The public sandbox expires after 24 hours. Anonymous sessions cannot be recovered after cookie loss or logout. Free providers can throttle or cold-start.
- Account registration uses an operator-issued email-scoped invitation. Team links require an existing private Clorix account. Email delivery and password recovery are outside this release.
- One fixed currency per workspace after the first deal. Reports describe current deal state, not accounting revenue or point-in-time history. Activity logs are append-only.
- Follow-up and forecasts use deterministic rules. The optional Gemini sample lab, custom stages, external sending, FX, billing, integrations, advanced automation, and native mobile apps are outside this release.
- Authentication uses Better Auth's PostgreSQL adapter. Its auth tables have separate runtime grants because the adapter validates sessions before tenant context is established. CRM tables enforce membership and tenant scope with forced RLS. The app relies on parameterized server-owned queries and protecting the runtime connection.
- The pipeline displays up to 1,000 deals and the relationship picker up to 1,000 active records per type. Lists use cursor pagination. Bulk CSV limits and sandbox record limits are documented separately.
- No trademark clearance or Clorix source license approval has been recorded. Passing the portfolio checks does not establish commercial or enterprise readiness.
