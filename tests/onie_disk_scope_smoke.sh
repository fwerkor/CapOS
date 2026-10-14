#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
block="$work/sys/class/block"
mkdir -p "$block"/{vda1,vda2,vdb1,vdb2}

uuid=aabbccdd-1111-2222-3333-444455556666
printf 'DEVNAME=vda1\nDISKSEQ=12\nPARTNAME=OTHER\n' > "$block/vda1/uevent"
printf 'DEVNAME=vda2\nDISKSEQ=12\nPARTNAME=OPENWRT-ROOT\nPARTUUID=%s\n' "$uuid" > "$block/vda2/uevent"
printf 'DEVNAME=vdb1\nDISKSEQ=34\nPARTNAME=ONIE-BOOT\n' > "$block/vdb1/uevent"
printf 'DEVNAME=vdb2\nDISKSEQ=34\nPARTNAME=OPENWRT-ROOT\n' > "$block/vdb2/uevent"

source <(sed "s@/sys/class/block@$block@g" \
  "$repo/target/linux/x86/base-files/lib/upgrade/platform.sh")
cmdline_get_var() { echo "PARTUUID=$uuid"; }
export_bootdevice() { return 1; }

[[ $(onie_boot_diskseq) == 12 ]]
if is_onie_install; then
  echo 'Foreign-disk ONIE partitions were mistaken for the boot disk' >&2
  exit 1
fi
if find_partname_dev ONIE-BOOT 12 >/dev/null; then
  echo 'Found an ONIE partition on the wrong disk' >&2
  exit 1
fi

# ONIE-BOOT on the same disk enables ONIE detection, even with duplicate
# OPENWRT-ROOT/ONIE-BOOT labels on another attached disk.
printf 'DEVNAME=vda1\nDISKSEQ=12\nPARTNAME=ONIE-BOOT\n' > "$block/vda1/uevent"
is_onie_install
[[ $(find_partname_dev ONIE-BOOT 12) == /dev/vda1 ]]
[[ $(find_partname_dev OPENWRT-ROOT 12) == /dev/vda2 ]]

# Other boot device formats use the system's existing boot-disk resolver.
cmdline_get_var() { echo /dev/vda2; }
export_bootdevice() { BOOTDEV_DISKSEQ=12; }
[[ $(onie_boot_diskseq) == 12 ]]
is_onie_install

# If boot identity cannot be determined, do not select unrelated disks.
export_bootdevice() { return 1; }
if is_onie_install; then
  echo 'Unknown boot disk was recognized as ONIE' >&2
  exit 1
fi
echo 'ONIE boot-disk scoping smoke tests passed'
