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

This contract governs presentation only. BAY EXCUSE X remains the school-data/identity Source of Truth; AWH remains the workspace/control-plane authority. No design decision may create a duplicate database, login, queue, notification system, or school-data authority.

The implementation baseline reviewed for this contract is AWH production `3acbac97b12774ec973fcef86ba0271d208f656e`. Agents must still refresh current Git/Production truth before editing.
## Colors

- **Primary / navy** structures navigation, titles, owner controls, and trusted product identity.
- **Action blue** is for interactive emphasis and links; do not scatter unrelated accent colors.
- **Orange** is the warm KRUART accent for emphasis, small labels, and selected branded moments.
- **Background/surface** stays light. Operational screens should not become decorative gradients or dark dashboards without an approved product-level change.
- **Success / warning / danger** communicate state only; never use them as decoration.
- Runtime source mapping: `web/kruart-system.css` and `web/awh-light-system.css`. New raw hex values require an explicit token decision or a documented product exception.

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
