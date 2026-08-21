# ReadyIDC topology hygiene closure

สถานะเอกสารนี้เป็น local/review-only และยังไม่มีการแก้ไข ReadyIDC ในรอบนี้

## Root cause

การ deploy รุ่น M3E/M4 เดิมสร้าง snapshot ของ Nginx และ PHP-FPM ไว้ข้างไฟล์
ที่อยู่ใน active configuration directory (`/etc/nginx/sites-enabled`). Nginx
โหลดไฟล์ที่ตรง wildcard ใน directory นี้ ทำให้ snapshot ที่ควรเป็น backup กลายเป็น
server block ที่ active พร้อมกัน และทำให้เกิด `conflicting server name` แม้
`nginx -t` จะยังคืนค่า syntax สำเร็จได้

การแก้ใน source of truth คือ:

- M3E เก็บ Nginx/PHP-FPM snapshots ใต้ `/var/backups/awh-hub/config/`
- M4 เก็บ Nginx snapshot ใต้ `/var/backups/awh-hub/config/nginx/`
- snapshot มี owner/mode restrictive และถูกลบเมื่อ deployment สำเร็จหรือ rollback
  เสร็จตามสถานะของ attempt
- topology cleanup ที่ explicit เท่านั้น archive residue ไปที่
  `/var/backups/awh-hub/topology-cleanup-<release-id>/` แล้วตรวจ `nginx -T`,
  authoritative include และ regression ก่อนเดินหน้าต่อ
- backup ไม่ถูกวางไว้ใน `sites-enabled`, `conf.d` หรือ directory ที่ Nginx โหลด

## Read-only ReadyIDC classification

จากการตรวจจริงแบบไม่แก้ไข:

| Classification | Evidence |
| --- | --- |
| `CANONICAL_ACTIVE` | `/etc/nginx/sites-enabled/awh-preview.conf` |
| `LEGITIMATE_INCLUDE` | `/opt/awh-hub/enrollment-current/deploy/nginx/awh-enrollment.conf` |
| `HISTORICAL_BACKUP_RESIDUE` | `awh-preview.conf.m4-062b18eb37c0` และ `awh-preview.conf.pre-m3e2-*` snapshots ที่อยู่ใน `sites-enabled` |
| `FAILED_RELEASE_RESIDUE` | ไม่พบ M4 control pointer/release จาก read-only inventory |
| `UNKNOWN` | ไม่พบ AWH topology file อื่นที่ต้องจัดประเภทจาก inventory ที่ตรวจ |

พบ warning `conflicting server name` ใน effective `nginx -T`. ยังไม่มีการลบหรือ
archive ไฟล์ใดในรอบนี้ เพราะการ cleanup เป็น production mutation ที่ต้องได้รับ
approval แยกต่างหาก

`git_mirror=OPTIONAL_ABSENT` เป็นสถานะที่ยอมรับได้สำหรับ M4 เพราะ activation
engine ใช้ SSH target และ exact release bundle โดยไม่พึ่ง Git mirror บน VPS

## Reviewed later activation command

หลังได้รับ approval สำหรับ topology cleanup และ M4 activation ให้ใช้คำสั่งเดียว
ที่รวมการ archive/verify residue กับ activation:

```sh
cd /Users/mac/Documents/ChatGPT/lnwjud-readme
AWH_SOURCE_ROOT=/Users/mac/Documents/ChatGPT/lnwjud-readme \
AWH_DEPLOY_TARGET=awh-ready \
AWH_HUB_HOSTNAME=157-85-108-142.sslip.io \
AWH_RELEASE_COMMIT=<approved-release-sha> \
./deploy/awh-control-plane/deploy-control-plane.sh --deploy --approve --cleanup-topology
```

คำสั่งนี้ต้องใช้ clean exact release เท่านั้น. หาก preflight พบ topology ที่ไม่ใช่
historical residue ที่จัดประเภทไว้, deployment จะ fail closed และไม่ทำ cleanup.
Rollback จะ restore verified SQLite backup, pointers และ Nginx state ก่อน reload
และตรวจ M3D baseline อีกครั้ง
