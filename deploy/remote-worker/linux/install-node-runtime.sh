#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MANIFEST=${AWH_DEVICE_RUNTIME_MANIFEST:-$HERE/../../../config/device-runtime-release.json}
command -v python3 >/dev/null 2>&1 || { printf '%s\n' AWH_NODE_RUNTIME_PYTHON3_REQUIRED >&2; exit 1; }
[ -f "$MANIFEST" ] || { printf '%s\n' AWH_NODE_RUNTIME_MANIFEST_MISSING >&2; exit 1; }
manifest_value(){ python3 - "$MANIFEST" "$1" <<'PYJSON'
import json,sys
value=json.load(open(sys.argv[1],encoding='utf-8'))
for part in sys.argv[2].split('.'): value=value[part]
print(value)
PYJSON
}
VERSION=$(manifest_value linuxConnector.nodeRuntime.version)
MINIMUM_VERSION=$(manifest_value linuxConnector.nodeRuntime.minimumVersion)
NAME_TEMPLATE=$(manifest_value linuxConnector.nodeRuntime.asset.nameTemplate)
ARCHIVE=$(printf '%s' "$NAME_TEMPLATE" | sed "s/{version}/$VERSION/g")
EXPECTED_SHA=$(manifest_value linuxConnector.nodeRuntime.asset.sha256)
URL_TEMPLATE=$(manifest_value linuxConnector.nodeRuntime.sourceUrlTemplate)
URL=$(printf '%s' "$URL_TEMPLATE" | sed "s/{version}/$VERSION/g;s|{asset}|$ARCHIVE|g")
ROOT=${AWH_NODE_RUNTIME_ROOT:-/opt/awh-tools/remote-desktop}
TARGET=$ROOT/node-v${VERSION}-linux-x64
fail(){ printf '%s\n' "$1" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail AWH_NODE_RUNTIME_INSTALL_REQUIRES_ROOT
[ "$(uname -s)" = Linux ] || fail AWH_NODE_RUNTIME_UNSUPPORTED_OS
[ "$(uname -m)" = x86_64 ] || fail AWH_NODE_RUNTIME_UNSUPPORTED_ARCH
if [ -x "$TARGET/bin/node" ] && [ "$($TARGET/bin/node -v)" = "v$VERSION" ]; then
  printf '%s\n' "AWH_NODE_RUNTIME=READY version=$VERSION"
  exit 0
fi
command -v curl >/dev/null 2>&1 || fail AWH_NODE_RUNTIME_CURL_REQUIRED
command -v sha256sum >/dev/null 2>&1 || fail AWH_NODE_RUNTIME_SHA256_REQUIRED
command -v tar >/dev/null 2>&1 || fail AWH_NODE_RUNTIME_TAR_REQUIRED
TMP=$(mktemp -d /tmp/awh-node-runtime.XXXXXX)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$URL" -o "$TMP/$ARCHIVE"
printf '%s  %s\n' "$EXPECTED_SHA" "$TMP/$ARCHIVE" | sha256sum -c - >/dev/null || fail AWH_NODE_RUNTIME_CHECKSUM_MISMATCH
tar -xJf "$TMP/$ARCHIVE" -C "$TMP"
[ -x "$TMP/node-v${VERSION}-linux-x64/bin/node" ] || fail AWH_NODE_RUNTIME_ARCHIVE_INVALID
install -d -o root -g root -m 0755 "$ROOT"
rm -rf "$TARGET.new"
mv "$TMP/node-v${VERSION}-linux-x64" "$TARGET.new"
chown -R root:root "$TARGET.new"
chmod -R go-w "$TARGET.new"
rm -rf "$TARGET"
mv "$TARGET.new" "$TARGET"
[ "$($TARGET/bin/node -v)" = "v$VERSION" ] || fail AWH_NODE_RUNTIME_VERSION_MISMATCH
printf '%s\n' "AWH_NODE_RUNTIME_INSTALL=PASS version=$VERSION"
