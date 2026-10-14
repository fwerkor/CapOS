#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/root"
printf kernel > "$work/kernel"

# The configured size must be honored even when the payload is small.
[ "$("$repo/target/linux/x86/image/onie-partsize.sh" "$work/root" "$work/kernel" 2048)" = 2048 ]
[ "$("$repo/target/linux/x86/image/onie-partsize.sh" "$work/root" "$work/kernel" 100)" = 512 ]

# A large extracted rootfs must force a larger partition than 512 MiB.
cat > "$work/bin/du" <<'EOD'
#!/bin/sh
case "$2" in
    */root) printf '900000\t%s\n' "$2" ;;
    *) printf '10000\t%s\n' "$2" ;;
esac
EOD
chmod +x "$work/bin/du"
size=$(PATH="$work/bin:$PATH" "$repo/target/linux/x86/image/onie-partsize.sh" "$work/root" "$work/kernel" 512)
[ "$size" -gt 1000 ]
echo 'ONIE image partition sizing smoke tests passed'
