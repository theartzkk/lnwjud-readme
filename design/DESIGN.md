---
version: "alpha"
name: "KRUART / Art’s Workspace Hub"
description: "Golden visual and interaction contract for the KRUART / BAY ecosystem."
colors:
  primary: "#0B3D91"
  action: "#176DE5"
  accent: "#FF7A00"
  accent-strong: "#FF943F"
  background: "#F5FAFF"
  surface: "#FFFFFF"
  surface-raised: "#F7FBFF"
  surface-soft: "#EAF5FF"
  text: "#11325F"
  muted: "#657D99"
  line: "#DBE8F4"
  line-strong: "#C7DCEC"
  success: "#16855B"
  warning: "#A9690D"
  danger: "#C43D3D"
  on-primary: "#FFFFFF"
  on-action: "#FFFFFF"
  on-accent: "#FFFFFF"
typography:
  display:
    fontFamily: "Noto Sans Thai"
    fontSize: 48px
    fontWeight: 900
    lineHeight: 1.05
    letterSpacing: -0.03em
  title-lg:
    fontFamily: "Noto Sans Thai"
    fontSize: 34px
    fontWeight: 850
    lineHeight: 1.1
  title-md:
    fontFamily: "Noto Sans Thai"
    fontSize: 22px
    fontWeight: 850
    lineHeight: 1.2
  body-md:
    fontFamily: "Noto Sans Thai"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Noto Sans Thai"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Noto Sans Thai"
    fontSize: 11px
    fontWeight: 850
    lineHeight: 1.2
rounded:
  sm: 12px
  md: 16px
  lg: 22px
  xl: 28px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  xxxl: 40px
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    rounded: "{rounded.sm}"
    height: 44px
    padding: 12px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    height: 44px
    padding: 12px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 16px
---

## Overview

KRUART is a light-first, Thai-first product family: calm blue structure, warm orange emphasis, generous white surfaces, exact approved illustration slots, and information-first operational screens. The live Golden baseline is the reviewed KRUART/AWH production family, not a generic AI-generated aesthetic.

This contract governs presentation only. BAY EXCUSE is the current school-facing service; confirm live identity and school-data ownership against the existing BAY Host Contract before changing an integration. AWH remains the workspace/control-plane authority. No design decision may create a duplicate database, login, queue, notification system, or school-data authority.

The implementation baseline reviewed for this contract is AWH production `3acbac97b12774ec973fcef86ba0271d208f656e`. Agents must still refresh current Git/Production truth before editing.
Figma may be used as an **editable, non-authoritative UI review workspace** for an existing product screen. Git Source and the established Central Design Policy remain authoritative; a Figma or FigCraft design is not production code, an extra approval gate, a separate design system, or permission to add a new CSS owner. Only implement an approved design through the product's existing source and release path.

## Practical design priorities

KRUART consistency means **shared behavior and quality**, not identical pages. Reuse each product's existing components, shell and data architecture. An operational teacher screen may be denser than a student game, while a public parent page may be simpler than an Owner console.

Before changing a screen, identify its intended user, their primary task and the one most useful next action. Prefer one clear page heading, one primary action per decision context, predictable secondary actions and progressive disclosure of advanced controls. Avoid card-within-card layouts, duplicate views/tabs for the same data, parallel navigation, decorative status chips, generic dashboard filler and jargon in user-facing UI.

Use real authorized data, explicit empty states and honest loading/error/retry affordances. Never show fictitious student, teacher, activity, score, publication, release, news or system-health data as if it were live. Do not use “mockup”, “coming soon” or demo copy on an active production path unless it truthfully describes an intentionally unavailable feature.

Choose the simplest interaction that completes the user task: direct edit rather than unnecessary modal layers; clear mobile form groups rather than tiny spreadsheet controls; scoped horizontal scrolling only where a real grid requires it. Prefer existing product patterns over imposing a universal table/card/tabs layout.

## Colors

- **Primary / navy** structures navigation, titles, owner controls, and trusted product identity.
- **Action blue** is for interactive emphasis and links; do not scatter unrelated accent colors.
- **Orange** is the warm KRUART accent for emphasis, small labels, and selected branded moments.
- **Background/surface** stays light. Operational screens should not become decorative gradients or dark dashboards without an approved product-level change.
- **Success / warning / danger** communicate state only; never use them as decoration.
- Runtime source mapping: `web/kruart-system.css` and `web/awh-light-system.css`. New raw hex values require an explicit token decision or a documented product exception.

### Contrast-safe color pairings

Choose foreground **against its rendered background**, not by token name alone. Normal-sized text requires at least 4.5:1 contrast; large text at least 3:1; meaningful icon boundaries and focus/non-text UI components generally require at least 3:1 where WCAG 2.2 AA applies. Check active, hover, focus and selected combinations on actual rendered surfaces, not token swatches alone.

Known baseline mismatches requiring remediation at the owning runtime component:
- Brand orange `#FF7A00` + white `#FFFFFF` is approximately **2.61:1** (fails normal text). Preserve the orange brand but use a contrast-safe foreground, e.g. existing navy `#11325F` (approximately **4.88:1**), for normal text on orange where rendered evidence confirms it.
- Existing muted `#657D99` + white is approximately **4.25:1** (not AA for normal text). Reserve this pair for appropriate large/decorative content or select a tested darker semantic text treatment through the existing token owner.
- Existing runtime `--awh-accent-ink: #ffffff` is not proof that orange buttons have accessible text. Do not blanket-switch a legacy selector without inspecting its actual surface/state and downstream component usage.

A corrected policy does **not** imply these Production styles have been fixed. Resolve the canonical product CSS owner, update the existing token mapping/component, run rendered contrast and critical-flow QA, then separately verify Production. No second theme, ad-hoc dark-orange palette or override stylesheet.

## Typography

Use the Thai-first sans stack already implemented by `--awh-font-sans`: Noto Sans Thai first, then the existing platform fallbacks. Thai vowels and tone marks must never clip. Line-height must remain sufficient for Thai script.

The token scale captures the stable semantic hierarchy, not every legacy selector. Existing selectors may remain smaller where a reviewed compact operational layout requires it, but new normal body copy should use the semantic body scale rather than inventing another micro-size.

## Layout

- Mobile-first release references: 390 px and 430 px. Tablet reference: 820 px. Desktop references: 1366 px and 1440 px.
- Minimum supported document width is 320 px. Horizontal page overflow is a release blocker.
- Primary touch targets are at least 44 px where the interaction is intended for touch.
- Root Portfolio and signed-in AWH Workspace are distinct navigation contexts; do not leak one shell into the other.
- AWH Workspace keeps at most three primary mobile destinations: Chat, My Work, Tools.
- Composer, sheets, fixed navigation, and headers must respect safe areas and the visual viewport/keyboard.
- Prefer shared layout/root-cause fixes over page-specific compensation.
## Elevation & Depth

Depth is restrained. White surfaces use subtle blue-gray borders and low-opacity shadows. Floating/dialog surfaces may use the stronger existing float shadow. Avoid glassmorphism, neon glow, heavy drop shadows, or stacked translucent panels unless an approved overlay explicitly calls for them.

Current runtime references:
- panel shadow: `0 10px 30px rgba(20,61,117,.075)`
- float shadow: `0 20px 52px rgba(20,61,117,.12)`

## Shapes

Rounded geometry is deliberate and consistent: 12 / 16 / 22 / 28 px for small, medium, large, and extra-large surfaces. Pills are reserved for compact statuses, filters, and short contextual actions. Do not turn every container into a pill or card.

## Components

- **Primary action:** blue, white text, 44 px minimum touch height.
- **Accent action:** orange only when the warm brand emphasis is intentional; it must not compete with the primary action.
- **Composer/input:** white surface, readable dark text, stable focus state, no layout jump, mobile keyboard aware.
- **Cards:** information-first white surfaces. Illustration belongs only in semantic asset slots.
- **Status:** text + state color; status must never be color-only.
- **Dialog/sheet/popover:** deterministic stacking, one interaction owner, focus/recovery preserved.
- **Navigation:** one owner per context; no duplicate mobile/top navigation.
- **Operational tables/forms/logs:** no decorative character art.
## CSS ownership and anti-overrides

- **One rule, one owner.** Every shared visual value belongs in `design/foundations.json`; every component or layout behavior has one implementation owner in the affected product. Product overlays describe genuine contextual differences, never copied token tables or a second theme.
- Modify the existing canonical selector/component and delete only proven-superseded declarations after regression verification. Do not fix a defect by stacking late stylesheets, appending increasingly specific selectors, blanket `!important`, duplicate media queries, inline overrides, or duplicate tokens.
- Do not replace existing framework/routing/layout architecture or add a second CSS/UI framework to apply this policy. Prefer existing assets, components, CSS bundles, build and QA paths. No new design server, shared database, registry, runtime dependency, orchestration, release gate, or policy file.
- Keep scoped product styling isolated; avoid broad global selectors that leak into unrelated modules. Preserve print/official form geometry, data behavior, existing authorization, and accessibility contracts.
- New CSS must stay minimal and deterministic. A necessary exception belongs next to the owning rule, with its reason and tests—not in a new override file. Remove demonstrably dead rules without blanket cleanup of unverified code.
- Tokens are **design authority**, not a demand to hot-link central CSS from all Production sites. Each product may compile or map them into its existing asset pipeline; never introduce a cross-site network dependency for normal rendering.

## Motion and feedback

- Shared durations: **fast 140 ms**, **standard 220 ms**, **detail 300 ms**, **emphasis 420 ms**. Use the existing `cubic-bezier(.2,.8,.2,1)` easing; treat these as limits/categories rather than animation quotas.
- Fast: press/hover/focus microfeedback. Standard: panels, menus, drawers and state changes. Detail: purposeful section expansion or reveal. Emphasis: rare onboarding/hero transitions, never routine navigation.
- Favor subtle opacity and transform changes (generally 8–16 px reveal distance), without large bounces, continuous motion, unnecessary page-wide animation, layout-shifting scroll effects, or animations that conceal loading failures. Preserve explicit focus and loading/error feedback.
- Honor `prefers-reduced-motion: reduce`: suppress nonessential movement and smooth scrolling, without removing essential state indicators. Motion must not block interaction, intercept keyboard focus, or delay task completion.
- Prefer composited opacity/transform where appropriate; avoid costly continuous layout/paint animation. Reuse the product's existing motion styles and remove obsolete conflicting declarations after QA.

## Smoothness and perceived performance

Visual polish must not make the product slower or harder to operate. Preserve the user's scroll position during ordinary state changes; avoid remounting the whole page when one region updates; prevent flicker from duplicate shells, competing animation definitions, hydration/loading swaps or late CSS injection. Verify that meaningful content and the primary action become usable without waiting for an entrance animation.

Use native, predictable scrolling; avoid scroll listeners that force layout on each frame, expensive blur/backdrop effects on long content, animating layout properties during list scrolling, and unsolicited autoplay. Keep scrolling responsive on long tables, 25–30 student rosters, chat transcripts and content-heavy school pages. Favor repairing the shared component and minimizing DOM/CSS work over hiding jank with animation.

## Mobile viewport and interaction ownership

- Document-level horizontal overflow is forbidden at widths down to 320 px. Fix the element that overflows; do not hide the symptom with broad `overflow-x:hidden` if it clips controls. Use deliberate scrolling only inside an appropriate table or region.
- Keep iPhone safe areas and the visual viewport in mind for fixed/sticky headers, bottom bars, chat composers, sheets, dialogs, menus and mobile keyboards. Typing must leave the focused input and actions visible without layout jumps or accidental double scrolling.
- Only a genuine modal interaction may lock background scrolling. Restore prior scroll position and focus on dismissal; never permanently lock page scrolling or introduce body-position hacks for ordinary content.
- Exactly one owner controls each drawer, modal, focus trap, navigation bar, scroll lock and floating layer. Do not install competing listeners or layered z-index patches.
- Use readable Thai copy and stable responsive layouts. At mobile sizes, input text should avoid iOS focus zoom; do not sacrifice accessibility or user-controlled text scaling.

## Accessibility and deployment truth

- For everyday text/interactive controls, meet WCAG AA contrast on actual backgrounds (including hover, disabled and focus states as applicable). Provide visible keyboard focus, appropriate labels, semantic controls and text alternatives for meaningful imagery.
- Touch targets for primary actions must be at least 44 px, with spacing preventing accidental activation. Respect enlarged text, long Thai words/names, RTL-free Thai glyph rendering, empty/error/loading states and screen readers.
- A source commit or successful build is **not** visual Production PASS. Test exact affected revision with the existing UX acceptance/QA path, then separately verify served CSS, assets, interaction and layout on actual Production after a product's own approved deploy.
- The shared policy is common; product-specific accessibility needs can be stricter, not weaker. Never require a product redesign or Production deployment merely because the shared policy was clarified.

## Do's and Don'ts

**Do**
- Refresh current Git HEAD, production revision, runtime state, and relevant Source of Truth before a visual change.
- Reuse `config/kruart-visual-assets.json` semantic slots and exact approved logos/assets.
- Keep UI copy in HTML/CSS; preserve approved banner pixels when the source asset intentionally contains branding.
- Preserve the exact school spelling: **โรงเรียนบ้านเอือดใหญ่**.
- Fix repeated visual defects at the shared CSS/component/layout/state owner when safe.
- Preserve AWH conversation continuity, progress, recovery, artifact delivery, and mobile composer behavior.
- Preserve BAY official document geometry and other explicitly frozen operational layouts.

**Don't**
- Do not regenerate or approximate project/school logos.
- Do not clone a third-party design system or let an AI agent invent a new theme.
- Do not migrate frameworks merely to achieve visual consistency.
- Do not add a second asset registry, design database, login, school-data store, queue, or notification authority.
- Do not hide backend architecture failures with cosmetic UI.
- Do not deploy a visual change without exact-revision QA and rollback evidence.
- Do not bulk-promote `02_REFERENCE_ONLY` assets into production.
