--
-- PostgreSQL database dump
--

\restrict t5SxvL890W2LAAMhCEJY5ZEPdFAVRiIu2wi6pCTfKcd0T2Mhbq9vEG6C6blD8ko

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: v2; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA v2;


--
-- Name: SCHEMA v2; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA v2 IS 'RU: Модель v2: граф сущностей (entities) + связи (links) + targets + вложения (attachments) + контент (documents, reference_items) + профили.
EN: v2 model: graph entities + links + targets + attachments + content + profiles.';


--
-- Name: request_user_id(); Type: FUNCTION; Schema: v2; Owner: -
--

CREATE FUNCTION v2.request_user_id() RETURNS uuid
    LANGUAGE plpgsql STABLE
    AS $$
declare s text;
begin
  s := current_setting('request.jwt.claim.sub', true);
  if s is null or s = '' then
    return null;
  end if;
  return s::uuid;
exception when others then
  return null;
end $$;


--
-- Name: FUNCTION request_user_id(); Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON FUNCTION v2.request_user_id() IS 'Best-effort: returns auth user id (uuid) from PostgREST request context; null for anon/unknown.';


--
-- Name: tg_set_audit(); Type: FUNCTION; Schema: v2; Owner: -
--

CREATE FUNCTION v2.tg_set_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare uid uuid;
begin
  uid := v2.request_user_id();

  if tg_op = 'INSERT' then
    if new.created_at is null then new.created_at := now(); end if;
    new.updated_at := now();

    if new.created_by is null then new.created_by := uid; end if;
    new.updated_by := uid;

  elsif tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := uid;
  end if;

  return new;
end $$;


--
-- Name: FUNCTION tg_set_audit(); Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON FUNCTION v2.tg_set_audit() IS 'Before INSERT/UPDATE: fills created_at/updated_at + created_by/updated_by (best-effort).';


--
-- Name: tg_targets_for_entity(); Type: FUNCTION; Schema: v2; Owner: -
--

CREATE FUNCTION v2.tg_targets_for_entity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  insert into v2.targets(kind, entity_id) values ('entity', new.id)
  on conflict (entity_id) do nothing;
  return new;
end $$;


--
-- Name: tg_targets_for_link(); Type: FUNCTION; Schema: v2; Owner: -
--

CREATE FUNCTION v2.tg_targets_for_link() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  insert into v2.targets(kind, link_id) values ('link', new.id)
  on conflict (link_id) do nothing;
  return new;
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: attachment_roles; Type: TABLE; Schema: v2; Owner: -
--

CREATE TABLE v2.attachment_roles (
    code text NOT NULL,
    title_ru text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: TABLE attachment_roles; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON TABLE v2.attachment_roles IS 'RU: Роли вложений (cover/gallery/wiki/slogan/quote/source/justification).
EN: Attachment roles.';


--
-- Name: attachments; Type: TABLE; Schema: v2; Owner: -
--

CREATE TABLE v2.attachments (
    id bigint NOT NULL,
    target_id bigint NOT NULL,
    role_code text,
    sort_order integer DEFAULT 0 NOT NULL,
    note text,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    document_id bigint,
    asset_id bigint,
    reference_item_id bigint,
    CONSTRAINT attachments_one_content_chk CHECK ((((
CASE
    WHEN (document_id IS NOT NULL) THEN 1
    ELSE 0
END +
CASE
    WHEN (asset_id IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (reference_item_id IS NOT NULL) THEN 1
    ELSE 0
END) = 1))
);


--
-- Name: TABLE attachments; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON TABLE v2.attachments IS 'RU: Вложения (attachments): прикрепляют один объект контента (document или asset или reference_item) к target (entity/link) с ролью, порядком и заметкой.
EN: Attachments: bind exactly one content object (document/asset/reference) to a target (entity/link) with role/sort/note.';


--
-- Name: COLUMN attachments.target_id; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.attachments.target_id IS 'RU: Куда прикреплено (FK v2.targets.id).
EN: Target (FK v2.targets.id).';


--
-- Name: COLUMN attachments.role_code; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.attachments.role_code IS 'RU: Роль вложения (cover/wiki/slogan/quote/source/justification/...); FK v2.attachment_roles.
EN: Attachment role; FK v2.attachment_roles.';


--
-- Name: COLUMN attachments.sort_order; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.attachments.sort_order IS 'RU: Порядок сортировки вложений внутри target/role.
EN: Ordering within a target/role.';


--
-- Name: COLUMN attachments.note; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.attachments.note IS 'RU: Короткая заметка к вложению (опционально).
EN: Optional short note.';


--
-- Name: COLUMN attachments.meta; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.attachments.meta IS 'RU: Произвольные метаданные (jsonb), опционально.
EN: Optional metadata (jsonb).';


--
-- Name: COLUMN attachments.document_id; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.attachments.document_id IS 'RU: Прикреплённый документ (длинный текст Editor.js) — FK v2.documents.id. Должен быть заполнен ровно один из (document_id, asset_id, reference_item_id).
EN: Attached document (Editor.js). Exactly one of the three content columns must be set.';


--
-- Name: COLUMN attachments.asset_id; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.attachments.asset_id IS 'RU: Прикреплённый файл/изображение/PDF — FK public.media_assets.id. Ровно один из трёх.
EN: Attached asset (public.media_assets). Exactly one of the three.';


--
-- Name: COLUMN attachments.reference_item_id; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.attachments.reference_item_id IS 'RU: Прикреплённый референс (цитата/слоган/URL/книга/статья/wiki) — FK v2.reference_items.id. Ровно один из трёх.
EN: Attached reference item. Exactly one of the three.';


--
-- Name: CONSTRAINT attachments_one_content_chk ON attachments; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON CONSTRAINT attachments_one_content_chk ON v2.attachments IS 'RU: Инвариант: ровно один тип контента в одной записи attachments.
EN: Invariant: exactly one content pointer per attachment row.';


--
-- Name: attachments_id_seq; Type: SEQUENCE; Schema: v2; Owner: -
--

ALTER TABLE v2.attachments ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME v2.attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: documents; Type: TABLE; Schema: v2; Owner: -
--

CREATE TABLE v2.documents (
    id bigint NOT NULL,
    title text,
    lang text,
    body_json jsonb NOT NULL,
    body_text text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: TABLE documents; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON TABLE v2.documents IS 'RU: Длинные тексты (Editor.js blocks JSON). Храним в БД (jsonb), не в Storage. Картинки внутри текста — через assets (media_assets) и/или ссылки в JSON.
EN: Long-form texts (Editor.js JSON) stored in DB.';


--
-- Name: COLUMN documents.body_json; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.documents.body_json IS 'RU: Editor.js JSON (blocks).
EN: Editor.js JSON blocks.';


--
-- Name: COLUMN documents.body_text; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.documents.body_text IS 'RU: Опционально: плоский текст (для поиска/превью).
EN: Optional plain text for search/preview.';


--
-- Name: documents_id_seq; Type: SEQUENCE; Schema: v2; Owner: -
--

ALTER TABLE v2.documents ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME v2.documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: entities; Type: TABLE; Schema: v2; Owner: -
--

CREATE TABLE v2.entities (
    id bigint NOT NULL,
    kind text NOT NULL,
    slug text NOT NULL,
    title_ru text NOT NULL,
    title_original text,
    original_language text,
    title_la text,
    title_en text,
    is_published boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    color text,
    cover_media_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: TABLE entities; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON TABLE v2.entities IS 'RU: Сущности (узлы графа). Храним только "карточку": тип, slug, названия, публикацию, цвет, обложку. Специфика — в профилях; контент — через attachments.
EN: Graph nodes (card fields). Specific fields in profiles; content via attachments.';


--
-- Name: COLUMN entities.kind; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.entities.kind IS 'RU: Тип сущности (FK v2.entity_kinds).';


--
-- Name: COLUMN entities.slug; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.entities.slug IS 'RU: slug — стабильный человекочитаемый идентификатор для URL (уникален в рамках (kind, slug)).
EN: Stable URL-friendly identifier (unique within kind).';


--
-- Name: COLUMN entities.title_ru; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.entities.title_ru IS 'RU: Основное название на русском (обязательно).';


--
-- Name: COLUMN entities.title_original; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.entities.title_original IS 'RU: Название на языке источника (оригинал).';


--
-- Name: COLUMN entities.original_language; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.entities.original_language IS 'RU: Код языка оригинала (de/el/la/... ).';


--
-- Name: COLUMN entities.title_la; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.entities.title_la IS 'RU: Латынь/латинизация (опционально).';


--
-- Name: COLUMN entities.cover_media_id; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.entities.cover_media_id IS 'RU: Обложка (FK public.media_assets.id).';


--
-- Name: COLUMN entities.created_by; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.entities.created_by IS 'RU: Кто создал (auth.users.id, best-effort).';


--
-- Name: COLUMN entities.updated_by; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.entities.updated_by IS 'RU: Кто правил (auth.users.id, best-effort).';


--
-- Name: entities_id_seq; Type: SEQUENCE; Schema: v2; Owner: -
--

ALTER TABLE v2.entities ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME v2.entities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: entity_kinds; Type: TABLE; Schema: v2; Owner: -
--

CREATE TABLE v2.entity_kinds (
    code text NOT NULL,
    title_ru text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: TABLE entity_kinds; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON TABLE v2.entity_kinds IS 'RU: Справочник типов сущностей (person/object/period/...).
EN: Dictionary of entity kinds.';


--
-- Name: COLUMN entity_kinds.code; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.entity_kinds.code IS 'RU/EN: Код (PK).';


--
-- Name: COLUMN entity_kinds.title_ru; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.entity_kinds.title_ru IS 'RU: Название.';


--
-- Name: COLUMN entity_kinds.sort_order; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.entity_kinds.sort_order IS 'RU: Порядок в UI.';


--
-- Name: links; Type: TABLE; Schema: v2; Owner: -
--

CREATE TABLE v2.links (
    id bigint NOT NULL,
    from_entity_id bigint NOT NULL,
    to_entity_id bigint NOT NULL,
    note text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    confidence text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: TABLE links; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON TABLE v2.links IS 'RU: Связи между сущностями (рёбра графа). Сама связь минимальна; обоснования/источники обычно прикрепляются как attachments к target(link).
EN: Graph edges. Usually used as attachment container + minimal note.';


--
-- Name: COLUMN links.note; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.links.note IS 'RU: Короткая заметка "почему связаны" (опционально).
EN: Short human note (optional).';


--
-- Name: links_id_seq; Type: SEQUENCE; Schema: v2; Owner: -
--

ALTER TABLE v2.links ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME v2.links_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: object_profile; Type: TABLE; Schema: v2; Owner: -
--

CREATE TABLE v2.object_profile (
    entity_id bigint NOT NULL,
    object_type text NOT NULL,
    year_start integer,
    year_end integer,
    city text,
    country text,
    lat double precision,
    lon double precision,
    typology text
);


--
-- Name: TABLE object_profile; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON TABLE v2.object_profile IS 'RU: Профиль kind=object (строгие поля для отображения/валидации).
EN: Strict profile for kind=object.';


--
-- Name: object_types; Type: TABLE; Schema: v2; Owner: -
--

CREATE TABLE v2.object_types (
    code text NOT NULL,
    title_ru text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: TABLE object_types; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON TABLE v2.object_types IS 'RU: Справочник подтипов объектов/произведений (арх. объект, книга, фильм, музыка...).
EN: Object subtypes.';


--
-- Name: period_profile; Type: TABLE; Schema: v2; Owner: -
--

CREATE TABLE v2.period_profile (
    entity_id bigint NOT NULL,
    period_type_id bigint NOT NULL,
    start_year integer,
    end_year integer
);


--
-- Name: TABLE period_profile; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON TABLE v2.period_profile IS 'RU: Профиль kind=period (тип периода + даты).
EN: Strict profile for kind=period.';


--
-- Name: period_types; Type: TABLE; Schema: v2; Owner: -
--

CREATE TABLE v2.period_types (
    id bigint NOT NULL,
    theme_code text NOT NULL,
    theme_title_ru text NOT NULL,
    theme_title_en text,
    section_code text NOT NULL,
    section_title_ru text NOT NULL,
    section_title_en text,
    sort_order integer DEFAULT 0 NOT NULL,
    default_color text,
    hierarchy_level integer DEFAULT 1 NOT NULL,
    CONSTRAINT period_types_hierarchy_level_chk CHECK ((hierarchy_level >= 1))
);


--
-- Name: COLUMN period_types.hierarchy_level; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.period_types.hierarchy_level IS 'RU: Уровень иерархии для UI (1=верхний слой, 2=нижний и т.д.). Не является связью родитель-ребёнок, только глубина отображения.
EN: UI hierarchy depth level (not a parent-child relation).';


--
-- Name: period_types_id_seq; Type: SEQUENCE; Schema: v2; Owner: -
--

ALTER TABLE v2.period_types ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME v2.period_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: person_profile; Type: TABLE; Schema: v2; Owner: -
--

CREATE TABLE v2.person_profile (
    entity_id bigint NOT NULL,
    person_type text NOT NULL,
    full_name text NOT NULL,
    birth_year integer,
    death_year integer
);


--
-- Name: TABLE person_profile; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON TABLE v2.person_profile IS 'RU: Профиль kind=person (строгие поля для отображения/валидации).
EN: Strict profile for kind=person.';


--
-- Name: person_types; Type: TABLE; Schema: v2; Owner: -
--

CREATE TABLE v2.person_types (
    code text NOT NULL,
    title_ru text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: TABLE person_types; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON TABLE v2.person_types IS 'RU: Справочник подтипов людей/организаций (person/company/group).
EN: Person subtypes.';


--
-- Name: reference_items; Type: TABLE; Schema: v2; Owner: -
--

CREATE TABLE v2.reference_items (
    id bigint NOT NULL,
    kind text NOT NULL,
    title text,
    text text,
    url text,
    year integer,
    lang text,
    reliability integer,
    commentary text,
    meta jsonb,
    is_published boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: TABLE reference_items; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON TABLE v2.reference_items IS 'RU: Референсы/источники/короткий контент: цитаты, слоганы, URL, книги, статьи, wiki и т.п. Переиспользуются и прикрепляются через attachments.
EN: Reusable references/snippets attached via attachments.';


--
-- Name: COLUMN reference_items.kind; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.reference_items.kind IS 'RU: Вид референса (FK v2.reference_kinds).
EN: Reference kind (FK v2.reference_kinds).';


--
-- Name: COLUMN reference_items.text; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.reference_items.text IS 'RU: Текст (цитата/слоган/описание).
EN: Main text (quote/slogan/description).';


--
-- Name: COLUMN reference_items.url; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON COLUMN v2.reference_items.url IS 'RU: URL (если есть). Для wiki/статьи/книги/источника может быть основным.
EN: Optional URL.';


--
-- Name: reference_kinds; Type: TABLE; Schema: v2; Owner: -
--

CREATE TABLE v2.reference_kinds (
    code text NOT NULL,
    title_ru text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: TABLE reference_kinds; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON TABLE v2.reference_kinds IS 'RU: Справочник видов референсов (quote/slogan/url/wiki/book/article/...).
EN: Dictionary of reference kinds.';


--
-- Name: snippets_id_seq; Type: SEQUENCE; Schema: v2; Owner: -
--

ALTER TABLE v2.reference_items ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME v2.snippets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: targets; Type: TABLE; Schema: v2; Owner: -
--

CREATE TABLE v2.targets (
    id bigint NOT NULL,
    kind text NOT NULL,
    entity_id bigint,
    link_id bigint,
    CONSTRAINT targets_kind_check CHECK ((kind = ANY (ARRAY['entity'::text, 'link'::text]))),
    CONSTRAINT targets_one_ref_chk CHECK ((((kind = 'entity'::text) AND (entity_id IS NOT NULL) AND (link_id IS NULL)) OR ((kind = 'link'::text) AND (link_id IS NOT NULL) AND (entity_id IS NULL))))
);


--
-- Name: TABLE targets; Type: COMMENT; Schema: v2; Owner: -
--

COMMENT ON TABLE v2.targets IS 'RU: Универсальные цели для вложений: target указывает либо на entity, либо на link. Это позволяет иметь одну таблицу attachments с FK.
EN: Universal attachment targets (entity or link). Enables single attachments table with FK integrity.';


--
-- Name: targets_id_seq; Type: SEQUENCE; Schema: v2; Owner: -
--

ALTER TABLE v2.targets ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME v2.targets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: attachment_roles attachment_roles_pkey; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.attachment_roles
    ADD CONSTRAINT attachment_roles_pkey PRIMARY KEY (code);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: entities entities_kind_slug_key; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.entities
    ADD CONSTRAINT entities_kind_slug_key UNIQUE (kind, slug);


--
-- Name: entities entities_pkey; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.entities
    ADD CONSTRAINT entities_pkey PRIMARY KEY (id);


--
-- Name: entity_kinds entity_kinds_pkey; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.entity_kinds
    ADD CONSTRAINT entity_kinds_pkey PRIMARY KEY (code);


--
-- Name: links links_pkey; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.links
    ADD CONSTRAINT links_pkey PRIMARY KEY (id);


--
-- Name: object_profile object_profile_pkey; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.object_profile
    ADD CONSTRAINT object_profile_pkey PRIMARY KEY (entity_id);


--
-- Name: object_types object_types_pkey; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.object_types
    ADD CONSTRAINT object_types_pkey PRIMARY KEY (code);


--
-- Name: period_profile period_profile_pkey; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.period_profile
    ADD CONSTRAINT period_profile_pkey PRIMARY KEY (entity_id);


--
-- Name: period_types period_types_pkey; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.period_types
    ADD CONSTRAINT period_types_pkey PRIMARY KEY (id);


--
-- Name: period_types period_types_theme_code_section_code_key; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.period_types
    ADD CONSTRAINT period_types_theme_code_section_code_key UNIQUE (theme_code, section_code);


--
-- Name: person_profile person_profile_pkey; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.person_profile
    ADD CONSTRAINT person_profile_pkey PRIMARY KEY (entity_id);


--
-- Name: person_types person_types_pkey; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.person_types
    ADD CONSTRAINT person_types_pkey PRIMARY KEY (code);


--
-- Name: reference_kinds snippet_kinds_pkey; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.reference_kinds
    ADD CONSTRAINT snippet_kinds_pkey PRIMARY KEY (code);


--
-- Name: reference_items snippets_pkey; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.reference_items
    ADD CONSTRAINT snippets_pkey PRIMARY KEY (id);


--
-- Name: targets targets_entity_id_key; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.targets
    ADD CONSTRAINT targets_entity_id_key UNIQUE (entity_id);


--
-- Name: targets targets_link_id_key; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.targets
    ADD CONSTRAINT targets_link_id_key UNIQUE (link_id);


--
-- Name: targets targets_pkey; Type: CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.targets
    ADD CONSTRAINT targets_pkey PRIMARY KEY (id);


--
-- Name: attachments_role_idx; Type: INDEX; Schema: v2; Owner: -
--

CREATE INDEX attachments_role_idx ON v2.attachments USING btree (role_code);


--
-- Name: attachments_target_idx; Type: INDEX; Schema: v2; Owner: -
--

CREATE INDEX attachments_target_idx ON v2.attachments USING btree (target_id);


--
-- Name: attachments_uniq_asset; Type: INDEX; Schema: v2; Owner: -
--

CREATE UNIQUE INDEX attachments_uniq_asset ON v2.attachments USING btree (target_id, asset_id, role_code) WHERE (asset_id IS NOT NULL);


--
-- Name: attachments_uniq_document; Type: INDEX; Schema: v2; Owner: -
--

CREATE UNIQUE INDEX attachments_uniq_document ON v2.attachments USING btree (target_id, document_id, role_code) WHERE (document_id IS NOT NULL);


--
-- Name: attachments_uniq_reference; Type: INDEX; Schema: v2; Owner: -
--

CREATE UNIQUE INDEX attachments_uniq_reference ON v2.attachments USING btree (target_id, reference_item_id, role_code) WHERE (reference_item_id IS NOT NULL);


--
-- Name: entities_kind_idx; Type: INDEX; Schema: v2; Owner: -
--

CREATE INDEX entities_kind_idx ON v2.entities USING btree (kind);


--
-- Name: entities_slug_idx; Type: INDEX; Schema: v2; Owner: -
--

CREATE INDEX entities_slug_idx ON v2.entities USING btree (slug);


--
-- Name: links_from_idx; Type: INDEX; Schema: v2; Owner: -
--

CREATE INDEX links_from_idx ON v2.links USING btree (from_entity_id);


--
-- Name: links_to_idx; Type: INDEX; Schema: v2; Owner: -
--

CREATE INDEX links_to_idx ON v2.links USING btree (to_entity_id);


--
-- Name: period_types_level_idx; Type: INDEX; Schema: v2; Owner: -
--

CREATE INDEX period_types_level_idx ON v2.period_types USING btree (hierarchy_level);


--
-- Name: reference_items_kind_idx; Type: INDEX; Schema: v2; Owner: -
--

CREATE INDEX reference_items_kind_idx ON v2.reference_items USING btree (kind);


--
-- Name: attachments attachments_audit_trg; Type: TRIGGER; Schema: v2; Owner: -
--

CREATE TRIGGER attachments_audit_trg BEFORE INSERT OR UPDATE ON v2.attachments FOR EACH ROW EXECUTE FUNCTION v2.tg_set_audit();


--
-- Name: documents documents_audit_trg; Type: TRIGGER; Schema: v2; Owner: -
--

CREATE TRIGGER documents_audit_trg BEFORE INSERT OR UPDATE ON v2.documents FOR EACH ROW EXECUTE FUNCTION v2.tg_set_audit();


--
-- Name: entities entities_audit_trg; Type: TRIGGER; Schema: v2; Owner: -
--

CREATE TRIGGER entities_audit_trg BEFORE INSERT OR UPDATE ON v2.entities FOR EACH ROW EXECUTE FUNCTION v2.tg_set_audit();


--
-- Name: entities entities_targets_trg; Type: TRIGGER; Schema: v2; Owner: -
--

CREATE TRIGGER entities_targets_trg AFTER INSERT ON v2.entities FOR EACH ROW EXECUTE FUNCTION v2.tg_targets_for_entity();


--
-- Name: links links_audit_trg; Type: TRIGGER; Schema: v2; Owner: -
--

CREATE TRIGGER links_audit_trg BEFORE INSERT OR UPDATE ON v2.links FOR EACH ROW EXECUTE FUNCTION v2.tg_set_audit();


--
-- Name: links links_targets_trg; Type: TRIGGER; Schema: v2; Owner: -
--

CREATE TRIGGER links_targets_trg AFTER INSERT ON v2.links FOR EACH ROW EXECUTE FUNCTION v2.tg_targets_for_link();


--
-- Name: reference_items snippets_audit_trg; Type: TRIGGER; Schema: v2; Owner: -
--

CREATE TRIGGER snippets_audit_trg BEFORE INSERT OR UPDATE ON v2.reference_items FOR EACH ROW EXECUTE FUNCTION v2.tg_set_audit();


--
-- Name: attachments attachments_asset_id_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.attachments
    ADD CONSTRAINT attachments_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.media_assets(id) ON DELETE CASCADE;


--
-- Name: attachments attachments_document_id_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.attachments
    ADD CONSTRAINT attachments_document_id_fkey FOREIGN KEY (document_id) REFERENCES v2.documents(id) ON DELETE CASCADE;


--
-- Name: attachments attachments_reference_item_id_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.attachments
    ADD CONSTRAINT attachments_reference_item_id_fkey FOREIGN KEY (reference_item_id) REFERENCES v2.reference_items(id) ON DELETE CASCADE;


--
-- Name: attachments attachments_role_code_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.attachments
    ADD CONSTRAINT attachments_role_code_fkey FOREIGN KEY (role_code) REFERENCES v2.attachment_roles(code);


--
-- Name: attachments attachments_target_id_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.attachments
    ADD CONSTRAINT attachments_target_id_fkey FOREIGN KEY (target_id) REFERENCES v2.targets(id) ON DELETE CASCADE;


--
-- Name: entities entities_cover_media_id_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.entities
    ADD CONSTRAINT entities_cover_media_id_fkey FOREIGN KEY (cover_media_id) REFERENCES public.media_assets(id) ON DELETE SET NULL;


--
-- Name: entities entities_kind_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.entities
    ADD CONSTRAINT entities_kind_fkey FOREIGN KEY (kind) REFERENCES v2.entity_kinds(code);


--
-- Name: links links_from_entity_id_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.links
    ADD CONSTRAINT links_from_entity_id_fkey FOREIGN KEY (from_entity_id) REFERENCES v2.entities(id) ON DELETE CASCADE;


--
-- Name: links links_to_entity_id_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.links
    ADD CONSTRAINT links_to_entity_id_fkey FOREIGN KEY (to_entity_id) REFERENCES v2.entities(id) ON DELETE CASCADE;


--
-- Name: object_profile object_profile_entity_id_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.object_profile
    ADD CONSTRAINT object_profile_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES v2.entities(id) ON DELETE CASCADE;


--
-- Name: object_profile object_profile_object_type_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.object_profile
    ADD CONSTRAINT object_profile_object_type_fkey FOREIGN KEY (object_type) REFERENCES v2.object_types(code);


--
-- Name: period_profile period_profile_entity_id_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.period_profile
    ADD CONSTRAINT period_profile_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES v2.entities(id) ON DELETE CASCADE;


--
-- Name: period_profile period_profile_period_type_id_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.period_profile
    ADD CONSTRAINT period_profile_period_type_id_fkey FOREIGN KEY (period_type_id) REFERENCES v2.period_types(id) ON DELETE RESTRICT;


--
-- Name: person_profile person_profile_entity_id_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.person_profile
    ADD CONSTRAINT person_profile_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES v2.entities(id) ON DELETE CASCADE;


--
-- Name: person_profile person_profile_person_type_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.person_profile
    ADD CONSTRAINT person_profile_person_type_fkey FOREIGN KEY (person_type) REFERENCES v2.person_types(code);


--
-- Name: reference_items snippets_kind_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.reference_items
    ADD CONSTRAINT snippets_kind_fkey FOREIGN KEY (kind) REFERENCES v2.reference_kinds(code);


--
-- Name: targets targets_entity_id_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.targets
    ADD CONSTRAINT targets_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES v2.entities(id) ON DELETE CASCADE;


--
-- Name: targets targets_link_id_fkey; Type: FK CONSTRAINT; Schema: v2; Owner: -
--

ALTER TABLE ONLY v2.targets
    ADD CONSTRAINT targets_link_id_fkey FOREIGN KEY (link_id) REFERENCES v2.links(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict t5SxvL890W2LAAMhCEJY5ZEPdFAVRiIu2wi6pCTfKcd0T2Mhbq9vEG6C6blD8ko

