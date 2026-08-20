#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-only

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/capos-oci-build-test.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

fixture="$tmp/repo"
mkdir -p "$fixture/scripts" "$fixture/fakebin" "$fixture/rootfs/sbin"
cp "$repo_root/scripts/capos-oci-build.sh" \
   "$repo_root/scripts/capos-oci-config.sh" \
   "$repo_root/scripts/capos-oci-pack.py" \
   "$repo_root/scripts/capos-oci-rootfs.sh" \
   "$fixture/scripts/"

cat > "$fixture/scripts/get_source_date_epoch.sh" <<'EOF'
#!/usr/bin/env sh
echo 1234567890
EOF
cat > "$fixture/scripts/feeds" <<'EOF'
#!/usr/bin/env sh
exit 0
EOF
cat > "$fixture/fakebin/make" <<'EOF'
#!/usr/bin/env sh
case "$*" in
    "-s val.TARGET_DIR") printf '%s\n' "$FAKE_TARGET_DIR" ;;
    defconfig|-j1|checksum) exit 0 ;;
    *) echo "unexpected make invocation: $*" >&2; exit 2 ;;
esac
EOF
chmod +x "$fixture/scripts/"*.sh "$fixture/scripts/feeds" "$fixture/fakebin/make"
printf '#!/bin/sh\n' > "$fixture/rootfs/sbin/init"
chmod 755 "$fixture/rootfs/sbin/init"
printf 'src-git packages https://example.invalid/packages\n' > "$fixture/feeds.conf.default"

run_build() {
    (
        cd "$fixture"
        PATH="$fixture/fakebin:$PATH" \
        FAKE_TARGET_DIR="$fixture/rootfs" \
        CAPOS_OCI_JOBS=1 \
            scripts/capos-oci-build.sh x86/64 >/dev/null
    )
}

run_build
test ! -e "$fixture/.config"
test ! -e "$fixture/feeds.conf"
test -f "$fixture/bin/targets/x86/64/capos-x86-64.oci.tar"

printf 'custom feeds\n' > "$fixture/feeds.conf"
run_build
grep -qx 'custom feeds' "$fixture/feeds.conf"

rm -f "$fixture/feeds.conf"
if (
    cd "$fixture"
    PATH="$fixture/fakebin:$PATH" \
    FAKE_TARGET_DIR="$fixture/rootfs" \
    CAPOS_OCI_JOBS=1 \
    CAPOS_OCI_REF='capos:latest' \
        scripts/capos-oci-build.sh x86/64 >/dev/null 2>&1
); then
    echo "invalid CAPOS_OCI_REF unexpectedly succeeded" >&2
    exit 1
fi
test ! -e "$fixture/feeds.conf"

echo "CapOS OCI build smoke test passed"
