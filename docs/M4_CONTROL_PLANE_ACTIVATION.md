# AWH M4 Control Plane Activation Package

สถานะของไฟล์ชุดนี้คือ local/prepared เท่านั้น ยังไม่ activate บน ReadyIDC และไม่แตะ Google Cloud `awh-vps`.

## สัญญาที่เพิ่ม

Migration `003_m4_control_plane.sql` เปลี่ยน SQLite `user_version` จาก 3 เป็น 4 แบบ additive และบันทึก ledger เป็น `m4-control-plane`. ตารางใหม่คือ session สำหรับ control surface, canonical tasks/events, worker presence/claim state, bounded artifact metadata และ scoped approvals. ไม่สร้าง project registry, memory หรือ task database ใหม่ และไม่เก็บ workspace path, source content หรือ credentials. หลัง migration มีขั้นตอน `hub/bin/register-m4-projects.php` ที่รับรายการ portable metadata ที่ผ่านการตรวจจาก onboarding service แต่ activation เรียกด้วยรายการว่างเสมอ จึงไม่ติดตั้ง user project ใดไว้ล่วงหน้า. เมื่อผู้ใช้เพิ่มโปรเจกต์ภายหลัง ระบบใช้ service เดิม ตรวจ conflict, ผูก owner membership และรันซ้ำได้โดยไม่สร้าง duplicate.

Browser control ใช้ `POST /api/v1/control/session` กับ pairing code อายุสั้นจาก owner device แล้วรับ Secure/HttpOnly session cookie. Permanent device bearer token ไม่ถูกส่งเข้า JavaScript หรือ browser storage. Requests ที่แก้ state ต้องส่ง same-origin และ CSRF header; goal เป็น bounded text ไม่ใช่คำสั่ง shell.

Canonical routes หลัง activation:

- `GET /api/v1/control/session`
- `POST /api/v1/control/session`
- `GET /api/v1/control/projects`
- `GET /api/v1/control/tasks`
- `GET /api/v1/control/tasks/{taskId}`
- `POST /api/v1/control/tasks`
- `GET /api/v1/control/workers`
- `POST /api/v1/control/workers/heartbeat`
- `POST /api/v1/control/workers/claim`
- `POST /api/v1/control/tasks/{taskId}/update`
- `GET /api/v1/control/results`
- `GET /api/v1/control/artifacts`
- `GET /api/v1/control/approvals`
- `GET /api/v1/control/approvals/{approvalId}`
- `POST /api/v1/control/approvals/{approvalId}/approve`
- `POST /api/v1/control/approvals/{approvalId}/reject`
- `GET /api/v1/control/worker/results/{deviceId}`
- `POST /api/v1/control/tasks/{taskId}/artifact`

Worker routes ใช้ device token ผ่าน existing M3E authentication boundary; browser routes ใช้ session cookie. ไม่มี shell/exec/file browser/MCP proxy/source editor.

## One approval scope

Prepare the exact release assets locally with `npm run web:build:control` followed by `npm run web:manifest`; the generated `dist-web/web-config.json` is the explicit `CONTROL` switch and contains no credential. The activation package stages that static release together with the PHP control plane; the ordinary `npm run web:build` remains the safe static-preview build.

ก่อน activation ต้องมี backup SQLite ที่ตรวจ `integrity_check` และ `foreign_key_check`, apply migration 003, run second invocation, verify generic project-onboarding readiness with an empty input, stage exact release, install `awh-control-plane.conf` ใน HTTPS AWH server block เดิม, `nginx -t`, reload PHP-FPM/Nginx, แล้วตรวจ M3D read routes และ control-plane fixture/health. Rollback คือ restore verified DB backup and remove the control-plane/static release/config before reload; because onboarding metadata is inside the same verified DB backup boundary, restore also removes only this attempt's metadata changes.

ใช้ `deploy/awh-control-plane/deploy-control-plane.sh --dry-run` เพื่อดู bounded plan. `--deploy --approve` เป็น activation path ที่ต้องใช้กับ release ที่ clean และได้รับ approval เท่านั้น; M4 verification จะตรวจ M3E หลัง schema v4 ด้วย invalid-bearer POST โดยไม่สร้าง pairing code.

## Field behavior

หลัง activation owner ออก pairing code จาก AWH Desktop ได้แม้ยังไม่มีโปรเจกต์ โดยรหัสแบบ empty scope เปิดได้เฉพาะ Control Panel และไม่ให้สิทธิ์ project ใด. iPhone เปิด AWH URL, กรอกรหัสครั้งเดียว, เห็น empty-project state, เพิ่มหรือเลือกโปรเจกต์ที่ onboard แล้ว, จึงพิมพ์ Goal และส่งได้. ถ้าไม่มี worker online งานต้องแสดง `WAITING_FOR_WORKER`; ห้ามแสดง `RUNNING` จนกว่า Mac/Windows worker จะ claim งานจริง. Mac/Windows worker ต้องรายงาน capabilities และ claim ผ่าน outbound HTTPS โดยใช้ credential ของเครื่องตัวเอง.

## Known boundary

Local fixture tests prove session exchange, CSRF/origin boundary, project authorization, idempotent task submission, truthful waiting state, worker claim/update, Results/Artifacts, scoped Approval decisions, and device-authenticated worker results. The Desktop runtime now has an opt-in outbound heartbeat/claim loop that routes claimed Goals through the existing project context, checkpoint, bounded Autopilot/QA, artifact and continuity engines; source-changing Goals additionally require the scoped approval. ReadyIDC production remains M3E-only until the single M4 approval is executed; therefore live iPhone command submission is not claimed in this source pass.

## PWA release contract

`npm run web:build:control` produces the same canonical CONTROL surface as a
phone-first installable PWA. The manifest uses standalone display and the
canonical AWH artwork. The versioned service worker caches only the static app
shell and never caches `/api/` responses, session state, or mutation results;
activation removes older `awh-shell-*` caches. Safari can use the ordinary
HTTPS page even when installation is unavailable.

## Deployment execution contract

`deploy/awh-control-plane/deploy-control-plane.sh --dry-run` is safe and local.
The real command is `--deploy --approve`, requires a clean exact release SHA,
validates the local PHP/SQL/Nginx/PWA assets and read-only production preflight,
then uploads one fixed bundle to the configured target. The remote script first
extracts that bundle into an exact release-owned directory, backs up SQLite,
applies migration 003 twice, verifies empty-project onboarding readiness, atomically
switches control/web pointers, inserts the include only in the reviewed HTTPS
server block, reloads the required service, runs M3D/control checks, and emits
allowlisted stage lines only. Failure restores the database, pointers and
Nginx state and verifies the baseline. This command has not been executed.
