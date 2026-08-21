# M4 owner-entry compatibility

M3E enrollment and M4 control plane share one SQLite database. `PRAGMA user_version`
is therefore the monotonic database version, not an exact version for every
subsystem. The enrollment API is ready when the `m3e.1-enrollment` and
`m3e.2-enrollment-api` ledger records, required enrollment tables/columns/indexes,
and foreign-key integrity are valid. A database at version 4 is valid; a database
below version 3 or with a missing/corrupt enrollment capability fails closed.

The historical M3E.2 migration remains an exact 2→3 migration and must never be
replayed on a v4 database. To refresh the live `enrollment-current` implementation
after M4, use the reviewed compatibility path only. It verifies the M3E capability,
does not run a migration or write `PRAGMA user_version`, and updates the enrollment
release/pointer and its reviewed PHP-FPM/Nginx route with the existing rollback
boundary.

The following is a bounded command template for a separately approved production
refresh. Replace only the release SHA/ID with the exact clean committed release;
this command is documentation and was not run by this change:

```sh
cd /Users/mac/Documents/ChatGPT/lnwjud-readme
AWH_SOURCE_ROOT=/Users/mac/Documents/ChatGPT/lnwjud-readme \
AWH_DEPLOY_TARGET=awh-ready \
AWH_HUB_HOSTNAME=157-85-108-142.sslip.io \
AWH_ENROLLMENT_RELEASE_ID=m3e2-<release-sha-prefix> \
AWH_RELEASE_COMMIT=<exact-clean-release-sha> \
./deploy/awh-enrollment/deploy-enrollment.sh --deploy --compat-refresh
```

The refresh requires the existing verified DB authority, backup/preflight gates,
and the reviewed service identity. On failure it restores the enrollment pointer,
Nginx/PHP-FPM configuration, release residue, and captured permissions; because
compatibility refresh does not mutate SQLite, it does not restore the DB unless a
future implementation explicitly reports a migration mutation.

The M4 deployment verification also sends a bounded POST with an intentionally
invalid bearer credential to the enrollment pairing route. The expected result is
an authentication failure, never `ENROLLMENT_SCHEMA_NOT_READY`.
