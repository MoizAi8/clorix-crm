# Product requirements
## Scope and personas
Personal non-commercial portfolio CRM for small sales teams/agency-style workflows using fictional data. Personas: evaluator (isolated sandbox owner), private workspace owner, member. The core experience must be practical with little onboarding. No billing, email delivery, third-party CRM integrations, scraping, enterprise SSO, mobile native app or multi-currency conversion in this release.

## Mandatory capabilities and acceptance
| Area | User behavior and done criteria |
|---|---|
| Marketing | Clear brand, animated hero, lifecycle narrative, real navigation/CTA to sandbox/sign-in; honest copy and responsive layout |
| Access | Sandbox without invitation; independent writable database tenant, bounded quota/expiry, seeded fictional data; private session sign-in/logout; secure configured account creation |
| Dashboard | Accurate open pipeline, active leads, closed-won value/count, win rate, overdue tasks and recent activity; filter date range; empty data handled |
| Leads | Create, view, update, search, filter by status/source/owner, archive; qualify, convert with one atomic operation; validation and duplicate handling |
| Contacts | CRUD/archive, linked company, phone/email optional, timeline, related deals/tasks; contact detail page |
| Companies | CRUD/archive, domain/industry optional, linked contacts and deals, summary |
| Deals | CRUD/archive, amounts and dates, associate contact/company, stage/owner, won/lost/reopen and history |
| Pipeline | Drag between stages, accessible move option, persist order/transition, clear status and totals, concurrent edit handling |
| Tasks | Create/edit, assign member, due date/priority/status, complete/reopen, overdue and today filters, follow-up view |
| Activities | Log calls, meetings, emails (log only), notes; timeline and entity links, timestamps, actor attribution |
| Reports | Closed-won trend, pipeline by stage, win rate, forecast, date range, safe CSV export; metrics computed from DB |
| Search | Ctrl/Cmd+K across permitted entity records; scoped search, keyboard navigation, safe empty results |
| CSV | Lead/contact import with preview/validation/duplicate policy and bounded batch; scoped export of leads/contacts/deals |
| Settings | Profile, workspace name/time zone/currency, membership list, owner-only invite/role management, session logout; no fake email recovery |
| Quality | Real browser journeys, genuine persistence, access isolation, mobile/tablet, no unresolved high severity bugs |

## Optional after core
Real Gemini sample lab (strict AI policy), custom stage editing, saved filters, richer charts, email recovery, in-app reminders beyond due list. Do not surface optional unfinished links. Team invite is a generated link/code copied manually, not an email service. Avoid pricing pages or claims about real business outcomes.

## Success
A first-time evaluator starts sandbox, sees clearly labeled synthetic records, creates lead, qualifies/converts, moves deal, marks won, logs activity, completes task, sees correct metrics, reloads and data persists. A second evaluator cannot see first's changes. User can sign in to permitted private evaluation account and see its own records. No core workflows depend on AI.
