#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Run the production function with isolated mounts and GRUB state.
source <(sed -e "s@/tmp/upgrade-root@$work/root@g" \
             -e "s@/tmp/upgrade-onie@$work/onie@g" \
             "$repo/target/linux/x86/base-files/lib/upgrade/platform.sh")
onie_boot_diskseq() { printf '12\n'; }
find_partname_dev() { printf '/dev/test-%s\n' "$1"; }
mount() { mkdir -p "${@: -1}"; }
umount() { :; }
sync() { :; }
v() { :; }
grub_edits=0
grub-editenv() { grub_edits=$((grub_edits + 1)); }

mkdir -p "$work/root" "$work/onie"
printf 'installer\n' > "$work/installer"
printf 'backup\n' > "$work/backup"
UPGRADE_BACKUP="$work/backup"
bundle="$work/root/onie-installer-x86_64"
staged="$bundle.tmp"


# Failed concatenation must preserve the previous bundle and never touch GRUB.
printf 'previous\n' > "$bundle"
cat() { printf 'truncated\n' > "$staged"; return 1; }
if platform_do_upgrade_onie "$work/installer"; then
  echo 'ONIE upgrade unexpectedly accepted failed concatenation' >&2
  exit 1
fi
[[ $(< "$bundle") == previous && ! -e "$staged" && $grub_edits == 0 ]]
unset -f cat

# Successful concatenation is atomically installed before changing GRUB.
platform_do_upgrade_onie "$work/installer"
[[ $(< "$bundle") == $'installer\nbackup' && -x "$bundle" && $grub_edits == 2 ]]

# Failed single-file copy also preserves the installed bundle.
UPGRADE_BACKUP="$work/missing"
cp() { printf 'truncated\n' > "$staged"; return 1; }
if platform_do_upgrade_onie "$work/installer"; then
  echo 'ONIE upgrade unexpectedly accepted failed copy' >&2
  exit 1
fi
[[ $(< "$bundle") == $'installer\nbackup' && ! -e "$staged" && $grub_edits == 2 ]]
unset -f cp

platform_do_upgrade_onie "$work/installer"
[[ $(< "$bundle") == installer && $grub_edits == 4 ]]
echo 'ONIE bundle staging smoke tests passed'
