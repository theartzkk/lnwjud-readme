# KRUART Visual Asset Contract v1

This is the canonical ingest map for illustrations used by kruart.online and AWH owner/admin surfaces.

## Why this exists

The deployed m20 UI already has strong hero/role/footer artwork, but a small set of wide images is reused in unrelated contexts. The same staff art currently appears in AWH, Infrastructure, Hosting and Control Center; student/teacher role art is also reused as news thumbnails. This contract keeps every semantic destination stable so future artwork can be dropped into the correct slot without adding another visual authority or chasing hard-coded URLs across CSS.

web/kruart-system.css remains the final visual authority. config/kruart-visual-assets.json is the machine-readable slot registry. Current fallbacks reproduce the deployed visuals, so introducing the contract must not intentionally change the page.

## Ingest rules

- Do not embed Thai/English copy in illustrations. UI text stays HTML so it remains sharp, accessible and editable.
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


## Approved Project Sources — 2026-09-09

The Project now contains three approved source archives: โลโก้โปรเจคทั้งหมด(2).zip, Final ref cartoon awh.zip, and Banner project.zip. They are source material, not web payloads. Production should ingest only curated WebP derivatives.

Project banner mapping is fixed as follows: Parent Connect → 27E9C536…, school → 2A034EC3…, Computer Lab → 317D5B1F…, LearnLab → 4C44742F…, KRUART Workspace → 6A986C82…, LearnLab overview → 852FC950…, AWH → 86029A98…, kruart.online → 98E44FD8…, and BAY EXCUSE X → AD6F3BF7….

The logo archive has two exact binary duplicates. kruart_online_logo.png is the canonical kruart.online copy and AWH_Arts_Workspace_Hub_logo.png is the canonical AWH horizontal copy. Do not commit the duplicate aliases.

The first curated illustration candidates are also recorded in config/kruart-visual-assets.json; this prevents UUID filenames from being reinterpreted differently by later agents. Parent Connect and Computer Lab banners are prepared as visual assets only and must not create new AWH/BAY project records. The BAY Ecosystem registry remains the project Source of Truth.
