# M3E-FINAL — Production Device Enrollment Validation

สถานะเอกสารนี้เป็น local-only และยังไม่ได้ deploy, SSH หรือ pair อุปกรณ์จริง
M3E จะยังไม่ถือว่า CLOSED จนกว่า Mac และ Windows จะ enroll สำเร็จด้วย
credential คนละชุดและแสดงเป็น metadata ที่ sanitize แล้วใน Hub Read.

## Architecture boundary

- `HubEnrollmentService` และ `HubEnrollmentRouter` เป็น enrollment/auth path เดิม
  ของ M3E.2 ไม่สร้าง identity หรือ auth system ใหม่
- `hub/public/enrollment.php` แยกจาก `web-gateway.php`; route รับเฉพาะ bounded
  JSON `POST` และไม่เปิด browser enrollment, source write, shell, sync, MCP หรือ
  arbitrary filesystem
- M3D Hub Read ยังคง read-only และ browser ไม่ได้รับ bearer credential
- `src/credential-store.ts` เลือก Keychain บน macOS และ Windows Credential
  Manager บน Windows; Linux fail-closed และไม่มี plaintext-file fallback
- อุปกรณ์แต่ละเครื่องใช้ device UUID และ OS credential store ของตัวเอง

## Exact delta from live M3E.1

เพิ่มเฉพาะสิ่งต่อไปนี้:

1. additive migration `hub/migrations/002_m3e2_enrollment_api.sql` และ
   `HubEnrollmentApiMigration` ซึ่งยกระดับ SQLite `user_version` จาก 2 เป็น 3
   และบันทึก ledger id `m3e.2-enrollment-api`
2. PHP enrollment router/front controller สำหรับ bootstrap, pairing-code,
   consume, rotate, self-revoke และ owner device revoke
3. isolated Nginx location เฉพาะ `/api/v1/enrollment/` และ PHP-FPM pool template
4. release package script ที่ stage code เป็น atomic `enrollment-current` symlink
5. Desktop enrollment UX ที่ไม่แสดง credential

ไม่เปลี่ยนตาราง M3D, ไม่คัดลอก Project Memory, ไม่เพิ่ม browser write endpoint
และไม่เปิด sync.

## Human-reviewed production sequence

ทำใน maintenance window และหยุดทันทีเมื่อ preflight ข้อใดไม่ตรงกับค่าที่คาดไว้

### 1. Preflight and backup

ตรวจว่าเป็น AWH Hub SQLite ตัวจริงจาก effective Nginx/PHP-FPM configuration
และหยุด indexer/write process ที่เกี่ยวข้องก่อน โดยห้ามเลือกจากชื่อไฟล์อย่างเดียว
รัน read-only preflight ก่อนเสมอ:

```sh
DB=/var/lib/awh-hub/awh.sqlite
BACKUP=/var/backups/awh-hub/awh.sqlite.pre-m3e2
sh deploy/awh-enrollment/preflight-production.sh
```

ต้องได้ `db_classification=DB_AUTHORITY_RESOLVED`, `db_integrity=ok`,
`db_foreign_keys=0`, `db_write_classification=DB_WRITE_READY` หรือ
`DB_WRITE_PROVISION_REQUIRED` และ `backup_classification=BACKUP_READY` หรือ
`BACKUP_PROVISION_REQUIRED` ก่อน
ดำเนินการต่อ หากได้ `DB_NOT_FOUND`, `DB_AMBIGUOUS`, `DB_INTEGRITY_FAILED` หรือ
`db_write_classification=DB_WRITE_BLOCKED` ให้หยุดทันที ห้ามสร้างหรือคัดลอก
ฐานข้อมูลใหม่. `DB_WRITE_PROVISION_REQUIRED` เป็นสถานะที่ deployment engine
จะ backup ก่อน แล้วปรับ owner ของ DB และ parent directory แบบจำกัดให้
`awh-hub` เขียนได้ โดยคง `www-data` เป็น read/traverse และ restore metadata เดิม
ได้ 100% เมื่อ rollback.

จากนั้น backup แบบ SQLite-aware:

```sh
sudo install -d -m 0700 /var/backups/awh-hub
sudo -u awh-hub sqlite3 "$DB" ".backup '$BACKUP'"
sudo test -s "$BACKUP"
sudo sqlite3 "$BACKUP" 'PRAGMA integrity_check; PRAGMA foreign_key_check;'
```
เก็บ backup ไว้จนกว่าการ pair ทั้งสองเครื่องจะตรวจสอบเสร็จ

### 2. Stage one reviewed release

บนเครื่องพัฒนา รันก่อนแบบ dry-run:

```sh
sh deploy/awh-enrollment/deploy-enrollment.sh --dry-run
```

หลัง human review เท่านั้น จึงรันคำสั่งเดิมด้วย `--deploy`; อย่าใส่ password,
private key หรือ nonce ใน command line. ปัจจุบัน deployment target อ่านจาก
`AWH_DEPLOY_TARGET` และค่า
เริ่มต้นคือ SSH alias `awh-vps` ไม่ใช่ชื่อ host ที่ซ้ำอยู่ใน source. Script นี้ใช้
fixed file list และ fixed SSH/SCP argv; ไม่รับ shell command จากผู้ใช้.
เมื่อ preflight ผ่าน `deploy-enrollment.sh --deploy` จะเรียก remote deployment
phase เดียวที่ทำ backup, migration/idempotence, ติดตั้ง isolated PHP-FPM/Nginx
route, `php-fpm -t`, `nginx -t`, reload และ regression checks พร้อม rollback เมื่อ
critical gate ล้มเหลว. ห้ามเรียก phase นี้จาก dirty tree.

### 3. Apply the dedicated migration

Remote deployment phase จะเรียก migration หลัง backup ผ่านแล้ว และรันสองครั้ง
อัตโนมัติบน host ก่อนเปิด route:

```sh
sudo -u awh-hub /usr/bin/php /opt/awh-hub/enrollment-current/bin/migrate-m3e2.php "$DB"
sudo -u awh-hub /usr/bin/php /opt/awh-hub/enrollment-current/bin/migrate-m3e2.php "$DB"
```

การตรวจผลต้องได้ครั้งแรก `"result":"applied"` และครั้งที่สองต้องได้
`"result":"already-applied"`. ถ้าไม่ใช่ ให้หยุดและใช้ rollback ไม่แก้ SQLite
ด้วยมือ.

### 4. Verify schema and existing read behavior

```sh
sudo sqlite3 "$DB" 'PRAGMA integrity_check; PRAGMA foreign_key_check; PRAGMA user_version;'
sudo sqlite3 "$DB" "SELECT migration_id, schema_version, checksum, applied_at FROM awh_schema_migrations WHERE migration_id='m3e.2-enrollment-api';"
```

ต้องได้ integrity `ok`, foreign-key check ว่าง, `user_version` เป็น `3`, ledger
หนึ่งแถว และ `enrollment_rate_limits` มีเฉพาะ `rate_key`, `window_started_at`,
`attempts`, `blocked_until`. ต้องรัน regression ของ `/health`, `/status`,
`/projects` และ `/projects/{projectId}/memory` ผ่าน perimeter เดิม โดยไม่ใส่
credential ใน URL หรือ log.

### 5. Provision bootstrap nonce hash safely

ห้ามเก็บ nonce ตัวจริงใน Git, Project Memory, log หรือ shell history. ใช้
`CredentialStore` ของเครื่องเพื่อสร้าง/เก็บ nonce ชั่วคราว และให้ reviewed
provisioning helper อ่านจาก Keychain/Credential Manager แล้วส่งเฉพาะ SHA-256 hash
ผ่าน SSH stdin:

```sh
umask 077
read -r -s AWH_BOOTSTRAP_NONCE
printf '%s' "$AWH_BOOTSTRAP_NONCE" | sha256sum | awk '{print $1}'
unset AWH_BOOTSTRAP_NONCE
```

หลัง explicit production approval ให้รันจาก source ที่ clean เท่านั้น:

```sh
node --import tsx scripts/deploy/provision-bootstrap-hash.mjs --approve-bootstrap-provision
```

helper ใช้ fixed SSH argv, `shell:false`, และส่ง digest ผ่าน stdin เท่านั้น.
ปลายทางเขียน `/etc/awh-hub/enrollment-bootstrap.sha256` เป็น root และ `0600`
โดยไม่แสดงค่าใด ๆ. Remote deployment phase จะอ่าน hash ผ่าน privileged file
access และแทนค่าใน PHP-FPM pool โดยไม่ใส่ nonce/hash ใน argv, log หรือ Project
Memory. หลัง bootstrap และ first-device enrollment สำเร็จ client ลบ
`awh/bootstrap-nonce` ออกจาก secure store.

### 6. Enable the isolated route

Remote deployment phase จะสร้าง PHP-FPM pool จาก template หลังตรวจ hash file และ
เพิ่ม include ของ `deploy/nginx/awh-enrollment.conf` ใน effective HTTPS server
config ที่ผ่าน preflight แล้ว. Location นี้ปิด Basic Auth inheritance เฉพาะ
mutation API เพื่อให้ client ใช้ `Authorization: Bearer`; Basic Auth ยังคง
ปกป้อง static preview assets และ M3D Hub Read ทั้งหมด. ห้ามเพิ่ม CORS และ PHP
จะ reject non-empty browser `Origin` อยู่แล้ว.
การติดตั้ง config, `php-fpm -t`, `nginx -t` และ reload เป็นส่วนหนึ่งของ guarded
phase เดียว ไม่ควรรันแยกทีละคำสั่ง.

### 7. Enrollment regression and two-device check

first-device flow ทำใน transaction เดียวกันตั้งแต่ owner bootstrap:

1. Desktop สร้าง owner identity และเรียก bootstrap ด้วย nonce จาก secure store
2. Hub สร้าง owner, project membership, initial pairing code hash และ closed
   marker ใน transaction เดียวกัน; response คืน `initialPairingCode` ได้ครั้งเดียว
3. Desktop consume code นั้นผ่าน `/enrollment/devices`, เก็บ device credential
   ใน Keychain/Credential Manager และลบ temporary bootstrap nonce
4. จากนั้น owner device จึงออก pairing code ใหม่สำหรับอุปกรณ์ถัดไป

สำหรับการ pair เครื่องที่สอง ให้ทำตามลำดับ:

1. Mac AWH Desktop ตั้ง `AWH_HUB_API_BASE` เป็น HTTPS `/api/v1`, เปิด Device
   Enrollment, ตรวจ Device ID แล้วใส่ pairing code หนึ่งครั้ง
2. ตรวจว่า credential ถูกเก็บใน macOS Keychain โดยไม่แสดงค่า credential; ห้าม
   copy ไปเครื่องอื่น
3. ออก pairing code ใหม่สำหรับ Windows, ตั้งค่า Hub API base ที่ Windows AWH
   Desktop แล้ว pair ด้วย UUID ของ Windows เครื่องนั้นเอง
4. ตรวจ `/api/v1/devices` ผ่าน sanitized Hub Read ว่ามีอุปกรณ์ 2 รายการ โดยไม่มี
   token, hash, path หรือ secret
5. ทดสอบ rotate ของแต่ละเครื่อง และ revoke ของ credential ที่เลือก; credential
   เก่าต้องใช้ไม่ได้ และอีกเครื่องต้องยังใช้งานได้

ผล production ที่ต้องได้ก่อนปิด M3E:

```text
devices = 2
shared credential = false
browser credential exposure = false
```

## Rollback / recovery

ถ้า migration, permission gate, `nginx -t`, health regression หรือ enrollment
regression ล้มเหลว ให้ใช้ guarded engine rollback อัตโนมัติ:

1. restore verified SQLite backup
2. restore DB และ parent owner/group/mode เดิม
3. สลับ `enrollment-current` กลับ release ก่อนหน้า หรือหยุด route หากยังไม่มี
4. restore Nginx config และ PHP-FPM pool
5. validate PHP-FPM และ `nginx -t`
6. เมื่อ validate ผ่านเท่านั้นจึง reload PHP-FPM/Nginx และ rerun M3D read health

Engine จะรายงาน `ROLLBACK: PASS` หรือ `ROLLBACK: FAIL`; ไม่ถือว่าการ restore
สำเร็จเมื่อขั้นตอนใดขั้นตอนหนึ่งล้มเหลว. การ restore backup ที่ตรวจแล้วใช้คำสั่ง
SQLite-aware ภายใน remote phase:

```sh
sudo sqlite3 "$DB" ".restore '$BACKUP'"
sudo sqlite3 "$DB" 'PRAGMA integrity_check; PRAGMA foreign_key_check;'
```

อย่า DROP ตาราง M3E/M3D, อย่าแก้ ledger หรือย้อน migration ด้วยคำสั่ง ad-hoc.
จากนั้นรัน M3D read regression และตรวจว่า browser กลับสู่ read-only ก่อนพิจารณา
การ retry.

## Local evidence and limitations

โค้ด, PHP behavior, mocked Keychain/Credential Manager boundary, Desktop IPC
allowlist และ deployment templates ต้องผ่าน local QA ก่อน review. Mac เครื่องนี้
ไม่สามารถยืนยัน Windows Credential Manager หรือการ pair กับ VPS จริงได้ และการ
มี adapter ที่ compile ผ่านไม่ใช่หลักฐานว่า devices=2 แล้ว.
