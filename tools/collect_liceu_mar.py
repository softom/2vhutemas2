"""Download verified public Liceu Mar competition sources; preserve originals.

Usage: python collect_liceu_mar.py DESTINATION
Requires PyMuPDF. No credentials or API publication.
"""
import concurrent.futures
import datetime
import hashlib
import json
import re
from pathlib import Path
import sys
import urllib.request
import uuid
import fitz

SOURCES = [
    ('technical-brief-es.pdf', 'https://www.liceubarcelona.cat/sites/default/files/2025-07/LICEU%20MAR_Plec%20Prescripcions%20T%C3%A8cniques%20Redacci%C3%B3_es_lr.pdf'),
    ('technical-brief-en.pdf', 'https://www.liceubarcelona.cat/sites/default/files/2025-07/Plec%20Prescripcions%20T%C3%A8cniques%20Redacci%C3%B3%20Projecte_en_lr.pdf'),
    ('technical-brief-ca.pdf', 'https://www.liceubarcelona.cat/sites/default/files/2025-07/LICEU%20MAR%20-%20Plec%20Prescripcions%20T%C3%A8cniques%20Redacci%C3%B3%20Projecte_cat_lr.pdf'),
    ('competition-rules-en.pdf', 'https://contractaciopublica.cat/portal-api/descarrega-document/301514804/E257364317AA171867F7A7742FC8AC87'),
    ('competition-rules-ca.pdf', 'https://contractaciopublica.cat/portal-api/descarrega-document/301514794/6212F001585081DD7CE344C54F443E6B'),
    ('applications-opening-2025-12-16.pdf', 'https://contractaciopublica.cat/portal-api/descarrega-document/301875629/6C87EEA20DF8AEFE562BB887C7F896E0'),
    ('launch-en.html', 'https://www.liceubarcelona.cat/en/news/liceu-mar-architecture-Competition'),
    ('finalists-en.html', 'https://www.liceubarcelona.cat/en/noticies/liceu-mar-finalistes'),
]

def main():
    root = Path(sys.argv[1]).resolve()
    if not root.is_dir():
        raise SystemExit('Destination must already exist')
    originals = root / 'documents'
    originals.mkdir(exist_ok=True)
    texts = root / 'extracted-text'
    texts.mkdir(exist_ok=True)
    sources = list(SOURCES)
    portal_titles = {}
    def walk_documents(value):
        if isinstance(value, dict):
            if all(k in value for k in ('id','hash','titol','mida')):
                title = value['titol']
                safe = re.sub(r'[<>:"/\\|?*]', '_', title)
                if len(safe) > 100:
                    safe = safe[:90] + Path(safe).suffix
                name = f"{value['id']}_{safe}"
                url = f"https://contractaciopublica.cat/portal-api/descarrega-document/{value['id']}/{value['hash']}"
                if not any(u == url for _, u in sources):
                    sources.append((name,url))
                    portal_titles[name] = title
            for v in value.values():
                walk_documents(v)
        elif isinstance(value, list):
            for v in value:
                walk_documents(v)
    for filename, publication_id in [('procurement-tender.json',300604574),('procurement-publication.json',300733083)]:
        url = f'https://contractaciopublica.cat/portal-api/detall-publicacio-expedient/cb4b6f63-8576-4a62-9be3-1c70301feea6/{publication_id}'
        path = root / filename
        if not path.exists():
            with urllib.request.urlopen(url, timeout=45) as response:
                data = response.read()
            json.loads(data)
            with path.open('xb') as f:
                f.write(data)
        walk_documents(json.loads(path.read_text(encoding='utf-8')))
    def fetch(item):
        name, url = item
        path = originals / name
        row = dict(source_uid=str(uuid.uuid5(uuid.NAMESPACE_URL, url)), url=url,
                   title=portal_titles.get(name,name),
                   file=path.relative_to(root).as_posix(),
                   publisher='Gran Teatre del Liceu / public procurement portal',
                   retrieved_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   rights='Official public source; no reuse licence verified')
        try:
            if not path.exists():
                with urllib.request.urlopen(url, timeout=45) as response:
                    data = response.read()
                    row['final_url'] = response.url
                if name.lower().endswith('.pdf'):
                    with fitz.open(stream=data, filetype='pdf') as doc:
                        row['pages'] = len(doc)
                with path.open('xb') as f:
                    f.write(data)
            data = path.read_bytes()
            row.update(status='ok', bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
            if name.lower().endswith('.pdf'):
                with fitz.open(path) as doc:
                    row['pages'] = len(doc)
                    (texts / (path.stem+'.txt')).write_text('\n'.join(f'\n--- PAGE {i+1} ---\n'+p.get_text() for i,p in enumerate(doc)), encoding='utf-8')
        except Exception as e:
            row.update(status='error', error=str(e))
        return row
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(fetch, sources))
    (root / 'download-manifest-2026-10-16.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    for row in rows:
        print(row['status'], row['file'], row.get('pages',''), row.get('error',''))

if __name__ == '__main__':
    main()
