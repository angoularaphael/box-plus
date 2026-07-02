# Boxing Center Boutique — Design Language & Veille Artistique

> Working doc for the frontend refonte. Governs every visual/motion decision.
> Frontend-only: we touch `storefront/public/**` (+ this doc). Backend is off-limits.
> Source of truth order: **Cahier des charges** (governing) → **bc-design brand law** → this synthesis.

---

## 0. Mission & guardrails

Build a boutique that is **world-class in craft** (motion, depth, polish — GSAP/scroll-grade)
but **restrained in service of conversion** (clear, fast, reassuring). The Cahier des charges is
explicit: *don't overload, reduce choice, reassure beginners, convert.* So we borrow the **craft**
of the award canon, never its excess.

**Three tests every screen must pass** (from bc-design):
1. **Billboard test** — message readable in 2 seconds.
2. **Scroll test** — would someone stop scrolling for this?
3. **Permission test** ⭐ — *would a woman who has never boxed feel this is for her?* If it reads
   intimidating/aggressive/exclusive, it fails. This is the same mandate as the Cahier des charges
   reassurance brief — it is our **north star**.

**Hard limits from the Cahier des charges:** homepage shows **max 3 featured offers**; pre-payment
form stays short; mobile-first + fast; RGPD consent; base SEO + conversion tracking. Navy / light-gray
/ white base, with a turquoise-or-light-blue **action accent** (explicitly permitted in §3.1).

---

## 1. Reference study — the award canon → what we steal (technique, not pixels)

Mirrors live in `../../../Portet/scrapers/output/`. We extract **techniques** and rebuild them
original; we never lift proprietary CSS/markup or their assets. Per-site takeaway → boutique use:

| Reference | Signature technique | How we apply it (tastefully) |
|---|---|---|
| **stripe.com** | Fluid gradient canvas, crisp product clarity, generous whitespace | Hero gradient depth behind real gym video; ruthless clarity on offer cards |
| **linear.app** | Precise micro-motion, gradient glows, perfect type rhythm | Reveal timing, focus states, the overall "expensive calm" |
| **vercel.com** | Restrained but flawless motion design, mono labels | Section transitions, mono kicker labels, dark CTA bands |
| **framer.com** | Delightful entrance choreography, springy ease | Staggered card/line reveals on scroll |
| **apple.com** | Cinematic scroll-scrubbed product reveals | Scroll-scrubbed gym clip in one signature section only |
| **zentry.com** (SOTM) | GSAP+Lenis, bento grid, clip-path reveals, pinned horizontal | Disciplines as a pinned horizontal reel; bento "salles" grid |
| **igloo.inc / noomo** (SOTY) | 3D depth, buttery parallax | Multi-depth parallax (subtle), layered hero |
| **lusion.co / resn** | Animation-first, magnetic interactions | Magnetic CTAs, cursor-aware imagery (desktop, fine-pointer only) |
| **merci-michel / unit9** | Playful reveals, marquee energy | A single discipline marquee; warm playful copy |
| **activetheory / bruno-simon** | Full WebGL worlds | *Inspiration only* — too heavy for a conversion shop; we fake depth with CSS/video |

**Verdict:** the canon's value for us = **smooth scroll, scroll-triggered reveals, multi-depth
parallax, pinned horizontal section, scroll-scrubbed video, magnetic/cursor micro-interactions,
count-up stats, marquee** — all of which the sibling Boxing Center site already implements (below)
and which we reimplement in dependency-light vanilla JS.

---

## 2. The sibling Boxing Center site — our richest, most-relevant source

`../../../Portet/site/` is a previous **same-brand** build (Vite + Lenis + GSAP + Three.js). We can't
port its TS/build, but we mine its **patterns, tokens, and real assets**.

**Motion patterns to reimplement in vanilla** (`src/scroll.ts`, `src/fx.ts`):
- Smooth scroll (Lenis) + `ScrollTrigger.update` loop; **falls back cleanly on `prefers-reduced-motion`**.
- Line/element reveals via **IntersectionObserver + CSS class** (they found GSAP `yPercent` unreliable —
  we hide reveal state with **opacity in CSS** and animate transform separately; see preview gotcha §6).
- `[data-reveal]` / `[data-reveal-group]` staggered fade-up; `[data-count]` count-up stats.
- rAF-throttled multi-depth parallax (never on the same node that also reveals).
- Media reveal: grayscale → color on enter. Ambient `<video>` plays **only while on-screen** (perf/battery).
- Pinned **horizontal disciplines reel** (vertical scroll drives a horizontal track).
- **Scroll-scrubbed** footage (Apple/Zentry technique) for one cinematic moment.
- Sticky nav hide-on-scroll-down/show-on-up; marquee; magnetic buttons; custom cursor (fine-pointer only).

**Reusable token values** (`src/styles/tokens.css`):
- Easings: `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` (expo-out, for reveals), `--ease-io: cubic-bezier(0.65,0,0.35,1)`.
- Timing: `--t-fast .25s`, `--t-med .5s`, `--t-slow .9s`. Section rhythm: `clamp(90px, 12vw, 180px)`.

---

## 3. Brand system (bc-design = THE LAW) + boutique synthesis

**Official palette** (canonical — corrects the current storefront):
```
Navy (official)  #20254B   logo fill / primary dark        (storefront had #0B1F3A → migrate)
Navy Deep        #0C1829   deep background sections
Bronze           #6D3111   logo contour accent only
Black            #080808   strong backgrounds / footer
White            #F5F5F5   primary text on dark / cards
Gray             #AAAAAA   secondary text
Red ENERGY       #E8001C   THE energy color — sparingly; never in logo
```
**Logo = a FILE, never re-typed, never recolored.** Use `BC_Logo_Officiel_Transparent.png` (dark bg)
/ `_FondBlanc.png` (light bg). The current header re-types "BOXING CENTER" + inverts an SVG → replace.

**Typography (brand voice):** Display = **Barlow Condensed / Bebas Neue** (uppercase, tight, slight
forward italic for momentum). Body = **Montserrat**. Labels = **IBM Plex Mono**. (Storefront uses Plus
Jakarta Sans → migrate display+body to the athletic voice; keep it readable per Permission test.)

**Boutique palette decision (synthesis of both authorities):**
- **Base:** official **navy #20254B** + **light gray #F4F5F7** + **white** cards → the reassuring,
  premium, readable boutique the Cahier des charges asks for. *Light/airy, not the dark arena DA.*
- **Primary action accent:** **turquoise `#2EC4C6`** (Cahier des charges §3.1 explicitly allows it; it
  reads calm/accessible → passes the Permission test for CTAs like "Je m'inscris").
- **Energy accent:** **red #E8001C**, *used sparingly* (promo badges, urgency, "offre" flags) — honors
  the brand law's energy color without making the shop aggressive.
- ⚠️ **Open decision for the client:** turquoise-led (calm, current) vs red-led (brand-law energy) vs the
  hybrid above. Recommended = **hybrid** (turquoise CTAs + red for promos). Easy to reweight via tokens.

---

## 4. Asset map — real Boxing Center material we build with

All real, same-brand, web-ready. Stage copies under `storefront/public/img/bc/`, `…/video/`, `…/coaches/`.

| Need | Asset (source `Portet/site/public/…` unless noted) | Where it goes |
|---|---|---|
| Logo | `00_MARQUE/BC_Logo_Officiel_{Transparent,FondBlanc}.png` | Header, footer, OG image |
| Hero video | `media/clip-ring.mp4`, `clip-entrance.mp4`, `clip-bags.mp4` | Homepage hero bg (muted, on-screen only) |
| Ambient video | `media/clip-{cross,mats,floor,exterior,rings}.mp4` | Section backgrounds / scrub section |
| Disciplines | `img/disc/{boxe-anglaise,muay-thai,kick,mma,cross,educative,lady,boxing-training,showcase-ring}.webp` | Disciplines reel, offer context |
| Coaches | `img/coaches/*.webp` + `cutouts/*.png` (7 real coaches) | "Encadrement" reassurance, coachings page |
| Gym interiors | `img/gym-01…25.jpg`, `portet-exterior.jpg` | 5-salles grid, reassurance, parallax bands |
| Photo catalog | `skills/bc-photos` BC-001…020 (BC-012 child ⭐, BC-013 women ⭐, BC-015 fireworks ⭐) | Pick by emotional value; women/kids = Permission test |

**Real-photo rule:** never replace these with AI. Inclusive photos (BC-013 women sparring, BC-012 child)
carry the Permission test — feature them prominently.

---

## 5. Page-by-page elevation plan (priority order)

P1 (Priorité 1 in the Cahier des charges):
1. **Design foundation** — tokens (official palette + easings + rhythm), athletic type, SVG icon set,
   vanilla **motion engine** (`js/motion.js`: reveals, parallax, magnetic, count-up, ambient video,
   reduced-motion gate), self-hosted GSAP/Lenis *only if* a moment needs it.
2. **Homepage** (flagship): cinematic real-video hero → 3 featured offers (premium cards) → reassurance
   (real coaches/gym, count-ups) → "Quel abonnement choisir?" decision helper → disciplines reel →
   témoignages → 5 salles → final CTA.
3. **Abonnements** (comptant / prélèvement / enfants) + premium comparable offer cards.
4. **Séance d'essai**, **Coachings**, **Matériel**.
5. **Tunnel** (short form → payment → full Deciplus form → signature → confirmation) — elevate UX only.

P2: témoignages/vidéos, full FAQ, salles spotlight. P3: matériel enrichi.

---

## 6. Build approach — performance, SEO, a11y, frontend-security

- **No build step.** Stay vanilla (HTML/CSS/JS) served by Express, matching the repo. Any library
  (GSAP/Lenis) is **self-hosted/vendored** under `public/js/vendor/` — no third-party CDN
  (supply-chain + CSP friendly). Frontend-security: no inline secrets, sanitized DOM injection
  (existing `esc()`), `rel="noopener"`, CSP-compatible assets.
- **Performance:** `<video>` `preload="none"` + play-on-visible; `loading="lazy"` + `width/height` on
  imagery; prefer `.webp`; system-font fallback while web fonts load; keep JS tiny.
- **Motion discipline:** everything gated on `prefers-reduced-motion`; desktop-only cursor/magnetic via
  `(pointer: fine)`; 60fps (transform/opacity only, rAF-throttled).
- **SEO (currently thin):** per-page `<title>`/meta, Open Graph + Twitter card, **JSON-LD**
  (Organization, Product/Offer, FAQPage, LocalBusiness × 5 salles), canonical, `sitemap.xml` (exists).
- **A11y:** semantic landmarks, focus-visible, color-contrast on navy/turquoise, alt text on real photos,
  keyboard-operable accordions/tabs.

### Preview/verify gotchas (from prior sessions)
- `preview_screenshot` **times out** on rAF/ticker-heavy pages — verify with `preview_console_logs`
  (clean) + `preview_snapshot` (content) + **read-only** `preview_eval`. Don't mutate GSAP via eval.
- GSAP + CSS `transform: %` conflict → keep reveal hidden-state in **opacity** (CSS), let JS own transform.
