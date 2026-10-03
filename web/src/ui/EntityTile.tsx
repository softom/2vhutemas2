/**
 * Плитка записи — одна для каталога и панели выбора. Что показать, решает
 * компактный вид типа (таблица отображений): миниатюра или портрет, знак
 * источника, значения параметров. Готовая страница сервера рисует ту же
 * разметку (`catalogHtml` в api/src/routes/pages.ts) — правки делать в обоих.
 */
import type { ReactNode } from "react";
import { compactParts, compactPicture, type CompactItem } from "../api";
import { SourceMark } from "../editor/entityBlocks";

interface Props {
  title: string;
  kind: string;
  compact?: CompactItem[];
  /** Есть адрес — плитка ссылка (каталог); нет — блок с действиями (выбор). */
  href?: string;
  /** Крупной плитке мозаики нужен экранный размер снимка. */
  large?: boolean;
  children?: ReactNode;
}

export function EntityTile({ title, kind, compact, href, large, children }: Props) {
  const view = compactParts(compact);
  const picture = compactPicture(view, large ? "screen" : "thumbnail");
  const className = view.portrait ? "card portrait" : "card";
  const body = (
    <>
      {view.picture && (picture
        ? <img src={picture} alt="" loading="lazy" />
        : <div className="card-no-cover">без изображения</div>)}
      <div className="kind">{kind}</div>
      <div className="title">{view.mark && <SourceMark />}{title}</div>
      {view.params.length > 0 && <div className="kind">{view.params.join(", ")}</div>}
      {children}
    </>
  );
  return href ? <a className={className} href={href}>{body}</a> : <div className={className}>{body}</div>;
}
