// === === === === === === === === === === === ===
// modelServices.js — модель Dest (гео-каталог мест) для МС destinations
// Аркана-версия: ArcadeDB через PG Wire.
// Исправлено: все RID и строки параметризованы ($1), process.exit() убран,
//             инлайн-экранирование удалено, добавлены транзакции.
// === === === === === === === === === === === ===
import { PDO } from './dbServices.js'

class Model extends PDO {
  constructor(options) {
    super(options)
  }

  // ============================================================
  //  Примитивы
  // ============================================================

  async queryAll(query, params) {
    try {
      return await this.db.queryAll(query, params)
    } catch (err) {
      console.log('⚡ err::queryAll => ', err)
      return []
    }
  }

  async queryOne(query, params) {
    try {
      return await this.db.queryOne(query, params)
    } catch (err) {
      console.log('⚡ err::queryOne => ', err)
      return null
    }
  }

  async insert(query, params) {
    try {
      const res = await this.db.command(query, params)
      return { message: res, type: 'insert', done: true }
    } catch (err) {
      console.log('⚡ err::insert => ', err)
      return { err: err, done: false }
    }
  }

  async createEdge(edgeClass, from, to) {
    try {
      return await this.db.createEdge(edgeClass, from, to)
    } catch (err) {
      console.log('⚡ err::createEdge => ', err)
      return { err: err, done: false }
    }
  }

  async command(query, params = []) {
    try {
      return await this.db.command(query, params)
    } catch (err) {
      console.log('⚡ err::command => ', err)
      return { err: err, done: false }
    }
  }

  // ============================================================
  //  Утилиты
  // ============================================================

  /** Удалить вершину с рёбрами в транзакции */
  async _deleteVertex(rid) {
    try {
      await this.db.command('BEGIN')
      await this.db.command('DELETE EDGE FROM $1', [rid])
      await this.db.command('DELETE EDGE TO $1', [rid])
      await this.db.command('DELETE VERTEX $1', [rid])
      await this.db.command('COMMIT')
      return { done: true }
    } catch (err) {
      try { await this.db.command('ROLLBACK') } catch (_) { /* ignore */ }
      console.log('⚡ err::_deleteVertex => ', err)
      return { err, done: false }
    }
  }

  /** Создать точку OPoint для PG Wire из lng/lat.
   *  Возвращает SQL-выражение (литерал объекта) или null.
   */
  _pointLiteral(lng, lat) {
    if (lng == null || lat == null) return null
    const ln = Number(lng)
    const lt = Number(lat)
    if (Number.isNaN(ln) || Number.isNaN(lt)) return null
    return `{'@type':'OPoint','coordinates':[${ln},${lt}]}`
  }

  // ============================================================
  //  Основные методы Dest
  // ============================================================

  /** Создать узел места (вершина Dest). parentRid опционален.
   *  ВАЖНО: ArcadeDB CREATE VERTEX не принимает $1 для строковых
   *  значений в SET. Параметризуем через INSERT-синтаксис (как в article).
   */
  async createDest({
    slug, title, h1, level, description, content, lat, lng,
    image, is_hub, priority, parentRid, status,
  }) {
    const st = status === 'published' ? 'published' : 'draft'
    const locLit = this._pointLiteral(lng, lat)
    const isHub = is_hub === undefined ? true : !!is_hub
    const prio = (priority == null || priority === '') ? 0.5 : Number(priority)
    const finalPrio = Number.isNaN(prio) ? 0.5 : prio

    const sql = `INSERT INTO Dest SET
      slug=:slug, title=:title, h1=:h1,
      level=:level, description=:description,
      content=:content, image=:image,
      is_hub=:is_hub, priority=:priority, status=:status,
      created=sysdate()${locLit ? ', location=' + locLit : ''}`

    const result = await this.insert(sql, {
      params: {
        slug: String(slug || ''),
        title: String(title || ''),
        h1: String(h1 || title || ''),
        level: String(level || 'place'),
        description: String(description || ''),
        content: content || null,
        image: String(image || ''),
        is_hub: isHub,
        priority: finalPrio,
        status: st,
      },
    })

    if (!result.done || !result.message || !result.message.length) return result
    const destRow = result.message[0]
    const destRid = destRow.rid || destRow['@rid']

    // ребро иерархии PART_OF — в транзакции
    if (parentRid && destRid) {
      try {
        await this.db.command('BEGIN')
        await this.db.createEdge('PART_OF', destRid, parentRid)
        await this.db.command('COMMIT')
      } catch (err) {
        try { await this.db.command('ROLLBACK') } catch (_) {}
        console.log('⚡ err::createDest edge => ', err)
        await this.command('DELETE VERTEX $1', [destRid])
        return { err, done: false }
      }
    }
    return { done: true, dest: destRow }
  }

  // --- Список всех узлов (админ) ---
  async listAll(limit = 100, offset = 0) {
    const lim = parseInt(limit, 10) || 100
    const off = parseInt(offset, 10) || 0
    // ВАЖНО: ArcadeDB PG Wire НЕ принимает параметризованные LIMIT/SKIP — только инлайн
    return this.queryAll(
      `SELECT @rid as rid, slug, title, h1, level, is_hub, priority, image, status, created
       FROM Dest ORDER BY created DESC SKIP ${off} LIMIT ${lim}`,
    )
  }

  // --- Узел по RID (админ) ---
  async getByRid(rid) {
    return this.queryOne('SELECT *, @rid as rid FROM $1', [rid])
  }

  /** Родитель узла (первый по out('PART_OF')) или null. */
  async getParentRid(rid) {
    const row = await this.queryOne(
      `SELECT out('PART_OF').@rid as parents FROM $1 WHERE out('PART_OF').size() > 0`,
      [rid],
    )
    const p = row && row.parents
    if (Array.isArray(p) && p.length) return String(p[0])
    return null
  }

  // --- Проверка: существует ли slug (внутри родителя или глобально) ---
  async slugExists(slug, parentRid, excludeRid) {
    let sql, params
    if (parentRid) {
      if (excludeRid) {
        sql = 'SELECT @rid FROM Dest WHERE slug = $1 AND $2 IN out(\'PART_OF\') AND @rid <> $3'
        params = [slug, parentRid, excludeRid]
      } else {
        sql = 'SELECT @rid FROM Dest WHERE slug = $1 AND $2 IN out(\'PART_OF\')'
        params = [slug, parentRid]
      }
    } else {
      if (excludeRid) {
        sql = 'SELECT @rid FROM Dest WHERE slug = $1 AND @rid <> $2'
        params = [slug, excludeRid]
      } else {
        sql = 'SELECT @rid FROM Dest WHERE slug = $1'
        params = [slug]
      }
    }
    const r = await this.queryOne(sql, params)
    return !!r
  }

  // --- Обновить узел (белый список полей) ---
  async updateDest(rid, fields) {
    const ALLOWED = ['slug', 'title', 'h1', 'level', 'description', 'content', 'image', 'summary', 'thumbnail', 'is_hub', 'priority', 'status']
    const set = []
    const values = []

    for (const key of ALLOWED) {
      if (fields[key] === undefined) continue
      values.push(key === 'content' ? (fields[key] || null) : fields[key])
      set.push(`${key}=$${values.length}`)
    }

    // координаты
    if (fields.lat != null && fields.lng != null) {
      const locLit = this._pointLiteral(fields.lng, fields.lat)
      if (locLit) set.push(`location = ${locLit}`)
    }

    if (!set.length) return { done: true, updated: 0 }
    const res = await this.command(
      `UPDATE $1 SET ${set.join(', ')}`,
      [rid, ...values],
    )
    return { done: true, updated: (res && res.done === undefined ? 1 : 0) }
  }

  // --- Сменить статус публикации узла ---
  async setStatus(rid, status) {
    const st = status === 'published' ? 'published' : 'draft'
    await this.command(
      'UPDATE $1 SET status = $2, updated=sysdate()',
      [rid, st],
    )
    return { done: true, updated: 1 }
  }

  // --- Множество скрытых RID (draft-узлы + поддерево) ---
  async getClosedRids() {
    const rows = await this.queryAll(
      `SELECT @rid as rid FROM (
         TRAVERSE in('PART_OF') FROM (SELECT FROM Dest WHERE status = 'draft')
       )`,
    )
    const set = new Set()
    for (const r of rows || []) set.add(String(r.rid))
    return set
  }

  // --- Сменить родителя ---
  async moveDest(rid, newParentRid) {
    try {
      await this.db.command('BEGIN')
      const edges = await this.db.queryAll(
        'SELECT @rid as rid FROM PART_OF WHERE out = $1',
        [rid],
      )
      for (const e of edges || []) {
        if (e && e.rid) await this.db.command('DELETE FROM $1', [e.rid])
      }
      if (newParentRid) {
        await this.db.createEdge('PART_OF', rid, newParentRid)
      }
      await this.db.command('COMMIT')
      return { done: true }
    } catch (err) {
      try { await this.db.command('ROLLBACK') } catch (_) {}
      console.log('⚡ err::moveDest => ', err)
      return { err, done: false }
    }
  }

  // --- Является ли maybeChildRid потомком rid ---
  async isDescendant(rid, maybeChildRid) {
    if (!rid || !maybeChildRid) return false
    const rs = String(rid)
    const mc = String(maybeChildRid)
    if (rs === mc) return true
    const rows = await this.queryAll(
      `SELECT @rid as rid FROM (
        TRAVERSE out('PART_OF') FROM $1
      ) WHERE @rid = $2`,
      [mc, rs],
    )
    return rows.length > 0
  }

  // --- Найти узел по slug ---
  async getBySlug(slug, parentRid) {
    if (parentRid) {
      return this.queryOne(
        `SELECT * FROM Dest WHERE slug = $1 AND $2 IN out('PART_OF')`,
        [slug, parentRid],
      )
    }
    return this.queryOne('SELECT * FROM Dest WHERE slug = $1', [slug])
  }

  // --- Список прямых детей (published) ---
  async listChildren(rid, limit = 50) {
    const lim = parseInt(limit, 10) || 50
    // ВАЖНО: ArcadeDB PG Wire НЕ принимает параметризованные LIMIT — только инлайн
    return this.queryAll(
      `SELECT @rid as rid, slug, title, h1, level, image, priority, status, content FROM Dest
       WHERE $1 IN out('PART_OF') AND status = 'published'
       ORDER BY priority DESC LIMIT ${lim}`,
      [rid],
    )
  }

  // --- Дети узла без лимита (админ) ---
  async listChildrenAdmin(rid, limit = 50, offset = 0) {
    const lim = parseInt(limit, 10) || 50
    const off = parseInt(offset, 10) || 0
    // ВАЖНО: ArcadeDB PG Wire НЕ принимает параметризованные SKIP/LIMIT — только инлайн
    return this.queryAll(
      `SELECT @rid as rid, slug, title, h1, level, image, priority, is_hub, status FROM Dest
       WHERE $1 IN out('PART_OF') ORDER BY priority DESC SKIP ${off} LIMIT ${lim}`,
      [rid],
    )
  }

  async countChildrenAdmin(rid) {
    const row = await this.queryOne(
      `SELECT COUNT(*) as c FROM (
        SELECT FROM Dest WHERE $1 IN out('PART_OF')
      )`,
      [rid],
    )
    return row ? (row.c || 0) : 0
  }

  // --- Дети верхнего уровня (админ-корень) ---
  async listRootAdmin(limit = 50, offset = 0) {
    const lim = parseInt(limit, 10) || 50
    const off = parseInt(offset, 10) || 0
    // ВАЖНО: ArcadeDB PG Wire НЕ принимает параметризованные SKIP/LIMIT — только инлайн
    return this.queryAll(
      `SELECT @rid as rid, slug, title, h1, level, image, priority, is_hub, status FROM Dest
       WHERE out('PART_OF').size() = 0 ORDER BY priority DESC SKIP ${off} LIMIT ${lim}`,
    )
  }

  async countRootAdmin() {
    const row = await this.queryOne(
      `SELECT COUNT(*) as c FROM Dest WHERE out('PART_OF').size() = 0`,
    )
    return row ? (row.c || 0) : 0
  }

  // --- Цепочка предков (для хлебных крошек) ---
  async parentsChain(rid) {
    return this.queryAll(
      `SELECT @rid as rid, slug, title, level FROM (
        TRAVERSE out('PART_OF') FROM $1
      )`,
      [rid],
    )
  }

  // --- Узел по полному пути (массив slug от корня) [ПУБЛИЧНЫЙ] ---
  async getByPath(slugs) {
    if (!slugs || !slugs.length) return null
    let current = await this.queryOne(
      `SELECT * FROM Dest WHERE slug = $1 AND out('PART_OF').size() = 0 AND status = 'published'`,
      [slugs[0]],
    )
    if (!current) return null
    for (let i = 1; i < slugs.length; i++) {
      const rid = current['@rid']
      current = await this.queryOne(
        `SELECT * FROM Dest WHERE slug = $1 AND $2 IN out('PART_OF') AND status = 'published'`,
        [slugs[i], rid],
      )
      if (!current) return null
    }
    return current
  }

  // --- Удалить узел ---
  async deleteDest(rid) {
    return this._deleteVertex(rid)
  }

  // ============================================================
  //  ЭТАП 4: Перелинковка и хабы
  // ============================================================

  /** Топ-места: важные целевые места из всего поддерева */
  async getTopPlaces(rid, { levels = ['attraction', 'place'], limit = 12 } = {}) {
    const lim = parseInt(limit, 10) || 12
    const levelClause = levels.length
      ? `(${levels.map((l, i) => `level=$${i + 2}`).join(' OR ')})`
      : '1=1'
    const closed = await this.getClosedRids()
    const places = await this.queryAll(
      `SELECT @rid as rid, slug, title, h1, level, image, priority, status, content, $path AS path FROM (
        TRAVERSE in('PART_OF') FROM $1
      ) WHERE ${levelClause} AND status = 'published' ORDER BY priority DESC LIMIT ${lim}`,
      [rid, ...levels],
    )
    const publicPlaces = places.filter((p) => !closed.has(String(p.rid)))
    const all = await this.queryAll(
      `SELECT @rid as rid, slug FROM (TRAVERSE in('PART_OF') FROM $1)`,
      [rid],
    )
    const slugMap = {}
    for (const n of all) {
      const r = String(n.rid)
      slugMap[r] = n.slug
      const m = r.match(/#\d+:\d+/)
      if (m) slugMap[m[0]] = n.slug
    }
    return { places: publicPlaces, slugMap }
  }

  /** Похожие места: братья по дереву */
  async getSiblings(rid, limit = 8) {
    const lim = parseInt(limit, 10) || 8
    const parentRow = await this.queryOne(
      'SELECT out(\'PART_OF\').@rid AS p FROM $1',
      [rid],
    )
    const parents = (parentRow && parentRow.p) || []
    if (!parents.length) return []
    const parentsList = Array.isArray(parents) ? parents : [parents]
    const clauses = []
    const params = [rid]
    for (const p of parentsList) {
      clauses.push(`$${params.length + 1} IN out('PART_OF')`)
      params.push(p)
    }
    // ВАЖНО: ArcadeDB PG Wire НЕ принимает параметризованные LIMIT — только инлайн
    return this.queryAll(
      `SELECT @rid as rid, slug, title, h1, level, image, priority, status, content FROM Dest
       WHERE (${clauses.join(' OR ')})
         AND @rid <> $1 AND status = 'published'
       ORDER BY priority DESC LIMIT ${lim}`,
      params,
    )
  }

  /** Прочитать поле links узла */
  async getLinks(rid) {
    const r = await this.queryOne('SELECT links FROM $1', [rid])
    return (r && r.links) || null
  }

  /** Sitemap: все узлы дерева с полным путём */
  async getSitemapTree() {
    const rows = await this.queryAll(
      `SELECT @rid as rid, slug, title, h1, level, priority, is_hub, image, status, $path AS path FROM (
        TRAVERSE in('PART_OF') FROM (SELECT FROM Dest WHERE out('PART_OF').size() = 0)
      )`,
    )
    const all = await this.queryAll(
      `SELECT @rid as rid, slug FROM (
        TRAVERSE in('PART_OF') FROM (SELECT FROM Dest WHERE out('PART_OF').size() = 0)
      )`,
    )
    const slugMap = {}
    for (const n of all) {
      const key = String(n.rid)
      slugMap[key] = n.slug
      const m = key.match(/#\d+:\d+/)
      if (m) slugMap[m[0]] = n.slug
    }
    return rows.map((r) => ({
      rid: String(r.rid),
      slug: r.slug,
      title: r.title,
      h1: r.h1,
      level: r.level,
      priority: r.priority,
      is_hub: r.is_hub,
      image: r.image,
      status: r.status || 'draft',
      path: (r.path || []).map((rid) => slugMap[String(rid)]).filter(Boolean).join('/'),
    }))
  }

  /** Глобальный поиск по каталогу */
  async searchDest(q, limit = 50) {
    const lim = parseInt(limit, 10) || 50
    const like = `%${q}%`
    // ВАЖНО: ArcadeDB PG Wire НЕ принимает параметризованные LIMIT — только инлайн
    const rows = await this.queryAll(
      `SELECT @rid as rid, slug, title, h1, level, image, is_hub, status, $path AS path FROM (
        TRAVERSE in('PART_OF') FROM (SELECT FROM Dest WHERE out('PART_OF').size() = 0)
      ) WHERE (slug ILIKE $1 OR title ILIKE $1) ORDER BY title LIMIT ${lim}`,
      [like],
    )
    const all = await this.queryAll(
      `SELECT @rid as rid, slug FROM (
        TRAVERSE in('PART_OF') FROM (SELECT FROM Dest WHERE out('PART_OF').size() = 0)
      )`,
    )
    const slugMap = {}
    for (const n of all) {
      slugMap[String(n.rid)] = n.slug
    }
    return rows.map((r) => ({
      rid: String(r.rid),
      slug: r.slug,
      title: r.title,
      h1: r.h1,
      level: r.level,
      image: r.image,
      is_hub: r.is_hub,
      status: r.status || 'draft',
      path: (r.path || []).map((rid) => slugMap[String(rid)]).filter(Boolean).join('/'),
    }))
  }

  /** Статьи, связанные с местом */
  async getRelatedArticles(rid, limit = 6) {
    const lim = parseInt(limit, 10) || 6
    const viaEdge = await this.queryAll(
      `SELECT out('HAS_ARTICLE').url AS url, out('HAS_ARTICLE').title AS title
       FROM $1 WHERE out('HAS_ARTICLE').size() > 0`,
      [rid],
    )
    if (viaEdge && viaEdge.length) {
      const urls = viaEdge[0].url
      const titles = viaEdge[0].title
      if (Array.isArray(urls)) {
        return urls.slice(0, lim).map((u, i) => {
          let t = (Array.isArray(titles) && titles[i]) || 'Читать далее'
          if (t && typeof t === 'object') t = t.ru || t.en || t._ || Object.values(t)[0] || 'Читать далее'
          return { url: `/stati/${String(u).replace(/^\/+/, '')}`, title: String(t) }
        })
      }
    }
    return []
  }

  // ============================================================
  //  ЭТАП 5: точки для карты
  // ============================================================

  /** Точки для карты узла (сам узел + прямые дети) */
  async getMapPoints(rid, _pageSlugs = []) {
    const pull = (r) => {
      if (r && r.location) {
        const c = r.location.coordinates
        if (Array.isArray(c) && c.length >= 2) {
          return { lat: Number(c[1]), lng: Number(c[0]) }
        }
      }
      return null
    }

    const points = []
    let center = null

    const self = await this.queryOne(
      `SELECT @rid, slug, title, level, summary, thumbnail, location,
              out('HAS_TYPE').slug AS typeSlug,
              out('HAS_TYPE').name AS typeName,
              out('HAS_TYPE').icon AS typeIcon
       FROM $1`,
      [rid],
    )
    const selfLoc = pull(self)
    let selfFullSlug = ''
    if (selfLoc && self.title) {
      const ts = Array.isArray(self.typeSlug) ? self.typeSlug[0] : self.typeSlug
      const tn = Array.isArray(self.typeName) ? self.typeName[0] : self.typeName
      const ti = Array.isArray(self.typeIcon) ? self.typeIcon[0] : self.typeIcon
      const chain = await this.parentsChain(rid)
      const pathSlugs = (chain || []).map(c => c.slug).reverse()
      selfFullSlug = pathSlugs.join('/')
      points.push({ name: self.title, level: self.level, summary: self.summary || '', thumbnail: self.thumbnail || '', slug: self.slug || '', fullSlug: selfFullSlug, typeSlug: ts || null, typeName: tn || null, typeIcon: ti || null, ...selfLoc })
      center = selfLoc
    }

    const kids = await this.queryAll(
      `SELECT @rid as rid, slug, title, level, summary, thumbnail, location,
              out('HAS_TYPE').slug AS typeSlug,
              out('HAS_TYPE').name AS typeName,
              out('HAS_TYPE').icon AS typeIcon
       FROM Dest
       WHERE $1 IN out('PART_OF') AND location IS NOT NULL AND status = 'published'`,
      [rid],
    )
    for (const k of kids || []) {
      const loc = pull(k)
      if (loc && k.title) {
        const ts = Array.isArray(k.typeSlug) ? k.typeSlug[0] : k.typeSlug
        const tn = Array.isArray(k.typeName) ? k.typeName[0] : k.typeName
        const ti = Array.isArray(k.typeIcon) ? k.typeIcon[0] : k.typeIcon
        const fullSlug = (selfFullSlug || '').split('/').filter(Boolean).concat([k.slug]).join('/')
        points.push({ name: k.title, level: k.level, summary: k.summary || '', thumbnail: k.thumbnail || '', slug: k.slug || '', fullSlug, typeSlug: ts || null, typeName: tn || null, typeIcon: ti || null, ...loc })
      }
    }

    if (!center && points.length) {
      const lat = points.reduce((a, p) => a + p.lat, 0) / points.length
      const lng = points.reduce((a, p) => a + p.lng, 0) / points.length
      center = { lat, lng }
    }
    return { points, center }
  }

  /** Все точки региона (TRAVERSE всех потомков) */
  async getMapPointsDeep(rid, _pageSlugs = []) {
    const pull = (r) => {
      if (r && r.location) {
        const c = r.location.coordinates
        if (Array.isArray(c) && c.length >= 2) {
          return { lat: Number(c[1]), lng: Number(c[0]) }
        }
      }
      return null
    }

    const points = []
    let center = null

    const self = await this.queryOne(
      `SELECT @rid, slug, title, level, summary, thumbnail, location,
              out('HAS_TYPE').slug AS typeSlug,
              out('HAS_TYPE').name AS typeName,
              out('HAS_TYPE').icon AS typeIcon
       FROM $1`,
      [rid],
    )
    const selfLoc = pull(self)
    if (selfLoc && self.title) {
      const ts = Array.isArray(self.typeSlug) ? self.typeSlug[0] : self.typeSlug
      const tn = Array.isArray(self.typeName) ? self.typeName[0] : self.typeName
      const ti = Array.isArray(self.typeIcon) ? self.typeIcon[0] : self.typeIcon
      const chain = await this.parentsChain(rid)
      const pathSlugs = (chain || []).map(c => c.slug).reverse()
      const fullSlug = pathSlugs.join('/')
      points.push({ name: self.title, level: self.level, summary: self.summary || '', thumbnail: self.thumbnail || '', slug: self.slug || '', fullSlug, typeSlug: ts || null, typeName: tn || null, typeIcon: ti || null, ...selfLoc })
      center = selfLoc
    }

    const descendants = await this.queryAll(
      `SELECT @rid as rid, slug, title, level, summary, thumbnail, location, $path AS path,
              out('HAS_TYPE').slug AS typeSlug,
              out('HAS_TYPE').name AS typeName,
              out('HAS_TYPE').icon AS typeIcon
       FROM (TRAVERSE in('PART_OF') FROM $1 MAXDEPTH 10)
       WHERE @rid <> $1 AND location IS NOT NULL AND status = 'published'`,
      [rid],
    )
    const allSlugs = await this.queryAll(
      `SELECT @rid as rid, slug FROM (TRAVERSE in('PART_OF') FROM $1 MAXDEPTH 10)`,
      [rid],
    )
    const slugMap = {}
    for (const n of allSlugs) {
      slugMap[String(n.rid)] = n.slug
    }
    for (const d of descendants || []) {
      const loc = pull(d)
      if (loc && d.title) {
        const ts = Array.isArray(d.typeSlug) ? d.typeSlug[0] : d.typeSlug
        const tn = Array.isArray(d.typeName) ? d.typeName[0] : d.typeName
        const ti = Array.isArray(d.typeIcon) ? d.typeIcon[0] : d.typeIcon
        const pathSlugs = (d.path || []).map(rid => slugMap[String(rid)]).filter(Boolean)
        const fullSlug = pathSlugs.join('/')
        points.push({ name: d.title, level: d.level, summary: d.summary || '', thumbnail: d.thumbnail || '', slug: d.slug || '', fullSlug, typeSlug: ts || null, typeName: tn || null, typeIcon: ti || null, ...loc })
      }
    }

    if (!center && points.length) {
      const lat = points.reduce((a, p) => a + p.lat, 0) / points.length
      const lng = points.reduce((a, p) => a + p.lng, 0) / points.length
      center = { lat, lng }
    }

    const typeSet = new Map()
    for (const p of points) {
      if (p.typeSlug && p.typeName) {
        typeSet.set(p.typeSlug, { slug: p.typeSlug, name: p.typeName })
      }
    }
    const types = Array.from(typeSet.values())

    return { points, center, types }
  }

  // ============================================================
  //  DestType: типы объектов
  // ============================================================

  async getTypes() {
    return this.queryAll(
      `SELECT @rid as rid, slug, slug_plural, name, name_plural, icon, description, priority
       FROM DestType ORDER BY priority`,
    )
  }

  async getDestType(destRid) {
    const row = await this.queryOne(
      `SELECT out('HAS_TYPE').slug AS slug, out('HAS_TYPE').name AS name,
              out('HAS_TYPE').name_plural AS name_plural, out('HAS_TYPE').icon AS icon
       FROM $1 WHERE out('HAS_TYPE').size() > 0`,
      [destRid],
    )
    if (!row) return null
    const slug = Array.isArray(row.slug) ? row.slug[0] : row.slug
    const name = Array.isArray(row.name) ? row.name[0] : row.name
    const icon = Array.isArray(row.icon) ? row.icon[0] : row.icon
    const name_plural = Array.isArray(row.name_plural) ? row.name_plural[0] : row.name_plural
    return slug ? { slug, name, name_plural, icon } : null
  }

  async setDestType(destRid, typeSlug) {
    try {
      await this.db.command('BEGIN')
      // удаляем старые HAS_TYPE рёбра
      const edges = await this.db.queryAll(
        'SELECT @rid as rid FROM HAS_TYPE WHERE out = $1',
        [destRid],
      )
      for (const e of edges || []) {
        if (e && e.rid) await this.db.command('DELETE FROM $1', [e.rid])
      }
      if (typeSlug) {
        const type = await this.queryOne(
          'SELECT @rid FROM DestType WHERE slug = $1',
          [typeSlug],
        )
        if (!type) {
          await this.db.command('ROLLBACK')
          return { done: false, error: `DestType '${typeSlug}' not found` }
        }
        await this.db.createEdge('HAS_TYPE', destRid, type['@rid'])
      }
      await this.db.command('COMMIT')
      return { done: true }
    } catch (err) {
      try { await this.db.command('ROLLBACK') } catch (_) {}
      console.log('⚡ err::setDestType => ', err)
      return { err, done: false }
    }
  }

  async getSimilarByType(destRid, limit = 8) {
    const lim = parseInt(limit, 10) || 8
    const typeRow = await this.queryOne(
      `SELECT out('HAS_TYPE').@rid AS typeRid FROM $1 WHERE out('HAS_TYPE').size() > 0`,
      [destRid],
    )
    if (!typeRow || !typeRow.typeRid) return []
    const typeRid = Array.isArray(typeRow.typeRid) ? typeRow.typeRid[0] : typeRow.typeRid
    const parentRow = await this.queryOne(
      `SELECT out('PART_OF').@rid AS p FROM $1`,
      [destRid],
    )
    const parents = (parentRow && parentRow.p) || []
    if (!parents.length) return []
    const clauses = []
    const params = [destRid, typeRid]
    for (const p of parents) {
      clauses.push(`$${params.length + 1} IN out('PART_OF')`)
      params.push(p)
    }
    // ВАЖНО: ArcadeDB PG Wire НЕ принимает параметризованные LIMIT — только инлайн
    return this.queryAll(
      `SELECT @rid as rid, slug, title, h1, level, image, priority, status, content FROM Dest
       WHERE (${clauses.join(' OR ')}) AND @rid <> $1 AND status = 'published'
         AND $2 IN out('HAS_TYPE')
       ORDER BY priority DESC LIMIT ${lim}`,
      params,
    )
  }

  async getByParentAndType(parentRid, typeSlug, limit = 50) {
    const lim = parseInt(limit, 10) || 50
    const type = await this.queryOne(
      'SELECT @rid FROM DestType WHERE slug = $1',
      [typeSlug],
    )
    if (!type) return []
    // ВАЖНО: ArcadeDB PG Wire НЕ принимает параметризованные LIMIT — только инлайн
    return this.queryAll(
      `SELECT @rid as rid, slug, title, h1, level, image, priority, description, content FROM Dest
       WHERE $1 IN out('PART_OF') AND status = 'published'
         AND $2 IN out('HAS_TYPE')
       ORDER BY priority DESC LIMIT ${lim}`,
      [parentRid, type['@rid']],
    )
  }
}

export { Model }