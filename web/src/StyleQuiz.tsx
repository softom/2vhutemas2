import { useEffect, useState } from "react";
import quiz from "./styleQuiz.json";
import "./styleQuiz.css";

type Building = typeof quiz.buildings[number];
type Photo = { asset_id: string; author?: string; source_url?: string; role?: string };
type Info = { title_ru: string; slug?: string; media: Photo[] };

function year(b: Building) {
  return String(b.year) + (b.year < 1000 ? " г. н. э." : "") + (b.start ? " (начало стройки)" : "");
}
function correct(b: Building, answer: string) {
  return answer === b.style || (b.also as string[]).includes(answer);
}
function choices() {
  const names = quiz.styles.map(s => s.name);
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  return names;
}
function Photos({ info }: { info: Info }) {
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const photos = info.media;
  const count = photos.length;
  useEffect(() => {
    if (count < 2 || hover || focus || matchMedia("(prefers-reduced-motion:reduce)").matches) return;
    const timer = setInterval(() => setIndex(i => (i + 1) % count), 3500);
    return () => clearInterval(timer);
  }, [count, hover, focus]);
  const photo = photos[index];
  if (!photo) return <p>Фотографии нет</p>;
  return <figure onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
    onFocus={() => setFocus(true)} onBlur={e => setFocus(e.currentTarget.contains(e.relatedTarget))}>
    <img alt={info.title_ru} src={'/api/v1/media/' + encodeURIComponent(photo.asset_id) + '/file?variant=screen'} />
    {count > 1 && <div><button aria-label="Предыдущее фото" onClick={() => setIndex((index+count-1)%count)}>‹</button>
      {index + 1} / {count} <button aria-label="Следующее фото" onClick={() => setIndex((index+1)%count)}>›</button></div>}
    {photo.author && <figcaption>Фото: {photo.author} {photo.source_url && /^https?:\/\//i.test(photo.source_url) && <a href={photo.source_url}>источник</a>}</figcaption>}
  </figure>;
}

type Result = { name: string; title: string };
function Round({ b, finish, score, step }: { b: Building; finish: (r: Result) => void; score: number; step: number }) {
  const [options] = useState(choices);
  const [info, setInfo] = useState<Info>();
  const [answer, setAnswer] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/v1/entities/' + b.id, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data: Info = await response.json();
        const media = (data.media ?? []).filter(p => p.asset_id)
          .sort((a,c) => Number(c.role === "cover") - Number(a.role === "cover")).slice(0,8);
        if (!controller.signal.aborted) setInfo({...data, media});
      } catch {
        if (!controller.signal.aborted) setInfo({title_ru: "Здание №" + b.id, media: []});
      }
    }
    void load();
    return () => controller.abort();
  }, [b.id]);
  if (!info) return <p role="status">Загрузка…</p>;
  const s = quiz.styles.find(s => s.name === b.style)!;
  const right = correct(b, answer);
  return <div aria-live="polite"><p>Здание {step+1} из {quiz.buildings.length} · Верно: {score + Number(right)}</p>
    <Photos info={info}/><p>{year(b)} — {info.title_ru}</p>
    <div className="quiz-options">{options.map(name => <button key={name} disabled={!!answer}
      className={answer && (correct(b,name) ? "quiz-right" : name === answer ? "quiz-wrong" : "")}
      onClick={() => setAnswer(name)}>{name}</button>)}</div>
    {answer && <div><strong>{right ? "Верно" : "Не совсем"}: {s.name}</strong>
      {!right && <p>Вы выбрали: {answer}.</p>}
      <dl><dt>Период</dt><dd>{s.period}</dd><dt>Метод</dt><dd>{s.method}</dd>
      <dt>Повестка</dt><dd>{s.agenda}</dd><dt>Заказчик</dt><dd>{s.customer}</dd></dl>
      {info.slug && <p><a href={'/entities/'+encodeURIComponent(info.slug)}>Страница здания</a></p>}
      <button autoFocus onClick={() => finish({name:answer,title:info.title_ru})}>{step+1 < quiz.buildings.length ? "Дальше" : "Итог"}</button></div>}
  </div>;
}

export default function StyleQuiz() {
  const [results, setResults] = useState<Result[]>([]);
  const step = results.length;
  const score = results.filter((r,i) => correct(quiz.buildings[i],r.name)).length;
  const total = quiz.buildings.length;
  return <div className="style-quiz"><p>Здания появляются по хронологии: от Пантеона до Сферы. Выберите стиль — и узнайте, что двигало автором: метод, повестка, заказчик.</p>
    {step < total ? <Round key={step} b={quiz.buildings[step]} step={step} score={score} finish={r => setResults([...results,r])}/>
    : <div><h3>Итог: {score} из {total}</h3><p>{score > total*.7 ? "Стили вы узнаёте уверенно." : score > total*.4 ? "Хорошее начало: ошибки показывают, где стили граничат." : "Стили трудно отличать — это нормально: они возникают на стыке метода, повестки и заказчика."}</p>
      {score < total && <><h4>Где ошиблись</h4><ul>{results.map((r,i) => {
        const b = quiz.buildings[i];
        return correct(b,r.name) ? null : <li key={b.id}>{year(b)} — {r.title}: ваш ответ «{r.name}», верно «{b.style}»</li>;
      })}</ul></>}
      <p>Последний вопрос игры без ответа: какой стиль будет у вас? Что движет вами — метод, повестка, заказчик?</p>
      <button onClick={() => setResults([])}>Сыграть ещё</button></div>}
    <p>Описания стилей — рабочие, сверка по источникам идёт. Фотографии принадлежат авторам, указанным под снимком.</p></div>;
}
