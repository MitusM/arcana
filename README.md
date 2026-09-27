# cloudFRT / arcana

ESM-монорепо: **Gateway + RabbitMQ-микросервисы** (MicroMQ) + **ArcadeDB**.

Стек: Node.js (ESM), RabbitMQ (amin's MicroMQ / `core/micromq`), ArcadeDB 26.x (графовая БД через Postgres Wire), Redis. Сервисы общаются по RPC-шине (RabbitMQ); HTTP-вход один — Gateway (порт `7606`).

> Код: `/media/04E0AC01E0ABF6D8/arcana/` | Git: https://github.com/MitusM/arcana.git

## Архитектура

```
HTTP-клиент
   │
   ▼
 Gateway (core/micromq) ── RabbitMQ ──▶ Микросервисы (RPC-консьюмеры)
   │  res.delegate(...)                    users, auth, render, article, trips,
   │                       ◀─────── JSON   users, auth, render, article, trips,
   │                                      destinations, cache, maps
   ▼
 клиент ← res.end(...)
```

- **Один вход** — Gateway: клиентский HTTP → `res.delegate()` → очередь → микросервис-консьюмер → ответ `Response` → JSON обратно по шине → Gateway `res.end()`.
- **Ответы микросервисов сериализуются через `JSON.stringify`** (Buffer ломается). Для бинарных данных используется контракт `{ __frtBase64: string, contentType?: string }` — Gateway декодирует base64 и отдаёт настоящие байты клиенту (правка в `core/micromq/src/Gateway.js`).

## Микросервисы

| Сервис | Роль |
|---|---|
| `gateway` | HTTP-шлюз, маршрутизация RPC-запросов |
| `users`/`auth` | Авторизация/сессии |
| `render` | Рендер HTML |
| `article` | Статьи |
| `trips` | Агрегат поездок (Trip + TripMember + TripPlace) |
| `destinations` | Гео-каталог мест (страны → регионы → места) |
| `cache` | Кэш |
| `maps` | Визуальная карта (MapLibre GL) + гео |

## База данных

**ArcadeDB 26.9.1** — графовая БД через Postgres Wire.

- **Протокол:** Postgres Wire (`:5432`) через `pg` (node-postgres)
- **HTTP API:** `:2480` (Studio, REST)
- **Пароль root:** `arcade4db`
- **БД:** `cloudFRT`
- **Драйвер:** `pg` — общая обёртка в `shared/db-pg.js`

## Карта (МС maps)

Визуальная карта рендерится **в одной точке** — `microservices/maps/service/renderMapHtml.js` (MapLibre GL 4.4, CDN unpkg + OpenFreeMap Liberty; спутник — Esri World Imagery). Этот же HTML отдаётся и по RPC `maps:map`, и по `GET /maps/map`, и его переиспользуют поездки (trips) и OG-превью.

Публичные эндпоинты: `/maps/map`, `/maps/geocode`, `/maps/pois`, `/maps/og`.

### OG-превью поездки (серверный рендер)
- `trips GET /trips/:id/og-image` — грузит поездку + места → RPC `maps:og` → PNG.
- `maps:og` / `microservices/maps/service/ogExport.js` — рендер во **headless Chromium** (Playwright), та же точка рендера `renderMapHtml`.
- **Кэш**: `trips/service/ogCache.js` → `cloudFRT/og-cache/<tripId>.png`, TTL 7 дней.

## Запуск

- Скрипт подъёма стека: `/media/04E0AC01E0ABF6D8/agent/tim/scripts/start-arcana.sh`
  (Redis / RabbitMQ / ArcadeDB + Gateway + микросервисы через nodemon).
- Переменные окружения — в `.env` каждого МС (PG_HOST/PORT/DATABASE/USERNAME/PASSWORD, Redis, таймаут RPC).
- Для прод-режима: `DEV_MODE=0 ./start-arcana.sh`