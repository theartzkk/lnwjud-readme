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
ANYWHERE_EXECUTION=0
COST_AWARE_AI=0
AUTOMATIONS=0
SELF_SUFFICIENT_AI=0
ACCOUNT_HOSTING=0
CLOUD_FIRST=0
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
    --anywhere-execution) ANYWHERE_EXECUTION=1 ;;
    --cost-aware-ai) COST_AWARE_AI=1 ;;
    --automations) AUTOMATIONS=1 ;;
    --self-sufficient-ai) SELF_SUFFICIENT_AI=1 ;;
    --account-hosting) ACCOUNT_HOSTING=1 ;;
    --cloud-first) CLOUD_FIRST=1 ;;
    *) echo "Usage: $0 [--dry-run] | --deploy --approve --owner-auth [--compat-refresh|--assistant-workstream|--workspace-continuity|--unified-workspace|--final-product|--founding-memory|--self-service|--central-project-authority|--anywhere-execution|--cost-aware-ai|--automations|--self-sufficient-ai|--account-hosting|--cloud-first] [--cleanup-topology]" >&2; exit 2 ;;
  esac
done
if test "$MODE" = dry-run && test "$APPROVED" -eq 1; then echo "--approve requires --deploy" >&2; exit 2; fi

ROOT=${AWH_SOURCE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}
TARGET=${AWH_DEPLOY_TARGET:-awh-ready}
RELEASE=${AWH_RELEASE_COMMIT:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)}
HOSTNAME=${AWH_HUB_HOSTNAME:-157-85-108-142.sslip.io}
OWNER_USERNAME=${AWH_OWNER_AUTH_USERNAME:-art}
REMOTE_ROOT=/opt/awh-hub
if test "$CLOUD_FIRST" -eq 1; then RELEASE_ID=m18-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$ACCOUNT_HOSTING" -eq 1; then RELEASE_ID=m17-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$SELF_SUFFICIENT_AI" -eq 1; then RELEASE_ID=m16-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$AUTOMATIONS" -eq 1; then RELEASE_ID=m15-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$COST_AWARE_AI" -eq 1; then RELEASE_ID=m14-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$ANYWHERE_EXECUTION" -eq 1; then RELEASE_ID=m13-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$CENTRAL_PROJECT_AUTHORITY" -eq 1; then RELEASE_ID=m12-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$SELF_SERVICE" -eq 1; then RELEASE_ID=m11-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$FOUNDING_MEMORY" -eq 1; then RELEASE_ID=m10-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$FINAL_PRODUCT" -eq 1; then RELEASE_ID=m9-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$UNIFIED_WORKSPACE" -eq 1; then RELEASE_ID=m8-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$WORKSPACE_CONTINUITY" -eq 1; then RELEASE_ID=m7-$(printf '%s' "$RELEASE" | cut -c1-12); elif test "$ASSISTANT_WORKSTREAM" -eq 1; then RELEASE_ID=m6-$(printf '%s' "$RELEASE" | cut -c1-12); else RELEASE_ID=m4-$(printf '%s' "$RELEASE" | cut -c1-12); fi
REMOTE_STAGE=/tmp/awh-control-plane-$RELEASE_ID.tar.gz
PREFLIGHT=$ROOT/deploy/awh-enrollment/preflight-production.sh
REMOTE_DEPLOY=$ROOT/deploy/awh-control-plane/remote-deploy-control-plane.sh
OUTPUT_VALIDATOR=$ROOT/deploy/awh-control-plane/validate-remote-output.sh
REMOTE_SCRIPT=/tmp/awh-control-plane-$RELEASE_ID.sh
BUNDLE=$(mktemp "${TMPDIR:-/tmp}/awh-control-plane.XXXXXX")
RELEASE_BUILD_LOCK=$ROOT/.awh-build/release-build.lock
RELEASE_BUILD_LOCK_HELD=0
cleanup() {
  rm -f "$BUNDLE"
  if test "$RELEASE_BUILD_LOCK_HELD" -eq 1; then
    rm -f "$RELEASE_BUILD_LOCK/owner"
    rmdir "$RELEASE_BUILD_LOCK" 2>/dev/null || true
  fi
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$ROOT/.awh-build"
lease_attempt=0
while :; do
  if mkdir "$RELEASE_BUILD_LOCK" 2>/dev/null; then
    printf '%s\n' "$$" > "$RELEASE_BUILD_LOCK/owner"
    RELEASE_BUILD_LOCK_HELD=1
    break
  fi
  lease_owner=$(cat "$RELEASE_BUILD_LOCK/owner" 2>/dev/null || true)
  case "$lease_owner" in
    ''|*[!0-9]*) stale_lease=1 ;;
    *) if kill -0 "$lease_owner" 2>/dev/null; then stale_lease=0; else stale_lease=1; fi ;;
  esac
  if test "$stale_lease" -eq 1; then
    rm -f "$RELEASE_BUILD_LOCK/owner"
    rmdir "$RELEASE_BUILD_LOCK" 2>/dev/null || true
    continue
  fi
  lease_attempt=$((lease_attempt + 1))
  test "$lease_attempt" -lt 60 || { echo "Another AWH release build still holds the build lease" >&2; exit 1; }
  sleep 1
done

case "$TARGET" in ''|*[!A-Za-z0-9._-]*) echo "AWH_DEPLOY_TARGET is invalid" >&2; exit 2 ;; esac
case "$RELEASE" in ''|*[!0-9a-fA-F]*) echo "AWH_RELEASE_COMMIT is invalid" >&2; exit 2 ;; esac
case "$HOSTNAME" in ''|*[!A-Za-z0-9.-]*|.*|*.) echo "AWH_HUB_HOSTNAME is invalid" >&2; exit 2 ;; esac
case "$HOSTNAME" in *[A-Za-z]*.*) : ;; *) echo "AWH_HUB_HOSTNAME is invalid" >&2; exit 2 ;; esac

# The web tree is a release artifact, never a reused local preview. Build it
# from this exact source lock before checking or bundling any deployment asset.
command -v node >/dev/null 2>&1 || { echo "node is required to build the CONTROL web release" >&2; exit 1; }
AWH_WEB_RELEASE_ID="$RELEASE_ID" node --import tsx "$ROOT/scripts/build-web-preview.ts" --control >/dev/null
AWH_RELEASE_ID="$RELEASE_ID" node "$ROOT/scripts/create-web-release-manifest.mjs" "$ROOT/dist-web" >/dev/null

FILES="hub/public/control-plane.php hub/src/HubEnrollmentService.php hub/src/HubEnrollmentApiMigration.php hub/src/HubControlPlaneService.php hub/src/HubThaiGovernmentDocumentService.php hub/assets/thai-government-garuda-v7.png hub/src/HubControlPlaneRouter.php hub/src/HubBrowserOriginPolicy.php hub/src/HubControlPlaneMigration.php hub/src/HubControlPlaneProjectRegistration.php hub/src/HubOwnerAuthMigration.php hub/src/HubOwnerAuthService.php hub/src/HubOwnerAuthRouter.php hub/src/HubAssistantWorkstreamMigration.php hub/src/HubWorkspaceContinuityMigration.php hub/src/HubUnifiedWorkspaceMigration.php hub/src/HubFinalProductMigration.php hub/src/HubFoundingMemorySeed.php hub/src/HubFoundingMemoryMigration.php hub/src/HubFoundingMemoryService.php hub/src/HubSelfServiceMigration.php hub/src/HubCentralProjectAuthorityMigration.php hub/src/HubAnywhereExecutionMigration.php hub/src/HubCapabilityRegistryService.php hub/src/HubCostAwareAiMigration.php hub/src/HubProviderPricingService.php hub/src/HubAutomationMigration.php hub/src/HubAutomationRegistryService.php hub/src/HubAutomationSchedulerService.php hub/src/HubAiProviderAdapter.php hub/src/HubOpenAiProviderAdapter.php hub/src/HubAiGovernanceService.php hub/src/HubAiQualificationService.php hub/src/HubSelfSufficientAiMigration.php hub/src/HubAccountHostingMigration.php hub/src/HubTrustPolicy.php hub/src/HubManagedHostingService.php hub/src/HubManagedHostingOperator.php hub/src/HubProjectVault.php hub/src/HubProjectVaultService.php hub/src/HubDurableExecutionService.php hub/src/HubSecretContentPolicy.php hub/src/HubProviderCredentialStore.php hub/src/HubAttachmentStore.php hub/src/HubArtifactStore.php hub/src/HubNativeAgentService.php hub/src/HubDatabaseStudioService.php hub/src/HubDatabaseStudioRouter.php hub/src/HubBackupService.php hub/src/HubInfrastructureService.php hub/public/database-studio.php hub/bin/backup.php hub/bin/activate-release.php hub/bin/scheduled-backup.php hub/bin/system-telemetry.php deploy/systemd/awh-backup.service deploy/systemd/awh-backup.timer hub/migrations/001_m3e_enrollment.sql hub/migrations/002_m3e2_enrollment_api.sql hub/migrations/003_m4_control_plane.sql hub/migrations/004_owner_auth.sql hub/migrations/005_assistant_workstream.sql hub/migrations/006_workspace_continuity.sql hub/migrations/007_unified_workspace.sql hub/migrations/008_final_product.sql hub/migrations/009_founding_memory.sql hub/migrations/010_self_service.sql hub/migrations/011_central_project_authority.sql hub/migrations/012_anywhere_execution_fabric.sql hub/migrations/013_cost_aware_ai.sql hub/migrations/014_automations.sql hub/migrations/015_self_sufficient_ai.sql hub/migrations/016_account_hosting.sql hub/bin/migrate-m4.php hub/bin/migrate-owner-auth.php hub/bin/migrate-assistant-workstream.php hub/bin/migrate-workspace-continuity.php hub/bin/migrate-unified-workspace.php hub/bin/migrate-final-product.php hub/bin/migrate-founding-memory.php hub/bin/migrate-self-service.php hub/bin/migrate-central-project-authority.php hub/bin/migrate-anywhere-execution.php hub/bin/migrate-cost-aware-ai.php hub/bin/migrate-automations.php hub/bin/migrate-self-sufficient-ai.php hub/bin/migrate-account-hosting.php hub/bin/awh-hosting-operator.php hub/bin/awh-native-executor.php hub/bin/sync-deployed-source-vault.php hub/bin/register-m4-projects.php hub/bin/setup-owner-auth.php hub/bin/verify-owner-auth-runtime.php deploy/systemd/awh-native-executor.service deploy/systemd/awh-native-executor.timer deploy/systemd/awh-hosting-operator.service deploy/systemd/awh-hosting-operator.timer deploy/nginx/awh-control-plane.conf deploy/nginx/render-control-plane-include.php deploy/nginx/transform-owner-auth.php deploy/awh-enrollment/insert-nginx-include.php deploy/awh-control-plane/remote-deploy-control-plane.sh dist-web/index.html dist-web/styles.css dist-web/awh-design-system.css dist-web/app.js dist-web/dashboard.css dist-web/dashboard.js dist-web/execution-ux.js dist-web/tool-registry.js dist-web/school-tools.js dist-web/vendor/pdf-lib.min.js dist-web/vendor/qrcode.js dist-web/database.html dist-web/database.css dist-web/database.js dist-web/infrastructure.html dist-web/infrastructure.css dist-web/infrastructure.js dist-web/hosting.html dist-web/hosting.css dist-web/hosting.js dist-web/trust.html dist-web/trust.css dist-web/trust.js dist-web/hub-read-adapter.js dist-web/control-plane-adapter.js dist-web/manifest.webmanifest dist-web/sw.js dist-web/logo-256x256.png dist-web/web-config.json dist-web/data.json dist-web/release.json"
DESKTOP_ARTIFACT_FILES="dist-web/downloads/AWH-macOS-x64.zip dist-web/downloads/AWH-Windows-x64.zip dist-web/downloads/SHA256SUMS.txt"
FILES="$FILES hub/src/HubStorageGovernanceService.php hub/src/HubExecutionTriageService.php hub/src/HubStaffGovernorService.php hub/src/HubStaffOperationsService.php hub/src/HubActionGraphService.php hub/src/HubConversationReferentService.php deploy/awh-control-plane/verify-web-release.php dist-web/navigation.js"
FILES="$FILES dist-web/responsive-layout.css dist-web/review.html dist-web/review.css dist-web/review.js"
FILES="$FILES hub/src/HubCloudFirstMigration.php hub/src/HubCloudWorkflowService.php hub/migrations/017_cloud_first_control.sql hub/bin/migrate-cloud-first.php .github/workflows/awh-cloud-qa.yml .github/workflows/awh-cloud-review.yml"
DESKTOP_ARTIFACTS=
desktop_artifact_count=0
for file in $DESKTOP_ARTIFACT_FILES; do
  if test -f "$ROOT/$file"; then desktop_artifact_count=$((desktop_artifact_count + 1)); fi
done
case "$MODE:$desktop_artifact_count" in
  dry-run:0|*:3) : ;;
  *) echo "Desktop release artifacts must be complete for production deploy" >&2; exit 1 ;;
esac
# Desktop packages are content-addressed on ReadyIDC. A backend/web refresh
# reuses an already-verified object instead of retransmitting the large bytes.
for file in $DESKTOP_ARTIFACT_FILES; do
  test -f "$ROOT/$file" || continue
  if test "$MODE" = deploy; then
    digest=$(node -e 'const fs=require("node:fs"),c=require("node:crypto");const b=fs.readFileSync(process.argv[1]);process.stdout.write(c.createHash("sha256").update(b).digest("hex"))' "$ROOT/$file")
    case "$digest" in *[!0-9a-f]*|'') echo "Desktop artifact checksum is invalid" >&2; exit 1 ;; esac
    test "${#digest}" -eq 64 || { echo "Desktop artifact checksum is invalid" >&2; exit 1; }
    name=$(basename "$file")
    remote_digest=$(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" "sudo test -f '/var/www/awh-web/desktop-artifacts/$digest-$name' && sudo sha256sum '/var/www/awh-web/desktop-artifacts/$digest-$name' | cut -d' ' -f1" 2>/dev/null || true)
    if test "$remote_digest" = "$digest"; then
      printf '%s\n' "DESKTOP_ARTIFACT_REUSE=$name"
      continue
    fi
  fi
  DESKTOP_ARTIFACTS="$DESKTOP_ARTIFACTS $file"
done
FILES="$FILES$DESKTOP_ARTIFACTS"
BUNDLE_CLOSURE=$ROOT/scripts/deploy/verify-control-plane-bundle-closure.mjs
test -f "$BUNDLE_CLOSURE" || { echo "Missing control-plane bundle closure verifier" >&2; exit 1; }
node "$BUNDLE_CLOSURE" "$ROOT" $FILES >/dev/null || { echo "Control-plane bundle dependency closure failed" >&2; exit 1; }
for file in $FILES; do test -f "$ROOT/$file" || { echo "Missing reviewed M4 asset: $file" >&2; exit 1; }; done
test -f "$PREFLIGHT" || { echo "Missing read-only production preflight" >&2; exit 1; }
test -f "$OUTPUT_VALIDATOR" || { echo "Missing typed remote output validator" >&2; exit 1; }
test -f "$ROOT/dist-web/web-config.json" || { echo "Missing CONTROL web release" >&2; exit 1; }
grep -q '"mode": "CONTROL"' "$ROOT/dist-web/web-config.json" || { echo "CONTROL web release is required" >&2; exit 1; }
grep -q '"mode": "CONTROL"' "$ROOT/dist-web/data.json" || { echo "CONTROL web data release is required" >&2; exit 1; }
! grep -q 'Remote Preview\|Preview only\|static build' "$ROOT/dist-web/data.json" || { echo "CONTROL web release contains stale preview data" >&2; exit 1; }
grep -q "awh-shell-$RELEASE_ID" "$ROOT/dist-web/sw.js" || { echo "CONTROL service worker release identity is missing" >&2; exit 1; }

if test "$MODE" = dry-run; then
  if test "$CLOUD_FIRST" -eq 1; then echo "M18_ARTIFACT_STORAGE=private-object-root-required"; elif test "$ACCOUNT_HOSTING" -eq 1; then echo "M17_ARTIFACT_STORAGE=private-object-root-required"; elif test "$SELF_SUFFICIENT_AI" -eq 1; then echo "M16_ARTIFACT_STORAGE=private-object-root-required"; elif test "$AUTOMATIONS" -eq 1; then echo "M15_ARTIFACT_STORAGE=private-object-root-required"; elif test "$COST_AWARE_AI" -eq 1; then echo "M14_ARTIFACT_STORAGE=private-object-root-required"; elif test "$ANYWHERE_EXECUTION" -eq 1; then echo "M13_ARTIFACT_STORAGE=private-object-root-required"; elif test "$CENTRAL_PROJECT_AUTHORITY" -eq 1; then echo "M12_ARTIFACT_STORAGE=private-object-root-required"; fi
  if test "$CLOUD_FIRST" -eq 1; then echo "M18_DRY_RUN=PASS"; echo "M18_TARGET=$TARGET"; echo "M18_RELEASE=$RELEASE"; elif test "$ACCOUNT_HOSTING" -eq 1; then echo "M17_DRY_RUN=PASS"; echo "M17_TARGET=$TARGET"; echo "M17_RELEASE=$RELEASE"; elif test "$SELF_SUFFICIENT_AI" -eq 1; then echo "M16_DRY_RUN=PASS"; echo "M16_TARGET=$TARGET"; echo "M16_RELEASE=$RELEASE"; elif test "$AUTOMATIONS" -eq 1; then echo "M15_DRY_RUN=PASS"; echo "M15_TARGET=$TARGET"; echo "M15_RELEASE=$RELEASE"; elif test "$COST_AWARE_AI" -eq 1; then echo "M14_DRY_RUN=PASS"; echo "M14_TARGET=$TARGET"; echo "M14_RELEASE=$RELEASE"; elif test "$ANYWHERE_EXECUTION" -eq 1; then echo "M13_DRY_RUN=PASS"; echo "M13_TARGET=$TARGET"; echo "M13_RELEASE=$RELEASE"; elif test "$CENTRAL_PROJECT_AUTHORITY" -eq 1; then echo "M12_DRY_RUN=PASS"; echo "M12_TARGET=$TARGET"; echo "M12_RELEASE=$RELEASE"; elif test "$SELF_SERVICE" -eq 1; then echo "M11_DRY_RUN=PASS"; echo "M11_TARGET=$TARGET"; echo "M11_RELEASE=$RELEASE"; elif test "$FOUNDING_MEMORY" -eq 1; then echo "M10_DRY_RUN=PASS"; echo "M10_TARGET=$TARGET"; echo "M10_RELEASE=$RELEASE"; elif test "$FINAL_PRODUCT" -eq 1; then echo "M9_DRY_RUN=PASS"; echo "M9_TARGET=$TARGET"; echo "M9_RELEASE=$RELEASE"; elif test "$UNIFIED_WORKSPACE" -eq 1; then echo "M8_DRY_RUN=PASS"; echo "M8_TARGET=$TARGET"; echo "M8_RELEASE=$RELEASE"; elif test "$WORKSPACE_CONTINUITY" -eq 1; then echo "M7_DRY_RUN=PASS"; echo "M7_TARGET=$TARGET"; echo "M7_RELEASE=$RELEASE"; elif test "$ASSISTANT_WORKSTREAM" -eq 1; then echo "M6_DRY_RUN=PASS"; echo "M6_TARGET=$TARGET"; echo "M6_RELEASE=$RELEASE"; else echo "M4_DRY_RUN=PASS"; echo "M4_TARGET=$TARGET"; echo "M4_RELEASE=$RELEASE"; fi
  if test "$CLOUD_FIRST" -eq 1; then echo "M18_PLAN=build-control-pwa,preflight,backup,stage,verify-v17-or-v18-authority,quiesce-native-and-hosting-operators,migrate-017-only-from-v17,source-refresh-without-migration-on-v18,verify-no-shadow-authority,cloud-capability-route,control-pointer,resume-managed-operators,php-fpm-reload,web-pointer,nginx-test,reload,project-vault-source-sync,m3d-m3e-control-regression"; elif test "$ACCOUNT_HOSTING" -eq 1; then echo "M17_PLAN=build-control-pwa,preflight,backup,stage,verify-v16-or-v17-authority,migrate-016-only-from-v16,account-membership-authority,managed-hosting-authority,typed-hosting-operator,control-pointer,php-fpm-reload,web-pointer,nginx-test,reload,m3d-m3e-control-regression"; elif test "$SELF_SUFFICIENT_AI" -eq 1; then echo "M16_PLAN=build-control-pwa,preflight,backup,stage,verify-v15-or-v16-authority,quiesce-native-executor,migrate-015-only-from-v15,source-refresh-without-migration-on-v16,self-sufficient-ai-governance-route,control-pointer,resume-native-executor,php-fpm-reload,web-pointer,nginx-test,reload,project-vault-source-sync,m3d-m3e-control-regression"; elif test "$AUTOMATIONS" -eq 1; then echo "M15_PLAN=build-control-pwa,preflight,backup,stage,verify-v14-or-v15-authority,quiesce-native-executor,migrate-014-only-from-v14,source-refresh-without-migration-on-v15,automation-registry-and-scheduler,control-pointer,resume-native-executor,php-fpm-reload,web-pointer,nginx-test,reload,project-vault-source-sync,m3d-m3e-control-regression"; elif test "$COST_AWARE_AI" -eq 1; then echo "M14_PLAN=build-control-pwa,preflight,backup,stage,verify-v13-or-v14-authority,quiesce-native-executor,migrate-013-only-from-v13,source-refresh-without-migration-on-v14,cost-aware-provider-route,control-pointer,resume-native-executor,php-fpm-reload,web-pointer,nginx-test,reload,project-vault-source-sync,m3d-m3e-control-regression"; elif test "$ANYWHERE_EXECUTION" -eq 1; then echo "M13_PLAN=build-control-pwa,preflight,backup,stage,verify-v12-or-v13-authority,quiesce-native-executor,migrate-012-only-from-v12,source-refresh-without-migration-on-v13,capability-fabric-route,control-pointer,resume-native-executor,php-fpm-reload,web-pointer,nginx-test,reload,project-vault-source-sync,m3d-m3e-control-regression"; elif test "$CENTRAL_PROJECT_AUTHORITY" -eq 1; then echo "M12_PLAN=build-control-pwa,preflight,backup,stage,verify-v11-or-v12-authority,project-vault-runtime-ready,project-vault-storage-ready,migrate-011-only-from-v11,source-refresh-without-migration-on-v12,control-pointer,refresh-managed-native-executor,php-fpm-reload,project-vault-source-sync,web-pointer,nginx-test,reload,unauthenticated-vault-route,m3d-m3e-control-regression"; elif test "$SELF_SERVICE" -eq 1; then echo "M11_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,verify-m7-capability,migrate-007,idempotence,migrate-008,idempotence,attachment-storage-ready,migrate-009,idempotence,founding-memory-capability,migrate-010,idempotence,provider-credential-storage-ready,self-service-capability,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,public-work-shell,m3d-m3e-control-regression"; elif test "$FOUNDING_MEMORY" -eq 1; then echo "M10_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,verify-m7-capability,migrate-007,idempotence,migrate-008,idempotence,attachment-storage-ready,migrate-009,idempotence,founding-memory-import,idempotence,founding-memory-capability,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,public-work-shell,m3d-m3e-control-regression"; elif test "$FINAL_PRODUCT" -eq 1; then echo "M9_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,verify-m7-capability,migrate-007,idempotence,migrate-008,idempotence,attachment-storage-ready,final-product-capability,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,public-work-shell,m3d-m3e-control-regression"; elif test "$UNIFIED_WORKSPACE" -eq 1; then echo "M8_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,verify-m7-capability,migrate-007,idempotence,unified-workspace-capability,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,public-work-shell,m3d-m3e-control-regression"; elif test "$WORKSPACE_CONTINUITY" -eq 1; then echo "M7_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,verify-owner-auth-v5,migrate-005,idempotence,assistant-workstream-capability,migrate-006,idempotence,workspace-continuity-capability,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,public-work-shell,m3d-m3e-control-regression"; elif test "$ASSISTANT_WORKSTREAM" -eq 1; then echo "M6_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,verify-owner-auth-v5,migrate-005,idempotence,assistant-workstream-capability,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,public-work-shell,m3d-m3e-control-regression"; elif test "$COMPAT_REFRESH" -eq 1; then echo "M4_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,owner-auth-v5-capability,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,browser-shaped-owner-login,session,projects,m3d-m3e-control-regression"; else echo "M4_PLAN=build-control-pwa,preflight,backup,stage,nginx-cutover-candidate,migrate-003,idempotence,migrate-004-owner-auth,idempotence,owner-auth-runtime,owner-credential,project-onboarding-ready,control-pointer,php-fpm-reload,web-pointer,nginx-cutover,nginx-test,reload,owner-login,m3d-m3e-control-regression"; fi
  test "$CLEANUP_TOPOLOGY" -eq 1 && echo "M4_TOPOLOGY_CLEANUP=approval-gated-archive-and-verify" || echo "M4_TOPOLOGY_CLEANUP=not-requested"
  if test "$CLOUD_FIRST" -eq 1; then
    echo "M18_ROLLBACK=restore-exact-db-baseline,pointer,web-pointer,native-executor,hosting-operator,nginx,service-health,m3d-m3e-control-regression"
    echo "M18_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  elif test "$ACCOUNT_HOSTING" -eq 1; then
    echo "M17_ROLLBACK=restore-exact-db-baseline,pointer,web-pointer,hosting-operator,nginx,service-health,m3d-m3e-control-regression"
    echo "M17_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  elif test "$SELF_SUFFICIENT_AI" -eq 1; then
    echo "M16_ROLLBACK=restore-exact-db-baseline,pointer,web-pointer,native-executor,nginx,service-health,m3d-m3e-control-regression"
    echo "M16_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  elif test "$AUTOMATIONS" -eq 1; then
    echo "M15_ROLLBACK=restore-exact-db-baseline,pointer,web-pointer,native-executor,nginx,service-health,m3d-m3e-control-regression"
    echo "M15_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  elif test "$COST_AWARE_AI" -eq 1; then
    echo "M14_ROLLBACK=restore-exact-db-baseline,pointer,web-pointer,native-executor,nginx,service-health,m3d-m3e-control-regression"
    echo "M14_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  elif test "$ANYWHERE_EXECUTION" -eq 1; then
    echo "M13_ROLLBACK=restore-exact-db-baseline,pointer,web-pointer,native-executor,nginx,service-health,m3d-m3e-control-regression"
    echo "M13_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  elif test "$CENTRAL_PROJECT_AUTHORITY" -eq 1; then
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
EXTENSION_MODE_COUNT=$((ASSISTANT_WORKSTREAM + WORKSPACE_CONTINUITY + UNIFIED_WORKSPACE + FINAL_PRODUCT + FOUNDING_MEMORY + SELF_SERVICE + CENTRAL_PROJECT_AUTHORITY + ANYWHERE_EXECUTION + COST_AWARE_AI + AUTOMATIONS + SELF_SUFFICIENT_AI + ACCOUNT_HOSTING + CLOUD_FIRST))
if test $((COMPAT_REFRESH + EXTENSION_MODE_COUNT)) -gt 1; then echo "Choose one bounded activation mode" >&2; exit 2; fi
OWNER_LOGIN_PROOF_REQUIRED=0
if test "$EXTENSION_MODE_COUNT" -eq 0; then OWNER_LOGIN_PROOF_REQUIRED=1; fi
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
if test "$OWNER_LOGIN_PROOF_REQUIRED" -eq 1; then
  IFS= read -r OWNER_PASSWORD || { echo "Owner password input is required on stdin" >&2; exit 1; }
  test "${#OWNER_PASSWORD}" -ge 12 || { echo "Owner password input is too short" >&2; exit 1; }
  test "${#OWNER_PASSWORD}" -le 512 || { echo "Owner password input is too long" >&2; exit 1; }
  case "$OWNER_PASSWORD" in *[!A-Za-z0-9._~-]*) echo "Owner password input contains unsupported characters" >&2; exit 1 ;; esac
fi

EXTRA_FILES=
if test "$CENTRAL_PROJECT_AUTHORITY" -eq 1 || test "$ANYWHERE_EXECUTION" -eq 1 || test "$COST_AWARE_AI" -eq 1 || test "$AUTOMATIONS" -eq 1 || test "$SELF_SUFFICIENT_AI" -eq 1 || test "$ACCOUNT_HOSTING" -eq 1 || test "$CLOUD_FIRST" -eq 1; then
  command -v git >/dev/null 2>&1 || { echo "git is required to build the M12/M13/M14/M15/M16/M17/M18 source snapshot" >&2; exit 1; }
  mkdir -p "$ROOT/.awh-build"; rm -f "$ROOT/.awh-build/awh-source.zip" "$ROOT/.awh-build/release-commit.txt"
  git -C "$ROOT" archive --format=zip --output="$ROOT/.awh-build/awh-source.zip" "$RELEASE"
  printf '%s\n' "$RELEASE" > "$ROOT/.awh-build/release-commit.txt"
  test -s "$ROOT/.awh-build/awh-source.zip" || { echo "M12/M13/M14/M15/M16/M17 exact source snapshot is unavailable" >&2; exit 1; }
  grep -Fx "$RELEASE" "$ROOT/.awh-build/release-commit.txt" >/dev/null || { echo "release commit marker is invalid" >&2; exit 1; }
  EXTRA_FILES='.awh-build/awh-source.zip .awh-build/release-commit.txt'
fi
tar -czf "$BUNDLE" -C "$ROOT" $FILES $EXTRA_FILES
scp -o BatchMode=yes -o StrictHostKeyChecking=yes "$BUNDLE" "$TARGET:$REMOTE_STAGE"
scp -o BatchMode=yes -o StrictHostKeyChecking=yes "$REMOTE_DEPLOY" "$TARGET:$REMOTE_SCRIPT"
set +e
if test "$OWNER_LOGIN_PROOF_REQUIRED" -eq 0; then
  REMOTE_OUTPUT=$(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" sh "$REMOTE_SCRIPT" "$DB_PATH" "$REMOTE_ROOT" "$REMOTE_STAGE" "/opt/awh-hub/control-releases/$RELEASE_ID" "$RELEASE_ID" "$NGINX_CONFIG" "$HOSTNAME" "$AWH_FPM_SOCKET" "$AWH_FPM_SERVICE" "$CLEANUP_TOPOLOGY" "$OWNER_USERNAME" "$OWNER_AUTH" "$REMOTE_SCRIPT" "$COMPAT_REFRESH" "$ASSISTANT_WORKSTREAM" "$WORKSPACE_CONTINUITY" "$UNIFIED_WORKSPACE" "$FINAL_PRODUCT" "$FOUNDING_MEMORY" "$SELF_SERVICE" "$CENTRAL_PROJECT_AUTHORITY" "$RELEASE" "$ANYWHERE_EXECUTION" "$COST_AWARE_AI" "$AUTOMATIONS" "$SELF_SUFFICIENT_AI" "$ACCOUNT_HOSTING" "$CLOUD_FIRST")
else
  REMOTE_OUTPUT=$(printf '%s\n' "$OWNER_PASSWORD" | ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" sh "$REMOTE_SCRIPT" "$DB_PATH" "$REMOTE_ROOT" "$REMOTE_STAGE" "/opt/awh-hub/control-releases/$RELEASE_ID" "$RELEASE_ID" "$NGINX_CONFIG" "$HOSTNAME" "$AWH_FPM_SOCKET" "$AWH_FPM_SERVICE" "$CLEANUP_TOPOLOGY" "$OWNER_USERNAME" "$OWNER_AUTH" "$REMOTE_SCRIPT" "$COMPAT_REFRESH" "$ASSISTANT_WORKSTREAM" "$WORKSPACE_CONTINUITY" "$UNIFIED_WORKSPACE" "$FINAL_PRODUCT" "$FOUNDING_MEMORY" "$SELF_SERVICE" "$CENTRAL_PROJECT_AUTHORITY" "$RELEASE" "$ANYWHERE_EXECUTION" "$COST_AWARE_AI" "$AUTOMATIONS" "$SELF_SUFFICIENT_AI" "$ACCOUNT_HOSTING" "$CLOUD_FIRST")
fi
REMOTE_STATUS=$?
set -e
OWNER_PASSWORD=
if test "${#REMOTE_OUTPUT}" -gt 16384; then echo "M4 remote deployment output exceeded the bound" >&2; exit 1; fi
printf '%s\n' "$REMOTE_OUTPUT" | while IFS= read -r line; do
  case "$line" in
    DEPLOY_STAGE=PROJECT_VAULT_RUNTIME_READY|DEPLOY_STAGE=PROJECT_VAULT_STORAGE_READY|DEPLOY_STAGE=CENTRAL_PROJECT_MIGRATION_FIRST|DEPLOY_STAGE=CENTRAL_PROJECT_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=CENTRAL_PROJECT_MIGRATION_VERIFIED|DEPLOY_STAGE=CENTRAL_PROJECT_ROUTE|DEPLOY_STAGE=PROJECT_VAULT_SOURCE_SYNC|DEPLOY_STAGE=NATIVE_EXECUTOR_QUIESCED|DEPLOY_STAGE=ANYWHERE_MIGRATION_FIRST|DEPLOY_STAGE=ANYWHERE_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=ANYWHERE_MIGRATION_VERIFIED|DEPLOY_STAGE=ANYWHERE_EXECUTION_ROUTE|DEPLOY_STAGE=COST_AWARE_MIGRATION_FIRST|DEPLOY_STAGE=COST_AWARE_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=COST_AWARE_MIGRATION_VERIFIED|DEPLOY_STAGE=COST_AWARE_AI_ROUTE|DEPLOY_STAGE=AUTOMATION_MIGRATION_FIRST|DEPLOY_STAGE=AUTOMATION_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=AUTOMATION_MIGRATION_VERIFIED|DEPLOY_STAGE=AUTOMATION_ROUTE|DEPLOY_STAGE=SELF_SUFFICIENT_MIGRATION_FIRST|DEPLOY_STAGE=SELF_SUFFICIENT_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=SELF_SUFFICIENT_MIGRATION_VERIFIED|DEPLOY_STAGE=AI_GOVERNANCE_ROUTE) printf '%s\n' "$line" ;;
    DEPLOY_FAILED_AT=PROJECT_VAULT_RUNTIME_READY|DEPLOY_FAILED_AT=PROJECT_VAULT_STORAGE_READY|DEPLOY_FAILED_AT=CENTRAL_PROJECT_MIGRATION_FIRST|DEPLOY_FAILED_AT=CENTRAL_PROJECT_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=CENTRAL_PROJECT_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=CENTRAL_PROJECT_ROUTE|DEPLOY_FAILED_AT=PROJECT_VAULT_SOURCE_SYNC|DEPLOY_FAILED_AT=NATIVE_EXECUTOR_QUIESCED|DEPLOY_FAILED_AT=ANYWHERE_MIGRATION_FIRST|DEPLOY_FAILED_AT=ANYWHERE_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=ANYWHERE_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=ANYWHERE_EXECUTION_ROUTE|DEPLOY_FAILED_AT=COST_AWARE_MIGRATION_FIRST|DEPLOY_FAILED_AT=COST_AWARE_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=COST_AWARE_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=COST_AWARE_AI_ROUTE|DEPLOY_FAILED_AT=AUTOMATION_MIGRATION_FIRST|DEPLOY_FAILED_AT=AUTOMATION_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=AUTOMATION_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=AUTOMATION_ROUTE|DEPLOY_FAILED_AT=SELF_SUFFICIENT_MIGRATION_FIRST|DEPLOY_FAILED_AT=SELF_SUFFICIENT_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=SELF_SUFFICIENT_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=AI_GOVERNANCE_ROUTE) printf '%s\n' "$line" ;;
    DEPLOY_STAGE=PREMUTATION_READY|DEPLOY_STAGE=TOPOLOGY_CLEANUP_ARCHIVE|DEPLOY_STAGE=TOPOLOGY_CLEANUP_VERIFY|DEPLOY_STAGE=BACKUP_VERIFIED|DEPLOY_STAGE=RELEASE_STAGED|DEPLOY_STAGE=CONTROL_ORIGIN_RENDER|DEPLOY_STAGE=NGINX_CUTOVER_PREPARE|DEPLOY_STAGE=MIGRATION_FIRST_PASS|DEPLOY_STAGE=MIGRATION_IDEMPOTENT|DEPLOY_STAGE=MIGRATION_VERIFIED|DEPLOY_STAGE=OWNER_AUTH_MIGRATION_FIRST|DEPLOY_STAGE=OWNER_AUTH_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=OWNER_AUTH_VERIFIED|DEPLOY_STAGE=OWNER_AUTH_RUNTIME|DEPLOY_STAGE=OWNER_AUTH_COMPATIBILITY|DEPLOY_STAGE=OWNER_AUTH_PRESERVED|DEPLOY_STAGE=OWNER_AUTH_PROVISION|DEPLOY_STAGE=OWNER_AUTH_SURFACE|DEPLOY_STAGE=OWNER_AUTH_LOGIN|DEPLOY_STAGE=OWNER_AUTH_SESSION|DEPLOY_STAGE=OWNER_AUTH_CONTROL|DEPLOY_STAGE=ASSISTANT_MIGRATION_FIRST|DEPLOY_STAGE=ASSISTANT_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=ASSISTANT_MIGRATION_VERIFIED|DEPLOY_STAGE=ASSISTANT_ROUTE|DEPLOY_STAGE=WORKSPACE_PRESERVED|DEPLOY_STAGE=WORKSPACE_MIGRATION_FIRST|DEPLOY_STAGE=WORKSPACE_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=WORKSPACE_MIGRATION_VERIFIED|DEPLOY_STAGE=WORKSPACE_ROUTE|DEPLOY_STAGE=UNIFIED_MIGRATION_FIRST|DEPLOY_STAGE=UNIFIED_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=UNIFIED_MIGRATION_VERIFIED|DEPLOY_STAGE=UNIFIED_ROUTE|DEPLOY_STAGE=FINAL_MIGRATION_FIRST|DEPLOY_STAGE=FINAL_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=FINAL_MIGRATION_VERIFIED|DEPLOY_STAGE=FOUNDING_MIGRATION_FIRST|DEPLOY_STAGE=FOUNDING_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=FOUNDING_MIGRATION_VERIFIED|DEPLOY_STAGE=SELF_SERVICE_MIGRATION_FIRST|DEPLOY_STAGE=SELF_SERVICE_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=SELF_SERVICE_MIGRATION_VERIFIED|DEPLOY_STAGE=PROVIDER_CREDENTIAL_STORAGE_READY|DEPLOY_STAGE=SELF_SERVICE_ROUTE|DEPLOY_STAGE=FOUNDING_MEMORY_ROUTE|DEPLOY_STAGE=ATTACHMENT_STORAGE_READY|DEPLOY_STAGE=ARTIFACT_STORAGE_READY|DEPLOY_STAGE=FINAL_PRODUCT_ROUTE|DEPLOY_STAGE=PROJECT_VAULT_STORAGE_READY|DEPLOY_STAGE=CENTRAL_PROJECT_MIGRATION_FIRST|DEPLOY_STAGE=CENTRAL_PROJECT_MIGRATION_IDEMPOTENT|DEPLOY_STAGE=CENTRAL_PROJECT_MIGRATION_VERIFIED|DEPLOY_STAGE=CENTRAL_PROJECT_ROUTE|DEPLOY_STAGE=PROJECT_VAULT_SOURCE_SYNC|DEPLOY_STAGE=PROJECTS_READY|DEPLOY_STAGE=CONTROL_POINTER|DEPLOY_STAGE=NATIVE_EXECUTOR_UNITS_READY|DEPLOY_STAGE=PHP_FPM_RELOAD|DEPLOY_STAGE=WEB_RELEASE_COPY|DEPLOY_STAGE=WEB_ACCESS_READY|DEPLOY_STAGE=WEB_POINTER_SWITCH|DEPLOY_STAGE=WEB_RELEASE_STAGED|DEPLOY_STAGE=NGINX_CUTOVER_INSTALL|DEPLOY_STAGE=NGINX_CONFIGURED|DEPLOY_STAGE=SERVICE_RELOAD|DEPLOY_STAGE=OWNER_AUTH_EFFECTIVE_CONFIG|DEPLOY_STAGE=OWNER_AUTH_WEB_SURFACE|DEPLOY_STAGE=M3D_REGRESSION|DEPLOY_STAGE=M3E_POST_SCHEMA_REGRESSION|DEPLOY_STAGE=CONTROL_ROUTE) printf '%s\n' "$line" ;;
    DEPLOY_FAILED_AT=WEB_RELEASE_COPY) printf '%s\n' "$line" ;;
    DEPLOY_FAILED_AT=PREMUTATION_READY|DEPLOY_FAILED_AT=TOPOLOGY_CLEANUP_ARCHIVE|DEPLOY_FAILED_AT=TOPOLOGY_CLEANUP_VERIFY|DEPLOY_FAILED_AT=BACKUP_VERIFIED|DEPLOY_FAILED_AT=RELEASE_STAGED|DEPLOY_FAILED_AT=CONTROL_ORIGIN_RENDER|DEPLOY_FAILED_AT=NGINX_CUTOVER_PREPARE|DEPLOY_FAILED_AT=MIGRATION_FIRST_PASS|DEPLOY_FAILED_AT=MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=MIGRATION_VERIFIED|DEPLOY_FAILED_AT=OWNER_AUTH_MIGRATION_FIRST|DEPLOY_FAILED_AT=OWNER_AUTH_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=OWNER_AUTH_VERIFIED|DEPLOY_FAILED_AT=OWNER_AUTH_RUNTIME|DEPLOY_FAILED_AT=OWNER_AUTH_COMPATIBILITY|DEPLOY_FAILED_AT=OWNER_AUTH_PRESERVED|DEPLOY_FAILED_AT=OWNER_AUTH_PROVISION|DEPLOY_FAILED_AT=OWNER_AUTH_LOGIN|DEPLOY_FAILED_AT=OWNER_AUTH_SESSION|DEPLOY_FAILED_AT=OWNER_AUTH_CONTROL|DEPLOY_FAILED_AT=ASSISTANT_MIGRATION_FIRST|DEPLOY_FAILED_AT=ASSISTANT_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=ASSISTANT_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=ASSISTANT_ROUTE|DEPLOY_FAILED_AT=WORKSPACE_PRESERVED|DEPLOY_FAILED_AT=WORKSPACE_MIGRATION_FIRST|DEPLOY_FAILED_AT=WORKSPACE_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=WORKSPACE_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=WORKSPACE_ROUTE|DEPLOY_FAILED_AT=UNIFIED_MIGRATION_FIRST|DEPLOY_FAILED_AT=UNIFIED_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=UNIFIED_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=UNIFIED_ROUTE|DEPLOY_FAILED_AT=FINAL_MIGRATION_FIRST|DEPLOY_FAILED_AT=FINAL_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=FINAL_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=FOUNDING_MIGRATION_FIRST|DEPLOY_FAILED_AT=FOUNDING_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=FOUNDING_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=SELF_SERVICE_MIGRATION_FIRST|DEPLOY_FAILED_AT=SELF_SERVICE_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=SELF_SERVICE_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=PROVIDER_CREDENTIAL_STORAGE_READY|DEPLOY_FAILED_AT=SELF_SERVICE_ROUTE|DEPLOY_FAILED_AT=FOUNDING_MEMORY_ROUTE|DEPLOY_FAILED_AT=ATTACHMENT_STORAGE_READY|DEPLOY_FAILED_AT=FINAL_PRODUCT_ROUTE|DEPLOY_FAILED_AT=PROJECT_VAULT_STORAGE_READY|DEPLOY_FAILED_AT=CENTRAL_PROJECT_MIGRATION_FIRST|DEPLOY_FAILED_AT=CENTRAL_PROJECT_MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=CENTRAL_PROJECT_MIGRATION_VERIFIED|DEPLOY_FAILED_AT=CENTRAL_PROJECT_ROUTE|DEPLOY_FAILED_AT=PROJECT_VAULT_SOURCE_SYNC|DEPLOY_FAILED_AT=PROJECTS_READY|DEPLOY_FAILED_AT=CONTROL_POINTER|DEPLOY_FAILED_AT=PHP_FPM_RELOAD|DEPLOY_FAILED_AT=WEB_ACCESS_READY|DEPLOY_FAILED_AT=WEB_POINTER_SWITCH|DEPLOY_FAILED_AT=WEB_RELEASE_STAGED|DEPLOY_FAILED_AT=NGINX_CUTOVER_INSTALL|DEPLOY_FAILED_AT=NGINX_INCLUDE_PREPARE|DEPLOY_FAILED_AT=NGINX_INCLUDE_INSERT|DEPLOY_FAILED_AT=NGINX_CONFIGURED|DEPLOY_FAILED_AT=SERVICE_RELOAD|DEPLOY_FAILED_AT=OWNER_AUTH_SURFACE|DEPLOY_FAILED_AT=OWNER_AUTH_WEB_SURFACE|DEPLOY_FAILED_AT=M3D_REGRESSION|DEPLOY_FAILED_AT=M3E_POST_SCHEMA_REGRESSION|DEPLOY_FAILED_AT=CONTROL_ROUTE|DEPLOY_FAILED_AT=REMOTE_TRANSPORT|DEPLOY_FAILED_AT=REMOTE_RESULT_MISSING) printf '%s\n' "$line" ;;
    DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_HTTP_[0-9][0-9][0-9]|DEPLOY_DIAGNOSTIC=OWNER_AUTH_LOGIN_HTTP_[0-9][0-9][0-9]|DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_ATTEMPTS_[1-9]|DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_ATTEMPTS_10|DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_BASIC_CHALLENGE|DEPLOY_DIAGNOSTIC=OWNER_AUTH_LOGIN_BASIC_CHALLENGE) printf '%s\n' "$line" ;;
    DEPLOY_RESULT=PASS|ROLLBACK=PASS|ROLLBACK=FAIL) printf '%s\n' "$line" ;;
    '') : ;;
    *) printf '%s\n' "$line" | sh "$OUTPUT_VALIDATOR" ;;
  esac
done
if test "$REMOTE_STATUS" -ne 0; then test -n "$REMOTE_OUTPUT" || echo 'DEPLOY_FAILED_AT=REMOTE_TRANSPORT'; exit "$REMOTE_STATUS"; fi
printf '%s\n' "$REMOTE_OUTPUT" | grep -q '^DEPLOY_RESULT=PASS$' || { echo 'DEPLOY_FAILED_AT=REMOTE_RESULT_MISSING' >&2; exit 1; }
