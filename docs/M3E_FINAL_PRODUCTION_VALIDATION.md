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

ตรวจว่าเป็น AWH Hub SQLite ตัวจริงและหยุด indexer/write process ที่เกี่ยวข้องก่อน
จากนั้น backup แบบ SQLite-aware:

```sh
DB=/var/lib/awh-hub/awh.sqlite
BACKUP=/var/backups/awh-hub/awh.sqlite.pre-m3e2
sudo install -d -m 0700 /var/backups/awh-hub
sudo -u awh-hub sqlite3 "$DB" ".backup '$BACKUP'"
sudo test -s "$BACKUP"
sudo sqlite3 "$BACKUP" 'PRAGMA integrity_check; PRAGMA foreign_key_check;'
```

ต้องได้ `ok` และไม่มีแถวจาก foreign-key check ก่อนดำเนินการต่อ เก็บ backup ไว้
จนกว่าการ pair ทั้งสองเครื่องจะตรวจสอบเสร็จ

### 2. Stage one reviewed release

บนเครื่องพัฒนา รันก่อนแบบ dry-run:

```sh
sh deploy/awh-enrollment/deploy-enrollment.sh --dry-run
```

หลัง human review เท่านั้น จึงตั้งค่า `AWH_DEPLOY_USER` จาก secure shell session
และรันคำสั่งเดิมด้วย `--deploy`; อย่าใส่ password, private key หรือ nonce ใน
command line. Script นี้ใช้ fixed file list และ fixed SSH/SCP argv; ไม่รับ shell
command จากผู้ใช้.

### 3. Apply the dedicated migration

บน host หลัง package ถูก stage แต่ก่อนเปิด Nginx location:

```sh
sudo -u awh-hub /usr/bin/php /opt/awh-hub/enrollment-current/bin/migrate-m3e2.php "$DB"
sudo -u awh-hub /usr/bin/php /opt/awh-hub/enrollment-current/bin/migrate-m3e2.php "$DB"
```

ครั้งแรกต้องได้ `"result":"applied"` และครั้งที่สองต้องได้
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

ห้ามเก็บ nonce ตัวจริงใน Git, Project Memory, log หรือ shell history ใช้ secure
interactive input แล้วเก็บเฉพาะ SHA-256 hash ใน PHP-FPM pool environment ที่
permission `0600`:

```sh
umask 077
read -r -s AWH_BOOTSTRAP_NONCE
printf '%s' "$AWH_BOOTSTRAP_NONCE" | sha256sum | awk '{print $1}'
unset AWH_BOOTSTRAP_NONCE
```

นำ hash ที่ได้ไปแทน placeholder ในไฟล์ PHP-FPM ที่อยู่นอก repository โดย
ตรวจซ้ำว่าไฟล์ owner/permission ถูกต้อง แล้ว `unset` ค่าชั่วคราวทั้งหมด. ห้าม
คัดลอก nonce เข้า `AWH_ENROLLMENT_BOOTSTRAP_NONCE_HASH`; ตัวแปรนี้รับ hash เท่านั้น.

### 6. Enable the isolated route

ติดตั้ง `deploy/php-fpm/awh-enrollment.pool.conf` หลังแทนค่า hash นอก source
control แล้ว include `deploy/nginx/awh-enrollment.conf` ภายใน HTTPS server เดิม
หรือ server แยกที่ผ่าน review. Location นี้ปิด Basic Auth inheritance เฉพาะ
mutation API เพื่อให้ client ใช้ `Authorization: Bearer`; Basic Auth ยังคง
ปกป้อง static preview assets และ M3D Hub Read ทั้งหมด. ห้ามเพิ่ม CORS และ PHP
จะ reject non-empty browser `Origin` อยู่แล้ว.

```sh
sudo nginx -t
sudo systemctl reload php8.3-fpm
sudo systemctl reload nginx
```

### 7. Enrollment regression and two-device check

ใช้ operator flow ที่ออก pairing code อายุสั้นจาก owner device แล้วทำตามลำดับ:

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

ถ้า migration, `nginx -t`, health regression หรือ enrollment regression ล้มเหลว:

1. ปิด/ถอด isolated enrollment location และ reload Nginx
2. สลับ `enrollment-current` กลับ release ก่อนหน้า หรือหยุด route หากยังไม่มี
   release ก่อนหน้า
3. ตรวจ backup ด้วย `integrity_check` อีกครั้ง แล้ว restore เฉพาะ backup ที่
   ตรวจแล้ว:

```sh
sudo nginx -t
sudo systemctl reload nginx
sudo -u awh-hub sqlite3 "$DB" 'PRAGMA integrity_check;'
sudo install -o awh-hub -g awh-hub -m 0600 "$BACKUP" "$DB"
sudo -u awh-hub sqlite3 "$DB" 'PRAGMA integrity_check; PRAGMA foreign_key_check;'
```

อย่า DROP ตาราง M3E/M3D, อย่าแก้ ledger หรือย้อน migration ด้วยคำสั่ง ad-hoc.
จากนั้นรัน M3D read regression และตรวจว่า browser กลับสู่ read-only ก่อนพิจารณา
การ retry.

## Local evidence and limitations

โค้ด, PHP behavior, mocked Keychain/Credential Manager boundary, Desktop IPC
allowlist และ deployment templates ต้องผ่าน local QA ก่อน review. Mac เครื่องนี้
ไม่สามารถยืนยัน Windows Credential Manager หรือการ pair กับ VPS จริงได้ และการ
มี adapter ที่ compile ผ่านไม่ใช่หลักฐานว่า devices=2 แล้ว.
