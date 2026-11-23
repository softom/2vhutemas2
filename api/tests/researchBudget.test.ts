import {analysisPlan} from '../src/lib/researchBudget.ts';
import {attributionProposal,attributionFromFragment,attributionFormat} from '../src/lib/classificationValidation.ts';
let count=0;const ok=(v:unknown,m:string)=>{if(!v)throw Error(m);count++;};
const source=(n:number)=>({source_uid:String(n),source_url:`https://example.org/${n}`,source_title:'Page '+n,source_text:('Background details. '.repeat(2000)+'The podium is Brutalist. La corona es postmoderna. Método tecnicista. '+'More background. '.repeat(2000))});
const corpus=Array.from({length:100},(_,i)=>source(i));const before=JSON.stringify(corpus);const plan=analysisPlan(corpus,{code:'style_solutions',search_profiles:[{topic_terms:['brutalis','postmodern','tecnicis']}]});
ok(plan.summary.calls<=5&&plan.summary.selected_chars<=200000,'Hard budget');ok(plan.summary.limited,'Limited coverage explicit');ok(plan.summary.analyzed_sources===100,'Every eligible source represented');
const pieces=plan.chunks.flat();ok(new Set(pieces.map(p=>p.id)).size===100,'Balanced source coverage');
for(const p of pieces)ok(corpus[Number(p.id)].source_text.slice(p.offset,p.offset+p.text.length)===p.text,'Exact original substring');
ok(pieces.some(p=>p.text.includes('Brutalist'))&&pieces.some(p=>p.text.includes('postmoderna'))&&pieces.some(p=>p.text.includes('tecnicista')),'Relevant non-leading text retained');ok(JSON.stringify(corpus)===before,'Corpus unchanged');
ok(analysisPlan([{...source(1),source_url:'https://2vhutemas.ru/x'}],{code:'style_solutions'}).summary.calls===0,'Own site excluded');
const catalog=[{id:1,axis:'art_styles',title_ru:'Test'}],raw={axis:'art_styles',concept_id:1,relation:'classification_membership',source_id:'s',quote:'La corona es postmoderna.',rationale:'Источник прямо указывает на этот стиль.'};
const fragments=[{id:'s',text:'Other completely separate paragraph.',evidence:'page'},{id:'s',text:'La corona es postmoderna.',evidence:'page'}];
ok(attributionProposal(raw,catalog,fragments).quote===raw.quote,'Quote in second fragment is valid');
let rejected=false;try{attributionProposal({...raw,quote:'The crown is postmodern.'},catalog,fragments);}catch{rejected=true;}ok(rejected,'Translated/invented quote remains rejected');
ok(attributionProposal({...raw,quote:'La  corona es postmoderna.'},catalog,fragments).quote===raw.quote,'Whitespace normalization');
ok(pieces.every(p=>p.text.length<=1600),'Citation fragment bounded');
const chosen=pieces.find(p=>p.text.includes('postmoderna'))!;ok(attributionFromFragment({source_id:chosen.id,fragment_id:chosen.fragment_id,quote:'La corona es postmoderna.'},pieces).quote==='La corona es postmoderna.','Quote resolved only from source');
let invalid=false;try{attributionFromFragment({source_id:'wrong',fragment_id:chosen.fragment_id},pieces);}catch{invalid=true;}ok(invalid,'Cross-source fragment rejected');
const schema=attributionFormat(catalog,['s'],[1,2]).json_schema.schema.properties.proposals.items;ok(schema.required.includes('quote')&&schema.required.includes('fragment_id'),'Model selects rather than rewrites quotation');
const relevant=analysisPlan([{...source(1),source_text:'Torres Colón. The podium is Brutalist.'},{...source(2),source_text:'Cristóbal Colón sailed to America.'}],{code:'style_solutions'},['Torres de Colón']);ok(relevant.summary.analyzed_sources===1&&relevant.summary.excluded_unrelated===1,'Object name disambiguates Columbus');
const dense=Array.from({length:100},(_,i)=>({...source(i),source_text:Array.from({length:20},(_,j)=>'Brutalist structure '+i+' '+j+' '+('abc '.repeat(100))+'. ').join('')}));const bounded=analysisPlan(dense,{code:'style_solutions'});ok(bounded.summary.calls===5&&bounded.summary.selected_chars===200000,'Large unique corpus hits exact hard ceiling');
console.log('RESEARCH_BUDGET_AND_QUOTES_CHECKS',count);

for(const axis of ['form_method','morphological_trait'])ok(attributionProposal(raw,[{...catalog[0],axis}],fragments).relation==='classification_trait','Use canonical trait relation');

const variants=['Kaohsiung Music Center','Harbor Concert Hall'];
const titles=['Kaohsiung Maritime Pop Music Center','Music center in Kaohsiung','Kaohsiung music','Kaohsiung musical center','Kaohsiung concert hall','Concert hall by the harbor'];
const named=titles.map((title,i)=>({...source(i),source_title:title,source_text:'Architecture.'}));
ok(analysisPlan(named,{code:'style_solutions'},variants).summary.relevant_sources===3,'All whole words from one name, independently of order and intervening words');

const longQuote='The building stands on the waterfront. '+('Its timber columns support the cantilevered roof. ').repeat(13).trim();
const located={...raw,fragment_id:5,quote:longQuote};
const specimen={id:'s',fragment_id:5,text:longQuote};
const shortened=attributionFromFragment(located,[specimen]);
ok(shortened.quote.length<=400&&shortened.quote_trimmed,'Long exact quote is shortened');
ok(attributionProposal(shortened,catalog,[specimen]).quote===shortened.quote,'Clipped quote survives acceptance');
let invented=false;try{attributionFromFragment({...located,quote:longQuote+' invented ending'},[specimen]);}catch{invented=true;}ok(invented,'Full match before clipping');

const sameSource=[{...specimen,text:'One unrelated sentence.'},{...specimen,fragment_id:6,text:'The architect described a “folded roof” here.'}];
const typographyQuote={...located,quote:'The architect described a "folded roof" here.'};
const recovered=attributionFromFragment(typographyQuote,sameSource);
ok(recovered.fragment_id===6&&recovered.quote===sameSource[1].text,'Recover actual typography within same source');
let ambiguous=false;try{attributionFromFragment(typographyQuote,[...sameSource,{...sameSource[1],fragment_id:7}]);}catch{ambiguous=true;}ok(ambiguous,'Ambiguous alternative is rejected');

const methodRole=attributionProposal({...raw,relation:'classification_citation',zone:'CANOPY'},[{...catalog[0],axis:'form_method'}],fragments);
ok(methodRole.relation==='classification_trait'&&methodRole.zone==='навес','Method citation and multilingual zone normalized');
for(const [axis,relation] of [['art_epochs','influence'],['morphological_trait','classification_citation'],['form_method','influence']]){
 let blocked=false;try{attributionProposal({...raw,relation},[{...catalog[0],axis}],fragments);}catch{blocked=true;}ok(blocked,'Unexpected axis role blocked');
}
