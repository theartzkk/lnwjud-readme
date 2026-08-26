# AWH Recovery Runbook

AWH recovery is staged. A backup file is never copied over the production database while the Hub is live.

## Standard recovery sequence

1. Identify a verified snapshot and its matching manifest.
2. Run `php hub/bin/backup.php verify <snapshot> <manifest>`.
3. Run `php hub/bin/backup.php drill <snapshot> <manifest> <scratchRoot>` and require `PASS`.
4. Put the target release into a controlled maintenance/cutover window.
5. Preserve the current production database as an additional rollback snapshot.
6. Materialize the verified backup to a new target path; never overwrite the active path in place.
7. Run integrity, foreign-key and migration compatibility checks against the candidate database.
8. Switch the service to the candidate database atomically, then run application health checks.
9. If health checks fail, switch back to the preserved pre-cutover database.

## Non-negotiable rules

- Restore drills are safe and disposable; production restores are explicit cutovers.
- Secrets are not stored in manifests.
- A database snapshot without a matching verified manifest is not a Stable release recovery artifact.
- Migration and rollback plans are release evidence, not informal chat instructions.
