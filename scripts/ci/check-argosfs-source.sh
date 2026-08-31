#!/usr/bin/env bash
set -euo pipefail

makefile="${1:-package/utils/argosfs/Makefile}"

read_make_var() {
  local name="$1"
  sed -n "s/^${name}:=//p" "$makefile" | head -n1
}

source_url="$(read_make_var PKG_SOURCE_URL)"
source_version="$(read_make_var PKG_SOURCE_VERSION)"
pkg_version="$(read_make_var PKG_VERSION)"
release_tag="v${pkg_version}"

if [[ -z "$source_url" || -z "$source_version" || -z "$pkg_version" ]]; then
  echo "ERROR: unable to read ArgosFS source URL/version from $makefile" >&2
  exit 1
fi

if [[ ! "$source_version" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: ArgosFS PKG_SOURCE_VERSION must be a full 40-character commit SHA" >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
repo="$tmpdir/argosfs"
mkdir -p "$repo"
git -C "$repo" init -q

fetched=0
for attempt in 1 2 3; do
  if git -C "$repo" fetch -q --depth=1 "$source_url" "refs/tags/$release_tag"; then
    fetched=1
    break
  fi
  echo "ArgosFS release tag fetch attempt $attempt failed" >&2
  sleep "$attempt"
done

if [[ "$fetched" -ne 1 ]]; then
  echo "ERROR: ArgosFS release tag $release_tag is not fetchable from $source_url" >&2
  exit 1
fi

tag_commit="$(git -C "$repo" rev-parse 'FETCH_HEAD^{commit}')"
if [[ "$tag_commit" != "$source_version" ]]; then
  echo "ERROR: ArgosFS $release_tag resolves to $tag_commit, but CapOS pins $source_version" >&2
  echo "Pin to the release commit so GitHub archive downloads remain reachable after branch history maintenance." >&2
  exit 1
fi

git -C "$repo" cat-file -e 'FETCH_HEAD^{tree}'
git -C "$repo" checkout -q --detach "$tag_commit"

required_files=(
  Cargo.toml
  Cargo.lock
  integrations/capos/initramfs/argosfs-root.sh
  integrations/capos/initramfs/hooks/argosfs
  integrations/capos/mkinitramfs/argosfs.conf
  integrations/capos/systemd/argosfs-root.service
  integrations/capos/systemd/argosfs-health.service
  integrations/capos/systemd/argosfs-watchdog.service
  integrations/capos/systemd/argosfs-recovery.target
)

for path in "${required_files[@]}"; do
  if [[ ! -f "$repo/$path" ]]; then
    echo "ERROR: pinned ArgosFS source is missing required file: $path" >&2
    exit 1
  fi
done

cargo_version="$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$repo/Cargo.toml" | head -n1)"
if [[ "$cargo_version" != "$pkg_version" ]]; then
  echo "ERROR: CapOS ArgosFS PKG_VERSION=$pkg_version does not match upstream Cargo version=$cargo_version" >&2
  exit 1
fi

echo "ArgosFS source preflight passed: $release_tag -> $source_version"
