# KRUART Visual Asset Contract v1

This is the canonical ingest map for illustrations used by kruart.online and AWH owner/admin surfaces.

## Why this exists

The deployed m20 UI already has strong hero/role/footer artwork, but a small set of wide images is reused in unrelated contexts. The same staff art currently appears in AWH, Infrastructure, Hosting and Control Center; student/teacher role art is also reused as news thumbnails. This contract keeps every semantic destination stable so future artwork can be dropped into the correct slot without adding another visual authority or chasing hard-coded URLs across CSS.

web/kruart-system.css remains the final visual authority. config/kruart-visual-assets.json is the machine-readable slot registry. Current fallbacks reproduce the deployed visuals, so introducing the contract must not intentionally change the page.

## Ingest rules

- Do not embed new Thai/English UI copy in illustrations. UI text stays HTML so it remains sharp, accessible and editable. Approved project-banner lockups from Banner project.zip are a source-fidelity exception: preserve their pixels exactly and never retype or redraw their branding.
- Keep logos and official marks exact. Do not redraw or approximate them inside generated art.
- Use WebP for raster artwork and SVG only for simple vector/icon work.
- Preserve a copy-safe zone for heroes and banners. Prefer focal-point/crop tuning before creating a second mobile file.
- Role-card art keeps the person/scene on the left because HTML copy occupies the right side.
- News art must be a real 16:9 thumbnail, not a crop of a role banner.
- Dedicated 1:1 artwork is required for the account/avatar slot; a wide staff banner is only a temporary fallback.
- Operational UI (metrics, database rows, logs, security forms, chat messages) stays information-first. Do not add decorative people/art there.
- Only above-fold hero/brand imagery may be eager. Below-fold image content should use img/picture with lazy decoding when converted from CSS backgrounds.

## Slot priorities

P0 — keep/use now: public hero, four role cards, public footer, brand logo.

P1 — first new artwork to ingest: public news x3, today message, account avatar, owner hero, four owner system cards, owner control, AWH home hero, Infrastructure, Hosting and Control Panel.

P2 — optional enrichment: AWH sign-in side art, empty states, Database/Review/Trust subtle route art and owner footer variants.

## Canvas guide

| Family | Master canvas | Composition |
|---|---:|---|
| Public hero | 2200×880 (5:2) | characters/scene at edges, center copy-safe |
| Role card | 2048×768 (8:3) | subject in left 42%, no embedded text |
| News thumbnail | 960×540 (16:9) | center-safe editorial scene |
| Mini/today | 800×600 (4:3) | subject biased right |
| Avatar | 512×512 (1:1) | centered, readable at 40 px |
| Owner system card | 1200×800 (3:2) | product cue/subject left |
| Route/control art | 1200×900 (4:3) | right-anchored, quiet background |
| Footer | 2400×800 (3:1) | decoration at edges, copy-safe middle |

## Acceptance gate for every new asset

1. Map it to an existing slot ID; do not invent a parallel selector unless the UX genuinely has a new semantic destination.
2. Check identity/face/logo fidelity where applicable.
3. Verify crop at desktop 1536×864, iPhone-class width, and narrow 320–390 px width.
4. Verify text contrast and that CTA/input areas are never covered.
5. Check file size and loading behavior; unused/below-fold art must not become an eager page-weight regression.
6. Run test/kruart-system-ui.test.ts, root portfolio, and mobile overflow tests.
7. Build dist-web, then visually compare the real rendered output before deployment.


## Approved Project Source — 2026-09-10

The Project visual authority is now `KRUART-ECOSYSTEM-SOURCES-READY-FINAL-v2.zip` (manifest `2026-09-10-final-v2-ui-authority`, SHA-256 `2cf381c01c0a29b7e0a8d95b6b97426e82e2288658cce46ad79927d7c1c1e52e`). It contains 329 indexed files / 313 images and separates `01_PRODUCTION_READY` from `02_REFERENCE_ONLY`. The v2 rule is explicit: the current live `kruart.online` is the highest Golden UI/UX reference; project folders are curated starting points, not mandatory templates.

Product identity is also explicit: `kruart.online` is the canonical public/root web surface of **Art’s Workspace Hub (AWH)**. The signed-in Workspace is a mode of the same product, not a second product nested inside it. BAY registry IDs may remain backward-compatible, but presentation must deduplicate `kruart-online` and `awh` instead of showing them as two independent systems.

Production ingest is intentionally selective: use semantic slots in `config/kruart-visual-assets.json`, keep existing verified web binaries when they already satisfy the slot, and import only a curated `01_PRODUCTION_READY` asset when it closes a demonstrated visual gap. Never bulk-copy the archive into the web release. `02_REFERENCE_ONLY` is for identity/style/provenance and must not auto-promote.

Canonical project logos remain exact source marks and must never be regenerated. UI copy stays HTML/CSS; prefer no-text artwork. The canonical school spelling is **โรงเรียนบ้านเอือดใหญ่**. Parent Connect, Computer Lab, LearnLab, BAY EXCUSE X, School Website, KRUART and AWH visuals are presentation assets only; they must not create duplicate project, identity, login, queue or school-data authorities.

The earlier UUID banner mapping is preserved in the machine-readable registry for provenance. New agents should start from the unified archive paths recorded as `unifiedSource` and the semantic slot ID, not infer meaning from old UUID filenames.
