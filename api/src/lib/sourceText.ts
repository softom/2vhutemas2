import {isIP} from 'node:net';
import {gunzipSync,inflateSync,brotliDecompressSync} from 'node:zlib';
import {parseHTML} from 'npm:linkedom@0.18.12';
import {Readability} from 'npm:@mozilla/readability@0.6.0';
import {isOwnResearchSource} from './researchSourcePolicy.ts';
const MAX_BYTES=3_000_000,MAX_TEXT=240_000;
export function publicIPv4(ip:string){
 if(isIP(ip)!==4)return false;
 const [a,b,c]=ip.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113||ip==='155.212.170.40');
}
export function textSourceUrl(raw:string){
 const u=new URL(raw);
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port&&!['80','443'].includes(u.port)||isIP(u.hostname)||!u.hostname.includes('.')||/\.(local|localhost|internal|lan|test|invalid)$/i.test(u.hostname)||isOwnResearchSource(u.href))throw new Error('Адрес источника запрещён');
 return u;
}
export async function pinnedGet(raw:string,signal:AbortSignal,resolve:(host:string)=>Promise<string[]>=host=>Deno.resolveDns(host,'A')):Promise<{bytes:Uint8Array;type:string;url:string}>{
 let u=textSourceUrl(raw);
 for(let redirect=0;redirect<=4;redirect++){
  signal.throwIfAborted();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const addresses=await Promise.race([resolve(u.hostname),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS timeout')),4000);})]).finally(()=>clearTimeout(timer));
  signal.throwIfAborted();
  if(!addresses.length||addresses.some(ip=>!publicIPv4(ip)))throw new Error('DNS источника указывает на запрещённую сеть');
  const result=await socketGet(u,addresses[0],signal);
  if([301,302,303,307,308].includes(result.status)){if(!result.headers.location||redirect===4)throw new Error('Слишком много перенаправлений');u=textSourceUrl(new URL(result.headers.location,u).href);continue;}
  if(result.status!==200)throw new Error('HTTP '+result.status);
  let bytes=result.bytes;const encoding=String(result.headers['content-encoding']||'').toLowerCase();
  const options={maxOutputLength:MAX_BYTES};
  if(encoding==='gzip')bytes=gunzipSync(bytes,options);else if(encoding==='deflate')bytes=inflateSync(bytes,options);else if(encoding==='br')bytes=brotliDecompressSync(bytes,options);else if(encoding&&encoding!=='identity')throw new Error('Неподдерживаемое сжатие');
  return {bytes,type:String(result.headers['content-type']||''),url:u.href};
 }
 throw new Error('Не удалось получить страницу');
}
// Pin the TCP destination while verifying TLS against the original hostname.
// Deno 2.1 node:https does not honour servername with an IP hostname.
async function socketGet(u:URL,ip:string,signal:AbortSignal){
 let conn:Deno.Conn|undefined;
 const abort=()=>{try{conn?.close();}catch{}};
 signal.addEventListener('abort',abort,{once:true});
 try{
  let rejectConnect:((reason:unknown)=>void)|undefined;
  const abortConnect=()=>rejectConnect?.(signal.reason);
  signal.addEventListener('abort',abortConnect,{once:true});
  try{conn=await Promise.race([Deno.connect({hostname:ip,port:Number(u.port|| (u.protocol==='https:'?443:80))}).then(c=>{if(signal.aborted){c.close();throw signal.reason;}return c;}),new Promise<never>((_,reject)=>{rejectConnect=reject;if(signal.aborted)reject(signal.reason);})]);}
  finally{signal.removeEventListener('abort',abortConnect);}
  signal.throwIfAborted();
  if(u.protocol==='https:')conn=await Deno.startTls(conn as Deno.TcpConn,{hostname:u.hostname,alpnProtocols:['http/1.1']});
  signal.throwIfAborted();
  const request=new TextEncoder().encode(`GET ${u.pathname+u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUser-Agent: 2VhutemasResearch/1.0 (+https://2vhutemas.ru)\r\nAccept: text/html,application/xhtml+xml,text/plain,application/json\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n`);
  for(let sent=0;sent<request.length;)sent+=await conn.write(request.subarray(sent));
  const chunks:Uint8Array[]=[];let size=0;
  while(true){signal.throwIfAborted();const chunk=new Uint8Array(32768);const n=await conn.read(chunk);if(n===null)break;size+=n;if(size>MAX_BYTES+131072)throw new Error('Превышен размер страницы');chunks.push(chunk.slice(0,n));}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  return decodeResponse(bytes);
 }finally{signal.removeEventListener('abort',abort);abort();}
}
export function decodeResponse(raw:Uint8Array){
 const end=raw.findIndex((_,i)=>raw[i]===13&&raw[i+1]===10&&raw[i+2]===13&&raw[i+3]===10);
 if(end<0||end>65536)throw new Error('Некорректные HTTP заголовки');
 const lines=new TextDecoder().decode(raw.subarray(0,end)).split('\r\n');const status=Number(lines.shift()?.match(/^HTTP\/1\.[01] (\d{3})/)?.[1]);
 if(!status)throw new Error('Некорректный HTTP ответ');
 const headers:Record<string,string>={};for(const line of lines){const i=line.indexOf(':');if(i<1)throw new Error('Некорректный HTTP заголовок');const k=line.slice(0,i).toLowerCase();if(headers[k]!==undefined)headers[k]+=', '+line.slice(i+1).trim();else headers[k]=line.slice(i+1).trim();}
 let bytes=raw.subarray(end+4);
 if(headers['transfer-encoding']){
  if(headers['transfer-encoding'].toLowerCase()!=='chunked')throw new Error('Неподдерживаемый HTTP transfer encoding');
  const pieces:Uint8Array[]=[];let offset=0,total=0;
  while(true){let e=offset;while(e<bytes.length&&!(bytes[e]===13&&bytes[e+1]===10))e++;if(e-offset>1024||e>=bytes.length)throw new Error('Оборванный HTTP chunk');const line=new TextDecoder().decode(bytes.subarray(offset,e)).split(';')[0];if(!/^[0-9a-f]+$/i.test(line))throw new Error('Некорректный HTTP chunk');const n=parseInt(line,16);offset=e+2;if(!n)break;if(n>MAX_BYTES||offset+n+2>bytes.length||bytes[offset+n]!==13||bytes[offset+n+1]!==10)throw new Error('Оборванный HTTP chunk');total+=n;if(total>MAX_BYTES)throw new Error('Превышен размер страницы');pieces.push(bytes.subarray(offset,offset+n));offset+=n+2;}
  bytes=new Uint8Array(total);let at=0;for(const p of pieces){bytes.set(p,at);at+=p.length;}
 }else if(headers['content-length']!==undefined&&(!/^\d+$/.test(headers['content-length'])||Number(headers['content-length'])!==bytes.length))throw new Error('Оборванный HTTP ответ');
 if(bytes.length>MAX_BYTES)throw new Error('Превышен размер страницы');
 return {status,headers,bytes};
}
const tidy=(s:string)=>s.replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/\n\s*\n\s*\n/g,'\n\n').trim();
export function extractPage(bytes:Uint8Array,type:string,url:string){
 const charset=type.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]||new TextDecoder().decode(bytes.slice(0,4096)).match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]||'utf-8';
 let html:string;try{html=new TextDecoder(charset).decode(bytes);}catch{throw new Error('Неподдерживаемая кодировка');}
 if(!/text\/html|application\/xhtml\+xml|text\/plain/i.test(type))throw new Error('Тип страницы пока не поддерживается: '+type.slice(0,80));
 if(/just a moment|checking your browser|verify you are human|access denied|enable javascript and cookies|captcha/i.test(html.slice(0,2000)))throw new Error('Страница защиты вместо текста');
 let text='',title='',language='',author='',method='plain';
 if(/text\/plain/i.test(type))text=tidy(html);
 else{
  const {document}=parseHTML(html) as any;Object.defineProperty(document,'documentURI',{value:url});Object.defineProperty(document,'baseURI',{value:url});
  language=document.documentElement.lang||'';title=document.title||'';author=document.querySelector('meta[name="author"]')?.getAttribute('content')||'';
  try{const clone=document.cloneNode(true);Object.defineProperty(clone,'documentURI',{value:url});Object.defineProperty(clone,'baseURI',{value:url});const article=new Readability(clone as any,{charThreshold:300,maxElemsToParse:40000}).parse();if(article?.textContent&&article.textContent.trim().length>=300){text=tidy(article.textContent);title=article.title||title;author=article.byline||author;method='readability';}}catch{/* DOM fallback below; no external service. */}
  if(!text){for(const n of document.querySelectorAll('script,style,noscript,nav,footer,header,aside,form,iframe,svg'))n.remove();const root=document.querySelector('article,main,[role="main"]');if(!root)throw new Error('Не удалось выделить основной текст');text=tidy(Array.from(root.querySelectorAll('h1,h2,h3,p,li,td')).map((n:any)=>n.textContent||'').join('\n\n'));method='semantic-html';}
 }
 if(text.length<300)throw new Error('Недостаточно текста страницы');
 return {text:text.slice(0,MAX_TEXT),title,language,author,method,quality:text.length>MAX_TEXT?'partial':'page',final_url:url};
}
export async function retrieveText(raw:string){
 const url=textSourceUrl(raw);const signal=AbortSignal.timeout(25000);let directError='';
 try{const page=await pinnedGet(url.href,signal);return extractPage(page.bytes,page.type,page.url);}catch(e){directError=(e as Error).message;}
 // Independent provider API fallback for Wikipedia, without proxying arbitrary URLs.
 if(/^[a-z-]+\.wikipedia\.org$/.test(url.hostname)&&url.pathname.startsWith('/wiki/')){
  try{const api=new URL('/w/api.php',url);api.search=new URLSearchParams({action:'query',prop:'extracts',explaintext:'1',redirects:'1',format:'json',titles:decodeURIComponent(url.pathname.slice(6)).replaceAll('_',' ')}).toString();
   const page=await pinnedGet(api.href,AbortSignal.timeout(15000));const data=JSON.parse(new TextDecoder().decode(page.bytes));const found:any=Object.values(data.query?.pages||{})[0];const text=tidy(String(found?.extract||''));if(text.length<300)throw new Error('Нет текста');return {text:text.slice(0,MAX_TEXT),title:found.title,language:url.hostname.split('.')[0],author:'',method:'wikipedia-api',quality:text.length>MAX_TEXT?'partial':'page',final_url:url.href};
  }catch(e){throw new Error(directError+'; Wikipedia API: '+(e as Error).message);}
 }
 throw new Error(directError);
}
