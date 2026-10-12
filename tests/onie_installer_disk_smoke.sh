#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Execute the installer's disk selector with synthetic mounts and a stubbed
# blkid; only block-device existence is relaxed for the unprivileged test.
sed -n '/^# ONIE mounts its own boot partition/,/^echo "Install device/p' \
    "$repo/target/linux/x86/image/onie-install.sh.in" | \
    sed -e "s@/proc/mounts@$work/mounts@g" \
        -e 's/\[ -b /[ -n /g' > "$work/selector.sh"
mkdir "$work/bin"
cat > "$work/bin/blkid" <<'EOB'
#!/bin/sh
printf '%s: LABEL="ONIE-BOOT"\n' "$1"
EOB
chmod +x "$work/bin/blkid"

printf '/dev/sdb2 /somewhere ext4 rw 0 0\n/dev/sda2 /mnt/onie-boot ext4 rw 0 0\n' > "$work/mounts"
PATH="$work/bin:$PATH" sh "$work/selector.sh" | grep -q 'Install device    : /dev/sda'

printf '/dev/nvme0n1p2 /mnt/onie-boot ext4 rw 0 0\n' > "$work/mounts"
PATH="$work/bin:$PATH" sh "$work/selector.sh" | grep -q 'Install device    : /dev/nvme0n1'

printf '/dev/sdb2 /somewhere ext4 rw 0 0\n' > "$work/mounts"
if PATH="$work/bin:$PATH" sh "$work/selector.sh" >/dev/null 2>&1; then
    echo 'Installer selected a disk without the mounted ONIE boot partition' >&2
    exit 1
fi
echo 'ONIE installer boot-disk smoke tests passed'
