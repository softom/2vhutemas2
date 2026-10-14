# Архитектура TPAC — собранные чертежи и публикации

## Планы, разрезы, фасады

### Takeaway
Сохранены 62 основных файла: 61 изображение и один PDF. Файлы — `files/architecture`, UUID, URL, авторство, размеры и SHA-256 — в `architecture-manifest.json`. Проверены декодирование изображений и чтение PDF. Дата сбора: 2026-10-14. Это исследовательские материалы, без публикации, записи в БД или заявления о BackUp.

### Cited Findings
- [A&C, июль 2022, №494](https://anc.masilwide.com/2167): восемь отдельных планов OMA 2482×1755, подписанных на странице 1st–8th FLOOR PLAN; две перспективы-разреза Super Theatre и Proscenium Playhouse. Файлы `anc-edited_A2-01_landscape.png` … `anc-edited_A2-08.png` и `anc-TPAC_-_Sectional_perspective_*.jpg`. Планы без таблицы площадей.
- [OMA на gooood, 22.01.2021](https://www.gooood.cn/taipei-performing-arts-center-oma.htm): 27 оригинальных файлов публичной галереи, номера 28, 29, 30, 31, 33, 35, 37, 39, 40, 41, 42, 43, 45, 46, 47, 48, 49, 50, 51, 52, 54, 55, 56, 57, 58, 53, 59. Префикс `gooood-original-`: планы разных уровней, фасады, разрезы и детали. Планы преимущественно 960 пикселей по ширине, фасады/разрезы до 1700. Номер файла не равен этажу. Визуально проверенный файл 45 содержит оси 1–17 и отметки B1 −6,50, 1F ±0,00, 4F +15,00, 7F +30,00, 12F +50,00, R1 +55,00, RF +63,00. Файл 59 — план/разрез лестницы; 43 — верхний план/кровля. Материал предоставлен OMA, опубликован до завершения строительства; это не заверенный исполнительный комплект.
- [Architectural Record, Izzy Kornblatt, декабрь 2022](https://www.architecturalrecord.com/articles/15951-at-omas-taipei-performing-arts-center-building-as-public-performance): файл 14 — Ground Floor и Second Floor, линейный масштаб 30 м; 15 — Eighth Floor, масштаб 15 м; 16 — разрез A–A, масштаб 15 м; 17 — Public Loop. Легенда разреза 1–14: площадь, лобби, загрузочная, Globe, сцена Globe, репетиционная, кафе, парковка, Grand Theatre, главная сцена, под-сценическое пространство, Blue Box, офис, смотровая площадка. Все четыре чертежа сохранены с префиксом `record-`.
- [TwArchitect, 2022/07](https://www.twarchitect.org.tw/works/臺北表演藝術中心/): три журнальных изображения, карточка OMA + KRIS YAO ARTECH. Участок 20 769 м², застройка 10 893 м², общая площадь 58 658 м²; 1 подземный и 12 надземных этажей. Фото: Chris Stowers, 牧童攝影, 林軒朗, TPAC.

### Inferences
Масштабные линейки Record позволяют приблизительно оценивать площади блоков. Высоты 55 и 63 м относятся к разным верхним отметкам. Архитектурную нумерацию этажей следует сопоставлять с эксплуатационной по геометрии, а не только цифре. Пустоты двусветных залов нельзя суммировать как площади перекрытий.

### Gaps
Полная ведомость помещений с м² не найдена. Обмер по растрам ещё не выполнялся. Архитектурные картинки не названы исполнительной документацией или утверждёнными пожарными планами.

## Инженерные материалы

### Takeaway
Arup Journal уточняет размещение инженерных помещений и снимает прежнее предположение о противоречии между подвалом и центральным кубом.

### Cited Findings
- [Arup Journal 2022 №2, официальный PDF](https://www.arup.com/globalassets/downloads/arup-journal/the-arup-journal-2022-issue-2.pdf): `Arup-Journal-2022-2.pdf`, 7 908 299 байт, 23 PDF-разворота. TPAC — печатные стр.20–29 / PDF-страницы 11–15. Авторы Jonathan Griffiths, Gigi Kam, Tony Lam, Rory McGowan, Chas Pope, Yuanyuan Song. Куб 53,5×53,5 м; подполье изоляторов 2,7 м. Основные машинные помещения в неизолированной периферии подвала; центральная холодильная станция в подвале; градирни и AHU сцены Grand Theatre наверху западных башен; декорационные мастерские с западной стороны. Описаны отдельные климатические системы инструментальных помещений. На стр.28–29 — изображения модели эвакуации и CFD дыма, описание поэтапной эвакуации, защищённых зон ожидания и дымоудаления. Это инженерная публикация о стратегии, **не комплект согласованных пожарных планов**.
- [Arup, карточка проекта](https://www.arup.com/projects/taipei-performing-arts-centre/): инженерные дисциплины, местные консультанты, сейсмоизоляция, пожарное моделирование и вентиляция. Сохранён HTML `arup.html`.
- [Evergreen / TwArchitect — Structural Performance](https://www.twarchitect.org.tw/special/臺北表演藝術中心的結構實踐/): авторская публикация консультанта, сохранены `tw-structure.html` и `tw-structure.jpg`.
- [TwArchitect — HVAC](https://www.twarchitect.org.tw/special/北藝中心的空調挑戰/): публикация о кондиционировании; сохранены `tw-hvac.html` и `tw-hvac.jpg`.
- [dUCKS scéno](https://ducks.fr/en/projet/performing-art-center-2/): сценография, механика, кресла/трибуны и AV; сохранён `ducks.html`. Сводка 50 000 м², 1500/800/840 мест и Super Theatre 100 м расходится с другими стадиями; не заменяет технические листы оператора.

### Inferences
Техпомещения следует делить на центральные установки, распределение/вентиляцию, сценическую технику и доступ обслуживания. «В подвале» и «в кубе» не взаимоисключающие варианты. Числа из разных стадий сохранять с датой и источником.

### Gaps
Площадь каждой венткамеры, полный акустический расчёт и согласованный пожарный проект в данном наборе отсутствуют.

## Авторские публикации, интервью, обзоры

### Takeaway
Сохранены официальные превью книги OMA и индекс публикаций бюро. Индекс внешних ссылок шире набора прочитанных и скачанных материалов.

### Cited Findings
- [The Metropolitan Stage: Taipei Performing Arts Center](https://www.oma.com/publications/the-metropolitan-stage-taipei-performing-arts-center), A+Tec, 2023, английский/китайский, гостевая редакция OMA: **15 официально опубликованных превью/изображений**, файлы `oma-book-excerpt-01.jpg` … `15.jpg`. Основные развороты 5433×3508. Это **не полная книга**. Среди редакторов Rem Koolhaas, David Gianotten, Chiaju Lin, Sylvia Chan и команда OMA.
- [OMA, проект и хронология публикаций](https://www.oma.com/projects/taipei-performing-arts-center): сохранён `oma.html`, исходящие ссылки в `architecture-oma-bibliography.json` — 73 записи с UUID, названием, URL и статусом `link_listed_by_OMA_not_all_opened`. Включены интервью Korea Herald, La Vie, CommonWealth, тексты Financial Times, The Economist, Le Monde, Wallpaper, Dezeen, Detail, Abitare, Phaidon, строительные новости, лекция Koolhaas/Gianotten «Architecture: Cultural Perspective». Некоторые ссылки служебные/на новости OMA; это не 73 скачанных статьи.
- [ArchDaily, 13.05.2022](https://www.archdaily.com/981894/taipei-performing-arts-center-oma): авторский текст, команда по стадиям, галерея; сохранены HTML и индекс изображений. Фото Chris Stowers и Shephotoerd Co., графика OMA.
- [Architectural Record, Izzy Kornblatt](https://www.architecturalrecord.com/articles/15951-at-omas-taipei-performing-arts-center-building-as-public-performance): критический обзор здания, общественного маршрута, трансформации театра и остекления; его чертежи сохранены выше.
- Дополнительные библиографические ссылки, отдельные файлы статей не скачаны: [THE PLAN](https://www.theplan.it/eng/whats_on/taipei-performing-arts-center-a-theater-thats-a-part-of-peoples-lives), [TECTURE](https://mag.tecture.jp/culture/20220517-taipei-performing-arts-center/), [dUCKS о завершении](https://ducks.fr/en/taipei-performing-arts-centre-completion/), [BauNetz Wissen — фасады](https://www.baunetzwissen.de/fassade/objekte/kultur-bildung/taipei-performing-arts-center-8052127).

### Inferences
Для площадной программы приоритетны планы архитекторов, технические планы оператора и Arup Journal. Книга и обзоры поясняют замысел, публичные пространства и трансформацию. Фотографии фасадов не заменяют фасадные чертежи.

### Gaps
Полная книга и платные полные версии не приобретались; ограничения доступа не обходились. Исследовательская копия не означает свободную лицензию: при использовании сохранять автора, издателя, фотографа и источник. Прежняя внешняя папка на E: не изменялась. Итоговая побайтовая сверка всего пакета после сборки остаётся за координатором; individual SHA-256 и декодирование проверены при загрузке.
