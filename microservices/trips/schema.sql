-- ============================================================================
-- schema.sql — схема ArcadeDB для микросервиса trips (arcana)
--
-- Ядро trips: 3 вершины (Trip, Place, GeoObject) + 3 ребра
--             (TripMember, TripPlace, hasObject).
--
-- ВАЖНО:
--  1. Код trips НЕ создаёт схему автоматически (только DML — CREATE
--     VERTEX/EDGE). Классы/свойства/индексы заводятся этим скриптом ВРУЧНУЮ.
--  2. Выполнять ОДИН РАЗ на чистой БД (или на пустой схеме trips).
--  3. ArcadeDB поддерживает IF NOT EXISTS — скрипт можно прогонять повторно.
--
-- Выполнить через ArcadeDB Studio (http://localhost:2480) или HTTP API.
-- ============================================================================

/* ---------- ВЕРШИНА Trip: поездка ---------- */
CREATE VERTEX TYPE Trip IF NOT EXISTS;
ALTER TYPE Trip PROPERTY title STRING;
ALTER TYPE Trip PROPERTY description STRING;
ALTER TYPE Trip PROPERTY start_date STRING;          -- ISO yyyy-mm-dd
ALTER TYPE Trip PROPERTY end_date STRING;
ALTER TYPE Trip PROPERTY currency STRING DEFAULT 'EUR';
ALTER TYPE Trip PROPERTY cover_image STRING;
ALTER TYPE Trip PROPERTY is_archived BOOLEAN DEFAULT false;
ALTER TYPE Trip PROPERTY reminder_days INTEGER DEFAULT 3;
ALTER TYPE Trip PROPERTY is_private BOOLEAN DEFAULT true;
ALTER TYPE Trip PROPERTY status STRING DEFAULT 'open';  -- open|closed
ALTER TYPE Trip PROPERTY owner STRING;               -- стабильный _id владельца
ALTER TYPE Trip PROPERTY ownerRid STRING;            -- RID владельца, напр. '#22:0'
ALTER TYPE Trip PROPERTY created_at DATETIME;
ALTER TYPE Trip PROPERTY updated_at DATETIME;
CREATE INDEX IF NOT EXISTS ON Trip (ownerRid) NOTUNIQUE;

/* ---------- ВЕРШИНА Place: снапшот места ---------- */
CREATE VERTEX TYPE Place IF NOT EXISTS;
ALTER TYPE Place PROPERTY name STRING;
ALTER TYPE Place PROPERTY description STRING;
ALTER TYPE Place PROPERTY address STRING;
ALTER TYPE Place PROPERTY lat DOUBLE;
ALTER TYPE Place PROPERTY lng DOUBLE;
ALTER TYPE Place PROPERTY osm_id STRING;
ALTER TYPE Place PROPERTY google_place_id STRING;
ALTER TYPE Place PROPERTY google_ftid STRING;
ALTER TYPE Place PROPERTY source STRING;             -- osm | google
ALTER TYPE Place PROPERTY url STRING;
ALTER TYPE Place PROPERTY _id STRING;                -- стабильный nanoid(21), пишет код
ALTER TYPE Place PROPERTY created_at DATETIME;

/* ---------- ВЕРШИНА GeoObject: канонический эталон места ---------- */
CREATE VERTEX TYPE GeoObject IF NOT EXISTS;
ALTER TYPE GeoObject PROPERTY name STRING;
ALTER TYPE GeoObject PROPERTY lat DOUBLE;
ALTER TYPE GeoObject PROPERTY lng DOUBLE;
ALTER TYPE GeoObject PROPERTY osm_id STRING;
ALTER TYPE GeoObject PROPERTY google_place_id STRING;
ALTER TYPE GeoObject PROPERTY google_ftid STRING;
ALTER TYPE GeoObject PROPERTY source STRING;
ALTER TYPE GeoObject PROPERTY created_at DATETIME;
CREATE INDEX IF NOT EXISTS ON GeoObject (osm_id) NOTUNIQUE;
CREATE INDEX IF NOT EXISTS ON GeoObject (name, lat, lng) NOTUNIQUE;

/* ---------- РЕБРО TripMember: Trip -[участвует]-> User ---------- */
CREATE EDGE TYPE TripMember IF NOT EXISTS;
ALTER TYPE TripMember PROPERTY is_guest BOOLEAN DEFAULT false;
ALTER TYPE TripMember PROPERTY role STRING;          -- owner/member/guest
ALTER TYPE TripMember PROPERTY invited_by STRING;    -- _id пригласившего
ALTER TYPE TripMember PROPERTY added_at DATETIME;

/* ---------- РЕБРО TripPlace: Trip -[место]-> Place ---------- */
CREATE EDGE TYPE TripPlace IF NOT EXISTS;
ALTER TYPE TripPlace PROPERTY added_at DATETIME;
ALTER TYPE TripPlace PROPERTY added_by STRING;       -- _id добавившего
ALTER TYPE TripPlace PROPERTY day STRING;            -- день поездки
ALTER TYPE TripPlace PROPERTY note STRING;           -- заметка пользователя
ALTER TYPE TripPlace PROPERTY article_id INTEGER;    -- стабильный Article.id (B+C)
ALTER TYPE TripPlace PROPERTY article_rid STRING;    -- RID статьи '#X:Y' (B+C)
CREATE INDEX IF NOT EXISTS ON TripPlace (article_rid) NOTUNIQUE;

/* ---------- РЕБРО hasObject: Place -[связан]-> GeoObject ---------- */
CREATE EDGE TYPE hasObject IF NOT EXISTS;