# Locked design — Midnight Growth Hybrid
Name: **Clorix** (wordmark with optional dot as visual punctuation, product name Clorix). Tagline: **From lead to loyalty.**

The user explicitly revised the dashboard: keep dark navigation workspace/sidebar; make insights, performance, records, tables and forms predominantly white/light. Use white in landing feature sections too. `design/hybrid-dashboard.svg` and `design/tokens.css` are the authoritative layout and palette. The local `design/references/initial-concept.png` is landing inspiration only. The obsolete dashboard PNG was removed. No fake logos, demo metric claims or fake testimonials from reference images.

## Tokens
| Token | Hex | Use |
|---|---|---|
| navy | #0B1220 | marketing hero, ink, dark shell |
| sidebar | #111A2E | fixed desktop navigation |
| forest | #12352B | one key KPI, occasional section, primary text alternative |
| lime | #C7FF4D | primary CTA with navy text, active nav, small highlights |
| mint | #8FE8C8 | secondary fill, chart highlight |
| green-ink | #205B49 | text/chart lines on light backgrounds |
| white | #FFFFFF | cards, forms, tables, header |
| canvas | #F5F8F7 | app content background |
| mint-wash | #EAF8F0 | soft supportive surface |
| border | #DCE5E0 | light dividers |
| dark-border | #22314A | dark dividers |
| dark-muted | #9FB0C7 | text on navy |
| light-muted | #53665E | secondary text on white |
| danger | #A32130 | errors, destructive actions |
| warning | #8A5200 | warning text with pale amber fill |

Use CSS variables from `design/tokens.css`; implement semantic tokens and dark/marketing scope. Lime never as small text on white. Mint on white needs dark labels; use forest stroke for readable chart lines. Check actual contrast (WCAG AA target), focus rings, text and icon labels. Status not conveyed by color alone. Default light workspace; no optional dark toggle unless fully themed/tested.

## Typography and layout
Manrope headings, Inter UI; use licensed self-hosted or framework font assets if build access permits, system fallback. 16px body, 14px table, 12px meta minimum where appropriate; tabular numerals. H1 landing 56–80 desktop responsive, 36–44 mobile; app title 24–30. 4/8px spacing system, 12px card radii, 8px controls, subtle shadows. Desktop sidebar ~240px, topbar 64px, content 24–32px padding; compact collapsible navigation tablet, accessible drawer mobile. Max marketing width ~1280px. Data tables responsive, horizontal scrolling within container, mobile card view for essentials. App never horizontal scrolls globally. Use standard icons (Lucide). No glass overload or neon shadows inside work area.

## Screen contracts
Dashboard: date filter, one forest KPI + white cards, white chart/report cards, mint due-task panel; no invented metrics. Leads/contacts/companies/deals: toolbar, search/filter, responsive rows and empty state, details drawer or route, CRUD forms. Pipeline: light neutral columns with white cards, colored stage headers and accessible menu. Tasks: list with due/priority and checkbox, filters. Reports: readable chart, accessible table and date filters. Settings and auth: white form with dark branding; errors near controls. Sidebar includes only implemented links. Global search dialog, mobile nav, confirmation dialog and consistent toasts.

## Motion
Landing expressive (see LANDING_ANIMATIONS). App 120–220ms subtle transitions, 44px touch targets where practical, reduced-motion mode; never delay data operations for decoration. Use actual browser screenshots to verify desktop/mobile. Use brand SVGs, not raster screenshot as functional UI.
