#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import shutil
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

OCI_LAYOUT_VERSION = "1.0.0"
OCI_INDEX = "application/vnd.oci.image.index.v1+json"
OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json"
OCI_CONFIG = "application/vnd.oci.image.config.v1+json"
OCI_LAYER_GZIP = "application/vnd.oci.image.layer.v1.tar+gzip"


def json_bytes(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def diff_id(path: Path) -> str:
    digest = hashlib.sha256()
    with gzip.open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_capos_rootfs(path: Path) -> None:
    with tarfile.open(path, "r:gz") as archive:
        names = {name[2:] if name.startswith("./") else name for name in archive.getnames()}
    if "sbin/init" not in names:
        raise SystemExit(f"{path} does not look like a CapOS rootfs: sbin/init is missing")


def write_blob(layout: Path, payload: bytes) -> tuple[str, int]:
    digest = hashlib.sha256(payload).hexdigest()
    blob = layout / "blobs" / "sha256" / digest
    blob.parent.mkdir(parents=True, exist_ok=True)
    blob.write_bytes(payload)
    return digest, len(payload)


def descriptor(media_type: str, digest: str, size: int, **extra: object) -> dict[str, object]:
    value: dict[str, object] = {
        "mediaType": media_type,
        "digest": f"sha256:{digest}",
        "size": size,
    }
    value.update(extra)
    return value


def add_tar_path(archive: tarfile.TarFile, path: Path, arcname: str, epoch: int) -> None:
    info = archive.gettarinfo(str(path), arcname=arcname)
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    info.mtime = epoch
    if info.isdir():
        info.mode = 0o755
        archive.addfile(info)
    else:
        info.mode = 0o644
        with path.open("rb") as stream:
            archive.addfile(info, stream)


def create_archive(layout: Path, output: Path, epoch: int) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    try:
        temporary.unlink()
    except FileNotFoundError:
        pass
    with tarfile.open(temporary, "w", format=tarfile.USTAR_FORMAT) as archive:
        directories = sorted(p for p in layout.rglob("*") if p.is_dir())
        files = sorted(p for p in layout.rglob("*") if p.is_file())
        for path in directories + files:
            add_tar_path(archive, path, path.relative_to(layout).as_posix(), epoch)
    os.replace(temporary, output)


def main() -> int:
    parser = argparse.ArgumentParser(description="Wrap a CapOS rootfs tarball as an OCI image-layout archive")
    parser.add_argument("rootfs", type=Path, help="CapOS rootfs.tar.gz produced by the OpenWrt image build")
    parser.add_argument("output", type=Path, help="output OCI archive (.oci.tar)")
    parser.add_argument("--architecture", choices=("amd64", "arm64"), required=True)
    parser.add_argument("--ref-name", default="latest")
    parser.add_argument("--created-epoch", type=int, default=0)
    parser.add_argument("--version", default="SNAPSHOT")
    parser.add_argument("--revision", default="unknown")
    parser.add_argument("--source", default="https://github.com/fwerkor/CapOS")
    args = parser.parse_args()

    if not args.rootfs.is_file():
        parser.error(f"rootfs does not exist: {args.rootfs}")
    if args.created_epoch < 0:
        parser.error("--created-epoch must be non-negative")

    ensure_capos_rootfs(args.rootfs)
    created = datetime.fromtimestamp(args.created_epoch, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    layer_digest, layer_size = sha256_file(args.rootfs)
    layer_diff_id = diff_id(args.rootfs)

    with tempfile.TemporaryDirectory(prefix="capos-oci-") as temp_dir:
        layout = Path(temp_dir)
        (layout / "oci-layout").write_bytes(json_bytes({"imageLayoutVersion": OCI_LAYOUT_VERSION}))

        layer_blob = layout / "blobs" / "sha256" / layer_digest
        layer_blob.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.rootfs, layer_blob)

        labels = {
            "org.opencontainers.image.created": created,
            "org.opencontainers.image.description": "CapOS system container image",
            "org.opencontainers.image.revision": args.revision,
            "org.opencontainers.image.source": args.source,
            "org.opencontainers.image.title": "CapOS",
            "org.opencontainers.image.version": args.version,
        }
        config = {
            "created": created,
            "architecture": args.architecture,
            "os": "linux",
            "config": {
                "Entrypoint": ["/sbin/init"],
                "Env": ["PATH=/usr/sbin:/usr/bin:/sbin:/bin"],
                "Labels": labels,
                "StopSignal": "SIGTERM",
            },
            "rootfs": {
                "type": "layers",
                "diff_ids": [f"sha256:{layer_diff_id}"],
            },
            "history": [
                {
                    "created": created,
                    "created_by": "CapOS OCI build",
                }
            ],
        }
        config_digest, config_size = write_blob(layout, json_bytes(config))

        manifest = {
            "schemaVersion": 2,
            "mediaType": OCI_MANIFEST,
            "config": descriptor(OCI_CONFIG, config_digest, config_size),
            "layers": [descriptor(OCI_LAYER_GZIP, layer_digest, layer_size)],
            "annotations": labels,
        }
        manifest_digest, manifest_size = write_blob(layout, json_bytes(manifest))

        index = {
            "schemaVersion": 2,
            "mediaType": OCI_INDEX,
            "manifests": [
                descriptor(
                    OCI_MANIFEST,
                    manifest_digest,
                    manifest_size,
                    annotations={"org.opencontainers.image.ref.name": args.ref_name},
                    platform={"architecture": args.architecture, "os": "linux"},
                )
            ],
        }
        (layout / "index.json").write_bytes(json_bytes(index))
        create_archive(layout, args.output, args.created_epoch)

    archive_digest, archive_size = sha256_file(args.output)
    print(f"OCI archive: {args.output}")
    print(f"Platform: linux/{args.architecture}")
    print(f"Reference: {args.ref_name}")
    print(f"SHA256: {archive_digest}")
    print(f"Size: {archive_size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
