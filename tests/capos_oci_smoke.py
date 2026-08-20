#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only

from __future__ import annotations

import gzip
import hashlib
import json
import stat
import subprocess
import tarfile
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PACKER = REPO_ROOT / "scripts" / "capos-oci-pack.py"
ROOTFS_PACKER = REPO_ROOT / "scripts" / "capos-oci-rootfs.sh"


def make_rootfs(directory: Path, path: Path) -> bytes:
    files = (
        ("etc/capos-release", b"NAME=CapOS\n", 0o644),
        ("sbin/init", b"#!/bin/sh\nexec /bin/sh\n", 0o755),
        ("bin/sh", b"#!/bin/sh\n", 0o755),
        ("usr/bin/sudo", b"#!/bin/sh\n", 0o4755),
        ("usr/bin/setgid-helper", b"#!/bin/sh\n", 0o2755),
    )
    for name, payload, mode in files:
        target = directory / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        target.chmod(mode)

    subprocess.run(
        [str(ROOTFS_PACKER), str(directory), str(path), "1234567890"],
        cwd=REPO_ROOT,
        check=True,
    )
    with tarfile.open(path, "r:gz") as archive:
        members = {
            member.name[2:] if member.name.startswith("./") else member.name: member
            for member in archive.getmembers()
        }
        if not members["usr/bin/sudo"].mode & stat.S_ISUID:
            raise AssertionError("rootfs packer lost setuid mode")
        if not members["usr/bin/setgid-helper"].mode & stat.S_ISGID:
            raise AssertionError("rootfs packer lost setgid mode")
        if members["usr/bin/sudo"].uid != 0 or members["usr/bin/sudo"].gid != 0:
            raise AssertionError("rootfs packer did not normalize ownership to root")

    with gzip.open(path, "rb") as compressed:
        return compressed.read()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest_value(value: str) -> str:
    prefix = "sha256:"
    if not value.startswith(prefix):
        raise AssertionError(f"unexpected digest: {value}")
    return value[len(prefix):]


def read_json(archive: tarfile.TarFile, name: str) -> dict[str, object]:
    member = archive.extractfile(name)
    assert member is not None
    return json.load(member)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="capos-oci-test-") as temp_dir:
        temp = Path(temp_dir)
        rootfs_dir = temp / "rootfs"
        rootfs = temp / "rootfs.tar.gz"
        output_a = temp / "capos-a.oci.tar"
        output_b = temp / "capos-b.oci.tar"
        uncompressed = make_rootfs(rootfs_dir, rootfs)

        args = [
            "python3",
            str(PACKER),
            str(rootfs),
            str(output_a),
            "--architecture",
            "amd64",
            "--ref-name",
            "test",
            "--created-epoch",
            "1234567890",
            "--version",
            "test",
            "--revision",
            "deadbeef",
        ]
        subprocess.run(args, cwd=REPO_ROOT, check=True, stdout=subprocess.PIPE, text=True)
        args[3] = str(output_b)
        subprocess.run(args, cwd=REPO_ROOT, check=True, stdout=subprocess.PIPE, text=True)

        if output_a.read_bytes() != output_b.read_bytes():
            raise AssertionError("OCI archive is not reproducible")

        with tarfile.open(output_a, "r") as archive:
            names = set(archive.getnames())
            if not {"oci-layout", "index.json", "blobs", "blobs/sha256"}.issubset(names):
                raise AssertionError(f"incomplete OCI layout: {sorted(names)}")

            layout = read_json(archive, "oci-layout")
            if layout != {"imageLayoutVersion": "1.0.0"}:
                raise AssertionError(f"unexpected OCI layout header: {layout}")

            index = read_json(archive, "index.json")
            manifest_desc = index["manifests"][0]
            if manifest_desc["platform"] != {"architecture": "amd64", "os": "linux"}:
                raise AssertionError(f"unexpected platform: {manifest_desc['platform']}")
            if manifest_desc["annotations"]["org.opencontainers.image.ref.name"] != "test":
                raise AssertionError("OCI reference annotation is missing")

            manifest_digest = digest_value(manifest_desc["digest"])
            manifest_path = f"blobs/sha256/{manifest_digest}"
            manifest_bytes = archive.extractfile(manifest_path).read()
            if sha256(manifest_bytes) != manifest_digest:
                raise AssertionError("manifest digest mismatch")
            manifest = json.loads(manifest_bytes)

            config_desc = manifest["config"]
            config_digest = digest_value(config_desc["digest"])
            config_path = f"blobs/sha256/{config_digest}"
            config_bytes = archive.extractfile(config_path).read()
            if sha256(config_bytes) != config_digest:
                raise AssertionError("config digest mismatch")
            config = json.loads(config_bytes)
            if config["architecture"] != "amd64" or config["os"] != "linux":
                raise AssertionError("config platform mismatch")
            if config["config"]["Entrypoint"] != ["/sbin/init"]:
                raise AssertionError("CapOS OCI entrypoint must be /sbin/init")
            if config["rootfs"]["diff_ids"] != [f"sha256:{sha256(uncompressed)}"]:
                raise AssertionError("rootfs diff_id mismatch")

            layer_desc = manifest["layers"][0]
            layer_digest = digest_value(layer_desc["digest"])
            layer_path = f"blobs/sha256/{layer_digest}"
            layer_bytes = archive.extractfile(layer_path).read()
            if sha256(layer_bytes) != layer_digest:
                raise AssertionError("layer digest mismatch")
            if layer_bytes != rootfs.read_bytes():
                raise AssertionError("OCI layer is not the original CapOS rootfs tarball")

    print("CapOS OCI smoke test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
