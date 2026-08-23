# Owner data and recovery

Art’s Workspace Hub keeps normal recovery inside the product rather than in a
server shell. An Owner should first use **กู้คืนการเข้าถึง** with a previously
saved recovery code, then sign in and create a fresh set of recovery codes.
Recovery codes are shown only at generation time, stored only as password
hashes, and are never included in exports or backups returned through the UI.

## Owner-only break-glass path

Break-glass is for the exceptional case in which every trusted session and
every unused recovery code is unavailable. It is not a normal login path and
it must never create a second Owner, bypass project membership, disclose a
provider credential, or weaken the existing password/session policy.

An approved operator follows the current release’s bounded recovery procedure:

1. Verify the requesting Owner through the organization’s out-of-band process.
2. Capture and verify the existing AWH database and release backup before any
   change.
3. Restore access only for the existing canonical `owner_bootstrap.owner_user_id`.
4. Require a new password and invalidate every existing session.
5. Record the recovery in the AWH audit trail, verify database integrity and
   project/device preservation, then require new recovery codes.

If the current release cannot prove that sequence, stop rather than attempting
an ad-hoc database edit. Production activation/recovery continues to use the
reviewed backup, integrity, rollback, and service-health gates; exports exclude
passwords, provider keys, cookies, local paths, source contents, and tokens.
