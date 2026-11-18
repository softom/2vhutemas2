/**
 * Справочник параметров и наборы (решение Р-38).
 *
 * Набор — список величин для ветви дерева типов; он и есть то, ради чего
 * заведены параметры: по нему заполняют карточки и сравнивают объекты.
 * Создание и правка идут одним окном, как у прочих универсальных элементов
 * (правило 15).
 *
 * Ведёт справочник обладатель `su`: «вместимость зала» и «Вместимость (мест)»,
 * заведённые порознь, делают сравнение невозможным.
 */
import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, type ParameterRow, type ParameterSetRow } from "../api";
import { ParameterDialog, VALUE_TYPES } from "../editor/ParameterDialog";
import { ParameterSetDialog } from "../editor/ParameterSetDialog";

type Dialog =
  | { kind: "none" }
  | { kind: "set"; set: ParameterSetRow | null }
  | { kind: "parameter"; parameter: ParameterRow | null };

export function Parameters({ canManage }: { canManage: boolean }) {
  const registryPage = useLocation().pathname === "/parameters/registry";
  const [items, setItems] = useState<ParameterRow[]>([]);
  const [sets, setSets] = useState<ParameterSetRow[]>([]);
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const reload = () => {
    api.parameters().then((result) => setItems(result.items ?? []))
      .catch((e) => setError((e as Error).message));
    api.parameterSets().then((result) => setSets(result.items ?? [])).catch(e=>setError(e.message));
  };

  useEffect(reload, []);

  const typeTitle = (code: string) => VALUE_TYPES.find((t) => t.code === code)?.title ?? code;

  return (
    <section>
      <h1>Параметры</h1>
      <p className="sub">
        Наборы величин для ветвей дерева типов. Один смысл — один параметр.
      </p>

      {error && <p className="error">{error}</p>}
      {status && <p className="notice">{status}</p>}

      <nav className="robot-block-nav" aria-label="Разделы параметров">
        <NavLink to="/parameters" end><span className="robot-block-number" aria-hidden="true">1</span><span>Наборы</span></NavLink>
        <NavLink to="/parameters/registry"><span className="robot-block-number" aria-hidden="true">2</span><span>Параметры</span></NavLink>
      </nav>
      {canManage && <div className="filters"><button type="button" onClick={()=>setDialog(registryPage?{kind:'parameter',parameter:null}:{kind:'set',set:null})}>
        {registryPage?'Завести параметр':'Создать набор'}
      </button></div>}
      {!registryPage && <>
        <h2>Наборы</h2>
        {sets.length===0 && <p className="notice">Наборов пока нет.</p>}
        {sets.map(set=><div className="block row" key={set.id}>
          <h3 style={{flex:1,margin:0}}>{set.title_ru}</h3>
          {canManage&&<button type="button" className="ghost" aria-label={`Править набор «${set.title_ru}»`} onClick={()=>setDialog({kind:'set',set})}>Править</button>}
        </div>)}
      </>}
      {registryPage && <>
      <h2>Справочник величин</h2>
      <table className="grid-table">
        <thead>
          <tr>
            <th>Название</th>
            <th>Тип значения</th>
            <th>Единица</th>
            <th>Заполнено</th>
            {canManage && <th></th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                {item.title_ru}
                {item.definition && <div className="hint">{item.definition}</div>}
              </td>
              <td>
                {typeTitle(item.value_type)}
                {item.is_repeatable && <div className="hint">несколько ответов</div>}
              </td>
              <td>{item.unit ?? "—"}</td>
              <td>{String(item.used)}</td>
              {canManage && (
                <td>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setDialog({ kind: "parameter", parameter: item })}
                  >
                    Править
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </>}

      {dialog.kind === "set" && (
        <ParameterSetDialog
          set={dialog.set}
          onSaved={() => {
            setStatus("Набор сохранён");
            reload();
          }}
          onClose={() => setDialog({ kind: "none" })}
        />
      )}
      {dialog.kind === "parameter" && (
        <ParameterDialog
          parameter={dialog.parameter}
          onSaved={() => {
            setStatus("Параметр сохранён");
            reload();
          }}
          onClose={() => setDialog({ kind: "none" })}
        />
      )}
    </section>
  );
}
