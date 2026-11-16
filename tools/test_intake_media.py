"""Publication regression. Only isolated DB/API, including isolated media storage."""
from pathlib import Path
import runpy, struct, zlib
globals().update(runpy.run_path(str(Path(__file__).with_name('test_intake_deferred.py'))))

def upload():
    def chunk(kind, data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',2,2,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0'+os.urandom(6)+b'\0'+os.urandom(6)))+chunk(b'IEND',b'')
    boundary='test-'+str(uuid.uuid4())
    body=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n'.encode()+png+f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\nTest media\r\n--{boundary}--\r\n'.encode())
    req=urllib.request.Request(base+'/media',data=body,headers={'Authorization':'Bearer '+token,'Content-Type':'multipart/form-data; boundary='+boundary})
    with urllib.request.urlopen(req) as r: return json.load(r)

def anonymous_file(asset):
    try:
        with urllib.request.urlopen(base+'/media/'+asset+'/file?variant=thumbnail') as r:return r.status
    except urllib.error.HTTPError as e:return e.code

def add_source_media(d, m):
    sql("insert into app.entity_intake_media(id,source_id,media_entity_id,url,kind,caption,status) values('"+str(uuid.uuid4())+"','"+d['sources'][0]['id']+"',"+str(m['entity_id'])+",'https://example.org/image','image','Test media','stored')")
    return get(d)

def publish(d):
    manifest=sorted(f"{m['id']}:{m['asset_id']}:{m['revision_id']}" for m in d.get('publication_media',[]))
    return call('POST','/entity-intake/'+d['id']+'/approve',{'version':d['version'],'confirm':True,'media_manifest':manifest})

m=upload(); assert anonymous_file(m['id'])==404
d=add_source_media(fixture(),m)
assert len(d['publication_media'])==1
assert approve(d)[0]==409  # old client cannot approve invisible media
ok(call('PATCH','/media/'+m['id'],{'caption':'Reviewed caption'}))
assert publish(d)[0]==409  # changed image must be reviewed again
d=get(d); p=ok(publish(d)); owner=p['target_entity_id']
assert anonymous_file(m['id'])==200
assert sql(f"select count(*) from app.links l join app.link_roles r on r.id=l.role_id where l.from_entity_id={owner} and l.to_entity_id={m['entity_id']} and r.code='illustration' and l.status='published'")=='1'
assert sql(f"select count(*) from app.revision_reviews where revision_id=(select published_revision_id from app.entities where id={m['entity_id']}) and decision='published'")=='1'
before=sql(f"select count(*) from app.revision_reviews where revision_id=(select published_revision_id from app.entities where id={m['entity_id']})")
ok(publish(p)); assert before==sql(f"select count(*) from app.revision_reviews where revision_id=(select published_revision_id from app.entities where id={m['entity_id']})")
print('PASS sketch media preview, stale-version rejection, atomic publication, public file, audit and retry')

late=upload();ok(call('POST','/media/attachments',{'entity_id':owner,'asset_id':late['id']}),201)
assert anonymous_file(late['id'])==200
print('PASS image attached after parent publication is public')

regular=ok(call('POST','/entities',{'type':'architecture_object','slug':'test-media-'+str(uuid.uuid4()),'title_ru':'Media publication test'}),201)
gallery=upload(); embedded=upload()
ok(call('POST','/media/attachments',{'entity_id':regular['id'],'asset_id':gallery['id']}),201)
assert anonymous_file(gallery['id'])==404
changed=ok(call('PATCH','/entities/'+str(regular['id']),{'base_revision_id':regular['revision_id'],'body_json':[{'id':'image-test','type':'mediaImage','props':{'assetId':embedded['id'],'caption':'Embedded'}}]}))
ok(call('POST','/entities/'+str(regular['id'])+'/publish',{}))
assert anonymous_file(gallery['id'])==200 and anonymous_file(embedded['id'])==200
print('PASS standard publication includes gallery and embedded files')

bad=upload(); d=add_source_media(fixture(),bad)
sql(f"update app.media_files set is_current=false where asset_id='{bad['id']}' and variant='original'")
assert publish(d)[0]==400
assert get(d)['status']=='ready'
assert sql("select count(*) from app.entities where slug='entity-"+d['id']+"'")=='0'
assert anonymous_file(bad['id'])==404
print('PASS failed media rolls back entire approval')

unresolved=fixture()
sql("insert into app.entity_intake_media(id,source_id,url,kind,caption,status) values('"+str(uuid.uuid4())+"','"+unresolved['sources'][0]['id']+"','https://example.org/unloaded','image','Unloaded','link')")
assert publish(get(unresolved))[0]==400
assert get(unresolved)['status']=='ready'
print('PASS unresolved media cannot silently disappear from publication')
