import {decodeResponse} from '../src/lib/sourceText.ts';
import {retrieveText,extractPage,publicIPv4,textSourceUrl,pinnedGet} from '../src/lib/sourceText.ts';
import {researchQueries} from '../src/lib/researchQueries.ts';
import {sourceQuality} from '../src/lib/sourceEvidence.ts';
let checks=0;function ok(v:unknown,m:string){if(!v)throw new Error(m);checks++;}
for(const ip of ['0.0.0.0','127.0.0.1','10.0.0.2','172.16.0.1','169.254.169.254','100.64.0.1','192.168.1.2','198.18.0.1','224.1.1.1','::1','::ffff:127.0.0.1','155.212.170.40'])ok(!publicIPv4(ip),'Reject '+ip);
ok(publicIPv4('8.8.8.8'),'Public address');
for(const url of ['http://127.1','http://0x7f000001','http://user:pass@example.org','http://example.org:8080','http://localhost','http://2vhutemas.ru','file:///etc/passwd']){let rejected=false;try{textSourceUrl(url);}catch{rejected=true;}ok(rejected,'Reject URL '+url);}
let rejected=false;try{await pinnedGet('https://example.org',AbortSignal.timeout(1000),async()=>['8.8.8.8','127.0.0.1']);}catch{rejected=true;}ok(rejected,'Mixed public/private DNS rejected before connection');
const prose='This is the complete text of a deliberately long architectural article about a building and its construction. '.repeat(12);
const html='<html lang="en"><head><title>Architecture test</title></head><body><nav>Junk menu</nav><article><h1>Architecture test</h1><p>'+prose+'</p></article><script>bad script</script></body></html>';
const extracted=extractPage(new TextEncoder().encode(html),'text/html; charset=utf-8','https://example.org/article');ok(extracted.text.includes(prose.trim())&&!extracted.text.includes('bad script'),'Article text extracted');ok(extracted.quality==='page'&&extracted.language==='en','Quality/language');
let blocked=false;try{extractPage(new TextEncoder().encode('<title>Just a moment</title>'+prose),'text/html','https://example.org');}catch{blocked=true;}ok(blocked,'Challenge is not content');
const queries=researchQueries({title_ru:'Башни Колумба',title_en:'Columbus Towers',title_original:'Torres de Colón',original_language:'es'},{code:'style_solutions',title_ru:'Стили'});
ok(queries.length===6&&queries.some(q=>q.language==='es'&&q.query.includes('estilo'))&&queries.some(q=>q.language==='en'&&q.searchType==='SEARCH_TYPE_COM')&&queries.some(q=>q.language==='ru'&&q.searchType==='SEARCH_TYPE_RU'),'Multilingual query plan');ok(!queries.some(q=>q.query.includes('морфология')),'Short topic queries');
ok(sourceQuality({source_text:'text',source_observations:JSON.stringify([{kind:'retrieval',chars:4,quality:'partial'}])})==='partial','Partial never full');
console.log('OFFLINE_CHECKS',checks);

const wire=(s:string)=>new TextEncoder().encode(s);
ok(new TextDecoder().decode(decodeResponse(wire('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nTest\r\n0\r\n\r\n')).bytes)==='Test','Chunk framing');
for(const bad of ['HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\nshort','HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n99\r\nshort']){let rejected=false;try{decodeResponse(wire(bad))}catch{rejected=true}ok(rejected,'Truncated HTTP body rejected');}
console.log('SOURCE_TEXT_CHECKS',checks);
