#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-only

set -euo pipefail

usage() {
    echo "usage: $0 <rootfs-dir> <output.tar.gz> [source-date-epoch]" >&2
}

if [[ $# -lt 2 || $# -gt 3 ]]; then
    usage
    exit 2
fi

rootfs_dir="$1"
output="$2"
source_epoch="${3:-${SOURCE_DATE_EPOCH:-0}}"

if [[ ! -d "$rootfs_dir" ]]; then
    echo "rootfs directory does not exist: $rootfs_dir" >&2
    exit 1
fi
if [[ ! "$source_epoch" =~ ^[0-9]+$ ]]; then
    echo "source-date-epoch must be a non-negative integer" >&2
    exit 2
fi

mkdir -p "$(dirname -- "$output")"
temporary="${output}.tmp.$$"
cleanup() {
    rm -f "$temporary"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Normalize ownership and timestamps for a reproducible OCI layer, but preserve
# the filesystem permission bits exactly. In particular, sudo and BusyBox may
# require setuid/setgid bits that OpenWrt's generic targz image intentionally
# strips with --mode=a-s.
tar -cp \
    --numeric-owner \
    --owner=0 \
    --group=0 \
    --sort=name \
    --mtime="@$source_epoch" \
    -C "$rootfs_dir" . | gzip -9n > "$temporary"

mv -f "$temporary" "$output"
trap - EXIT INT TERM
