#!/bin/sh

# Bounded enrollment-current pointer state/rollback helpers.
# The caller must set POINTER_PATH to the fixed /opt/awh-hub pointer and may
# set POINTER_SUDO to an absolute sudo executable for privileged operations.

POINTER_RELEASE_ROOT=${POINTER_RELEASE_ROOT:-/opt/awh-hub/enrollment-releases}

pointer_exec() {
  if test -n "${POINTER_SUDO:-}"; then
    "$POINTER_SUDO" "$@"
  else
    "$@"
  fi
}

pointer_release_shape() {
  pointer_exec test -d "$1" \
    && pointer_exec test -f "$1/hub/public/enrollment.php" \
    && pointer_exec test -f "$1/hub/src/HubEnrollmentService.php" \
    && pointer_exec test -f "$1/hub/migrations/002_m3e2_enrollment_api.sql" \
    && pointer_exec test -f "$1/hub/bin/migrate-m3e2.php"
}

pointer_resolve() {
  resolved_target=$(pointer_exec readlink -f -- "$1" 2>/dev/null || true)
  if test -n "$resolved_target"; then
    printf '%s\n' "$resolved_target"
  else
    pointer_exec realpath "$1" 2>/dev/null || true
  fi
}

pointer_capture() {
  POINTER_STATE=ABSENT
  PREVIOUS_TARGET=
  if pointer_exec test -L "$POINTER_PATH"; then
    raw_target=$(pointer_exec readlink "$POINTER_PATH" 2>/dev/null || true)
    case "$raw_target" in
      "$POINTER_RELEASE_ROOT"/*) ;;
      *) return 1 ;;
    esac
    pointer_release_shape "$raw_target" || return 1
    resolved_target=$(pointer_resolve "$POINTER_PATH")
    test "$resolved_target" = "$raw_target" || return 1
    PREVIOUS_TARGET=$raw_target
    POINTER_STATE=PRESENT
    return 0
  fi
  if pointer_exec test -e "$POINTER_PATH"; then return 1; fi
  if pointer_exec test -L "$POINTER_PATH"; then return 1; fi
  return 0
}

pointer_restore_and_verify() {
  if test "${POINTER_STATE:-UNSET}" = ABSENT; then
    pointer_exec rm -f "$POINTER_PATH" || return 1
    pointer_exec test ! -e "$POINTER_PATH" || return 1
    pointer_exec test ! -L "$POINTER_PATH" || return 1
    return 0
  fi
  if test "${POINTER_STATE:-UNSET}" = PRESENT; then
    pointer_exec ln -sfn "$PREVIOUS_TARGET" "$POINTER_PATH" || return 1
    pointer_exec test -L "$POINTER_PATH" || return 1
    restored_target=$(pointer_resolve "$POINTER_PATH")
    test "$restored_target" = "$PREVIOUS_TARGET" || return 1
    pointer_release_shape "$PREVIOUS_TARGET" || return 1
    return 0
  fi
  return 1
}
