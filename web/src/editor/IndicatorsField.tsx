/**
 * Показатели записи: величины, которые подсказывает её ветвь дерева (Р-38).
 *
 * Показателей может быть несколько — «по проекту» и «после реконструкции»;
 * по действующим считаются отбор и сортировка, в карточке видны все.
 *
 * Дата и место — такие же величины, как вместимость зала (Р-39): вид даты
 * и роль места стали параметрами. У таких вопросов бывает несколько ответов
 * — две реконструкции, два адреса, — поэтому они заполняются списком.
 */
import { useEffect, useState } from "react";
import { api, request, type ParameterSetRow, type Indicator, type IndicatorValue, placeLabel, type SuggestedParameter } from "../api";
import { PlacePicker } from "./PlacePicker";
import { PlaceDialog } from "./PlaceDialog";
import { ParameterSetPanel } from './ParameterSetPanel';
import { ParameterTable } from './ParameterTable';
import {groupKey,groupLabel} from './researchMerge';
import { SetResearchPanel } from './SetResearchPanel';

interface Props {
  beforeResearch?:()=>Promise<string|undefined>;
  onRevision?:(revision:string)=>void;
  entityId?: number | null;
  onSuggested?: (fields: SuggestedParameter[]) => void;
  indicators: Indicator[];
  suggested: SuggestedParameter[];
  onChange: (next: Indicator[]) => void;
}

function emptyIndicator(title: string): Indicator {
  return { title, is_current: true, measured_year: null, values: [] };
}

function repeatable(field: SuggestedParameter): boolean {
  return field.is_repeatable ?? (field.value_type === "date" || field.value_type === "place");
}

export function IndicatorsField({ indicators, suggested, onChange, entityId, onSuggested, beforeResearch, onRevision }: Props) {
  const [sets,setSets]=useState<ParameterSetRow[]>([]);
  const [adding,setAdding]=useState(false);
  const [setError,setSetError]=useState('');
  const [setBusy,setSetBusy]=useState(false);
  const [chosen,setChosen]=useState('');
  const [setNotice,setSetNotice]=useState('');
  useEffect(()=>{api.parameterSets().then(r=>setSets(r.items.filter(s=>!['program_row','text_body','research_materials','research_source_row','style_solution_row'].includes(s.code)))).catch(e=>setSetError(e.message));},[]);
  async function attach(){
    if(!entityId||!chosen||setBusy)return;
    setSetBusy(true);setSetError('');
    try{
      await request(`/parameter-sets/${chosen}/entities`,{method:'POST',body:JSON.stringify({entity_id:entityId})});
      const result=await api.parametersForEntity(entityId);onSuggested?.(result.items);setAdding(false);setChosen('');
    }catch(e){setSetError((e as Error).message);}finally{setSetBusy(false);}
  }
  async function detach(set:ParameterSetRow){
    if(!entityId||setBusy)return;
    setSetBusy(true);setSetError('');setSetNotice('');
    try{
      await request(`/parameter-sets/${set.id}/entities/${entityId}`,{method:'DELETE'});
      const result=await api.parametersForEntity(entityId);onSuggested?.(result.items);
      setSetNotice(`Набор «${set.title_ru}» откреплён. Заполненные значения сохранены; значения вне других наборов доступны в панели «Сохранённые значения». Материалы исследования сохранены.`);
    }catch(e){setSetError((e as Error).message);}finally{setSetBusy(false);}
  }
  // Величины видно сразу: пустой список за кнопкой выглядел так, будто
  // показателей у типа нет вовсе.
  useEffect(() => {
    if (indicators.length === 0 && suggested.length > 0) {
      onChange([emptyIndicator("Сведения")]);
    }
  }, [indicators.length, suggested.length]);

  // Окно места открывается поверх формы: универсальный элемент правится
  // в собственном окне (правило 15).
  const [picking, setPicking] = useState<{ group: number; position: number } | null>(null);
  const [creating, setCreating] = useState<{ group: number; position: number } | null>(null);

  // Показываем подсказанное ветвью и то, что уже заполнено вне набора:
  // набор подсказывает состав, но не ограничивает его.
  const extra = new Map<string, SuggestedParameter>();
  for (const indicator of indicators) {
    for (const value of indicator.values) {
      if (!suggested.some((item) => item.parameter === value.parameter)) {
        extra.set(value.parameter, {
          parameter: value.parameter,
          title: value.title ?? value.parameter,
          unit: value.unit ?? null,
          value_type: value.value_type ?? "text",
          definition: null,
          set: "",
          set_title: "Сохранённые значения",
          hint: null,
          options: [],
        });
      }
    }
  }
  const fields = [...suggested, ...extra.values()].filter(f=>!['research_sources','research_state'].includes(f.parameter));

  const update = (index: number, next: Indicator) => {
    const items = [...indicators];
    items[index] = next;
    onChange(items);
  };

  /** Значения одного параметра внутри показателей вместе с их местами в списке. */
  const entriesOf = (indicator: Indicator, code: string) =>
    indicator.values
      .map((value, position) => ({ value, position }))
      .filter((entry) => entry.value.parameter === code);

  const patchValue = (
    group: number,
    position: number,
    patch: Partial<IndicatorValue>,
  ) => {
    const indicator = indicators[group];
    const values = [...indicator.values];
    values[position] = { ...values[position], ...patch };
    update(group, { ...indicator, values });
  };

  const addValue = (group: number, code: string) => {
    const indicator = indicators[group];
    update(group, { ...indicator, values: [...indicator.values, { parameter: code }] });
  };

  const removeValue = (group: number, position: number) => {
    const indicator = indicators[group];
    update(group, {
      ...indicator,
      values: indicator.values.filter((_, at) => at !== position),
    });
  };

  /** Место выбрано или заведено: значение получает ссылку на справочник. */
  const setPlace = (target: { group: number; position: number }, placeId: string) => {
    patchValue(target.group, target.position, { place_id: placeId, place: undefined });
    setPicking(null);
    setCreating(null);
  };

  const valueInput = (
    group: number,
    field: SuggestedParameter,
    entry: { value: IndicatorValue; position: number },
  ) => {
    const { value, position } = entry;
    const set = (patch: Partial<IndicatorValue>) => {
      if(indicators[group].values[position])patchValue(group, position, patch);
      else update(group,{...indicators[group],values:[...indicators[group].values,{parameter:field.parameter,...patch}]});
    };

    if (field.value_type === "place") {
      return (
        <div className="value-row" key={position}>
          <span className="value-place">
            {value.place ? placeLabel(value.place) : value.place_id ? "место выбрано" : "не указано"}
          </span>
          <button type="button" className="ghost" onClick={() => setPicking({ group, position })}>
            Выбрать
          </button>
          <button type="button" className="ghost" onClick={() => setCreating({ group, position })}>
            Создать
          </button>
          <button type="button" className="ghost" onClick={() => removeValue(group, position)}>
            Убрать
          </button>
        </div>
      );
    }

    if (field.value_type === "date") {
      return (
        <div className="value-row" key={position}>
          <input
            className="year"
            inputMode="numeric"
            placeholder="год"
            value={value.date_start_year ?? ""}
            onChange={(e) =>
              set({ date_start_year: e.target.value ? Number(e.target.value) : null })}
          />
          <input
            className="year"
            inputMode="numeric"
            placeholder="по год"
            value={value.date_end_year ?? ""}
            onChange={(e) => set({ date_end_year: e.target.value ? Number(e.target.value) : null })}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={value.is_approximate === true}
              onChange={(e) => set({ is_approximate: e.target.checked })}
            />
            около
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={value.is_ongoing === true}
              onChange={(e) => set({ is_ongoing: e.target.checked, date_end_year: null })}
            />
            продолжается
          </label>
          <button type="button" className="ghost" onClick={() => removeValue(group, position)}>
            Убрать
          </button>
        </div>
      );
    }

    if (field.value_type === "boolean") {
      return (
        <label className="checkbox" key={position}>
          <input
            type="checkbox"
            checked={value.bool_value === true}
            onChange={(e) => set({ bool_value: e.target.checked })}
          />
          да
        </label>
      );
    }

    if (field.value_type === "option") {
      return (
        <select
          key={position}
          value={value.option ?? ""}
          onChange={(e) => set({ option: e.target.value || null })}
        >
          <option value="">не указано</option>
          {field.options.map((option) => (
            <option key={option.code} value={option.code}>{option.title}</option>
          ))}
        </select>
      );
    }


    const numeric = field.value_type === "number" || field.value_type === "integer";
    return (
      <input
        key={position}
        value={numeric ? value.num_value ?? "" : value.text_value ?? ""}
        inputMode={numeric ? "numeric" : undefined}
        placeholder={field.hint ?? ""}
        onChange={(e) =>
          set(numeric ? { num_value: e.target.value || null } : { text_value: e.target.value })}
      />
    );
  };

  const renderFields=(indicator:Indicator,group:number,panelFields:SuggestedParameter[]) => <div className="parameter-fields">
          {panelFields.map((field) => {
            const entries = entriesOf(indicator, field.parameter);
            const many = repeatable(field);

            if (field.value_type === "option" && many) {
              const chosen = entries.map((entry) => entry.value.option);
              return (
                <div className="value-field" key={field.parameter}>
                  <div className="value-label">{field.title}</div>
                  <div className="chips">
                    {field.options.map((option) => (
                      <label className="chip" key={option.code}>
                        <input
                          type="checkbox"
                          checked={chosen.includes(option.code)}
                          onChange={(e) => {
                            const current = indicators[group];
                            const values = e.target.checked
                              ? [...current.values, {
                                parameter: field.parameter,
                                option: option.code,
                              }]
                              : current.values.filter((item) =>
                                !(item.parameter === field.parameter &&
                                  item.option === option.code)
                              );
                            update(group, { ...current, values });
                          }}
                        />
                        {option.title}
                      </label>
                    ))}
                  </div>
                  {field.definition && <span className="hint">{field.definition}</span>}
                </div>
              );
            }
            if(field.value_type==='table')return <div className="value-field" key={field.parameter}>
              <div className="value-label">{field.title}</div><ParameterTable parameter={field.parameter} entityId={entityId} rows={entries[0]?.value.rows||[]} onChange={rows=>{
                if(entries.length)patchValue(group,entries[0].position,{rows});
                else update(group,{...indicator,values:[...indicator.values,{parameter:field.parameter,rows}]});
              }}/></div>;
            if(entries.length===0&&!many&&['boolean','option'].includes(field.value_type))return <div className="value-field" key={field.parameter}><div className="value-label">{field.title}</div>{valueInput(group,field,{value:{parameter:field.parameter},position:indicator.values.length})}</div>;
            if (entries.length === 0 && !many) {
              // Единственный ответ заводится сразу, чтобы поле было видно.
              return (
                <label key={field.parameter}>
                  {field.unit ? `${field.title}, ${field.unit}` : field.title}
                  <input
                    value=""
                    placeholder={field.hint ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const numeric = field.value_type === "number" ||
                        field.value_type === "integer";
                      const indicatorNow = indicators[group];
                      update(group, {
                        ...indicatorNow,
                        values: [...indicatorNow.values, {
                          parameter: field.parameter,
                          ...(numeric ? { num_value: raw } : { text_value: raw }),
                        }],
                      });
                    }}
                  />
                  {field.definition && <span className="hint">{field.definition}</span>}
                </label>
              );
            }
            return (
              <div className="value-field" key={field.parameter}>
                <div className="value-label">
                  {field.unit ? `${field.title}, ${field.unit}` : field.title}
                </div>
                {entries.map((entry) => valueInput(group, field, entry))}
                {many && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => addValue(group, field.parameter)}
                  >
                    {entries.length === 0 ? "Указать" : "Добавить ещё"}
                  </button>
                )}
                {field.definition && <span className="hint">{field.definition}</span>}
              </div>
            );
          })}
  </div>;
  const panelCodes=[...new Set(fields.map(f=>f.set))];
  const panels=panelCodes.map(code=>{
    const set=sets.find(s=>s.code===code);
    const members=fields.filter(f=>f.set===code);
    const order=new Map((set?.items||[]).map((item,index)=>[item.code,index]));
    members.sort((a,b)=>(order.get(a.parameter)??9999)-(order.get(b.parameter)??9999));
    return {code,set,title:set?.title_ru||members[0]?.set_title||'Другие параметры',fields:members};
  }); // API orders inherited sets first, then attachments from oldest to newest.
  const detachAction=(panel:typeof panels[number],disabled=false)=>panel.set&&entityId?<button type="button" className="ghost" disabled={disabled||setBusy||!panel.fields.some(f=>f.set_attached&&!f.set_inherited)} title={panel.fields.some(f=>f.set_inherited)?'Набор задан типом записи и не открепляется отдельно':'Заполненные значения и материалы исследования сохранятся'} onClick={()=>void detach(panel.set!)}>Открепить</button>:null;
  const panelForm=(panel:typeof panels[number])=>{
    let groups=indicators.map((indicator,index)=>({indicator,index})).filter(({indicator})=>!indicator.values.length||indicator.values.some(v=>panel.fields.some(f=>f.parameter===v.parameter)));
    if(!groups.length&&indicators.length)groups=[{indicator:indicators[0],index:0}];
    return <div className="parameter-set-form">{groups.map(({indicator,index})=><fieldset className="indicator" key={indicator.id??index}>
      <legend>{groupLabel(indicator,index)}</legend>
      <label className="parameter-group-heading">Название группы<input value={indicator.title} onChange={e=>update(index,{...indicator,title:e.target.value})}/></label>
      {renderFields(indicator,index,panel.fields)}
      <details className="measurement-details"><summary>Сведения об измерении{indicator.title?' · '+indicator.title:''}</summary><div className="row">
        <label>Год сведений<input inputMode="numeric" value={indicator.measured_year??''} onChange={e=>update(index,{...indicator,measured_year:e.target.value?Number(e.target.value):null})}/></label>
        <label className="checkbox"><input type="checkbox" checked={indicator.is_current} onChange={e=>update(index,{...indicator,is_current:e.target.checked})}/>Действующие</label>
      </div><p className="hint">Сведения об измерении общие для значений этой группы.</p></details>
      {groups.length>1&&<button type="button" className="ghost" onClick={()=>{
        const remaining=indicator.values.filter(v=>!panel.fields.some(f=>f.parameter===v.parameter));
        if(remaining.length)update(index,{...indicator,values:remaining});else onChange(indicators.filter((_,i)=>i!==index));
      }}>Убрать значения набора в этом измерении</button>}
    </fieldset>)}<button type="button" className="ghost" onClick={()=>onChange([...indicators,emptyIndicator('Новое измерение')])}>Добавить измерение</button></div>;
  };
  return (
    <div className="block">
      <div className="parameter-section-heading"><div><span className="editor-eyebrow">Сведения об объекте</span><h3>Наборы параметров</h3></div><button type="button" className="ghost" disabled={!entityId||setBusy} onClick={()=>setAdding(!adding)}>＋ Добавить набор</button></div>
      {!entityId&&<p className="hint">Сохраните запись, чтобы прикреплять дополнительные наборы.</p>}
      {setError&&<p role="alert" className="error">{setError}</p>}
      {setNotice&&<p role="status" className="hint">{setNotice}</p>}

      {adding&&<div className="parameter-add-panel"><label>Набор параметров<select value={chosen} onChange={e=>setChosen(e.target.value)}><option value="">Выберите набор…</option>{sets.filter(s=>!suggested.some(p=>p.set===s.code)).map(s=><option key={s.id} value={s.id}>{s.title_ru}</option>)}</select></label><button type="button" disabled={!chosen||setBusy} onClick={()=>void attach()}>{setBusy?'Добавляем…':'Добавить'}</button></div>}
      {panels.map(panel=><ParameterSetPanel key={panel.set?.id||panel.code||'extra'} title={panel.title+(indicators.filter(g=>g.values.some(v=>panel.fields.some(f=>f.parameter===v.parameter))).length>1?' · групп: '+indicators.filter(g=>g.values.some(v=>panel.fields.some(f=>f.parameter===v.parameter))).length:'')}>
        {entityId&&panel.set&&beforeResearch&&onRevision?<SetResearchPanel entityId={entityId} set={panel.set} sets={sets} beforeStart={beforeResearch} onRevision={onRevision} indicators={indicators} fields={panel.fields} onAccept={(group,target)=>{if(target===null)onChange([...indicators,group]);else if(indicators.some((g,i)=>groupKey(g,i)===target))onChange(indicators.map((g,i)=>groupKey(g,i)===target?group:g));}} actions={disabled=>detachAction(panel,disabled)}>
          {panelForm(panel)}
        </SetResearchPanel>:<div className="set-research-panel"><div className="row"><button type="button" className="ghost" disabled>Собрать источники</button><button type="button" className="ghost" disabled>Определить при помощи LLM</button>{detachAction(panel)}</div>{panelForm(panel)}</div>}
      </ParameterSetPanel>)}

      {picking && (
        <PlacePicker
          onPick={(placeId) => setPlace(picking, placeId)}
          onCreateNew={() => {
            setCreating(picking);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {creating && (
        <PlaceDialog
          onSaved={(placeId) => setPlace(creating, placeId)}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  );
}
