#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-only

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

target_spec="${1:-${CAPOS_OCI_TARGET:-x86/64}}"
case "$target_spec" in
    x86/64)
        target=x86
        subtarget=64
        architecture=amd64
        ;;
    armsr/armv8)
        target=armsr
        subtarget=armv8
        architecture=arm64
        ;;
    *)
        echo "unsupported CapOS OCI target: $target_spec" >&2
        echo "supported targets: x86/64, armsr/armv8" >&2
        exit 2
        ;;
esac

jobs="${CAPOS_OCI_JOBS:-}"
if [[ -z "$jobs" ]]; then
    jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 1)"
fi
if [[ ! "$jobs" =~ ^[1-9][0-9]*$ ]]; then
    echo "CAPOS_OCI_JOBS must be a positive integer" >&2
    exit 2
fi

ref_name="${CAPOS_OCI_REF:-capos:latest}"
version="${CAPOS_OCI_VERSION:-SNAPSHOT}"
revision="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
created_epoch="$(scripts/get_source_date_epoch.sh 2>/dev/null || echo 0)"

config_backup="$(mktemp "${TMPDIR:-/tmp}/capos-oci-config.XXXXXX")"
had_config=0
if [[ -f .config ]]; then
    cp .config "$config_backup"
    had_config=1
fi

restore_config() {
    if (( had_config )); then
        cp "$config_backup" .config
    else
        rm -f .config
    fi
    rm -f "$config_backup"
}
trap restore_config EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ! -f feeds.conf && -f feeds.conf.default ]]; then
    cp feeds.conf.default feeds.conf
fi
./scripts/feeds list >/dev/null
./scripts/feeds install -a >/dev/null

scripts/capos-oci-config.sh "$target_spec"
make defconfig

grep -q '^# CONFIG_TARGET_ROOTFS_ARGOSFS is not set$' .config
grep -q '^CONFIG_TARGET_ROOTFS_TARGZ=y$' .config
grep -q '^CONFIG_TARGET_ROOTFS_PERSIST_VAR=y$' .config

make -j"$jobs"

output_dir="bin/targets/$target/$subtarget"
shopt -s nullglob
rootfs_candidates=("$output_dir"/*-"$target"-"$subtarget"-rootfs.tar.gz)
shopt -u nullglob
if [[ ${#rootfs_candidates[@]} -eq 0 ]]; then
    echo "CapOS rootfs tarball was not produced in $output_dir" >&2
    exit 1
fi
rootfs="$(ls -1t -- "${rootfs_candidates[@]}" | head -n 1)"
stem="$(basename "$rootfs" -rootfs.tar.gz)"
oci_archive="$output_dir/$stem.oci.tar"

python3 scripts/capos-oci-pack.py \
    "$rootfs" "$oci_archive" \
    --architecture "$architecture" \
    --ref-name "$ref_name" \
    --created-epoch "$created_epoch" \
    --version "$version" \
    --revision "$revision"

make checksum

printf '\nCapOS OCI build complete:\n  %s\n' "$oci_archive"
