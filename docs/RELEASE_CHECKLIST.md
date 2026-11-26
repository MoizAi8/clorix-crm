# Portfolio release gate

**GO for fictional-data portfolio evaluation.** Vercel production is running commit [528b097](https://github.com/MoizAi8/clorix-crm/commit/528b097ad965c8a61cef2e5b65a497ca94497946). The [GitHub Actions run](https://github.com/MoizAi8/clorix-crm/actions/runs/45857389951) passed on that commit.

| Gate | Outcome | Evidence |
|---|---|---|
| Landing, branding, links and responsive hybrid workspace | Pass | Production landing links, approved tokens, and desktop/mobile screenshots |
| No-invite writable sandbox, expiry and durable limits | Pass | Two independent hosted browser contexts, real writes, reload, synthetic notice, and PostgreSQL quota/expiry tests |
| Private account creation and sign-in | Pass | One-time registration, hosted sign-out and sign-in persistence, and team invitation tests |
| Lead qualification and conversion | Pass | Hosted lead-to-deal flow and concurrent idempotent PostgreSQL conversion |
| Customer records and relationships | Pass | Hosted contact detail and PostgreSQL related records, archive and scoped relationship checks |
| Pipeline moves and history | Pass | Hosted drag-and-drop and keyboard move, PostgreSQL version races, lost reason, reopen and stage history |
| Tasks and activities | Pass | Hosted linked task completion and manual activity, PostgreSQL due-list, archive and reopen |
| Exact reports and date ranges | Pass | Hosted won-value delta, PostgreSQL date and reopen checks, SQL integer minor units and empty result handling |
| Search, CSV and settings | Pass | Hosted search, preview, confirmed import and export. PostgreSQL stale preview, duplicate skip, spreadsheet escaping, owner-only actions and session revocation |
| Tenant isolation and session protection | Pass | PostgreSQL cross-tenant read/write denial, pool reset, forced RLS and foreign-key scoping. Hosted HttpOnly, Secure and SameSite cookies |
| Migration rollout and isolated cleanup | Pass | Six migrations verified locally and on Neon. No-context pooled verification and bounded expiry tests. Browser fixtures removed using their owned IDs |
| Local, CI and hosted suites | Pass | 39 unit tests, 15 PostgreSQL tests, 3 local production-browser tests and 2 hosted browser journeys. GitHub Actions independently passed |
| Visual, responsive and keyboard QA | Pass | Five viewport widths, reduced motion, axe scans on landing and dashboard, and hosted desktop/mobile images |
| Performance | Pass | 50 authenticated search samples and 50 dashboard samples on isolated synthetic data, plus mobile-emulated landing timing |
| Dedicated free-tier release | Pass | Public personal GitHub source, Vercel Hobby and Neon Free. Deployment metadata matched the published source SHA |
| Setup, access instructions, limitations and license status | Pass | README, deployment instructions, known limitations and this evidence record |

[Open the live sandbox](https://clorix-crm.vercel.app/sandbox) · [Verification artifacts](../artifacts/visual-qa/) · [Known limitations](KNOWN_LIMITATIONS.md)
