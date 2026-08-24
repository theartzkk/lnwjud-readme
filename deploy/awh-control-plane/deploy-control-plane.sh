#!/bin/sh

# AWH owner-auth activation orchestrator. Dry-run is the default. Real mutation is
# reachable only with --deploy --approve, a clean exact release lock, and the
# existing read-only production preflight.
set -eu
LC_ALL=C
export LC_ALL

MODE=dry-run
APPROVED=0
CLEANUP_TOPOLOGY=0
OWNER_AUTH=0
COMPAT_REFRESH=0
ASSISTANT_WORKSTREAM=0
WORKSPACE_CONTINUITY=0
UNIFIED_WORKSPACE=0
FINAL_PRODUCT=0
FOUNDING_MEMORY=0
SELF_SERVICE=0
CENTRAL_PROJECT_AUTHORITY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE=dry-run ;;
    --deploy) MODE=deploy ;;
    --approve) APPROVED=1 ;;
    --cleanup-topology) CLEANUP_TOPOLOGY=1 ;;
    --owner-auth) OWNER_AUTH=1 ;;
    --compat-refresh) COMPAT_REFRESH=1 ;;
    --assistant-workstream) ASSISTANT_WORKSTREAM=1 ;;
    --workspace-continuity) WORKSPACE_CONTINUITY=1 ;;
    --unified-workspace) UNIFIED_WORKSPACE=1 ;;
    --final-product) FINAL_PRODUCT=1 ;;
    --founding-memory) FOUNDING_MEMORY=1 ;;
    --self-service) SELF_SERVICE=1 ;;
    --central-project-authority) CENTRAL_PROJECT_AUTHORITY=1 ;;
    *) echo "Usage: $0 [--dry-run] | --deploy --approve --owner-auth [--compat-refresh|--assistant-workstream|--workspace-continuity|--unified-workspace|--final-product|--founding-memory|--self-service|--central-project-authority] [--cleanup-topology]" >&2; exit 2 ;;
  esac
done
if test "$MODE" = dry-run && test "$APPROVED" -eq 1; then echo "--approve requires --deploy" >&2; exit 2; fi

ROOT=${AWH_SOURCE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}
TARGET=${AWH_DEPLOY_TARGET:-awh-ready}
RELEASE=${AWH_RELEASE_COMMIT:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)}
HOSTNAME=${AWH_HUB_HOSTNAME:-157-85-108-142.sslip.io}
OWNER_USERNAME=${AWH_OWNER_AUTH_USERNAME:-art}
REMOTE_ROOT=/opt/awh-hub
if test "$CENTRAL_PROJECT_AUTHORITY" -eq 1; then RELEASE_ID=m12-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$SELF_SERVICE" -eq 1; then RELEASE_ID=m11-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$FOUNDING_MEMORY" -eq 1; then RELEASE_ID=m10-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$FINAL_PRODUCT" -eq 1; then RELEASE_ID=m9-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$UNIFIED_WORKSPACE" -eq 1; then RELEASE_ID=m8-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$WORKSPACE_CONTINUITY" -eq 1; then RELEASE_ID=m7-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$ASSISTANT_WORKSTREAM" -eq 1; then RELEASE_ID=m6-$(printf '%s' "$RELEASE" | cut -c1-12); else RELEASE_ID=m4-$(printf '%s' "$RELEASE" | cut -c1-12); fi
REMOTE_STAGE=/tmp/awh-control-plane-$RELEASE_ID.tar.gz
PREFLIGHT=$ROOT/deploy/awh-enrollment/preflight-production.sh
REMOTE_DEPLOY=$ROOT/deploy/awh-control-plane/remote-deploy-control-plane.sh
REMOTE_SCRIPT=/tmp/awh-control-plane-$RELEASE_ID.sh
BUNDLE=$(mktemp "${TMPDIR:-/tmp}/awh-control-plane.XXXXXX")
cleanup() { rm -f "$BUNDLE"; }
trap cleanup EXIT HUP INT TERM

case "$TARGET" in ''|*[!A-Za-z0-9._-]*) echo "AWH_DEPLOY_TARGET is invalid" >&2; exit 2 ;; esac
case "$RELEASE" in ''|*[!0-9a-fA-F]*) echo "AWH_RELEASE_COMMIT is invalid" >&2; exit 2 ;; esac
case "$HOSTNAME" in ''|*[!A-Za-z0-9.-]*|.*|*.) echo "AWH_HUB_HOSTNAME is invalid" >&2; exit 2 ;; esac
case "$HOSTNAME" in *[A-Za-z]*.*) : ;; *) echo "AWH_HUB_HOSTNAME is invalid" >&2; exit 2 ;; esac

# The web tree is a release artifact, never a reused local preview. Build it
# from this exact source lock before checking or bundling any deployment asset.
command -v node >/dev/null 2>&1 || { echo "node is required to build the CONTROL web release" >&2; exit 1; }
AWH_WEB_RELEASE_ID="$RELEASE_ID" node --import tsx "$ROOT/scripts/build-web-preview.ts" --control >/dev/null
AWH_RELEASE_ID="$RELEASE_ID" node "$ROOT/scripts/create-web-release-manifest.mjs" "$ROOT/dist-web" >/dev/null

FILES="hub/public/control-plane.php hub/src/HubEnrollmentService.php hub/src/HubEnrollmentApiMigration.php hub/src/HubControlPlaneService.php hub/src/HubControlPlaneRouter.php hub/src/HubBrowserOriginPolicy.php hub/src/HubControlPlaneMigration.php hub/src/HubControlPlaneProjectRegistration.php hub/src/HubOwnerAuthMigration.php hub/src/HubOwnerAuthService.php hub/src/HubOwnerAuthRouter.php hub/src/HubAssistantWorkstreamMigration.php hub/src/HubWorkspaceContinuityMigration.php hub/src/HubUnifiedWorkspaceMigration.php hub/src/HubFinalProductMigration.php hub/src/HubFoundingMemorySeed.php hub/src/HubFoundingMemoryMigration.php hub/src/HubFoundingMemoryService.php hub/src/HubSelfServiceMigration.php hub/src/HubCentralProjectAuthorityMigration.php hub/src/HubProjectVault.php hub/src/HubProjectVaultService.php hub/src/HubDurableExecutionService.php hub/src/HubProviderCredentialStore.php hub/src/HubAttachmentStore.php hub/src/HubArtifactStore.php hub/src/HubNativeAgentService.php hub/migrations/002_m3e2_enrollment_api.sql hub/migrations/003_m4_control_plane.sql hub/migrations/004_owner_auth.sql hub/migrations/005_assistant_workstream.sql hub/migrations/006_workspace_continuity.sql hub/migrations/007_unified_workspace.sql hub/migrations/008_final_product.sql hub/migrations/009_founding_memory.sql hub/migrations/010_self_service.sql hub/migrations/011_central_project_authority.sql hub/bin/migrate-m4.php hub/bin/migrate-owner-auth.php hub/bin/migrate-assistant-workstream.php hub/bin/migrate-workspace-continuity.php hub/bin/migrate-unified-workspace.php hub/bin/migrate-final-product.php hub/bin/migrate-founding-memory.php hub/bin/migrate-self-service.php hub/bin/migrate-central-project-authority.php hub/bin/awh-native-executor.php hub/bin/sync-deployed-source-vault.php hub/bin/register-m4-projects.php hub/bin/setup-owner-auth.php hub/bin/verify-owner-auth-runtime.php deploy/systemd/awh-native-executor.service deploy/systemd/awh-native-executor.timer deploy/nginx/awh-control-plane.conf deploy/nginx/render-control-plane-include.php deploy/nginx/transform-owner-auth.php deploy/awh-enrollment/insert-nginx-include.php deploy/awh-control-plane/remote-deploy-control-plane.sh dist-web/index.html dist-web/styles.css dist-web/app.js dist-web/hub-read-adapter.js dist-web/control-plane-adapter.js dist-web/manifest.webmanifest dist-web/sw.js dist-web/logo-256x256.png dist-web/web-config.json dist-web/data.json dist-web/release.json"
DESKTOP_ARTIFACT_FILES="dist-web/downloads/AWH-macOS-x64.zip dist-web/downloads/AWH-Windows-x64.zip dist-web/downloads/SHA256SUMS.txt"
DESKTOP_ARTIFACTS=
desktop_artifact_count=0
for file in $DESKTOP_ARTIFACT_FILES; do
  if test -f "$ROOT/$file"; then desktop_artifact_count=$((desktop_artifact_count + 1)); DESKTOP_ARTIFACTS="$DESKTOP_ARTIFACTS $file"; fi
done
case "$MODE:$desktop_artifact_count" in
  dry-run:0|*:3) : ;;
  *) echo "Desktop release artifacts must be complete for production deploy" >&2; exit 1 ;;
esac
FILES="$FILES$DESKTOP_ARTIFACTS"
for file in $FILES; do test -f "$ROOT/$file" || { echo "Missing reviewed M4 asset: $file" >&2; exit 1; }; done
test -f "$PREFLIGHT" || { echo "Missing read-only production preflight" >&2; exit 1; }
test -f "$ROOT/dist-web/web-config.json" || { echo "Missing CONTROL web release" >&2; exit 1; }
grep -q '"mode": "CONTROL"' "$ROOT/dist-web/web-config.json" || { echo "CONTROL web release is required" >&2; exit 1; }
grep -q '"mode": "CONTROL"' "$ROOT/dist-web/data.json" || { echo "CONTROL web data release is required" >&2; exit 1; }
! grep -q 'Remote Preview\|Preview only\|static build' "$ROOT/dist-web/data.json" || { echo "CONTROL web release contains stale preview data" >&2; exit 1; }
grep -q "awh-shell-$RELEASE_ID" "$ROOT/dist-web/sw.js" || { echo "CONTROL service worker release identity is missing" >&2; exit 1; }

if test "$MODE" = dry-run; then
  if test "$CENTRAL_PROJECT_AUTHORITY" -eq 1; then echo "M12_ARTIFACT_STORAGE=private-object-root-required"; fi
  if test "$CENTRAL_PROJECT_AUTHORITY" -eq 1; then echo "M12_DRY_RUN=PASS"; echo "M12_TARGET=$TARGET"; echo "M12_RELEASE=$RELEASE"; elif test "$SELF_SERVICE" -eq 1; then echo "M11_DRY_RUN=PASS"; echo "M11_TARGET=$TARGET"; echo "M11_RELEASE=$RELEASE"; elif test "$FOUNDING_MEMORY" -eq 1; then echo "M10_DRY_RUN=PASS"; echo "M10_TARGET=$TARGET"; echo "M10_RELEASE=$RELEASE"; elif test "$FINAL_PRODUCT" -eq 1; then echo "M9_DRY_RUN=PASS"; echo "M9_TARGET=$TARGET"; echo "M9_RELEASE=$RELEASE"; elif test "$UNIFIED_WORKSPACE" -eq 1; then echo "M8_DRY_RUN=PASS"; echo "M8_TARGET=$TARGET"; echo "M8_RELEASE=$RELEASE"; elif test "$WORKSPACE_CONTINUITY" -eq 1; then echo "M7_DRY_RUN=PASS"; echo "M7_TARGET=$TARGET"; echo "M7_RELEASE=$RELEASE"; elif test "$ASSISTANT_WORKSTREAM" -eq 1; then echo "M6_DRY_RUN=PASS"; echo "M6_TARGET=$TARGET"; echo "M6_RELEASE=$RELEASE"; else echo "M4_DRY_RUN=PASS"; echo "M4_TARGET=$TARGET"; echo "M4_RELEASE=$RELEASE"; fi
  if test "$CENTRAL_PROJECT_AUTHORITY" -eq 1; then echo "M12_PLAN=build-control-pwa,preflight,backup,stage,verify-v11-or-v12-authority,project-vault-runtime-ready,project-vault-storage-ready,migrate-011-only-from-v11,source-refresh-without-migration-on-v12,control-pointer,refresh-managed-native-executor,php-fpm-reload,project-vault-source-sync,web-pointer,nginx-test,reload,unauthenticated-vault-route,m3d-m3e-control-regression"; elif test "$SELF_SERVICE" -eq 1; then echo "M11_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,verify-m7-capability,migrate-007,idempotence,migrate-008,idempotence,attachment-storage-ready,migrate-009,idempotence,founding-memory-capability,migrate-010,idempotence,provider-credential-storage-ready,self-service-capability,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,public-work-shell,m3d-m3e-control-regression"; elif test "$FOUNDING_MEMORY" -eq 1; then echo "M10_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,verify-m7-capability,migrate-007,idempotence,migrate-008,idempotence,attachment-storage-ready,migrate-009,idempotence,founding-memory-import,idempotence,founding-memory-capability,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,public-work-shell,m3d-m3e-control-regression"; elif test "$FINAL_PRODUCT" -eq 1; then echo "M9_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,verify-m7-capability,migrate-007,idempotence,migrate-008,idempotence,attachment-storage-ready,final-product-capability,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,public-work-shell,m3d-m3e-control-regression"; elif test "$UNIFIED_WORKSPACE" -eq 1; then echo "M8_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,verify-m7-capability,migrate-007,idempotence,unified-workspace-capability,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,public-work-shell,m3d-m3e-control-regression"; elif test "$WORKSPACE_CONTINUITY" -eq 1; then echo "M7_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,verify-owner-auth-v5,migrate-005,idempotence,assistant-workstream-capability,migrate-006,idempotence,workspace-continuity-capability,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,public-work-shell,m3d-m3e-control-regression"; elif test "$ASSISTANT_WORKSTREAM" -eq 1; then echo "M6_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,verify-owner-auth-v5,migrate-005,idempotence,assistant-workstream-capability,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,public-work-shell,m3d-m3e-control-regression"; elif test "$COMPAT_REFRESH" -eq 1; then echo "M4_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,owner-auth-v5-capability,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,browser-shaped-owner-login,session,projects,m3d-m3e-control-regression"; else echo "M4_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,migrate-003,idempotence,migrate-004-owner-auth,idempotence,owner-auth-runtime,owner-credential,project-onboarding-ready,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,owner-login,m3d-m3e-control-regression"; fi
  test "$CLEANUP_TOPOLOGY" -eq 1 && echo "M4_TOPOLOGY_CLEANUP=approval-gated-archive-and-verify" || echo "M4_TOPOLOGY_CLEANUP=not-requested"
  if test "$CENTRAL_PROJECT_AUTHORITY" -eq 1; then
    echo "M12_ROLLBACK=restore-db-only-if-migrated,pointer,web-pointer,managed-executor-units,nginx,service-health,m3d-m3e-control-regression"
    echo "M12_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  elif test "$SELF_SERVICE" -eq 1; then
    echo "M11_ROLLBACK=restore-db-v7,pointer,web-pointer,nginx,service-health,m3d-m3e-m4-m7-regression"
    echo "M11_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  elif test "$FOUNDING_MEMORY" -eq 1; then
    echo "M10_ROLLBACK=restore-db-v7,pointer,web-pointer,nginx,service-health,m3d-m3e-m4-m7-regression"
    echo "M10_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  elif test "$FINAL_PRODUCT" -eq 1; then
    echo "M9_ROLLBACK=restore-db-v7,pointer,web-pointer,nginx,service-health,m3d-m3e-m4-m7-regression"
    echo "M9_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  elif test "$UNIFIED_WORKSPACE" -eq 1; then
    echo "M8_ROLLBACK=restore-db-v7,pointer,web-pointer,nginx,service-health,m3d-m3e-m4-m7-regression"
    echo "M8_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  elif test "$WORKSPACE_CONTINUITY" -eq 1; then
    echo "M7_ROLLBACK=restore-db,pointer,nginx,service-health,m3d-regression"
    echo "M7_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  elif test "$ASSISTANT_WORKSTREAM" -eq 1; then
    echo "M6_ROLLBACK=restore-db,pointer,nginx,service-health,m3d-regression"
    echo "M6_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  else
    echo "M4_ROLLBACK=restore-db,pointer,nginx,service-health,m3d-regression"
    echo "M4_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  fi
  exit 0
fi

test "$APPROVED" -eq 1 || { echo "M4 deployment requires explicit --approve" >&2; exit 3; }
test "$OWNER_AUTH" -eq 1 || { echo "Owner-auth activation requires --owner-auth" >&2; exit 3; }
if test $((COMPAT_REFRESH + ASSISTANT_WORKSTREAM + WORKSPACE_CONTINUITY + UNIFIED_WORKSPACE + FINAL_PRODUCT + FOUNDING_MEMORY + SELF_SERVICE + CENTRAL_PROJECT_AUTHORITY)) -gt 1; then echo "Choose one bounded activation mode" >&2; exit 2; fi
if test "$COMPAT_REFRESH" -eq 1; then test "$OWNER_AUTH" -eq 1 || { echo "Owner-auth compatibility refresh requires --owner-auth" >&2; exit 3; }; fi
test -z "$(git -C "$ROOT" status --porcelain --untracked-files=all)" || { echo "M4 deployment requires a clean committed tree" >&2; exit 1; }
test "$(git -C "$ROOT" rev-parse HEAD)" = "$RELEASE" || { echo "M4 release lock does not match local HEAD" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "tar is required" >&2; exit 1; }
command -v scp >/dev/null 2>&1 || { echo "scp is required" >&2; exit 1; }
command -v ssh >/dev/null 2>&1 || { echo "ssh is required" >&2; exit 1; }

PREFLIGHT_OUTPUT=$(AWH_DEPLOY_TARGET="$TARGET" AWH_HUB_HOSTNAME="$HOSTNAME" sh "$PREFLIGHT") || { echo "M4 preflight failed" >&2; exit 1; }
printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -q '^db_classification=DB_AUTHORITY_RESOLVED$' || { echo "M4 preflight did not resolve the Hub database" >&2; exit 1; }
printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -Eq '^backup_classification=(BACKUP_READY|BACKUP_PROVISION_REQUIRED)$' || { echo "M4 backup is not provisionable" >&2; exit 1; }
NGINX_TOPOLOGY=$(printf '%s\n' "$PREFLIGHT_OUTPUT" | sed -n 's/^nginx_topology=//p' | tail -n 1)
case "$NGINX_TOPOLOGY:$CLEANUP_TOPOLOGY" in
  PASS:0|PASS:1|BLOCKED_HISTORICAL_BACKUP_RESIDUE:1) ;;
  BLOCKED_HISTORICAL_BACKUP_RESIDUE:0) echo "M4 Nginx topology cleanup requires --cleanup-topology" >&2; exit 1 ;;
  *) echo "M4 Nginx topology is unsafe: $NGINX_TOPOLOGY" >&2; exit 1 ;;
esac
DB_PATH=$(printf '%s\n' "$PREFLIGHT_OUTPUT" | sed -n 's/^db_resolution_path=//p' | tail -n 1)
NGINX_CONFIG=$(printf '%s\n' "$PREFLIGHT_OUTPUT" | sed -n 's/^effective_nginx_server_config=//p' | tail -n 1)
AWH_FPM_SOCKET=$(printf '%s\n' "$PREFLIGHT_OUTPUT" | sed -n 's/^effective_enrollment_fastcgi=fastcgi_pass unix:\([^;]*\);$/\1/p' | tail -n 1)
AWH_FPM_VERSION=$(basename "$AWH_FPM_SOCKET" | sed -n 's/^php\([0-9][0-9.]*\)-fpm-awh\.sock$/\1/p')
AWH_FPM_SERVICE=php$AWH_FPM_VERSION-fpm.service
case "$DB_PATH" in /var/lib/awh-hub/*|/opt/awh-hub/*|/srv/awh/*) ;; *) echo "M4 DB path is outside the bounded Hub roots" >&2; exit 1 ;; esac
case "$NGINX_CONFIG" in /etc/nginx/sites-enabled/*) ;; *) echo "M4 Nginx authority is unresolved" >&2; exit 1 ;; esac
printf '%s' "$AWH_FPM_SOCKET" | grep -Eq '^/run/php/php[0-9]+\.[0-9]+-fpm-awh\.sock$' || { echo "M4 AWH PHP-FPM authority is unresolved" >&2; exit 1; }
printf '%s' "$AWH_FPM_SERVICE" | grep -Eq '^php[0-9]+\.[0-9]+-fpm\.service$' || { echo "M4 AWH PHP-FPM service is unresolved" >&2; exit 1; }
printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -Fx "php_service_${AWH_FPM_SERVICE}=active" >/dev/null || { echo "M4 AWH PHP-FPM service is not active" >&2; exit 1; }
case "$OWNER_USERNAME" in [A-Za-z][A-Za-z0-9._-][A-Za-z0-9._-]* ) ;; *) echo "Owner username is invalid" >&2; exit 1 ;; esac
test "${#OWNER_USERNAME}" -ge 3 && test "${#OWNER_USERNAME}" -le 64 || { echo "Owner username is invalid" >&2; exit 1; }

OWNER_PASSWORD=
if test "$ASSISTANT_WORKSTREAM" -eq 0 && test "$WORKSPACE_CONTINUITY" -eq 0 && test "$UNIFIED_WORKSPACE" -eq 0 && test "$FINAL_PRODUCT" -eq 0 && test "$FOUNDING_MEMORY" -eq 0 && test "$SELF_SERVICE" -eq 0 && test "$CENTRAL_PROJECT_AUTHORITY" -eq 0; then
  IFS= read -r OWNER_PASSWORD || { echo "Owner password input is required on stdin" >&2; exit 1; }
  test "${#OWNER_PASSWORD}" -ge 12 || { echo "Owner password input is too short" >&2; exit 1; }
  test "${#OWNER_PASSWORD}" -le 512 || { echo "Owner password input is too long" >&2; exit 1; }
  case "$OWNER_PASSWORD" in *[!A-Za-z0-9._~-]*) echo "Owner password input contains unsupported characters" >&2; exit 1 ;; esac
fi

EXTRA_FILES=
if test "$CENTRAL_PROJECT_AUTHORITY" -eq 1; then
  command -v git >/dev/null 2>&1 || { echo "git is required to build the M12 source snapshot" >&2; exit 1; }
  mkdir -p "$ROOT/.awh-build"; rm -f "$ROOT/.awh-build/awh-source.zip"
  git -C "$ROOT" archive --format=zip --output="$ROOT/.awh-build/awh-source.zip" "$RELEASE"
  test -s "$ROOT/.awh-build/awh-source.zip" || { echo "M12 exact source snapshot is unavailable" >&2; exit 1; }
  EXTRA_FILES=.awh-build/awh-source.zip
fi
tar -czf "$BUNDLE" -C "$ROOT" $FILES $EXTRA_FILES
scp -o BatchMode=yes -o StrictHostKeyChecking=yes "$BUNDLE" "$TARGET:$REMOTE_STAGE"
scp -o BatchMode=yes -o StrictHostKeyChecking=yes "$REMOTE_DEPLOY" "$TARGET:$REMOTE_SCRIPT"
set +e
if test "$ASSISTANT_WORKSTREAM" -eq 1 || test "$WORKSPACE_CONTINUITY" -eq 1 || test "$UNIFIED_WORKSPACE" -eq 1 || test "$FINAL_PRODUCT" -eq 1 || test "$FOUNDING_MEMORY" -eq 1 || test "$SELF_SERVICE" -eq 1 || test "$CENTRAL_PROJECT_AUTHORITY" -eq 1; then
  REMOTE_OUTPUT=$(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" sh "$REMOTE_SCRIPT" "$DB_PATH" "$REMOTE_ROOT" "$REMOTE_STAGE" "/opt/awh-hub/control-releases/$RELEASE_ID" "$RELEASE_ID" "$NGINX_CONFIG" "$HOSTNAME" "$AWH_FPM_SOCKET" "$AWH_FPM_SERVICE" "$CLEANUP_TOPOLOGY" "$OWNER_USERNAME" "$OWNER_AUTH" "$REMOTE_SCRIPT" "$COMPAT_REFRESH" "$ASSISTANT_WORKSTREAM" "$WORKSPACE_CONTINUITY" "$UNIFIED_WORKSPACE" "$FINAL_PRODUCT" "$FOUNDING_MEMORY" "$SELF_SERVICE" "$CENTRAL_PROJECT_AUTHORITY" "$RELEASE")
else
  REMOTE_OUTPUT=$(printf '%s\n' "$OWNER_PASSWORD" | ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" sh "$REMOTE_SCRIPT" "$DB_PATH" "$REMOTE_ROOT" "$REMOTE_STAGE" "/opt/awh-hub/control-releases/$RELEASE_ID" "$RELEASE_ID" "$NGINX_CONFIG" "$HOSTNAME" "$AWH_FPM_SOCKET" "$AWH_FPM_SERVICE" "$CLEANUP_TOPOLOGY" "$OWNER_USERNAME" "$OWNER_AUTH" "$REMOTE_SCRIPT" "$COMPAT_REFRESH" "$ASSISTANT_WORKSTREAM" "$WORKSPACE_CONTINUITY" "$UNIFIED_WORKSPACE" "$FINAL_PRODUCT" "$FOUNDING_MEMORY" "$SELF_SERVICE" "$CENTRAL_PROJECT_AUTHORITY")
fi
REMOTE_STATUS=$?
set -e
OWNER_PASSWORD=
if test "${#REMOTE_OUTPUT}" -gt 16384; then echo "M4 remote deployment output exceeded the bound" >&2; exit 1; fi
printf '%s\n' "$REMOTE_OUTPUT" | while IFS= read -r line; do
  case "$line" in
    DEPLOY_STAGE=PROJECT_VAULT_RUNTIME_READY|DEPLOY_STAGE=PROJECT_VAULT_STORAGE_READY|DEPLOY_STAGE=CENTRAL_PROJECT_MIGRATION_FIRST|DEPLOY_STAGE=CENTRAL_PROJECT_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=CENTRAL_PROJECT_MIGRATION_VERIFIED|DEPLOY_STAGE=CENTRAL_PROJECT_ROUTE|DEPLOY_STAGE=PROJECT_VAULT_SOURCE_SYNC) printf '%s\n' "$line" ;;
    DEPLOY_FAILED_AT=PROJECT_VAULT_RUNTIME_READY|DEPLOY_FAILED_AT=PROJECT_VAULT_STORAGE_READY|DEPLOY_FAILED_AT=CENTRAL_PROJECT_MIGRATION_FIRST|DEPLOY_FAILED_AT=CENTRAL_PROJECT_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=CENTRAL_PROJECT_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=CENTRAL_PROJECT_ROUTE|DEPLOY_FAILED_AT=PROJECT_VAULT_SOURCE_SYNC) printf '%s\n' "$line" ;;
    DEPLOY_STAGE=PREMUTATION_READY|DEPLOY_STAGE=TOPOLOGY_CLEANUP_ARCHIVE|DEPLOY_STAGE=TOPOLOGY_CLEANUP_VERIFY|DEPLOY_STAGE=BACKUP_VERIFIED|DEPLOY_STAGE=RELEASE_STAGED|DEPLOY_STAGE=CONTROL_ORIGIN_RENDER|DEPLOY_STAGE=NGINX_CUTOVER_PREPARE|DEPLOY_STAGE=MIGRATION_FIRST_PASS|DEPLOY_STAGE=MIGRATION_IDEMPOTENT|DEPLOY_STAGE=MIGRATION_VERIFIED|DEPLOY_STAGE=OWNER_AUTH_MIGRATION_FIRST|DEPLOY_STAGE=OWNER_AUTH_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=OWNER_AUTH_VERIFIED|DEPLOY_STAGE=OWNER_AUTH_RUNTIME|DEPLOY_STAGE=OWNER_AUTH_COMPATIBILITY|DEPLOY_STAGE=OWNER_AUTH_PRESERVED|DEPLOY_STAGE=OWNER_AUTH_PROVISION|DEPLOY_STAGE=OWNER_AUTH_SURFACE|DEPLOY_STAGE=OWNER_AUTH_LOGIN|DEPLOY_STAGE=OWNER_AUTH_SESSION|DEPLOY_STAGE=OWNER_AUTH_CONTROL|DEPLOY_STAGE=ASSISTANT_MIGRATION_FIRST|DEPLOY_STAGE=ASSISTANT_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=ASSISTANT_MIGRATION_VERIFIED|DEPLOY_STAGE=ASSISTANT_ROUTE|DEPLOY_STAGE=WORKSPACE_PRESERVED|DEPLOY_STAGE=WORKSPACE_MIGRATION_FIRST|DEPLOY_STAGE=WORKSPACE_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=WORKSPACE_MIGRATION_VERIFIED|DEPLOY_STAGE=WORKSPACE_ROUTE|DEPLOY_STAGE=UNIFIED_MIGRATION_FIRST|DEPLOY_STAGE=UNIFIED_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=UNIFIED_MIGRATION_VERIFIED|DEPLOY_STAGE=UNIFIED_ROUTE|DEPLOY_STAGE=FINAL_MIGRATION_FIRST|DEPLOY_STAGE=FINAL_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=FINAL_MIGRATION_VERIFIED|DEPLOY_STAGE=FOUNDING_MIGRATION_FIRST|DEPLOY_STAGE=FOUNDING_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=FOUNDING_MIGRATION_VERIFIED|DEPLOY_STAGE=SELF_SERVICE_MIGRATION_FIRST|DEPLOY_STAGE=SELF_SERVICE_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=SELF_SERVICE_MIGRATION_VERIFIED|DEPLOY_STAGE=PROVIDER_CREDENTIAL_STORAGE_READY|DEPLOY_STAGE=SELF_SERVICE_ROUTE|DEPLOY_STAGE=FOUNDING_MEMORY_ROUTE|DEPLOY_STAGE=ATTACHMENT_STORAGE_READY|DEPLOY_STAGE=ARTIFACT_STORAGE_READY|DEPLOY_STAGE=FINAL_PRODUCT_ROUTE|DEPLOY_STAGE=PROJECT_VAULT_STORAGE_READY|DEPLOY_STAGE=CENTRAL_PROJECT_MIGRATION_FIRST|DEPLOY_STAGE=CENTRAL_PROJECT_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=CENTRAL_PROJECT_MIGRATION_VERIFIED|DEPLOY_STAGE=CENTRAL_PROJECT_ROUTE|DEPLOY_STAGE=PROJECT_VAULT_SOURCE_SYNC|DEPLOY_STAGE=PROJECTS_READY|DEPLOY_STAGE=CONTROL_POINTER|DEPLOY_STAGE=NATIVE_EXECUTOR_UNITS_READY|DEPLOY_STAGE=PHP_FPM_RELOAD|DEPLOY_STAGE=WEB_RELEASE_COPY|DEPLOY_STAGE=WEB_ACCESS_READY|DEPLOY_STAGE=WEB_POINTER_SWITCH|DEPLOY_STAGE=WEB_RELEASE_STAGED|DEPLOY_STAGE=NGINX_CUTOVER_INSTALL|DEPLOY_STAGE=NGINX_CONFIGURED|DEPLOY_STAGE=SERVICE_RELOAD|DEPLOY_STAGE=OWNER_AUTH_EFFECTIVE_CONFIG|DEPLOY_STAGE=OWNER_AUTH_WEB_SURFACE|DEPLOY_STAGE=M3D_REGRESSION|DEPLOY_STAGE=M3E_POST_SCHEMA_REGRESSION|DEPLOY_STAGE=CONTROL_ROUTE) printf '%s\n' "$line" ;;
    DEPLOY_FAILED_AT=WEB_RELEASE_COPY) printf '%s\n' "$line" ;;
    DEPLOY_FAILED_AT=PREMUTATION_READY|DEPLOY_FAILED_AT=TOPOLOGY_CLEANUP_ARCHIVE|DEPLOY_FAILED_AT=TOPOLOGY_CLEANUP_VERIFY|DEPLOY_FAILED_AT=BACKUP_VERIFIED|DEPLOY_FAILED_AT=RELEASE_STAGED|DEPLOY_FAILED_AT=CONTROL_ORIGIN_RENDER|DEPLOY_FAILED_AT=NGINX_CUTOVER_PREPARE|DEPLOY_FAILED_AT=MIGRATION_FIRST_PASS|DEPLOY_FAILED_AT=MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=MIGRATION_VERIFIED|DEPLOY_FAILED_AT=OWNER_AUTH_MIGRATION_FIRST|DEPLOY_FAILED_AT=OWNER_AUTH_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=OWNER_AUTH_VERIFIED|DEPLOY_FAILED_AT=OWNER_AUTH_RUNTIME|DEPLOY_FAILED_AT=OWNER_AUTH_COMPATIBILITY|DEPLOY_FAILED_AT=OWNER_AUTH_PRESERVED|DEPLOY_FAILED_AT=OWNER_AUTH_PROVISION|DEPLOY_FAILED_AT=OWNER_AUTH_LOGIN|DEPLOY_FAILED_AT=OWNER_AUTH_SESSION|DEPLOY_FAILED_AT=OWNER_AUTH_CONTROL|DEPLOY_FAILED_AT=ASSISTANT_MIGRATION_FIRST|DEPLOY_FAILED_AT=ASSISTANT_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=ASSISTANT_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=ASSISTANT_ROUTE|DEPLOY_FAILED_AT=WORKSPACE_PRESERVED|DEPLOY_FAILED_AT=WORKSPACE_MIGRATION_FIRST|DEPLOY_FAILED_AT=WORKSPACE_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=WORKSPACE_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=WORKSPACE_ROUTE|DEPLOY_FAILED_AT=UNIFIED_MIGRATION_FIRST|DEPLOY_FAILED_AT=UNIFIED_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=UNIFIED_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=UNIFIED_ROUTE|DEPLOY_FAILED_AT=FINAL_MIGRATION_FIRST|DEPLOY_FAILED_AT=FINAL_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=FINAL_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=FOUNDING_MIGRATION_FIRST|DEPLOY_FAILED_AT=FOUNDING_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=FOUNDING_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=SELF_SERVICE_MIGRATION_FIRST|DEPLOY_FAILED_AT=SELF_SERVICE_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=SELF_SERVICE_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=PROVIDER_CREDENTIAL_STORAGE_READY|DEPLOY_FAILED_AT=SELF_SERVICE_ROUTE|DEPLOY_FAILED_AT=FOUNDING_MEMORY_ROUTE|DEPLOY_FAILED_AT=ATTACHMENT_STORAGE_READY|DEPLOY_FAILED_AT=FINAL_PRODUCT_ROUTE|DEPLOY_FAILED_AT=PROJECT_VAULT_STORAGE_READY|DEPLOY_FAILED_AT=CENTRAL_PROJECT_MIGRATION_FIRST|DEPLOY_FAILED_AT=CENTRAL_PROJECT_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=CENTRAL_PROJECT_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=CENTRAL_PROJECT_ROUTE|DEPLOY_FAILED_AT=PROJECT_VAULT_SOURCE_SYNC|DEPLOY_FAILED_AT=PROJECTS_READY|DEPLOY_FAILED_AT=CONTROL_POINTER|DEPLOY_FAILED_AT=PHP_FPM_RELOAD|DEPLOY_FAILED_AT=WEB_ACCESS_READY|DEPLOY_FAILED_AT=WEB_POINTER_SWITCH|DEPLOY_FAILED_AT=WEB_RELEASE_STAGED|DEPLOY_FAILED_AT=NGINX_CUTOVER_INSTALL|DEPLOY_FAILED_AT=NGINX_INCLUDE_PREPARE|DEPLOY_FAILED_AT=NGINX_INCLUDE_INSERT|DEPLOY_FAILED_AT=NGINX_CONFIGURED|DEPLOY_FAILED_AT=SERVICE_RELOAD|DEPLOY_FAILED_AT=OWNER_AUTH_SURFACE|DEPLOY_FAILED_AT=OWNER_AUTH_WEB_SURFACE|DEPLOY_FAILED_AT=M3D_REGRESSION|DEPLOY_FAILED_AT=M3E_POST_SCHEMA_REGRESSION|DEPLOY_FAILED_AT=CONTROL_ROUTE|DEPLOY_FAILED_AT=REMOTE_TRANSPORT|DEPLOY_FAILED_AT=REMOTE_RESULT_MISSING) printf '%s\n' "$line" ;;
    DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_HTTP_[0-9][0-9][0-9]|DEPLOY_DIAGNOSTIC=OWNER_AUTH_LOGIN_HTTP_[0-9][0-9][0-9]|DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_ATTEMPTS_[1-9]|DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_ATTEMPTS_10|DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_BASIC_CHALLENGE|DEPLOY_DIAGNOSTIC=OWNER_AUTH_LOGIN_BASIC_CHALLENGE) printf '%s\n' "$line" ;;
    DEPLOY_RESULT=PASS|ROLLBACK=PASS|ROLLBACK=FAIL) printf '%s\n' "$line" ;;
    '') : ;;
    *) echo "M4 remote output contract rejected" >&2; exit 1 ;;
  esac
done
if test "$REMOTE_STATUS" -ne 0; then test -n "$REMOTE_OUTPUT" || echo 'DEPLOY_FAILED_AT=REMOTE_TRANSPORT'; exit "$REMOTE_STATUS"; fi
printf '%s\n' "$REMOTE_OUTPUT" | grep -q '^DEPLOY_RESULT=PASS$' || { echo 'DEPLOY_FAILED_AT=REMOTE_RESULT_MISSING' >&2; exit 1; }
