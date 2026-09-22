"""Применение миграций проекта (решение Р-12).

Каждый файл db/migrations/NNNN_*.sql выполняется одной транзакцией вместе с
записью в журнал app.schema_migrations. Только вперёд: обратных миграций нет.
Файл, уже применённый с другой контрольной суммой, останавливает работу.

Подключение: ssh на сервер, psql внутри контейнера supa_db от роли
supabase_admin. Пароль читается на сервере из .env и не печатается.

    python tools/migrate.py --status     показать состояние
    python tools/migrate.py --dry-run    показать, что будет применено
    python tools/migrate.py              применить непримененные миграции
"""
import argparse, hashlib, pathlib, re, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "db" / "migrations"
ENV_FILE = "/opt/2vhutemas/.env"
JOURNAL_MIGRATION = 1

REMOTE = (
    'PW=$(grep -E "^POSTGRES_PASSWORD=" {env} | head -1 | cut -d= -f2-); '
    'docker exec -i -e PGPASSWORD="$PW" supa_db '
    'psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 {flags}'
)


def run_sql(host, sql, flags="-q -At -F '|'"):
    command = REMOTE.format(env=ENV_FILE, flags=flags)
    result = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host, command],
        input=sql.encode("utf-8"), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(result.stderr.decode("utf-8", "replace").strip())
    return result.stdout.decode("utf-8", "replace").strip()


def local_migrations():
    files = sorted(MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql"))
    items = []
    for path in files:
        number = int(re.match(r"(\d{4})_", path.name).group(1))
        body = path.read_text(encoding="utf-8")
        items.append({"number": number, "name": path.name, "body": body,
                      "checksum": hashlib.sha256(body.encode("utf-8")).hexdigest()})
    numbers = [item["number"] for item in items]
    if len(set(numbers)) != len(numbers):
        raise SystemExit("Повторяющиеся номера миграций")
    return items


def applied(host):
    exists = run_sql(host, "select to_regclass('app.schema_migrations') is not null;")
    if exists != "t":
        return None
    rows = run_sql(host, "select number, filename, checksum from app.schema_migrations order by number;")
    result = {}
    for line in filter(None, rows.split("\n")):
        number, filename, checksum = line.split("|")
        result[int(number)] = {"name": filename, "checksum": checksum}
    return result


def apply(host, item):
    register = (
        "insert into app.schema_migrations(number, filename, checksum, duration_ms) "
        "values ({number}, '{name}', '{checksum}', {duration});"
    )
    started = time.monotonic()
    sql = "begin;\n" + item["body"] + "\n" + register.format(
        number=item["number"], name=item["name"], checksum=item["checksum"],
        duration=0) + "\ncommit;"
    run_sql(host, sql, flags="-q")
    elapsed = int((time.monotonic() - started) * 1000)
    run_sql(host, f"update app.schema_migrations set duration_ms = {elapsed} "
                  f"where number = {item['number']};", flags="-q")
    return elapsed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="2vhutemas")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    items = local_migrations()
    done = applied(args.host)
    if done is None:
        print("Журнал миграций ещё не создан; будет создан миграцией 0001.")
        done = {}

    for item in items:
        record = done.get(item["number"])
        if record and record["checksum"] != item["checksum"]:
            raise SystemExit(
                f"{item['name']}: файл изменён после применения "
                f"({record['checksum'][:12]}… в журнале). Исправление — новая миграция.")

    pending = [item for item in items if item["number"] not in done]

    if args.status or args.dry_run:
        for item in items:
            mark = "применена" if item["number"] in done else "ожидает"
            print(f"{item['number']:04d} {item['name']:<40} {mark}")
        if not pending:
            print("Непримененных миграций нет.")
        return

    if not pending:
        print("Непримененных миграций нет.")
        return

    for item in pending:
        print(f"Применяю {item['name']}", flush=True)
        try:
            elapsed = apply(args.host, item)
        except RuntimeError as error:
            print(f"ОШИБКА в {item['name']}: {error}", file=sys.stderr)
            print("Транзакция откатилась, изменений нет. Следующие миграции не применялись.", file=sys.stderr)
            raise SystemExit(1)
        print(f"  готово за {elapsed} мс")
    print(f"Применено миграций: {len(pending)}")


if __name__ == "__main__":
    main()
