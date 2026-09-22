"""Copy the project WIKI to the Dropbox vault. Never copies secrets or backups."""
import argparse, datetime, filecmp, hashlib, json, pathlib, shutil

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_DEST = pathlib.Path(r"E:\Dropbox\Приложения\remotely-save\2Vhutemas")
SOURCES = ["WIKI", "README.md", "AGENTS.md", "config"]
SKIP_NAMES = {".obsidian", "__pycache__"}
SECRET_HINTS = (".env", ".secrets", ".pem", ".key", "secret")

def collect(base: pathlib.Path):
    if base.is_file():
        yield base
        return
    for path in base.rglob("*"):
        if path.is_dir() or SKIP_NAMES & set(path.parts):
            continue
        if any(hint in path.name.lower() for hint in SECRET_HINTS):
            raise RuntimeError(f"Refusing to copy possible secret: {path}")
        yield path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dest", type=pathlib.Path, default=DEFAULT_DEST)
    args = parser.parse_args()
    if not args.dest.parent.exists():
        raise SystemExit(f"Dropbox folder not found: {args.dest.parent}")
    copied = skipped = 0
    files = []
    for name in SOURCES:
        source_base = ROOT / name
        if not source_base.exists():
            continue
        for src in collect(source_base):
            rel = src.relative_to(ROOT)
            dst = args.dest / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            if dst.exists() and filecmp.cmp(src, dst, shallow=False):
                skipped += 1
            else:
                shutil.copy2(src, dst)
                copied += 1
            files.append({"path": str(rel).replace("\\", "/"),
                          "sha256": hashlib.sha256(src.read_bytes()).hexdigest(),
                          "bytes": src.stat().st_size})
    manifest = {"copied_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                "source": str(ROOT), "files": files}
    (args.dest / "wiki-copy-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"copied={copied} unchanged={skipped} total={len(files)} -> {args.dest}")

if __name__ == "__main__":
    main()
