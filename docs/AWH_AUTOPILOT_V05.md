# AWH Autopilot v0.5 — First Usable Product

## สถานะ

Autopilot v0.5 เป็น local-first implementation ที่ผ่าน local dogfood แล้ว:

`goal → project context → checkpoint → allowlisted gates → QA artifact → continuity checkpoint → discovery on another device data directory`

การตรวจนี้ไม่ใช่การ deploy และไม่ใช่การยืนยันว่า M3E production device pair
เสร็จแล้ว

## ขอบเขตที่ใช้งานได้

- Task Contract มี goal, acceptance criteria, allowed capabilities, risk class,
  approval gate, expected artifact, source checkpoint, assigned device, state และ
  timestamps แบบ bounded schema
- state รองรับ `QUEUED`, `PLANNING`, `WORKING`, `TESTING`, `RETRYING`,
  `READY_FOR_REVIEW`, `WAITING_APPROVAL`, `COMPLETED`, `FAILED`, `INTERRUPTED`
- Desktop รับเฉพาะ goal content; ไม่มีช่องรับ shell command
- runner ตรวจ project manifest และ local registry ซ้ำก่อน execution
- context อ่าน Project Memory ห้าไฟล์ตาม canonical order
- checkpoint เกิดก่อน gate ผ่าน engine เดิมและเก็บนอก workspace
- คำสั่งใช้เฉพาะ fixed package scripts ที่ project detector อนุมัติ
  (`test`, `lint`, `typecheck`, `build`)
- stdout/stderr ไม่ถูกเก็บใน task metadata; summary ถูกจำกัดและ redacted
- Artifact Center แสดงเฉพาะ bounded metadata และ relative reference
- continuity checkpoint เก็บ projectId, taskId, source device, Git revision/dirty
  state, bounded HANDOFF summary และ artifact refs โดยไม่เก็บ absolute path หรือ
  credential

## Project profiles

Profile เป็น reusable contract ไม่ผูกกับ project เดียว:

- BAY EXCUSE X PHP/Web: PHP lint, tests, QA hooks, release และ rollback contract
- Teacher Video/Remotion: Node/Remotion/FFmpeg asset/render contract
- School Website: web/mobile QA, staging preview, publish approval และ rollback
- General Node: local test/typecheck/build loop ที่ใช้กับ AWH เอง

การเลือก profile ใช้ portable manifest type และ detected ecosystem ไม่ใช้ absolute
workspace path เป็น identity

## Continuity / conflict safety

checkpoint ของอุปกรณ์ต้นทางสามารถถูกค้นพบใน data directory ของอุปกรณ์ถัดไปผ่าน
abstraction เดียวกัน การเริ่มต่อยังไม่เขียนทับ workspace โดยอัตโนมัติ และถ้าพบ
local dirty work จะแสดง `REVIEW REQUIRED` เพื่อให้มนุษย์ตรวจความขัดแย้งก่อน

การ copy checkpoint ระหว่างอุปกรณ์ยังเป็น human-reviewed bridge ไม่ใช่ real-time
sync และไม่ sync `.git` ผ่าน Drive หรือ generic file sync

## Approval boundary

งาน routine local QA ทำอัตโนมัติได้เมื่อ `AWH_ALLOW_EXEC=1` เปิดโดยผู้ใช้ งานที่
เป็น source mutation, production, destructive หรือ credential จะบังคับ
`requiredApproval=true` ใน Task Contract และยังไม่มี browser route สำหรับงานเหล่านี้

การแก้ HANDOFF/TASKS อัตโนมัติไม่เกิดขึ้นโดยเงียบ ๆ ใน v0.5; Desktop มีเฉพาะ
ปุ่ม explicit `Save concise Memory checkpoint` ซึ่งทำงานได้เมื่อผู้ใช้เปิด
write permission และ task จบสำเร็จเท่านั้น

## Desktop / Web / packaging

- Desktop ใช้ sandboxed Electron, fixed high-level IPC และ tray process เดิม
- Browser Web surface เป็น read/review-only; ไม่มี preload, IPC, filesystem, shell,
  source editor หรือ execution endpoint
- Browser ไม่ได้รับ bearer token และไม่เห็น credential
- Web tasks/artifacts เป็น status/placeholder จนกว่าจะมี sanitized Hub read contract
- Forge/Squirrel identity เดิมยังคงไว้; Windows package เต็มรูปแบบต้อง validate บน
  Windows-native toolchain และ Mac ไม่อ้างว่า installer Windows ผ่าน
- บน Mac ที่ใช้ตรวจนี้ bare Electron 43.2.0 x64 abort ก่อน app startup ใน AppKit
  เมื่อถูกเปิดจาก Codex context (`EXC_CRASH/SIGABRT` ที่ `_RegisterApplication`);
  Forge packaging ต้องการ artifact lookup จาก `github.com` เมื่อ offline จึงยังไม่มี
  package artifact ที่ยืนยันได้จากเครื่องนี้
- runner อยู่ใน main/tray process จึงไม่ถูกทำลายเพียงเพราะซ่อนหน้าต่าง และ metadata
  ถูก persist แบบ bounded เพื่อให้ interrupted history ต้องผ่าน human review
- บน Mac นี้ FFmpeg และ FFprobe ถูกค้นพบผ่าน fallback capability discovery และผ่าน
  disposable frame-sequence → MP4 E2E จริง: 8 frames, 5 FPS, ลำดับเฟรม, count/duration/
  timebase, H.264/yuv420p และการ decode ตรวจซ้ำผ่าน bounded runner; Remotion profile
  ยังรอการเลือก project จริง
- Electron smoke จาก Codex context ตรวจพบ LaunchServices `-10822` หรือ native AppKit
  abort ก่อน marker จึงรายงาน `GUI_SANDBOX_BLOCKED` อย่างชัดเจนและไม่อ้างว่า invocation
  นั้นเป็น AWH failure หรือผ่าน; การเปิดผ่าน logged-in macOS GUI LaunchServices นอก
  Codex ด้วย temp data directory จริงผ่าน marker `stage: passed`, `apiReady: true`,
  `requiredDom: true` จึงเป็นหลักฐาน runtime แยกต่างหาก ส่วน native failure ที่ไม่เข้า
  sandbox pattern ยังคงรายงาน `FAIL_RUNTIME` หากพบโดยไม่มี marker
