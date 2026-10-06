#!/usr/bin/env python3
"""One-time, read-only desktop Vault -> portable web ZIP. Not a server dependency.
Close the old application first. Unknown catalog fields are retained in .paper.json.
"""
import argparse
import hashlib
import json
import mimetypes
from pathlib import Path
import sqlite3
import tempfile
import zipfile
from datetime import datetime, timezone


def convert(vault: Path, destination: Path) -> tuple[int, int]:
    vault, destination = vault.resolve(), destination.resolve()
    if destination.exists() or destination.is_relative_to(vault):
        raise ValueError("Output must be a new file outside the source Vault")
    database = vault / ".agentero/catalog.sqlite"
    if not database.is_file():
        raise ValueError("Missing .agentero/catalog.sqlite; this converter requires an original Agentero Vault")
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as source:
        # A SQLite backup includes committed WAL data and produces one catalog snapshot.
        snapshot = sqlite3.connect(":memory:")
        source.backup(snapshot)
    snapshot.row_factory = sqlite3.Row
    entries = {}
    papers = 0
    for row in snapshot.execute("SELECT * FROM papers"):
        paper = dict(row)
        rel = paper["path"].replace("\\", "/").strip("/")
        if not rel.startswith("papers/") or any(p in (".", "..", "") for p in rel.split("/")):
            raise ValueError("Invalid catalog path: " + rel)
        if not (vault / rel).is_dir():
            raise ValueError("Catalog references a missing folder: " + rel)
        for field in ("authors", "tags", "creators"):
            value = paper.pop(field + "_json", None)
            if value is not None:
                paper[field] = json.loads(value)
        paper["tags"] = [{"name": t, "color": None} if isinstance(t, str) else t for t in paper.get("tags", [])]
        paper["is_read"] = bool(paper.get("is_read", False))
        paper["path"] = rel
        entries[rel + "/.paper.json"] = (json.dumps(paper, ensure_ascii=False, indent=2).encode(), "application/json")
        papers += 1
    tables = {row[0] for row in snapshot.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "pdf_page_counts" in tables:
        counts = {row[0]: row[1] for row in snapshot.execute("SELECT path, page_count FROM pdf_page_counts")}
        entries[".agentero/page-counts.json"] = (json.dumps(counts).encode(), "application/json")
    snapshot.close()
    for item in sorted(vault.rglob("*")):
        rel = item.relative_to(vault)
        # Do not copy desktop databases, runtime caches, credentials or agent setup.
        if any(p.startswith(".") for p in rel.parts):
            continue
        if item.is_symlink():
            raise ValueError("Resolve symlinks before conversion: " + rel.as_posix())
        if not item.is_file():
            continue
        path = rel.as_posix()
        if "\\" in path or any(ord(c) < 32 for c in path):
            raise ValueError("Unsupported filename: " + path)
        if item.stat().st_size > 32 * 1024 * 1024:
            raise ValueError("File exceeds web 32 MiB limit: " + path)
        entries[path] = (item.read_bytes(), mimetypes.guess_type(path)[0] or "application/octet-stream")
    if len(entries) > 20000 or sum(len(data) for data, _ in entries.values()) > 256 * 1024 * 1024:
        raise ValueError("Vault exceeds web backup limits (256 MiB / 20,000 entries); split it first")
    manifest = {"version": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "files": [
        {"path": path, "mime": mime, "sha256": hashlib.sha256(data).hexdigest()}
        for path, (data, mime) in entries.items()
    ]}
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as temp:
        temporary = Path(temp.name)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as archive:
            for path, (data, _) in entries.items():
                archive.writestr("files/" + path, data)
            archive.writestr("agentero-backup.json", json.dumps(manifest, ensure_ascii=False))
        # Exclusive creation also protects against an output appearing during conversion.
        with destination.open("xb") as output:
            output.write(temporary.read_bytes())
    finally:
        temporary.unlink(missing_ok=True)
    return papers, len(entries)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("vault", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    papers, files = convert(args.vault, args.output)
    print(f"Converted {papers} papers and {files} files. Hidden desktop settings/caches were excluded. Source unchanged.")
