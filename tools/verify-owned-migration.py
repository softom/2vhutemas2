"""Restore app from a backup and verify migration 0024 in a new isolated DB."""
import argparse,json,re,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from migrate import REMOTE,ENV_FILE
p=argparse.ArgumentParser();p.add_argument('--database',required=True);p.add_argument('--dump',default='/tmp/r78-postgres.dump');a=p.parse_args()
assert re.fullmatch(r'r78_verify_[a-z0-9_]+',a.database)
assert re.fullmatch(r'/tmp/[a-zA-Z0-9_.-]+',a.dump)
def sql(text,db=None):
 command=REMOTE.format(env=ENV_FILE,flags="-q -At").replace('-d postgres','-d '+(db or a.database))
 r=subprocess.run(['ssh','-o','BatchMode=yes','2vhutemas',command],input=text.encode(),capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr.decode())
 return r.stdout.decode().strip()
# Fails rather than replacing any existing database.
sql('create database '+a.database+';', 'postgres')
sql('create schema app authorization supabase_admin; grant usage on schema app to app_api;')
command=REMOTE.format(env=ENV_FILE,flags='-q');command=command[:command.index('psql -U')]+f'pg_restore -U supabase_admin -d {a.database} --schema=app --exit-on-error {a.dump}'
r=subprocess.run(['ssh','-o','BatchMode=yes','2vhutemas',command],capture_output=True)
if r.returncode:raise RuntimeError(r.stderr.decode())
checks={
 'documents':"select jsonb_build_object('count',count(*),'hash',md5(string_agg(to_jsonb(d)::text,'|' order by id))) from app.documents d",
 'credits':"select jsonb_build_object('count',count(*),'hash',md5(string_agg(to_jsonb(d)::text,'|' order by material_id,contributor_id,credit_role))) from app.material_credits d",
 'attachments':"select jsonb_build_object('count',count(*),'hash',md5(string_agg(to_jsonb(d)::text,'|' order by id))) from app.attachments d",
 'parameters':"select jsonb_build_object('count',count(*),'hash',md5(string_agg(to_jsonb(d)::text,'|' order by id))) from app.indicator_values d",
 'media':"select jsonb_build_object('count',count(*),'hash',md5(string_agg(to_jsonb(d)::text,'|' order by id))) from app.media_assets d",
}
before={k:sql(v) for k,v in checks.items()}
old=json.loads(sql("select jsonb_object_agg(id,md5(snapshot::text||coalesce(edited_by::text,'')||created_at::text)) from app.revisions"))
migration=Path(__file__).resolve().parents[1]/'db/migrations/0024_owned_content_versions.sql'
sql('begin;'+migration.read_text(encoding='utf-8')+';commit;')
for key,query in checks.items():assert before[key]==sql(query),key
new=json.loads(sql("select jsonb_object_agg(id,md5(snapshot::text||coalesce(edited_by::text,'')||created_at::text)) from app.revisions"))
assert all(new.get(k)==v for k,v in old.items()),'Historical revisions changed'
assert sql("select count(*) from app.entities where working_revision_id is null or (status='published' and published_revision_id is null)")=='0'
assert sql("select count(*) from app.links where working_revision_id is null")=='0'
print(json.dumps({'database':a.database,'restored_app':True,'migration':True,'unchanged':{k:json.loads(v)['count'] for k,v in before.items()},'historical_revisions_preserved':len(old),'total_revisions':len(new)},ensure_ascii=False,indent=2))
