-- ============================================================================
-- schema.sql — схема ArcadeDB для МС destinations (arcana)
--
-- Гео-каталог мест с SEO-иерархией в виде ГРАФА.
--
-- Класс-вершина Dest (узел места: страна/регион/место/достопримечательность)
-- и рёбра:
--   Dest -PART_OF-> Dest        иерархия (Телецкое ∈ Горный Алтай ∈ Россия)
--   Dest -HAS_TRIP-> Trip       место → поездки (МС trips)
--   Dest -HAS_ARTICLE-> Article место → статьи /stati/ (МС article)
--   Dest -HAS_MAP-> Map         место → карты (МС maps)
--
-- ВАЖНО:
--  1. Код destinations НЕ создаёт схему автоматически (только DML: CREATE VERTEX).
--     Класс/свойства/индексы заводятся этим скриптом ВРУЧНУЮ.
--  2. Выполнять ОДИН РАЗ на чистой БД (или пустой схеме Dest).
--  3. ArcadeDB поддерживает IF NOT EXISTS — скрипт можно прогонять повторно.
--
-- НЮАНСЫ:
--  * location — STRING (WKT "POINT(lng lat)"), задаётся через geo.geomFromText()
--  * links — STRING (JSON), вместо EMBEDDEDMAP
--  * GEOSPATIAL индекс на location
--
-- Выполнить через ArcadeDB Studio (http://localhost:2480) или HTTP API:
--   curl -u root:arcade4db -X POST "http://localhost:2480/api/v1/query/cloudFRT/sql" \
--     -H "Content-Type: application/json" \
--     -d '{"command":"<sql>","language":"sql"}'
-- ============================================================================

/* ---------- ВЕРШИНА Dest: узел гео-каталога ---------- */
CREATE VERTEX TYPE Dest IF NOT EXISTS;
ALTER TYPE Dest PROPERTY slug STRING;              -- сегмент в URL (напр. 'gornyj-altaj')
ALTER TYPE Dest PROPERTY title STRING;             -- название места
ALTER TYPE Dest PROPERTY h1 STRING;                -- H1 (если отличен от title)
ALTER TYPE Dest PROPERTY level STRING;             -- country | region | place | attraction
ALTER TYPE Dest PROPERTY description STRING;       -- SEO description
ALTER TYPE Dest PROPERTY content STRING;           -- контент хаба (HTML-строка)
ALTER TYPE Dest PROPERTY image STRING;             -- URL изображения
ALTER TYPE Dest PROPERTY summary STRING;           -- краткое описание (для карты)
ALTER TYPE Dest PROPERTY thumbnail STRING;         -- миниатюра 320px (для карты)
ALTER TYPE Dest PROPERTY is_hub BOOLEAN DEFAULT true;
ALTER TYPE Dest PROPERTY priority DOUBLE;          -- приоритет в sitemap (0..1)
ALTER TYPE Dest PROPERTY location STRING;          -- координаты — WKT "POINT(lng lat)" через geo.geomFromText()
ALTER TYPE Dest PROPERTY created DATETIME;
ALTER TYPE Dest PROPERTY links STRING;             -- ручные блоки перелинковки: JSON (вместо EMBEDDEDMAP)
ALTER TYPE Dest PROPERTY status STRING DEFAULT 'draft';  -- 'draft' (default) | 'published'

/* ---------- ИНДЕКСЫ Dest ---------- */
CREATE INDEX IF NOT EXISTS ON Dest (slug) NOTUNIQUE;
CREATE INDEX IF NOT EXISTS ON Dest (level) NOTUNIQUE;
CREATE INDEX IF NOT EXISTS ON Dest (location) GEOSPATIAL;

/* ---------- ТИПЫ РЁБЕР ---------- */
CREATE EDGE TYPE PART_OF IF NOT EXISTS;      -- иерархия мест (child -PART_OF-> parent)
CREATE EDGE TYPE HAS_TRIP IF NOT EXISTS;     -- место → поездки (МС trips)
CREATE EDGE TYPE HAS_ARTICLE IF NOT EXISTS;  -- место → статьи /stati/ (МС article)
CREATE EDGE TYPE HAS_MAP IF NOT EXISTS;      -- место → карты (МС maps)
CREATE EDGE TYPE HAS_TYPE IF NOT EXISTS;     -- Dest -HAS_TYPE-> DestType (тип объекта: озеро, водопад…)

/* ---------- DestType: каталог типов объектов ---------- */
CREATE VERTEX TYPE DestType IF NOT EXISTS;
ALTER TYPE DestType PROPERTY slug STRING;            -- ключ-идентификатор (ozero, vodopad, …)
ALTER TYPE DestType PROPERTY name STRING;            -- название (Озеро)
ALTER TYPE DestType PROPERTY name_plural STRING;     -- множественное (Озёра)
ALTER TYPE DestType PROPERTY icon STRING;            -- имя иконки (для MapLibre symbol-слоя)
ALTER TYPE DestType PROPERTY slug_plural STRING;     -- URL-форма множественного: ozera, vodopady, gory…
ALTER TYPE DestType PROPERTY description STRING;     -- SEO-описание для страниц категорий
ALTER TYPE DestType PROPERTY priority DOUBLE;        -- порядок сортировки
ALTER TYPE DestType PROPERTY created DATETIME;       -- sysdate() при вставке
CREATE INDEX IF NOT EXISTS ON DestType (slug) NOTUNIQUE;