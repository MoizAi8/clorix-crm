# Clorix — From lead to loyalty.
**Approved pre-development kit | 26 November 2026 | Midnight Growth Hybrid**

This is a specification and starter directory, not an implemented application. No packages, database, GitHub repo or deployment have been provisioned by this kit.

1. Extract the entire ZIP to a dedicated folder, e.g. `C:\Users\DC\clorix-crm`. Open the folder (not an individual document) in Codex.
2. Start a fresh Codex project/chat. Use the kickoff prompt in `KICKOFF_PROMPT.md`; it points to `MASTER_PROMPT.md` and all authoritative docs. No need to paste every file.
3. Codex should inspect existing files, initialize the actual app in this folder, set up local development and create a checkpoint. Never overwrite this kit or unrelated projects.
4. When credentials are needed, create dedicated `clorix-db` and `clorix-crm` Vercel project on existing authenticated accounts, if allowed. User manually enters secrets in `.env.local` or secure platform UI. See `docs/DEPLOYMENT.md`.
5. If interrupted by usage, use `CONTINUE_PROMPT.md` in the same project. Never restart or duplicate the database.
6. Only mark release complete after real local and hosted user journeys pass. A public landing page alone is not completion.

Priority: working core CRM, premium but restrained UI, secure actual persistence, easy evaluation, maintainable code. Do not spend scarce usage on enterprise extras. Reserve remaining model usage for the personal portfolio project.
