"""Применение миграций проекта (решение Р-12).

Каждый файл db/migrations/NNNN_*.sql выполняется одной транзакцией вместе с
записью в журнал app.schema_migrations. Только вперёд: обратных миграций нет.
Файл, уже применённый с другой контрольной суммой, останавливает работу.

Номер миграции — её порядковый номер: два файла с одним номером означают
неопределённый порядок применения, поэтому такой набор останавливает
работу с перечислением виновников. Переименованный после применения файл
тоже останавливает работу: журнал помнит прежнее имя и номер.

Подключение: ssh на сервер, psql внутри контейнера supa_db от роли
supabase_admin. Пароль читается на сервере из .env и не печатается.

    python tools/migrate.py --status     показать состояние
    python tools/migrate.py --dry-run    показать, что будет применено
    python tools/migrate.py              применить непримененные миграции
    python tools/migrate.py --record 0077,0078
                                      записать в журнал миграции, эффект
                                      которых уже есть в базе (файлы при
                                      этом не выполняются)
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
    repeated = sorted({number for number in numbers if numbers.count(number) > 1})
    if repeated:
        listed = "; ".join(
            f"{number:04d} — " + ", ".join(
                item["name"] for item in items if item["number"] == number)
            for number in repeated)
        raise SystemExit(
            "Повторяющиеся номера миграций: " + listed +
            ". Номер задаёт порядок применения: переименуйте один из файлов "
            "на свободный номер и запишите его в журнал (--record), если он "
            "уже применён.")
    return items


def applied(host):
    """Журнал применённых миграций: по номеру и по имени файла."""
    exists = run_sql(host, "select to_regclass('app.schema_migrations') is not null;")
    if exists != "t":
        return None
    rows = run_sql(host, "select number, filename, checksum from app.schema_migrations order by number;")
    by_number = {}
    by_name = {}
    for line in filter(None, rows.split("\n")):
        number, filename, checksum = line.split("|")
        record = {"number": int(number), "name": filename, "checksum": checksum}
        by_number[int(number)] = record
        by_name[filename] = record
    return {"by_number": by_number, "by_name": by_name}


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


def record(host, item):
    """Записать в журнал миграцию, эффект которой уже есть в базе.

    Файл не выполняется: инструмент только сверяет журнал с тем, что уже
    применено руками. Запись без такой сверки делает журнал ложью, поэтому
    вызывающий обязан убедиться, что эффект миграции в базе есть.
    """
    run_sql(
        host,
        "insert into app.schema_migrations(number, filename, checksum) "
        f"values ({item['number']}, '{item['name']}', '{item['checksum']}');",
        flags="-q")


def pick(items, wanted):
    """Найти миграцию по номеру или по имени файла."""
    for token in wanted:
        token = token.strip()
        if not token:
            continue
        for item in items:
            if item["name"] == token or f"{item['number']:04d}" == token:
                yield item
                break
        else:
            raise SystemExit(f"Миграция {token} не найдена в db/migrations.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="2vhutemas")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--record", default="",
                        help="записать в журнал миграции, уже применённые руками "
                             "(номера через запятую или имена файлов)")
    args = parser.parse_args()

    items = local_migrations()
    journal = applied(args.host)
    if journal is None:
        print("Журнал миграций ещё не создан; будет создан миграцией 0001.")
        journal = {"by_number": {}, "by_name": {}}
    by_number = journal["by_number"]
    by_name = journal["by_name"]

    for item in items:
        record_of_number = by_number.get(item["number"])
        if record_of_number and record_of_number["checksum"] != item["checksum"]:
            raise SystemExit(
                f"{item['name']}: файл изменён после применения "
                f"({record_of_number['checksum'][:12]}… в журнале). Исправление — новая миграция.")
        record_of_name = by_name.get(item["name"])
        if record_of_name and record_of_name["number"] != item["number"]:
            raise SystemExit(
                f"{item['name']}: в журнале этот файл значится под номером "
                f"{record_of_name['number']:04d}. Переименование применённой миграции "
                "ломает историю — вернуть прежнее имя или записать файл как новую миграцию.")

    if args.record:
        chosen = list(pick(items, args.record.split(",")))
        for item in chosen:
            if item["number"] in by_number:
                raise SystemExit(
                    f"{item['name']}: номер {item['number']:04d} уже есть в журнале.")
            if item["name"] in by_name:
                raise SystemExit(f"{item['name']}: файл уже есть в журнале.")
            record(args.host, item)
            print(f"Записано в журнал без выполнения: {item['number']:04d} {item['name']}")
        return

    pending = [item for item in items if item["number"] not in by_number]

    if args.status or args.dry_run:
        for item in items:
            mark = "применена" if item["number"] in by_number else "ожидает"
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
