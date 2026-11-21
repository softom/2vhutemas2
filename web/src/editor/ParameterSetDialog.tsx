import { useEffect, useState } from 'react';
import {api,type ParameterRow,type ParameterSetRow,type SetConfiguration,type SetMemberConfiguration} from '../api';
import {Modal} from '../ui/Modal';
import {ParameterDialog,VALUE_TYPES} from './ParameterDialog';
import './ParameterSetDialog.css';
interface Props {set?:ParameterSetRow|null;onSaved:()=>void;onClose:()=>void}
const empty=():SetConfiguration=>({set:{code:'',title_ru:'',note:null,card_side:'right',research_enabled:false,result_kind:'parameter_values',config_version:0},items:[],tasks:[],profiles:[],types:[],roles:[],branches:[],choices:{types:[],roles:[]}});
const member=(id:string,order:number):SetMemberConfiguration=>({parameter_id:id,hint:null,sort_order:order,label_override:null,input_kind:'auto',is_required:false,repeatability:'inherit',summary_order:null,research_enabled:true,fill_instruction:null,merge_policy:'inherit',dedup_policy:'inherit',source_required:true,quote_required:false,minimum_evidence:'snippet',phase_required:false,zone_required:false,result_slot:null});
const kinds:Record<string,[string,string][]>={text:[['text','Строка'],['textarea','Многострочный текст']],number:[['number','Число']],integer:[['number','Число']],boolean:[['checkbox','Флажок']],option:[['select','Список']],date:[['date','Дата']],entity:[['entity','Сущность']],table:[['table','Таблица']]};
function Select({label,value,options,onChange}:{label:string;value:string;options:[string,string][];onChange:(v:string)=>void}){return <label>{label}<select value={value} onChange={e=>onChange(e.target.value)}>{options.map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>}
function Check({label,value,onChange}:{label:string;value:boolean;onChange:(v:boolean)=>void}){return <label className="set-config-check"><input type="checkbox" checked={value} onChange={e=>onChange(e.target.checked)}/>{label}</label>}
function ChoiceList({title,options,value,onChange}:{title:string;options:{id:string;title_ru:string}[];value:string[];onChange:(v:string[])=>void}){return <details><summary>{title} · {value.length}</summary><div className="set-config-choices">{options.map(o=><Check key={o.id} label={o.title_ru} value={value.includes(o.id)} onChange={yes=>onChange(yes?[...value,o.id]:value.filter(v=>v!==o.id))}/>)}</div></details>}
function codeFrom(title: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
    э: "e", ю: "yu", я: "ya", " ": "_", "-": "_",
  };
  return title.toLowerCase().split("").map((ch) => map[ch] ?? ch)
    .join("").replace(/[^a-z0-9_]/g, "").replace(/_+/g, "_").replace(/^_|_$/g, "")
    .slice(0, 40);
}


export function ParameterSetDialog({set,onSaved,onClose}:Props){
 const [config,setConfig]=useState<SetConfiguration>(empty);
 const [initial,setInitial]=useState<SetConfiguration>(empty);
 const [registry,setRegistry]=useState<ParameterRow[]>([]);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const [parameterEditor,setParameterEditor]=useState<ParameterRow|null|undefined>(undefined);
 const [codeTouched,setCodeTouched]=useState(!!set);
 const reloadRegistry=async()=>{const r=await api.parameters();setRegistry(r.items);return r.items};
 useEffect(()=>{let live=true;Promise.all([api.parameters(),set?api.parameterSetConfig(set.id):api.parameterSetConfigChoices().then(choices=>({...empty(),choices}))]).then(([r,c])=>{if(live){setRegistry(r.items);setConfig(c);setInitial(c);setLoading(false)}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[set?.id]);
 const patch=(x:Partial<SetConfiguration>)=>setConfig(c=>({...c,...x}));
 const patchSet=(x:Partial<SetConfiguration['set']>)=>setConfig(c=>({...c,set:{...c.set,...x}}));
 const patchItem=(id:string,x:Partial<SetMemberConfiguration>)=>setConfig(c=>({...c,items:c.items.map(i=>i.parameter_id===id?{...i,...x}:i)}));
 const dirty=JSON.stringify(config)!==JSON.stringify(initial);
 const close=()=>{if(!dirty||confirm('Закрыть окно? Несохранённые изменения пропадут.'))onClose()};
 const move=(at:number,delta:number)=>{const items=[...config.items],to=at+delta;if(to<0||to>=items.length)return;[items[at],items[to]]=[items[to],items[at]];patch({items})};
 const save=async()=>{setSaving(true);setError('');try{
  if(!config.set.title_ru.trim())throw Error('Укажите название набора');
  const payload={...config,code:config.set.code,config_version:initial.set.config_version,
   items:config.items.map((i,n)=>({...i,sort_order:n})),
   tasks:config.tasks.map((t,n)=>({...t,sort_order:n})),profiles:config.profiles.map((p,n)=>({...p,sort_order:n,topic_terms:p.topic_terms.map(t=>t.trim()).filter(Boolean)})),
   add_item_ids:config.items.filter(i=>!initial.items.some(old=>old.parameter_id===i.parameter_id)).map(i=>i.parameter_id),
   remove_item_ids:initial.items.filter(i=>!config.items.some(now=>now.parameter_id===i.parameter_id)).map(i=>i.parameter_id)};
  await api.saveParameterSetConfig(set?.id??null,payload);onSaved();onClose();
 }catch(e){setError((e as Error).message)}finally{setSaving(false)}};
 return <Modal title={set?'Правка набора':'Новый набор параметров'} dirty={dirty} onClose={()=>{if(!saving)onClose()}} footer={<><button type="button" disabled={loading||saving} onClick={save}>{saving?'Сохраняем…':'Сохранить'}</button><button type="button" className="ghost" disabled={saving} onClick={close}>Отмена</button></>}>
  {error&&<p role="alert" className="error">{error}</p>}
  {loading?<p className="notice">Загружаем настройки…</p>:<fieldset className="set-config form" disabled={saving}>
   <div className="row"><label>Название набора<input autoFocus value={config.set.title_ru} onChange={e=>patchSet({title_ru:e.target.value,...(!codeTouched?{code:codeFrom(e.target.value)}:{})})}/></label>
    <label>Код<input disabled={!!set} value={config.set.code} onChange={e=>{setCodeTouched(true);patchSet({code:e.target.value})}}/></label></div>
   <label>Пояснение<textarea aria-label="Пояснение" rows={2} value={config.set.note??''} onChange={e=>patchSet({note:e.target.value||null})}/></label>
   <ChoiceList title="Для каких типов записей" options={config.choices.types} value={config.branches} onChange={branches=>patch({branches})}/>
   <Select label="Где отображать на карточке" value={config.set.card_side} options={[["left","Слева — в тексте"],["right","Справа — в колонке атрибутов"]]} onChange={v=>patchSet({card_side:v as 'left'|'right'})}/>
   <h3>Параметры в наборе</h3>
   {!config.items.length&&<p className="hint">Добавьте параметры из справочника.</p>}
   {config.items.map((i,n)=>{const p=registry.find(p=>p.id===i.parameter_id);return <details className="set-config-item" key={i.parameter_id}>
    <summary>{n+1}. {i.label_override||p?.title_ru||'Параметр'}</summary>
    <div className="set-config-content">
     <div className="row"><button type="button" className="ghost" disabled={!n} onClick={()=>move(n,-1)}>Выше</button><button type="button" className="ghost" disabled={n===config.items.length-1} onClick={()=>move(n,1)}>Ниже</button>
      {p&&<button type="button" className="ghost" onClick={()=>setParameterEditor(p)}>Править параметр</button>}
      <button type="button" className="ghost" onClick={()=>patch({items:config.items.filter(x=>x.parameter_id!==i.parameter_id)})}>Убрать из набора</button></div>
     <p className="hint">{p?.title_ru} · {VALUE_TYPES.find(t=>t.code===p?.value_type)?.title??p?.value_type}. Настройки ниже действуют только в этом наборе. Значения карточек сохраняются.</p>
     <label>Подпись в наборе<input value={i.label_override??''} placeholder={p?.title_ru} onChange={e=>patchItem(i.parameter_id,{label_override:e.target.value||null})}/></label>
     <label>Подсказка<textarea aria-label="Подсказка" rows={2} value={i.hint??''} onChange={e=>patchItem(i.parameter_id,{hint:e.target.value||null})}/></label>
     <Select label="Вид поля" value={i.input_kind} options={[["auto","По типу параметра"],...(kinds[p?.value_type??'']??[])]} onChange={v=>patchItem(i.parameter_id,{input_kind:v})}/>
     <Check label="Обязательно при публикации" value={i.is_required} onChange={v=>patchItem(i.parameter_id,{is_required:v})}/>
     <p className="hint">Повторяемость: {p?.is_repeatable?'несколько значений':'одно значение'} — по определению параметра.</p>
     <label>Порядок в кратком заголовке строки<input type="number" value={i.summary_order??''} onChange={e=>patchItem(i.parameter_id,{summary_order:e.target.value===''?null:Number(e.target.value)})}/></label>
     <details><summary>Сбор и ИИ-обработка</summary><div className="set-config-content">
      <Check label="Предлагать заполнение этого параметра" value={i.research_enabled} onChange={v=>patchItem(i.parameter_id,{research_enabled:v})}/>
      <label>Инструкция заполнения<textarea aria-label="Инструкция заполнения" rows={4} value={i.fill_instruction??''} onChange={e=>patchItem(i.parameter_id,{fill_instruction:e.target.value||null})}/></label>
      <Select label="Правило принятия" value={i.merge_policy} options={[["inherit","По типу параметра"],["replace","Заменить выбранное значение"],...((p?.is_repeatable||p?.value_type==='table')?[["append_unique","Добавить без повторов"] as [string,string]]:[]),...(config.set.result_kind==='relations'?[["supplement_relation","Дополнить связь цитатой"] as [string,string]]:[])]} onChange={v=>patchItem(i.parameter_id,{merge_policy:v})}/>
      <Select label="Определение повтора" value={i.dedup_policy} options={[["inherit","По типу результата"],["exact_value","Совпадающее значение"],["source_context","Источник и контекст"]]} onChange={v=>patchItem(i.parameter_id,{dedup_policy:v})}/>
      <Check label="Нужен источник" value={i.source_required} onChange={v=>patchItem(i.parameter_id,{source_required:v,...(!v?{quote_required:false}:{})})}/>
      <Check label="Нужна точная цитата" value={i.quote_required} onChange={v=>patchItem(i.parameter_id,{quote_required:v,...(v?{source_required:true}:{})})}/>
      <Select label="Минимальный материал источника" value={i.minimum_evidence} options={[["snippet","Поисковая выдержка"],["partial","Частичный текст"],["page","Полный текст страницы"]]} onChange={v=>patchItem(i.parameter_id,{minimum_evidence:v})}/>
      <Check label="Обязательна фаза" value={i.phase_required} onChange={v=>patchItem(i.parameter_id,{phase_required:v})}/><Check label="Обязательна часть объекта" value={i.zone_required} onChange={v=>patchItem(i.parameter_id,{zone_required:v})}/>
      {config.set.result_kind==='relations'&&<Select label="Назначение поля в связи" value={i.result_slot??''} options={[["","Не задано"],["concept","Понятие"],["relation","Характер связи"],["quote","Цитата"],["rationale","Обоснование"],["source","Источник"],["phase","Фаза"],["zone","Часть объекта"]]} onChange={v=>patchItem(i.parameter_id,{result_slot:v||null})}/>}
     </div></details>
    </div>
   </details>})}
   <div className="row"><label>Добавить параметр<select value="" onChange={e=>{if(e.target.value)patch({items:[...config.items,member(e.target.value,config.items.length)]})}}><option value="">Выберите из справочника</option>{registry.filter(p=>!config.items.some(i=>i.parameter_id===p.id)).map(p=><option key={p.id} value={p.id}>{p.title_ru}</option>)}</select></label><button type="button" className="ghost" onClick={()=>setParameterEditor(null)}>Завести параметр</button></div>
   <details className="set-config-item"><summary>Сбор и ИИ-обработка</summary><div className="set-config-content">
    <Check label="Разрешить исследование набора" value={config.set.research_enabled} onChange={v=>patchSet({research_enabled:v})}/>
    <Select label="Результат исследования" value={config.set.result_kind} options={[["parameter_values","Значения параметров"],["relations","Связи с понятиями"]]} onChange={v=>patchSet({result_kind:v as 'parameter_values'|'relations'})}/>
    {config.set.result_kind==='relations'&&<><ChoiceList title="Допустимые типы понятий" options={config.choices.types} value={config.types} onChange={types=>patch({types})}/><ChoiceList title="Допустимые роли связей" options={config.choices.roles} value={config.roles} onChange={roles=>patch({roles})}/></>}
    <h4>Задания LLM</h4>
    {config.tasks.map((t,n)=><details className="set-config-item" key={t.id??n} open={!t.id}><summary>{t.title||'Новое задание'}{!t.enabled?' · выключено':''}</summary><div className="set-config-content">
     <Check label="Задание включено" value={t.enabled} onChange={v=>patch({tasks:config.tasks.map((x,k)=>k===n?{...x,enabled:v}:x)})}/>
     <label>Название задания<input value={t.title} onChange={e=>patch({tasks:config.tasks.map((x,k)=>k===n?{...x,title:e.target.value}:x)})}/></label>
     <label>Инструкция LLM<textarea aria-label="Инструкция LLM" rows={9} value={t.instruction} onChange={e=>patch({tasks:config.tasks.map((x,k)=>k===n?{...x,instruction:e.target.value}:x)})}/></label>
     <div className="row"><label>Максимум запросов<input type="number" min={1} max={5} value={t.max_calls} onChange={e=>patch({tasks:config.tasks.map((x,k)=>k===n?{...x,max_calls:Number(e.target.value)}:x)})}/></label><label>Максимум символов источников<input type="number" min={1000} max={200000} value={t.max_source_chars} onChange={e=>patch({tasks:config.tasks.map((x,k)=>k===n?{...x,max_source_chars:Number(e.target.value)}:x)})}/></label></div>
     <p className="hint">Модель: {t.model_name||'настройка сервера'}. Выключенное задание сохраняется в истории и не запускается.</p>
     {!t.id&&<button type="button" className="ghost" onClick={()=>patch({tasks:config.tasks.filter((_,k)=>k!==n)})}>Убрать новое задание</button>}
    </div></details>)}
    <button type="button" className="ghost" onClick={()=>patch({tasks:[...config.tasks,{title:'Новое задание',instruction:'',enabled:true,sort_order:config.tasks.length,model_name:null,max_calls:2,max_source_chars:60000}]})}>Добавить задание</button>
    <h4>Поисковые профили</h4>
    <p className="hint">В шаблоне нужен {'{title}'} — название сущности; {'{set_title}'} подставляет название набора. Слова отбора помогают выбрать фрагменты для анализа.</p>
    {config.profiles.map((p,n)=>{const edit=(v:Partial<typeof p>)=>patch({profiles:config.profiles.map((x,k)=>k===n?{...x,...v}:x)});return <details className="set-config-item" key={p.id??n} open={!p.id}><summary>{p.language_tag} · {p.query_template}{!p.enabled?' · выключен':''}</summary><div className="set-config-content">
     <Check label="Профиль включён" value={p.enabled} onChange={v=>edit({enabled:v})}/>
     <label>Язык запроса<input value={p.language_tag} placeholder="ru, en, es" onChange={e=>edit({language_tag:e.target.value})}/></label>
     <Select label="Название сущности для запроса" value={p.title_source} options={[["title_ru","Русское"],["title_en","Английское"],["title_original","На языке оригинала"]]} onChange={v=>edit({title_source:v})}/>
     <label>Шаблон запроса<input value={p.query_template} onChange={e=>edit({query_template:e.target.value})}/></label>
     <label>Слова отбора — по одному на строке<textarea aria-label="Слова отбора — по одному на строке" rows={4} value={p.topic_terms.join('\n')} onChange={e=>edit({topic_terms:e.target.value.split('\n')})}/></label>
     {!p.id&&<button type="button" className="ghost" onClick={()=>patch({profiles:config.profiles.filter((_,k)=>k!==n)})}>Убрать новый профиль</button>}
    </div></details>})}
    <button type="button" className="ghost" onClick={()=>patch({profiles:[...config.profiles,{language_tag:'ru',title_source:'title_ru',query_template:'{title}',topic_terms:[],enabled:true,sort_order:config.profiles.length}]})}>Добавить профиль</button>
   </div></details>
  </fieldset>}
  {parameterEditor!==undefined&&<ParameterDialog parameter={parameterEditor} onClose={()=>setParameterEditor(undefined)} onSaved={async code=>{const rows=await reloadRegistry();const p=rows.find(p=>p.code===code);if(!parameterEditor&&p)setConfig(c=>({...c,items:c.items.some(i=>i.parameter_id===p.id)?c.items:[...c.items,member(p.id,c.items.length)]}))}}/>}
 </Modal>
}
