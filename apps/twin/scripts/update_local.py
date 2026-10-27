"""Update a local Twin install to this version without ever deleting the user's files.

    python3 apps/twin/scripts/update_local.py /path/to/your/twin

1. Zips the whole target folder first (data, accounts, anything unknown) into
   <target>/data/backups/pre-update-<time>.zip.
2. Copies this version's files over the old ones. Nothing in the target is deleted:
   files the new version no longer uses are listed, not removed.
3. Never touches <target>/data (accounts, practice portfolios, broker connections, backups).
"""
import argparse
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent
SKIP_DIRS = {"data", "__pycache__", ".git"}


def code_files(root):
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if path.is_file() and not (set(rel.parts) & SKIP_DIRS) and path.suffix != ".pyc":
            yield rel


def backup(target):
    folder = target / "data" / "backups"
    folder.mkdir(parents=True, exist_ok=True)
    archive_path = folder / ("pre-update-%s.zip" % datetime.now().strftime("%Y%m%d-%H%M%S"))
    count = 0
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(target.rglob("*")):
            rel = path.relative_to(target)
            if path.is_file() and rel.parts[:2] != ("data", "backups"):
                archive.write(path, rel.as_posix())
                count += 1
    archive_path.chmod(0o600)
    return archive_path, count


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("target", type=Path, help="the folder your Twin server runs from")
    parser.add_argument("--dry-run", action="store_true", help="show what would change, change nothing")
    args = parser.parse_args(argv)
    target = args.target.expanduser().resolve()
    if target == SOURCE:
        sys.exit("Target is this source folder; nothing to do.")
    if not target.is_dir():
        sys.exit("No folder at %s" % target)

    new_files = list(code_files(SOURCE))
    old_files = set(code_files(target))
    leftovers = sorted(old_files - set(new_files))
    print("Updating %s -> Twin from %s" % (target, SOURCE))
    if args.dry_run:
        print("  would copy %d files; %d existing files are not part of this version (kept): %s"
              % (len(new_files), len(leftovers), ", ".join(str(p) for p in leftovers[:20]) or "none"))
        return 0
    archive_path, count = backup(target)
    print("  backup: %s (%d files)" % (archive_path, count))
    for rel in new_files:
        destination = target / rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SOURCE / rel, destination)
    print("  copied %d files" % len(new_files))
    if leftovers:
        print("  kept %d files this version doesn't use (delete them yourself if you're sure):" % len(leftovers))
        for rel in leftovers[:40]:
            print("    " + str(rel))
    print("Restart the server to use the new version.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
