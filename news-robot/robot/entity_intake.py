"""Durable delivery of generated news materials to entity intake.
A stable dossier UUID makes retries and regeneration idempotent; editor data
is never overwritten. Pending JSON survives API outages/process restarts.
"""
from __future__ import annotations
import json,uuid
from pathlib import Path
from datetime import datetime
from urllib.parse import urlsplit

def _uid(key):return str(uuid.uuid5(uuid.NAMESPACE_URL,'https://2vhutemas.ru/news-story/'+key))
def _url(value):
 try:
  u=urlsplit(str(value or ''));return str(value)[:4000] if u.scheme in ('http','https') and u.netloc and not u.username and not u.password else ''
 except ValueError:return ''
def _write(path,value):
 path.parent.mkdir(parents=True,exist_ok=True)
 tmp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8');tmp.replace(path)
def payload(story,article=None,items=None):
 cand=story.get('candidate') or {};key=str(cand.get('story_key') or '')
 if not key:raise ValueError('Generated news has no story key')
 did=_uid(key);meta=story.get('source') or {};article=article or {};items=items or {}
 main=_url(meta.get('адрес'));source_list=list(cand.get('sources') or [])
 if main and not any(s.get('url')==main for s in source_list):source_list.insert(0,{'url':main,'title':meta.get('заголовок'),'source':meta.get('издание')})
 sources=[];seen=set()
 for s in source_list[:20]:
  url=_url(s.get('url'))
  if not url or url in seen:continue
  seen.add(url);item=next((i for i in items.values() if i.url==url),None)
  sid=str(uuid.uuid5(uuid.UUID(did),url));media=[]
  images=(article.get('images') or getattr(item,'images',[]) or []) if url==main else getattr(item,'images',[]) or []
  used=set()
  for im in images[:32]:
   address=_url(im.get('url'))
   if not address or address in used:continue
   used.add(address);media.append(dict(id=str(uuid.uuid5(uuid.UUID(sid),address)),url=address,media_entity_id=None,kind='image',caption=str(im.get('caption') or im.get('alt') or '')[:1000],author=str(im.get('credit') or '')[:1000],status='link',error=''))
  date=str(s.get('date') or '')[:10]
  try:datetime.strptime(date,'%Y-%m-%d')
  except ValueError:date=None
  description=(article.get('text') or getattr(item,'summary','') or '') if url==main else getattr(item,'summary','') or ''
  sources.append(dict(id=sid,url=url,title=str(s.get('title') or s.get('source') or url)[:500],description=str(description)[:12000],publisher=str(s.get('source') or '')[:1000],author=str(getattr(item,'author','') or '')[:1000],published_at=date,media=media))
 if not sources:raise ValueError('Generated news has no source URL')
 news=story.get('news') or {}
 return dict(id=did,title=str(news.get('title') or cand.get('title_ru') or sources[0]['title'])[:500],description=('Разобрать сущности по материалам новости: определить объекты, авторов, места и связи.\n'+json.dumps(story.get('facts') or {},ensure_ascii=False))[:60000],status='proposed',reason='',target_entity_id=None,sources=sources)

def flush(root:Path,log,api=None,limit=5):
 if api is None:
  from .publish import Api
  api=Api();api.client.timeout=15.0
 pending=root/'.state'/'entity_intake_outbox';sent=root/'.state'/'entity_intake_sent'
 for path in sorted(pending.glob('*.json'))[:limit]:
  try:
   task=json.loads(path.read_text(encoding='utf-8'))
   if not api.live:raise RuntimeError('API token not configured')
   result=api.call('POST','/entity-intake',json=task['payload'])
   _write(sent/path.name,{'id':result['id'],'story_key':task['story_key']})
   path.unlink(missing_ok=True)
   log('info','entity_intake','материалы новости переданы в стек сущностей',story=task['story_key'],intake_id=result['id'])
  except Exception as e:
   log('error','entity_intake','передача в стек сущностей ожидает повтора',file=path.name,error=str(e)[:300])

def enqueue(root:Path,story,article,items,log,api=None):
 task=payload(story,article,items);did=task['id'];story['entity_intake_id']=did
 if (root/'.state'/'entity_intake_sent'/f'{did}.json').exists():return did
 _write(root/'.state'/'entity_intake_outbox'/f'{did}.json',{'story_key':story['candidate']['story_key'],'payload':task})
 flush(root,log,api=api,limit=1)
 return did
