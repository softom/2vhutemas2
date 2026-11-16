"""One-time, explicitly authorized repair of reviewed intake publications, 2026-11-16.
Read-only by default. Run on the server; never exports credentials or database dumps.
"""
import argparse, json, os, subprocess, urllib.request
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--apply',action='store_true')
parser.add_argument('--manifest',required=True)
args=parser.parse_args()
parents=[2885,2915,2977,2987,2988,2993,3048,3084,3090,3108,3133,3134]
note='Исправление публикации иллюстраций стека по указанию пользователя 16.11.2026'

def sql(query):
    p=subprocess.run(['docker','exec','-i','-e','PGPASSWORD='+os.environ['TEST_DB_PASSWORD'],'supa_db','psql','-U','supabase_admin','-d','postgres','-At','-v','ON_ERROR_STOP=1'],input='BEGIN READ ONLY;\n'+query+';\nCOMMIT;',text=True,capture_output=True)
    if p.returncode: raise RuntimeError(p.stderr)
    return '\n'.join(x for x in p.stdout.splitlines() if x not in ('BEGIN','COMMIT'))

def request(path,body=None,auth=True):
    req=urllib.request.Request('http://127.0.0.1:7073/api/v1'+path,data=json.dumps(body).encode() if body is not None else None,
      headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+os.environ['INTAKE_TEST_TOKEN']} if auth else {})})
    with urllib.request.urlopen(req,timeout=45) as r: return json.load(r)

target=Path(args.manifest)
if target.exists(): manifest=json.loads(target.read_text())
else:
    rows=json.loads(sql("""select coalesce(json_agg(x),'[]') from (
      select img.id,img.working_revision_id revision_id,a.id asset_id,array_agg(distinct e.id order by e.id) parents,
        md5(rev.snapshot::text) snapshot_hash,
        (select md5(string_agg(f.id::text||f.sha256||f.storage_key,'|' order by f.id)) from app.media_files f where f.asset_id=a.id) files_hash
      from app.entities e join app.links l on l.from_entity_id=e.id
      join app.link_roles r on r.id=l.role_id and r.code='illustration'
      join app.entities img on img.id=l.to_entity_id
      join app.media_assets a on a.entity_id=img.id and a.archived_at is null
      join app.revisions rev on rev.id=img.working_revision_id
      where e.id in ("""+','.join(map(str,parents))+""") and e.status='published' and l.status='published'
        and img.status='draft' and img.published_revision_id is null
        and exists(select 1 from app.entity_intake d where d.target_entity_id=e.id and d.status='done')
        and not exists(select 1 from app.revision_reviews rr join app.revisions rv on rv.id=rr.revision_id where rv.entity_id=img.id and rr.decision='unpublished')
      group by img.id,img.working_revision_id,a.id,rev.snapshot order by img.id)x"""))
    assert len(rows)==52, f'Review required: expected 52 images, found {len(rows)}'
    assert sorted({p for row in rows for p in row['parents']})==parents
    manifest={'parents':parents,'images':rows,'note':note}
    target.write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print('Reviewed inventory:',len(manifest['parents']),'parents,',len(manifest['images']),'images',flush=True)
if not args.apply: raise SystemExit(0)
for row in manifest['images']:
    current=json.loads(sql(f"select row_to_json(x) from(select e.status,e.working_revision_id,e.published_revision_id,md5(r.snapshot::text) snapshot_hash from app.entities e join app.revisions r on r.id=e.working_revision_id where e.id={int(row['id'])})x"))
    assert current['working_revision_id']==row['revision_id'] and current['snapshot_hash']==row['snapshot_hash'],'Image changed; review again'
    if current['status']=='published' and current['published_revision_id']==row['revision_id']:continue
    assert current['status']=='draft' and current['published_revision_id'] is None
    request('/entities/'+str(row['id'])+'/publish',{'revision_id':row['revision_id'],'note':note})
for row in manifest['images']:
    entity=request('/entities/'+str(row['id']),auth=False)
    assert entity['is_published']
    for variant in ['thumbnail','screen','original']:
        with urllib.request.urlopen('http://127.0.0.1:7073/api/v1/media/'+row['asset_id']+'/file?variant='+variant,timeout=30) as r:
            assert r.status==200
            r.read(1)
    check=json.loads(sql(f"select row_to_json(x) from(select md5(r.snapshot::text) snapshot_hash,(select md5(string_agg(f.id::text||f.sha256||f.storage_key,'|' order by f.id)) from app.media_files f where f.asset_id='{row['asset_id']}') files_hash,(select count(*) from app.revision_reviews rr where rr.revision_id=r.id and rr.decision='published' and rr.note='{note}') reviews from app.revisions r where r.id='{row['revision_id']}')x"))
    assert check['snapshot_hash']==row['snapshot_hash'] and check['files_hash']==row['files_hash'] and check['reviews']==1,check
for parent in parents:
    assert sql(f'select app.cover_asset({parent},false) is not null')=='t'
print('VERIFIED: 52 published images, 156 anonymous file responses, 12 public covers; snapshots and file metadata unchanged; 52 review records',flush=True)
