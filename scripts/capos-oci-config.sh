#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-only

set -euo pipefail

usage() {
    echo "usage: $0 <x86/64|armsr/armv8>" >&2
}

if [[ $# -ne 1 ]]; then
    usage
    exit 2
fi

case "$1" in
    x86/64)
        target=x86
        subtarget=64
        ;;
    armsr/armv8)
        target=armsr
        subtarget=armv8
        ;;
    *)
        echo "unsupported CapOS OCI target: $1" >&2
        usage
        exit 2
        ;;
esac

cat > .config <<CONFIG
CONFIG_TARGET_${target}=y
CONFIG_TARGET_${target}_${subtarget}=y
CONFIG_PACKAGE_capos-core=y
# CONFIG_TARGET_ROOTFS_ARGOSFS is not set
CONFIG_TARGET_ROOTFS_TARGZ=y
# CONFIG_TARGET_ROOTFS_INITRAMFS is not set
# CONFIG_TARGET_ROOTFS_CPIOGZ is not set
# CONFIG_TARGET_ROOTFS_EROFS is not set
# CONFIG_TARGET_ROOTFS_EXT4FS is not set
# CONFIG_TARGET_ROOTFS_JFFS2 is not set
# CONFIG_TARGET_ROOTFS_JFFS2_NAND is not set
# CONFIG_TARGET_ROOTFS_SQUASHFS is not set
# CONFIG_TARGET_ROOTFS_UBIFS is not set
CONFIG_TARGET_ROOTFS_PERSIST_VAR=y
CONFIG_BUILD_LOG=y
CONFIG
