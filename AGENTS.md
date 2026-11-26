# Instructions for coding agents
- Read MASTER_PROMPT.md, PROGRESS.md and relevant docs before edits; explicit latest user direction wins. Locked theme: Midnight Growth Hybrid, dark navigation, light main workspace. Do not make the app entirely dark.
- Inspect working tree; preserve user changes and unrelated files. One vertical slice at a time, minimal tool chatter. Keep recoverable commits and truthful checkpoints. Never undo unrelated work or force-push.
- Core functionality and security before optional AI and animations. Every exposed control has a real behavior; no hardcoded live KPIs. Keep business logic reusable, typed, validated and testable.
- Use only dedicated Clorix resources, free plan, no billing. Never print or commit secrets; use .env.example only. Never export private CRM content to external AI.
- Test actual Postgres and browser production build; CI uses isolated test DB and no live secrets. Hosted tests use disposable synthetic records; cleanup only owned test records. Do not fabricate results.
- Public sandbox must be isolated and constrained, not a shared writable guest workspace. Stop and report if safe access cannot be delivered. Avoid claiming enterprise readiness.
- Keep README, known limitations, migration notes and release evidence up to date. On pause update PROGRESS.md; resume from there.
