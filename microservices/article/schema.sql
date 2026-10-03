-- ============================================================================
-- schema.sql — схема ArcadeDB для МС article (arcana)
--
-- Иерархия контента для туристического портала:
--   Section (раздел)
--     └── Subsection (подраздел / подподраздел / ...)
--          └── Article (статья)
--
-- ВАЖНО:
--  1. Код article НЕ создаёт схему автоматически (только DML).
--     Классы/свойства/индексы заводятся этим скриптом ВРУЧНУЮ.
--  2. Выполнять ОДИН РАЗ на чистой БД (или пустой схеме article/*).
--  3. ArcadeDB поддерживает IF NOT EXISTS — скрипт можно прогонять повторно.
--
-- НЮАНСЫ:
--  * title/content/tags — EMBEDDEDMAP (многоязычные: ru, en, de, fr)
--  * url — уникальный slug для SEO
--  * published — false по умолчанию (черновик)
--  * sortOrder — для ручной сортировки разделов/подразделов
--
-- Выполнить через ArcadeDB Studio (http://localhost:2480) или HTTP API:
--   curl -u root:arcade4db -X POST "http://localhost:2480/api/v1/query/cloudFRT/sql" \
--     -H "Content-Type: application/json" \
--     -d '{"command":"<sql>","language":"sql"}'
-- ============================================================================

/* ======================== */
/*  ВЕРШИНЫ                 */
/* ======================== */

/* ---------- Section: раздел (верхний уровень) ---------- */
CREATE VERTEX TYPE Section IF NOT EXISTS;

/* ВАЖНО: ArcadeDB через PG Wire НЕ принимает ALTER TYPE … PROPERTY.
   Используй `CREATE PROPERTY Type.name Type` через HTTP API:
     POST /api/v1/command/cloudFRT -d '{"command":"...","language":"sql"}'
*/
CREATE PROPERTY Section.title       EMBEDDEDMAP STRING;   -- {ru: "Азия", en: "Asia"}
CREATE PROPERTY Section.description STRING;               -- SEO-описание
CREATE PROPERTY Section.url         STRING;               -- slug: 'asia'
CREATE PROPERTY Section.sortOrder   INTEGER;              -- порядок сортировки
CREATE PROPERTY Section.image       STRING;               -- URL обложки
CREATE PROPERTY Section.created     DATETIME;
CREATE PROPERTY Section.updated     DATETIME;

CREATE INDEX IF NOT EXISTS ON Section (url) UNIQUE;
CREATE INDEX IF NOT EXISTS ON Section (sortOrder) NOTUNIQUE;

/* ---------- Subsection: подраздел (любой уровень вложенности) ---------- */
CREATE VERTEX TYPE Subsection IF NOT EXISTS;

CREATE PROPERTY Subsection.title       EMBEDDEDMAP STRING;
CREATE PROPERTY Subsection.description STRING;
CREATE PROPERTY Subsection.url         STRING;
CREATE PROPERTY Subsection.sortOrder   INTEGER;
CREATE PROPERTY Subsection.image       STRING;
CREATE PROPERTY Subsection.created     DATETIME;
CREATE PROPERTY Subsection.updated     DATETIME;

CREATE INDEX IF NOT EXISTS ON Subsection (url) NOTUNIQUE;
CREATE INDEX IF NOT EXISTS ON Subsection (sortOrder) NOTUNIQUE;

/* ---------- Article: статья ---------- */
CREATE VERTEX TYPE Article IF NOT EXISTS;

/* У Article уже часть свойств есть (старый код) — CREATE PROPERTY вернёт
   ошибку 'already exists', что безопасно. */
CREATE PROPERTY Article.title       EMBEDDEDMAP STRING;   -- {ru: "Что посмотреть в Азии"}
CREATE PROPERTY Article.description STRING;               -- SEO description
CREATE PROPERTY Article.url         STRING;               -- slug
CREATE PROPERTY Article.content     EMBEDDEDMAP STRING;   -- {ru: "<html>..."}
CREATE PROPERTY Article.tags        EMBEDDEDMAP STRING;   -- {ru: "азия,горы"}
CREATE PROPERTY Article.image       STRING;               — главное изображение
CREATE PROPERTY Article.keyword     STRING;               — SEO keyword
CREATE PROPERTY Article.searchable  BOOLEAN DEFAULT true;
CREATE PROPERTY Article.published   BOOLEAN DEFAULT false; — по умолчанию черновик
CREATE PROPERTY Article.config      EMBEDDED;             — {commented, likely, views}
CREATE PROPERTY Article.author      STRING;               — автор статьи
CREATE PROPERTY Article.sortOrder   INTEGER;
CREATE PROPERTY Article.created     DATETIME;
CREATE PROPERTY Article.updated     DATETIME;

CREATE INDEX IF NOT EXISTS ON Article (url) NOTUNIQUE;
CREATE INDEX IF NOT EXISTS ON Article (published) NOTUNIQUE;
CREATE INDEX IF NOT EXISTS ON Article (sortOrder) NOTUNIQUE;

/* ======================== */
/*  РЁБРА (EDGES)           */
/* ======================== */

/* ---------- HAS_SUBSECTION: раздел → подраздел (иерархия) ---------- */
CREATE EDGE TYPE HAS_SUBSECTION IF NOT EXISTS;

/* ---------- HAS_ARTICLE: подраздел → статья ---------- */
CREATE EDGE TYPE HAS_ARTICLE IF NOT EXISTS;