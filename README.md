# Clorix

**From lead to loyalty.**

Clorix is a full-stack CRM for personal, non-commercial evaluation with fictional data. It uses the Midnight Growth Hybrid theme, with a Midnight Navy sidebar and a Soft White workspace.

- [Open Clorix](https://clorix-crm.vercel.app/)
- [Try the live sandbox](https://clorix-crm.vercel.app/sandbox)
- [Sign in with a private evaluation account](https://clorix-crm.vercel.app/sign-in)

## What you can do

- Capture, qualify, archive and convert leads into linked contacts, companies and deals.
- Move deals through the six-stage pipeline with drag and drop or the keyboard-accessible move menu. Review history, close a deal as won or lost, and reopen it.
- Manage tasks and log calls, meetings, emails and notes. The follow-up queue orders work using due dates and recorded activity.
- Filter exact PostgreSQL reports by date range, search with Ctrl/Cmd + K, preview lead and contact CSV imports, and export scoped records as a workspace owner.
- Start an isolated sandbox from the landing page without an account invitation. The 24-hour sandbox has fictional seed data, database persistence and usage limits. Private evaluation accounts use one-time account invitations and can join teams through scoped invitations.

## Local setup

Use Node.js 24, npm, and an isolated PostgreSQL 17 or 18 database. Runtime access uses a dedicated non-owner login. Production uses Next.js App Router, React, Better Auth database sessions, Zod and parameterized SQL through node-postgres. The lockfile records exact versions. SQL migrations keep PostgreSQL policies and constraints explicit.

1. Run `npm ci`.
2. Copy `.env.example` to `.env.local` and set the dedicated connections and distinct secrets. Create the `clorix_runtime` login with `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`. Use a unique password.
3. Run `npm run db:migrate` with the direct owner connection and `npm run db:admin -- grant` to grant the runtime role. Use the restricted connection in the app.
4. Run `npm run dev` and open http://localhost:3000. Use that exact origin for browser mutations.

For a private account invite, an operator runs `npm run db:admin -- invite evaluator@clorix.example "Evaluation workspace"`. The command saves a one-time link under the ignored `artifacts/private/` directory. Copy the link privately. Account registration is invite-only. A team link is accepted by an existing private account after sign-in.

## Verification

Run `npm run lint`, `npm run typecheck`, and `npm test`. Integration tests use `npm run test:db` with a dedicated `clorix_test` database, with `TEST_DATABASE_URL` equal to its restricted runtime connection. Use `npm run build` and `npm start` before running `npm run test:e2e`. That command runs Chrome locally and provisions disposable synthetic test data. CI uses Chromium and an ephemeral PostgreSQL service.

See [Progress](PROGRESS.md), [release gates](docs/RELEASE_CHECKLIST.md), [limitations](docs/KNOWN_LIMITATIONS.md), and [evidence](artifacts/visual-qa/). Production configuration and operator commands are in [deployment](docs/DEPLOYMENT.md).

The source uses Next.js/React/Better Auth/Zod/CSV Parse (MIT), node-postgres (MIT), Lucide (ISC), and Inter/Manrope (SIL Open Font License 1.1). Dependency package notices govern those assets and packages. No license has been selected for the Clorix source.
