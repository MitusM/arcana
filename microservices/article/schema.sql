-- ============================================================================
-- schema.sql — схема ArcadeDB для МС article (arcana)
--
-- Графовая рубрикация статей:
--   Rubric (рубрика)
--     ├── HAS_CHILD ──→ Rubric      (подрубрика любого уровня вложенности)
--     └── HAS_ARTICLE ─→ Article    (статья прямо в рубрике)
--
-- ВАЖНО:
--  1. Код article НЕ создаёт схему автоматически (только DML).
--     Классы/свойства/индексы заводятся этим скриптом ВРУЧНУЮ.
--  2. Выполнять на БД cloudFRT (ArcadeDB).
--
-- ─── СИНТАКСИС ARCADEDB (не OrientDB!) ──────────────────────────────────────
--  * Контейнеры: MAP и LIST. Типов EMBEDDEDMAP / EMBEDDEDLIST в ArcadeDB НЕТ —
--    они падают с 'SQL syntax error ... extraneous input STRING'.
--  * IF NOT EXISTS поддерживают ТОЛЬКО CREATE VERTEX TYPE / CREATE EDGE TYPE
--    и CREATE INDEX. У CREATE PROPERTY его НЕТ — повторный прогон вернёт
--    'Property ... already exists'. Это безопасно: накатывать через раннер,
--    который трактует 'already exists' как SKIP (см. ниже).
--  * Свойства можно добавлять и через HTTP API /api/v1/command (PG Wire тоже
--    умеет CREATE PROPERTY; ALTER TYPE … PROPERTY в ArcadeDB отсутствует).
--
-- Выполнить через ArcadeDB (рабочий порт 2480):
--   curl -u root:arcade4db -X POST "http://127.0.0.1:2480/api/v1/command/cloudFRT" \
--     -H "Content-Type: application/json" \
--     -d '{"command":"<sql>","language":"sql"}'
--   (одной инструкцией за раз, без завершающей ';')
--
-- Идемпотентный раннер (одна инструкция за раз, 'already exists' → SKIP):
--   python3 /tmp/arcade-schema-run.py microservices/article/schema.sql
--
-- НЮАНСЫ ДАННЫХ:
--  * title/content/tags — MAP (многоязычные: {ru: "...", en: "..."})
--  * url — slug (внутри рубрики; глобально NOTUNIQUE)
--  * status — 'draft' (по умолчанию) | 'published' | 'archived'
--  * sortOrder — ручная сортировка рубрик/статей
--  * ЛЕГАСИ (унаследовано из импорта cloudFRT, НЕ переопределяем):
--      Article.description = MAP  (код читает как строку: article.description || '')
--      Article.created     = DATE (в новых записях используется DATETIME)
-- ============================================================================

/* ======================== */
/*  ВЕРШИНЫ                 */
/* ======================== */

/* ---------- Rubric: рубрика (любой уровень) ---------- */
CREATE VERTEX TYPE Rubric IF NOT EXISTS;
CREATE PROPERTY Rubric.title       MAP;                  -- {ru: "Азия", en: "Asia"}
CREATE PROPERTY Rubric.h1          STRING;               -- H1 (если отличен от title)
CREATE PROPERTY Rubric.description STRING;               -- SEO description
CREATE PROPERTY Rubric.url         STRING;               -- slug
CREATE PROPERTY Rubric.content     MAP;                  -- {ru: "<html>..."}
CREATE PROPERTY Rubric.image       STRING;               -- URL обложки
CREATE PROPERTY Rubric.sortOrder   INTEGER;              -- порядок сортировки
CREATE PROPERTY Rubric.status      STRING;               -- 'draft' | 'published' | 'archived'
CREATE PROPERTY Rubric.created     DATETIME;
CREATE PROPERTY Rubric.updated     DATETIME;

CREATE INDEX IF NOT EXISTS ON Rubric (url) NOTUNIQUE;
CREATE INDEX IF NOT EXISTS ON Rubric (status) NOTUNIQUE;
CREATE INDEX IF NOT EXISTS ON Rubric (sortOrder) NOTUNIQUE;

/* ---------- Article: статья ---------- */
-- Класс Article уже существует (старый код + импорт cloudFRT).
-- Повторный CREATE PROPERTY вернёт 'already exists' — безопасно (SKIP).
CREATE VERTEX TYPE Article IF NOT EXISTS;
CREATE PROPERTY Article.title       MAP;                  -- {ru: "Что посмотреть в Азии"}
CREATE PROPERTY Article.h1          STRING;               -- H1
CREATE PROPERTY Article.description STRING;               -- SEO description (легаси: MAP)
CREATE PROPERTY Article.url         STRING;               -- slug
CREATE PROPERTY Article.content     MAP;                  -- {ru: "<html>..."}
CREATE PROPERTY Article.tags        MAP;                  -- {ru: "азия,горы"}
CREATE PROPERTY Article.image       STRING;               -- главное изображение (легаси: MAP)
CREATE PROPERTY Article.gallery     LIST;                 -- галерея изображений
CREATE PROPERTY Article.keyword     STRING;               -- SEO keyword
CREATE PROPERTY Article.seo         EMBEDDED;             -- {title, description, canonical, robots}
CREATE PROPERTY Article.searchable  BOOLEAN;              -- участвует в поиске
CREATE PROPERTY Article.published   BOOLEAN;              -- legacy-флаг
CREATE PROPERTY Article.status      STRING;               -- 'draft' | 'published' | 'archived'
CREATE PROPERTY Article.config      EMBEDDED;             -- {commented, likely, views}
CREATE PROPERTY Article.author      STRING;
CREATE PROPERTY Article.sortOrder   INTEGER;
CREATE PROPERTY Article.created     DATETIME;
CREATE PROPERTY Article.updated     DATETIME;

CREATE INDEX IF NOT EXISTS ON Article (url) NOTUNIQUE;
CREATE INDEX IF NOT EXISTS ON Article (status) NOTUNIQUE;
CREATE INDEX IF NOT EXISTS ON Article (published) NOTUNIQUE;
CREATE INDEX IF NOT EXISTS ON Article (sortOrder) NOTUNIQUE;

/* ======================== */
/*  РЁБРА (EDGES)           */
/* ======================== */

/* ---------- HAS_CHILD: рубрика → подрубрика (иерархия) ----------
   Направление: ребёнок -HAS_CHILD-> родитель.
   out('HAS_CHILD') — предки, in('HAS_CHILD') — потомки. */
CREATE EDGE TYPE HAS_CHILD IF NOT EXISTS;

/* ---------- HAS_ARTICLE: рубрика → статья ---------- */
CREATE EDGE TYPE HAS_ARTICLE IF NOT EXISTS;
