#!/usr/bin/env python3
"""Preserve immutable assets for active sessions without restoring old HTML."""
import argparse
import json
import hashlib
import math
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile
import time

RETENTION_SECONDS = 7 * 24 * 60 * 60
MAX_BYTES = 500 * 1024 * 1024
MAX_MEMBERS = 20000
MANIFEST = 'asset-retention.json'


def safe_asset_path(name):
    while name.startswith('./'):
        name = name[2:]
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name:
        raise ValueError('Unsafe archive path')
    return path.as_posix() if path.parts and path.parts[0] == 'assets' and len(path.parts) > 1 else None


def file_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.digest()


def retain(output, archive, now):
    output = Path(output)
    if not (output / 'index.html').is_file() or not (output / 'assets').is_dir():
        raise ValueError('Current build is missing index.html or assets')
    current = {p.relative_to(output).as_posix(): p for p in (output / 'assets').rglob('*') if p.is_file()}
    if (output / 'assets').is_symlink() or any(p.is_symlink() for p in (output / 'assets').rglob('*')):
        raise ValueError('Current assets must not contain symlinks')
    total = sum(p.stat().st_size for p in current.values())
    if total > MAX_BYTES:
        raise ValueError('Current assets exceed retention limit')
    first_seen = {}
    retained = {}
    with tempfile.TemporaryDirectory() as temporary:
        staging = Path(temporary)
        with tarfile.open(archive, 'r:*') as tar:
            count = 0
            expanded = 0
            names = set()
            for member in tar:
                count += 1
                if count > MAX_MEMBERS:
                    raise ValueError('Too many archive members')
                normalized = member.name
                while normalized.startswith('./'):
                    normalized = normalized[2:]
                asset = safe_asset_path(member.name)
                if normalized == MANIFEST:
                    if not member.isfile() or member.size > 4 * 1024 * 1024:
                        raise ValueError('Invalid retention manifest')
                    first_seen = json.load(tar.extractfile(member))
                    if not isinstance(first_seen, dict):
                        raise ValueError('Invalid retention manifest')
                    continue
                if not asset:
                    continue
                if member.isdir():
                    continue
                if not member.isfile() or asset in names:
                    raise ValueError('Assets must be unique regular files')
                names.add(asset)
                expanded += member.size
                if member.size < 0 or expanded > MAX_BYTES:
                    raise ValueError('Previous assets exceed retention limit')
                target = staging / asset
                target.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, target.open('wb') as destination:
                    shutil.copyfileobj(source, destination)
                retained[asset] = target
        # Validate everything before changing the current deployment artifact.
        selected = {}
        for name, path in retained.items():
            if name in current:
                if file_digest(path) != file_digest(current[name]):
                    raise ValueError('Asset collision: same path has different contents')
                continue
            timestamp = first_seen.get(name, now)
            if not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp) or timestamp > now:
                raise ValueError('Invalid asset timestamp')
            if now - timestamp <= RETENTION_SECONDS:
                selected[name] = (path, timestamp)
                total += path.stat().st_size
        if total > MAX_BYTES:
            raise ValueError('Combined assets exceed retention limit')
        for name, (source, _) in selected.items():
            destination = output / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        manifest = {name: now for name in current}
        manifest.update({name: timestamp for name, (_, timestamp) in selected.items()})
        (output / MANIFEST).write_text(json.dumps(manifest, sort_keys=True), encoding='utf-8')
    print(f'Preserved {len(selected)} previous assets; current HTML unchanged; retention 7 days')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--previous-archive', required=True)
    parser.add_argument('--now', type=float, default=None)
    args = parser.parse_args()
    retain(args.output, args.previous_archive, time.time() if args.now is None else args.now)
