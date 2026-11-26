# Landing page art direction
Combine Concept A cinematic hero, B restrained typography, C sales-journey storytelling. Dark-to-light alternation. Original composition, not a clone.

1. Header: geometric C logo, Product/Features/How it works anchor links, Sign in, Try live sandbox. Mobile accessible menu. Header remains useful without JS animations.
2. Hero (navy): "From lead to loyalty." headline and clear one-sentence product description. Perspective dashboard frame built from HTML/CSS/SVG showing clearly labeled illustrative data; moving mint orbital ribbons, small floating deal notification, lime CTA. Entry sequence ~0.8–1.2s; no blocking splash screen. Product frame static fallback on low power/reduced motion. Second CTA scrolls to product walkthrough.
3. Journey (white): scroll progress across Capture → Qualify → Close → Retain. Reveal cards and connecting line using GSAP ScrollTrigger or simple observer; meaningful text visible without animation, no scroll hijack. Demonstrate same states as app.
4. Features (white/light): asymmetric bento grid for contacts/companies, Kanban, tasks, reporting, search, CSV. Use small live-style CSS visualizations with illustrative labels. Hover/focus transitions subtle.
5. Product deep dive (forest/navy): pinned-looking but non-blocking dashboard sequence; tabs switch actual illustrated features, keyboard accessible; no fake CTA. On mobile stack cards.
6. Intelligence (white): real rules-based follow-up prioritization, reporting formulas; only describe optional AI if deployed and eligible. Use no claims of customer growth percentages.
7. Use cases (mint wash): agencies, small teams, startup sales as intended use cases, not existing customers. FAQ clarifies sandbox expiry, synthetic data, free plan and limitations.
8. Closing (navy): tagline and real sandbox CTA; footer legal/privacy/accessibility links and verified repo link after release.

Use GSAP only for orchestrated marketing sequences, Motion for small interactive transitions if needed; avoid double animating same element. Prefer transform/opacity; lazy-load nonessential motion, no required heavy WebGL/video assets. Use `prefers-reduced-motion`, resize-safe cleanup, no layout shifts, keyboard navigation. Measure actual LCP and layout stability; target LCP <2.5s on representative warm profile, CLS <0.1, no claims without measurement. Check 375/390/768/1280/1440 widths. No raster mockup as app or fake testimonial section.
