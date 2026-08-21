# AWH M4 Control Plane Activation Package

สถานะของไฟล์ชุดนี้คือ local/prepared เท่านั้น ยังไม่ activate บน ReadyIDC และไม่แตะ Google Cloud `awh-vps`.

## สัญญาที่เพิ่ม

Migration `003_m4_control_plane.sql` เปลี่ยน SQLite `user_version` จาก 3 เป็น 4 แบบ additive และบันทึก ledger เป็น `m4-control-plane`. ตารางใหม่คือ session สำหรับ control surface, canonical tasks/events, worker presence/claim state, bounded artifact metadata และ scoped approvals. ไม่สร้าง project registry, memory หรือ task database ใหม่ และไม่เก็บ workspace path, source content หรือ credentials. หลัง migration มีขั้นตอน `hub/bin/register-m4-projects.php` ที่เพิ่มเฉพาะ portable metadata ของ BAY EXCUSE X และ Teacher Evaluation Video ด้วย project IDs ที่มีอยู่แล้ว, ตรวจ conflict, ผูก owner membership, และรันซ้ำได้โดยไม่สร้าง duplicate.

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

Worker routes ใช้ device token ผ่าน existing M3E authentication boundary; browser routes ใช้ session cookie. ไม่มี shell/exec/file browser/MCP proxy/source editor.

## One approval scope

Prepare the exact release assets locally with `npm run web:build:control` followed by `npm run web:manifest`; the generated `dist-web/web-config.json` is the explicit `CONTROL` switch and contains no credential. The activation package stages that static release together with the PHP control plane; the ordinary `npm run web:build` remains the safe static-preview build.

ก่อน activation ต้องมี backup SQLite ที่ตรวจ `integrity_check` และ `foreign_key_check`, apply migration 003, run second invocation, register the two fixed portable project manifests, stage exact release, install `awh-control-plane.conf` ใน HTTPS AWH server block เดิม, `nginx -t`, reload PHP-FPM/Nginx, แล้วตรวจ M3D read routes และ control-plane fixture/health. Rollback คือ restore verified DB backup and remove the control-plane/static release/config before reload; because project registration is inside the same verified DB backup boundary, restore also removes only this attempt's metadata changes.

ใช้ `deploy/awh-control-plane/deploy-control-plane.sh --dry-run` เพื่อดู bounded plan. `--deploy` ถูก guard ให้หยุดจนกว่าจะมี reviewed activation path; รอบนี้ห้ามรัน production mutation.

## Field behavior

หลัง activation owner ออก pairing code จาก AWH Desktop แล้ว iPhone เปิด AWH URL, กรอกรหัสครั้งเดียว, เลือก BAY EXCUSE X หรือ Teacher Evaluation Video, พิมพ์ Goal และส่ง. ถ้าไม่มี worker online งานต้องแสดง `WAITING_FOR_WORKER`; ห้ามแสดง `RUNNING` จนกว่า Mac/Windows worker จะ claim งานจริง. Mac/Windows worker ต้องรายงาน capabilities และ claim ผ่าน outbound HTTPS โดยใช้ credential ของเครื่องตัวเอง.

## Known boundary

Local fixture tests prove session exchange, CSRF/origin boundary, project authorization, idempotent task submission and truthful waiting state. ReadyIDC production remains M3E-only until the single M4 approval is executed; therefore live iPhone command submission is not claimed in this source pass.
