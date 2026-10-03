/**
 * Запись строкой — клиентский двойник `compactLine` сервера (blocksHtml.ts):
 * миниатюра или портрет, знак источника, название и значения параметров.
 * Что показать, решает компактный вид типа (таблица отображений).
 */
import { compactParts, compactPicture, type CompactItem } from "../api";
import { SourceMark } from "../editor/entityBlocks";

interface Props {
  slug: string;
  title: string;
  compact?: CompactItem[];
}

export function CompactLine({ slug, title, compact }: Props) {
  const view = compactParts(compact);
  const picture = compactPicture(view, "thumbnail");
  return (
    <a className="entity-mention" href={`/entities/${slug}`}>
      {picture
        ? <img className={view.portrait ? "mention-thumb portrait" : "mention-thumb"} src={picture} alt="" loading="lazy" />
        : view.mark && <SourceMark />}
      {title}
      {view.params.length > 0 && <span className="compact-param">, {view.params.join(", ")}</span>}
    </a>
  );
}
