"""Read-only remote backup to a local directory. Never uploads credentials or changes DB."""
import argparse, datetime, hashlib, json, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCES = ["opt/2vhutemas", "opt/2vhutemas-services", "var/www/2vhutemas", "var/www/gis", "etc/caddy"]

def fetch(host, command, dest):
    partial = dest.with_suffix(dest.suffix + ".partial")
    with partial.open("wb") as out:
        result = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host, command], stdout=out, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(f"Remote backup failed for {dest.name}: {result.stderr.decode(errors='replace')}")
    partial.replace(dest)
    digest = hashlib.sha256()
    with dest.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"file": dest.name, "bytes": dest.stat().st_size, "sha256": digest.hexdigest()}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="2vhutemas")
    args = parser.parse_args()
    folder = ROOT / "backups" / datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    folder.mkdir(parents=True, exist_ok=False)
    manifest = {"status": "running", "restore_verified": False, "sources": SOURCES, "artifacts": [], "scope": "Full postgres database, cluster globals, project server files; local source vault backed up separately", "consistency": "pg_dump transactional snapshot; filesystem follows dump, no write pause; concurrent file deletion not covered"}
    def save():
        (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    save()
    jobs = [
        ("postgres.dump", "docker exec supa_db pg_dump -U postgres -d postgres -Fc"),
        ("globals.sql", "docker exec supa_db pg_dumpall -U postgres --globals-only"),
        ("server-files.tar.gz", "tar -czf - -C / " + " ".join(SOURCES)),
    ]
    try:
        for name, command in jobs:
            print(f"Backing up {name}", flush=True)
            manifest["artifacts"].append(fetch(args.host, command, folder / name))
            save()
        manifest["status"] = "copied_not_restore_verified"
        save()
        print(str(folder), flush=True)
    except Exception:
        manifest["status"] = "failed"
        save()
        raise

if __name__ == "__main__":
    main()
