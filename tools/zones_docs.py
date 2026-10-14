"""Данные игры «Профили площадей» — из площадных программ записей сайта.

Читает опубликованные записи через публичный API и переписывает блок DOCS
в prototypes/plans/zones.html между метками «// DOCS:begin» и «// DOCS:end».
Затем страницы моделей собирает tools/make_model_pages.py.

Правило счёта: строки программы, которые входят в итог и имеют площадь;
пути движения, инженерия и стоянки не считаются (документы задают их
по-разному: строками, процентом, коэффициентом); открытые площадки
(разгрузка, телевизионные машины) не считаются, кроме места действия —
поле стадиона входит.
"""
import json, pathlib, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
API = 'https://2vhutemas.ru/api/v1'
AXES = ['core', 'users', 'visitors', 'performers', 'production', 'management', 'other']
SKIP = {'circulation', 'engineering', 'parking'}
# in_type: документ участвует в профиле типа; иначе — только пример.
# Места — для расчёта площади на одно место (режим «Программа по числу мест»).
SEATS = {2083: 1190, 2071: 1969, 2087: 2000, 2084: 20000, 2082: 20000, 2194: 6000, 2086: 2050}
DOCS = [
    (2083, 'Комише-опер, Берлин', 'theatre', 'конкурсное задание 2020', True, 'зал и фойе в задании одной строкой; мест — 1 190 (по Википедии, в задании числа нет)'),
    (2071, 'Опера в Осло', 'theatre', 'брошюра заказчика 2003', False, 'только три части: публика (зал вместе с фойе), сцена и всё остальное — оно показано как «производство»; в профиль типа не входит'),
    (2087, 'Концертный зал «Таутос намай», Вильнюс', 'concert', 'конкурсное задание 2019', True, 'по нижней границе диапазонов; место действия — эстрада, ниша органа, хоровой балкон и сцена Малого зала'),
    (2084, 'Стадион «Яншпортпарк», Берлин', 'stadium', 'конкурсное задание 2022', True, 'поле с беговой дорожкой — расчёт по габаритам, в программе задания его нет'),
    (2082, 'Национальный стадион, Рейкьявик', 'stadium', 'предтендерная концепция 2017', True, 'поле с полосой вокруг — по ведомости; места на трибунах — расчёт по размеру места'),
    (2194, 'Pegula Ice Arena, Пенсильвания', 'arena', 'программа требований 2010', True, 'два ледовых поля — место действия'),
    (2086, 'Киноцентр «Камеримидж», Торунь', 'screen', 'конкурсное задание 2021', True, 'музей, выставки и образование — «другие функции»; киностудия — производство'),
]

def code(x):
    return x.get('code') if isinstance(x, dict) else x

def zones(eid):
    with urllib.request.urlopen(f'{API}/entities/{eid}', timeout=60) as r:
        card = json.load(r)
    sums = dict.fromkeys(AXES, 0.0)
    total = 0.0
    for group in card['indicators']:
        for value in group['values']:
            if value['parameter'] != 'area_program' or not value.get('rows'):
                continue
            for row in value['rows']:
                c = row.get('cells', row)
                area = c.get('program_area_total')
                if area is None and c.get('program_area') is not None:
                    area = c['program_area'] * (c.get('program_count') or 1)
                if area is None or code(c.get('program_in_total')) == 'no':
                    continue
                total += area
                zone = (code(c.get('program_purpose')) or '').split('.')[0]
                if zone in SKIP or zone not in sums:
                    continue
                if code(c.get('program_space_type')) == 'open' and zone != 'core':
                    continue
                sums[zone] += area
    return [round(sums[a]) for a in AXES], round(total)

def main():
    lines = []
    for eid, name, typ, doc, in_type, note in DOCS:
        m2, total = zones(eid)
        lines.append('    ' + json.dumps({'id': eid, 'name': name, 'type': typ, 'doc': doc, 'inType': in_type,
                                          'seats': SEATS[eid], 'm2': m2, 'total': total, 'note': note}, ensure_ascii=False) + ',')
        print(eid, name, m2, total)
    path = ROOT / 'prototypes' / 'plans' / 'zones.html'
    text = path.read_text(encoding='utf-8')
    head, rest = text.split('// DOCS:begin\n', 1)
    _, tail = rest.split('  // DOCS:end', 1)
    path.write_text(head + '// DOCS:begin\n  var DOCS = [\n' + '\n'.join(lines).rstrip(',') + '\n  ];\n  // DOCS:end' + tail, encoding='utf-8')

if __name__ == '__main__':
    main()
