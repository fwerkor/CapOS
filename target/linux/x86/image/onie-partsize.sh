#!/bin/sh
# Minimum ONIE root partition in MiB: respect the configured size and
# leave 25% plus 64 MiB for ext4 metadata, kernel and upgrade state.
set -eu

root_kib=$(du -sk "$1" | awk '{print $1}')
kernel_kib=$(du -sk "$2" | awk '{print $1}')
needed=$(( (root_kib * 5 / 4 + kernel_kib + 65536 + 1023) / 1024 ))
[ "$needed" -ge 512 ] || needed=512
[ "$needed" -ge "$3" ] || needed=$3
printf '%s\n' "$needed"
