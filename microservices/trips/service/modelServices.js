// === === === === === === === === === === === ===
//
// === === === === === === === === === === === ===

import { PDO } from './dbServices.js'
import { nanoid } from 'nanoid'

// Экранирование строки для inline-SQL (ArcadeDB PG Wire)
function sq(v) {
  if (v == null || v === undefined) return 'null'
  const s = String(v)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
  return `'${s}'`
}

function num(v, def) {
  const n = parseFloat(v)
  return Number.isNaN(n) ? String(def != null ? def : 0) : String(n)
}

function toOrientDate(value) {
  if (!value) return value
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

class Model extends PDO {
  constructor(options) {
    super(options)
  }

  async queryAll(query, params) {
    try {
      const res = await this.db.queryAll(query, params)
      return res
    } catch (err) {
      console.log('⚡ err::queryAll => ', err)
      throw err
    }
  }

  async queryOne(query, params) {
    try {
      const res = await this.db.queryOne(query, params)
      return res
    } catch (err) {
      console.log('⚡ err::queryOne => ', err)
      throw err
    }
  }

  async queryRid(query) {
    try {
      const res = await this.db.pool.query(query)
      return res.rows[0] || null
    } catch (err) {
      return err
    }
  }

  async insert(query, json) {
    try {
      const res = await this.db.command(query, json)
      return { message: res, type: 'insert', done: true }
    } catch (err) {
      console.log('⚡ err::insert => ', err)
      return { err: err, done: false }
    }
  }

  async create(edgeClass, from, to) {
    try {
      const res = await this.db.pool.query(
        `CREATE EDGE ${edgeClass} FROM $1 TO $2`,
        [from, to]
      )
      return res.rows[0] || null
    } catch (err) {
      console.log('⚡ err::create => ', err)
      return { err: err, done: false }
    }
  }

  async command(query, params = []) {
    try {
      const res = await this.db.command(query, params)
      return res
    } catch (err) {
      console.log('⚡ err::command => ', err)
      return err
    }
  }

  // === === === === === === === === ===
  // Trip (вершина)
  // === === === === === === === === ===

  getAll = () => {
    return this.queryAll('SELECT FROM Trip')
  }

  //  Список трипов владельца (опционально только архивные)
  listTrips(ownerRid, archived) {
    if (archived) {
      return this.queryAll(
        'SELECT FROM Trip WHERE ownerRid = :rid AND is_archived = true',
        { params: { rid: ownerRid } },
      )
    }
    return this.queryAll(
      'SELECT FROM Trip WHERE ownerRid = :rid ORDER BY created_at DESC',
      { params: { rid: ownerRid } },
    )
  }

  //  Публичные поездки (видны всем, кроме тех, где юзер уже владелец/участник)
  listPublicTrips(userRid) {
    return this.queryAll(
      'SELECT FROM Trip WHERE is_private = false ' +
        'AND ownerRid <> :rid ' +
        'AND @rid NOT IN (' +
        '  SELECT expand(in(' + "'TripMember'" + ')) FROM User WHERE @rid = :rid' +
        ') ORDER BY created_at DESC',
      { params: { rid: userRid } },
    )
  }

  //  Одна поездка по RID
  getTrip(rid) {
    return this.queryOne('SELECT FROM Trip WHERE @rid = ' + rid)
  }

  //  Поиск поездки по стабильному _id (для URL, RID нестабилен при экспорте и содержит '#')
  getTripById(id) {
    return this.queryOne("SELECT FROM Trip WHERE _id = '" + id + "'")
  }

  //  Создать поездку (вершину). Возвращает { rid, _id }
  async createTrip(obj, ownerRid, created) {
    const _id = obj._id || nanoid(21)
    const created_at = toOrientDate(created)
    const updated_at = created_at
    const q =
      'CREATE VERTEX Trip SET ' +
      'title=' + sq(obj.title) + ', ' +
      'description=' + sq(obj.description || '') + ', ' +
      'start_date=' + sq(obj.start_date) + ', ' +
      'end_date=' + sq(obj.end_date) + ', ' +
      'currency=' + sq(obj.currency || 'EUR') + ', ' +
      'is_archived=' + (obj.is_archived ? 'true' : 'false') + ', ' +
      'reminder_days=' + num(obj.reminder_days, 3) + ', ' +
      'is_private=' + (obj.is_private !== undefined ? (obj.is_private ? 'true' : 'false') : 'true') + ', ' +
      'status=' + sq(obj.status || 'open') + ', ' +
      '_id=' + sq(_id) + ', ' +
      'owner=' + sq(obj.owner) + ', ' +
      'ownerRid=' + sq(ownerRid) + ', ' +
      'created_at=' + sq(created_at) + ', ' +
      'updated_at=' + sq(updated_at)
    const res = await this.command(q)
    if (res && res.length) {
      const rid = res[0] && res[0]['@rid'] ? String(res[0]['@rid']) : null
      return rid ? { rid, _id } : null
    }
    return null
  }

  //  Update: безопасно конвертим даты (если переданы) в OrientDB-формат
  updateTrip(rid, fields) {
    const sets = []
    for (const k of Object.keys(fields)) {
      const v = fields[k]
      if (v === undefined) continue
      const val = ['created_at', 'updated_at', 'added_at'].includes(k)
        ? sq(toOrientDate(v))
        : typeof v === 'boolean'
          ? (v ? 'true' : 'false')
          : typeof v === 'number'
            ? num(v)
            : sq(v)
      sets.push(k + '=' + val)
    }
    if (!sets.length) return { done: true, updated: 0 }
    return this.command(
      'UPDATE Trip SET ' + sets.join(', ') + ' WHERE @rid = ' + rid,
    )
  }

  //  Удалить поездку (каскадно убирает TripMember)
  deleteTrip(rid) {
    return this.command('DELETE VERTEX Trip WHERE @rid = ' + rid)
  }

  // === === === === === === === === ===
  // TripMember (ребро Trip-[TripMember]->User)
  // === === === === === === === === ===

  //  Участники поездки: рёбра с полем user (in)
  //  ArcadeDB (PG Wire): концы ребра в @out/@in, а НЕ в колонках out/in.
  async getMembers(tripRid) {
    const edges = await this.queryAll(
      "SELECT @out AS out, @in AS in, role, is_guest, invited_by, added_at FROM TripMember WHERE @out = " +
        tripRid,
    )
    if (!edges) return []
    //  рёбра дают in (User RID) — это участники
    return edges.map((e) => ({
      userRid: e.in,
      role: e.role,
      is_guest: !!e.is_guest,
      invited_by: e.invited_by,
      added_at: e.added_at,
    }))
  }

  //  Добавить участника/гостя ребром (inline SQL)
  async addMember(tripRid, userRid, obj) {
    const q =
      'CREATE EDGE TripMember FROM ' + tripRid + ' TO ' + userRid + ' SET ' +
      'role=' + sq(obj.role || 'member') + ', ' +
      'is_guest=' + (obj.is_guest ? 'true' : 'false') + ', ' +
      'invited_by=' + sq(obj.invited_by || '') + ', ' +
      'added_at=' + sq(toOrientDate(obj.added_at || new Date().toISOString()))
    const res = await this.command(q)
    return res && res.length ? res[0] : null
  }

  //  Удалить участника/гостя ребром
  removeMember(tripRid, userRid) {
    return this.command(
      'DELETE EDGE TripMember WHERE @out = ' +
        tripRid +
        ' AND @in = ' +
        userRid,
    )
  }

  //  Проверить членство юзера в трипе: рёбра out=trip and in=user
  async isMember(tripRid, userRid) {
    const edges = await this.queryAll(
      'SELECT FROM TripMember WHERE @out = ' +
        tripRid +
        ' AND @in = ' +
        userRid,
    )
    return edges && edges.length > 0 ? edges[0] : null
  }

  //  Все поездки, где юзер участник (графовый обход от User)
  tripsOfUser(userRid) {
    return this.queryAll(
      "SELECT FROM (SELECT expand(out('TripMember')) FROM Trip) " +
        "WHERE @rid IN (SELECT expand(in('TripMember')) FROM User WHERE @rid = " +
        userRid +
        ')',
    )
  }

  // === === === === === === === === ===
  // Place (вершина) + ребро Trip─Place
  // === === === === === === === === ===
  // Вершина Place — снапшот места (POI) внутри поездки.
  // Все DDL — inline SQL (ArcadeDB PG Wire не переваривает параметризацию
  // в CREATE VERTEX/EDGE).

  //  Создать Place (вершину). Возвращает { rid, _id } или null.
  async createPlace(obj) {
    const p = { ...obj }
    const _id = p._id || nanoid(21)
    const created_at = toOrientDate(p.created_at || new Date())
    const q =
      'CREATE VERTEX Place SET ' +
      'name=' + sq(p.name) + ', ' +
      'description=' + sq(p.description || '') + ', ' +
      'address=' + sq(p.address || '') + ', ' +
      'lat=' + num(p.lat) + ', ' +
      'lng=' + num(p.lng) + ', ' +
      'osm_id=' + sq(p.osm_id || null) + ', ' +
      'google_place_id=' + sq(p.google_place_id || null) + ', ' +
      'google_ftid=' + sq(p.google_ftid || null) + ', ' +
      'source=' + sq(p.source || 'article') + ', ' +
      'url=' + sq(p.url || null) + ', ' +
      '_id=' + sq(_id) + ', ' +
      'created_at=' + sq(created_at)
    const res = await this.command(q)
    if (res && res.length) {
      const rid = res[0] && res[0]['@rid'] ? String(res[0]['@rid']) : null
      return rid ? { rid, _id } : null
    }
    return null
  }

  //  Добавить место в поездку ребром Trip-[TripPlace]->Place (inline SQL)
  async addPlaceToTrip(tripRid, placeRid, obj) {
    const q =
      'CREATE EDGE TripPlace FROM ' + tripRid + ' TO ' + placeRid + ' SET ' +
      'added_at=' + sq(toOrientDate(obj.added_at || new Date().toISOString())) + ', ' +
      'added_by=' + sq(obj.added_by || '') + ', ' +
      'day=' + sq(obj.day || null) + ', ' +
      'note=' + sq(obj.note || null) + ', ' +
      'article_id=' + sq(obj.article_id || null) + ', ' +
      'article_rid=' + sq(obj.article_rid || null)
    const res = await this.command(q)
    return res && res.length ? res[0] : null
  }

  //  Места поездки (обход от Trip по ребру TripPlace)
  //  ArcadeDB (PG Wire): концы ребра в @out/@in, а НЕ в колонках out/in.
  async getTripPlaces(tripRid) {
    const edges = await this.queryAll(
      'SELECT @out AS out, @in AS in, added_at, added_by, day, note, article_id, article_rid FROM TripPlace WHERE @out = ' +
        tripRid,
    )
    if (!edges) return []
    // рёбра дают in (Place RID) — это места поездки
    const out = []
    for (const e of edges) {
      const place = await this.getPlace(e.in)
      if (place) out.push({ ...place, added_at: e.added_at, added_by: e.added_by, day: e.day, note: e.note, article_id: e.article_id, article_rid: e.article_rid })
    }
    return out
  }

  //  Найти канонический GeoObject места (дедуп): сначала по osm_id,
  //  фолбэк — по name+lat+lng. Создать, если нет. Возвращает rid GeoObject.
  async findOrCreateGeoObject(placeObj) {
    const lat = Number(placeObj.lat)
    const lng = Number(placeObj.lng)
    let existing = null
    if (placeObj.osm_id) {
      const hit = await this.queryOne(
        "SELECT @rid FROM GeoObject WHERE osm_id = '" +
          String(placeObj.osm_id).replace(/'/g, "''") + "' LIMIT 1",
      )
      if (hit && hit['@rid']) existing = hit['@rid']
    }
    if (!existing && !Number.isNaN(lat) && !Number.isNaN(lng) && placeObj.name) {
      const hit = await this.queryAll(
        'SELECT @rid FROM GeoObject WHERE name = :name AND lat = :lat AND lng = :lng LIMIT 1',
        { params: { name: placeObj.name, lat, lng } },
      )
      if (hit && hit.length && hit[0]['@rid']) existing = hit[0]['@rid']
    }
    if (existing) return String(existing)
    // не найден — создаём каноничный GeoObject (inline SQL)
    const created_at = toOrientDate(new Date())
    const q =
      'CREATE VERTEX GeoObject SET ' +
      'name=' + sq(placeObj.name) + ', ' +
      'lat=' + num(lat) + ', ' +
      'lng=' + num(lng) + ', ' +
      'osm_id=' + sq(placeObj.osm_id || null) + ', ' +
      'google_place_id=' + sq(placeObj.google_place_id || null) + ', ' +
      'google_ftid=' + sq(placeObj.google_ftid || null) + ', ' +
      'url=' + sq(placeObj.url || null) + ', ' +
      'source=' + sq(placeObj.source || 'article') + ', ' +
      'created_at=' + sq(created_at)
    const created = await this.command(q)
    if (created && created.length) {
      const rid = created[0] && created[0]['@rid'] ? String(created[0]['@rid']) : null
      return rid
    }
    return null
  }

  //  Ребро Place-[hasObject]->GeoObject (inline SQL)
  async linkPlaceToGeoObject(placeRid, geoRid) {
    if (!placeRid || !geoRid) return null
    const q = 'CREATE EDGE hasObject FROM ' + placeRid + ' TO ' + geoRid
    const res = await this.command(q)
    return res && res.length ? res[0] : null
  }

  //  Одно место по RID
  getPlace(rid) {
    return this.queryOne('SELECT FROM Place WHERE @rid = ' + rid)
  }

  //  Поиск места по стабильному _id
  getPlaceById(id) {
    return this.queryOne("SELECT FROM Place WHERE _id = '" + id + "'")
  }

  //  Убрать место из поездки (удалить ребро; саму вершину Place можно удалить отдельно)
  removePlaceFromTrip(tripRid, placeRid) {
    return this.command(
      'DELETE EDGE TripPlace WHERE @out = ' + tripRid + ' AND @in = ' + placeRid,
    )
  }

  // === === === === === === === === ===
  // Топ-объекты (места к посещению) — B+C
  // === === === === === === === === ===
  // Агрегируем по графу GeoObject<-hasObject-Place<-TripPlace-Trip.
  // Для каждого GeoObject считаем: сколько Place-меток (in_hasObject),
  // в скольких поездках (уникальные Trip через двойной in()), у скольких
  // уникальных пользователей (ownerRid этих Trip). Возвращает топ, отсор­
  // тированный по выбранной метрике и урезанный лимитом.
  //
  // orderBy: 'trips' (default) | 'users' | 'places'
  async topGeoObjects(limit = 10, minTrips = 1, orderBy = 'trips') {
    let geos = []
    try {
      geos = await this.queryAll(
        "SELECT @rid AS geoRid, name AS geoName, osm_id, lat, lng, source, url, " +
          "in('hasObject') AS places, in('hasObject').in('TripPlace') AS trips FROM GeoObject",
      )
    } catch (err) {
      console.log('⚡ err::topGeoObjects fetch geos', err)
      return []
    }
    if (!geos || !geos.length) return []

    const ridOf = (x) => (x == null ? '' : String(x))

    const out = []
    for (const g of geos) {
      const places = Array.isArray(g.places) ? g.places : []
      if (!places.length) continue

      const tripSet = new Set()
      for (const t of Array.isArray(g.trips) ? g.trips : []) {
        const r = ridOf(t)
        if (r) tripSet.add(r)
      }
      const tripRids = [...tripSet]
      const tripsCount = tripRids.length
      if (tripsCount < minTrips) continue

      let meta = []
      if (tripRids.length) {
        try {
          meta = await this.queryAll(
            'SELECT @rid, title, ownerRid FROM Trip WHERE @rid IN [' + tripRids.join(',') + ']',
          )
        } catch (err) {
          console.log('⚡ err::topGeoObjects trips-meta', err)
          meta = []
        }
      }

      const topTrips = []
      const ownerRids = new Set()
      for (const m of meta || []) {
        const r = ridOf(m['@rid'])
        if (r) {
          topTrips.push({ rid: r, title: m.title || null, ownerRid: m.ownerRid ? String(m.ownerRid) : null })
          if (m.ownerRid) ownerRids.add(String(m.ownerRid))
        }
      }

      out.push({
        geo: {
          rid: ridOf(g.geoRid || g['@rid']),
          name: g.geoName,
          osm_id: g.osm_id || null,
          lat: g.lat,
          lng: g.lng,
          source: g.source || null,
          url: g.url || null,
        },
        trips: tripsCount,
        users: ownerRids.size,
        places: places.length,
        topTrips,
      })
    }

    const key = orderBy === 'users' ? 'users' : orderBy === 'places' ? 'places' : 'trips'
    out.sort((a, b) => {
      if (b[key] !== a[key]) return b[key] - a[key]
      if (b.trips !== a.trips) return b.trips - a.trips
      return String(a.geo.name || '').localeCompare(String(b.geo.name || ''))
    })

    const n = Number.isInteger(limit) && limit > 0 ? limit : out.length
    return out.slice(0, n)
  }
}

export { Model }