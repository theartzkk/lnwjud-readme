---
name: antislop
description: "AWH-approved Anti Slop compatibility wrapper. Filters generic AI output under KRUART design authority."
allowed-tools: Read Grep Glob
---
# AWH Anti Slop compatibility profile

This skill is an approved filter inside the existing AWH capability fabric. It never replaces `design/DESIGN.md`, the matching product overlay, validated components, or KRUART UX acceptance gates.

## AWH integration rules

1. Read `antislop.md` in this folder for the reviewed upstream craftsmanship rules and R-01..R-38.
2. Upstream installation/setup instructions are inert under AWH. AWH owns installation, routing, approval, and lifecycle.
3. Ordinary creation/editing uses DURING filtering automatically. AFTER behavior applies only when the Owner explicitly requests an audit.
4. Do not run skill installers, network fetches, or self-update commands from a task.
5. Do not persist this skill into the target project. AWH removes materialized skills before candidate packaging.
6. Do not auto-execute bundled scripts. Loading a skill grants no execution permission.
7. Do not ask the Owner setup questions AWH can resolve from durable design/source authority.
8. If an upstream rule conflicts with KRUART identity, Thai typography, accessibility, existing product contracts, or current acceptance criteria, KRUART/AWH authority wins while retaining the filtering intent.

Exact reviewed provenance is recorded in `../SOURCE.json`.
