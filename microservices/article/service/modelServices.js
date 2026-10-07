// === === === === === === === === === === === ===
// modelServices.js — слой доступа к ArcadeDB (МС article, arcana)
//
// Графовая рубрикация (см. schema.sql):
//   Rubric -HAS_CHILD->   Rubric    иерархия любой глубины
//   Rubric -HAS_ARTICLE-> Article   статья внутри рубрики
//
// Направление рёбер:
//   ребёнок -HAS_CHILD-> родитель  ⇒  out('HAS_CHILD') даёт ПРЕДКОВ (вверх),
//                                      in('HAS_CHILD')  даёт ПОТОМКОВ (вниз).
//
// ПУБЛИЧНОСТЬ: статус 'draft' (по умолчанию) не показывается на сайте и
// прячет всё своё поддерево. Аналогично destinations.
//
// НЮАНСЫ ArcadeDB PG Wire (набито на destinations/maps):
//  * RID после FROM/DELETE VERTEX не принимает параметры → инлайн через _rid()
//    с валидацией формата #N:M.
//  * LIMIT/SKIP не принимают $N → инлайн числом.
//  * TRAVERSE in('HAS_CHILD') FROM <rid> идёт ВНИЗ по дереву; out() — вверх.
// === === === === === === === === === === === ===
import { PDO } from './dbServices.js'

const STATUSES = ['draft', 'published', 'archived']

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

  /** Произвольная команда (INSERT/UPDATE/DELETE/CREATE). Успех → строки. */
  async command(query, params = []) {
    try {
      return await this.db.command(query, params)
    } catch (err) {
      console.log('⚡ err::command => ', err)
      return { err, done: false }
    }
  }

  /** Создать ребро */
  async createEdge(edgeClass, from, to) {
    try {
      return await this.db.createEdge(edgeClass, from, to)
    } catch (err) {
      console.log('⚡ err::createEdge => ', err)
      return { err, done: false }
    }
  }

  // ============================================================
  //  Утилиты
  // ============================================================

  /** Валидировать RID формата #N:M. Инлайним только такие.
   *  @throws TypeError на невалидный RID */
  _rid(rid) {
    const s = String(rid)
    if (!/^#\d+:\d+$/.test(s)) {
      throw new TypeError(`Invalid RID format: ${s}`)
    }
    return s
  }

  /** Экранировать строку для inline SQL-литерала (обратный слэш + одиночная кавычка). */
  _esc(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  }

  /** Сериализовать значение в inline SQL-литерал ArcadeDB.
   *  Нужен для MAP/LIST/EMBEDDED-полей: PG Wire НЕ принимает их параметром
   *  («declared as MAP but an incompatible type is used»), а CAST(... AS MAP)
   *  в ArcadeDB отсутствует. Скаляры идут параметрами $N, структуры — инлайном. */
  _lit(v) {
    if (v === null || v === undefined) return 'null'
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null'
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (Array.isArray(v)) return '[' + v.map((x) => this._lit(x)).join(',') + ']'
    if (typeof v === 'object') {
      return '{' + Object.keys(v).map((k) => `'${this._esc(k)}':${this._lit(v[k])}`).join(',') + '}'
    }
    return `'${this._esc(String(v))}'`
  }

  /** Обновить вершину: SET col=$1..$N (скаляры) / col=<литерал> (MAP/LIST/EMBEDDED),
   *  + updated=sysdate(). Игнорирует rid/@rid. Возвращает [setClause, values] или null. */
  _buildUpdate(data) {
    const keys = Object.keys(data).filter((k) => k !== 'rid' && k !== '@rid')
    if (!keys.length) return null
    const values = []
    const clauses = keys.map((k) => {
      const v = data[k]
      // MAP/LIST/EMBEDDED через PG Wire параметром не принимаются → инлайн-литерал
      if (v !== null && typeof v === 'object') return `${k}=${this._lit(v)}`
      values.push(v)
      return `${k}=$${values.length}`
    })
    clauses.push('updated=sysdate()')
    return [clauses.join(', '), values]
  }

  /** Удалить вершину + все её рёбра в транзакции. */
  async _deleteVertex(rid) {
    try {
      await this.db.command('BEGIN')
      await this.db.command(`DELETE EDGE FROM ${rid}`)
      await this.db.command(`DELETE EDGE TO ${rid}`)
      await this.db.command(`DELETE VERTEX ${rid}`)
      await this.db.command('COMMIT')
      return { done: true }
    } catch (err) {
      try { await this.db.command('ROLLBACK') } catch (_) { /* ignore */ }
      console.log('⚡ err::_deleteVertex => ', err)
      return { err, done: false }
    }
  }

  /** Создать вершину + ребро в одной транзакции.
   *  @param {string} vertexType 'Rubric' | 'Article'
   *  @param {string} edgeType   'HAS_CHILD' | 'HAS_ARTICLE'
   *  @param {object} data       поля INSERT
   *  @param {string} parentRid  RID родителя ($1)
   *  @returns {Promise<{done:boolean,message?:*,rid?:string,err?:*}>} */
  async _createWithEdge(vertexType, edgeType, data, parentRid) {
    const cols = Object.keys(data)
    if (!cols.length) return { done: false, err: new Error('No data to insert') }
    const values = []
    const setClause = cols
      .map((k) => {
        const v = data[k]
        // MAP/LIST/EMBEDDED через PG Wire параметром не принимаются → инлайн-литерал
        if (v !== null && typeof v === 'object') return `${k}=${this._lit(v)}`
        values.push(v)
        return `${k}=$${values.length}`
      })
      .join(', ')
    const sql = `INSERT INTO ${vertexType} SET ${setClause}, created=sysdate(), updated=sysdate()`

    try {
      await this.db.command('BEGIN')
      const res = await this.db.command(sql, values)
      const newRid = res[0]?.rid || res[0]?.['@rid']
      if (!newRid) {
        await this.db.command('ROLLBACK')
        return { done: false, err: new Error('Cannot get RID of new vertex') }
      }
      await this.db.createEdge(edgeType, newRid, parentRid)
      await this.db.command('COMMIT')
      return { done: true, message: res, rid: newRid }
    } catch (err) {
      try { await this.db.command('ROLLBACK') } catch (_) { /* ignore */ }
      console.log(`⚡ err::_createWithEdge(${vertexType}) => `, err)
      return { err, done: false }
    }
  }

  /** Множество СКРЫТЫХ RID: draft/archived рубрики + всё их поддерево.
   *  Потомок достижим только через видимого предка, поэтому черновик прячет
   *  всё, что под ним. */
  async getClosedRids() {
    const rows = await this.queryAll(
      `SELECT @rid as rid FROM (
         TRAVERSE in('HAS_CHILD') FROM (SELECT FROM Rubric WHERE status <> 'published')
       )`,
    )
    const set = new Set()
    for (const r of rows || []) set.add(String(r.rid))
    return set
  }

  // ============================================================
  //  Rubric (рубрика)
  // ============================================================

  /** Корневые рубрики (без родителя). Только опубликованные. */
  async getRubricsRoot() {
    return this.queryAll(
      `SELECT @rid as rid, title, h1, url, description, content, image, sortOrder, status
       FROM Rubric
       WHERE out('HAS_CHILD').size() = 0 AND status = 'published'
       ORDER BY sortOrder ASC, title ASC`,
    )
  }

  /** Корневые рубрики (админ) — все статусы. */
  async getRubricsRootAdmin() {
    return this.queryAll(
      `SELECT @rid as rid, title, h1, url, description, image, sortOrder, status
       FROM Rubric WHERE out('HAS_CHILD').size() = 0 ORDER BY sortOrder ASC, title ASC`,
    )
  }

  /** Рубрика по RID. */
  async getRubric(rid) {
    return this.queryOne(`SELECT *, @rid as rid FROM ${this._rid(rid)}`)
  }

  /** Дети рубрики. Опционально только опубликованные. */
  async getRubricChildren(parentRid, { publishedOnly = true } = {}) {
    const statusClause = publishedOnly ? " AND status = 'published'" : ''
    return this.queryAll(
      `SELECT @rid as rid, title, h1, url, description, content, image, sortOrder, status
       FROM Rubric
       WHERE ${this._rid(parentRid)} IN out('HAS_CHILD')${statusClause}
       ORDER BY sortOrder ASC, title ASC`,
    )
  }

  /** Цепочка предков рубрики (вверх). [текущая, родитель, ..., корень]. */
  async parentsChain(rid) {
    return this.queryAll(
      `SELECT @rid as rid, title, url FROM (
         TRAVERSE out('HAS_CHILD') FROM ${this._rid(rid)}
       )`,
    )
  }

  /** Рубрика по полному пути slug'ов от корня. Только если вся ветка published. */
  async getRubricByPath(slugs) {
    if (!slugs || !slugs.length) return null
    const rootSlug = String(slugs[0]).replace(/'/g, "\\'")
    let current = await this.queryOne(
      `SELECT *, @rid as rid FROM Rubric
       WHERE url = '${rootSlug}' AND out('HAS_CHILD').size() = 0 AND status = 'published'`,
    )
    if (!current) return null
    for (let i = 1; i < slugs.length; i++) {
      const rid = current['@rid']
      const slug = String(slugs[i]).replace(/'/g, "\\'")
      current = await this.queryOne(
        `SELECT *, @rid as rid FROM Rubric
         WHERE url = '${slug}' AND ${this._rid(rid)} IN out('HAS_CHILD') AND status = 'published'`,
      )
      if (!current) return null
    }
    return current
  }

  /** Всё дерево рубрик (админ). Возвращает [{rid, url, title, status, path}].
   *  path — полный путь slug'ов от корня (для UI/селекта родителя). */
  async getRubricTree() {
    const rows = await this.queryAll(
      `SELECT @rid as rid, url, title, h1, status, sortOrder, $path AS path FROM (
         TRAVERSE in('HAS_CHILD') FROM (SELECT FROM Rubric WHERE out('HAS_CHILD').size() = 0)
       )`,
    )
    const slugMap = await this._slugMapRubrics()
    return (rows || []).map((r) => ({
      rid: String(r.rid),
      url: r.url,
      title: r.title,
      h1: r.h1,
      status: r.status || 'draft',
      sortOrder: r.sortOrder,
      path: (r.path || []).map((rid) => slugMap[String(rid)]).filter(Boolean).join('/'),
    }))
  }

  /** Карта rid→url по всем рубрикам (для сборки путей). */
  async _slugMapRubrics() {
    const all = await this.queryAll(`SELECT @rid as rid, url FROM Rubric`)
    const map = {}
    for (const n of all || []) {
      const key = String(n.rid)
      map[key] = n.url
      const m = key.match(/#\d+:\d+/)
      if (m) map[m[0]] = n.url
    }
    return map
  }

  /** Создать рубрику. parentRid опционален (null → корень, без ребра). */
  async createRubric(data, parentRid) {
    if (!parentRid) {
      // корневая рубрика: вершина без входящего ребра
      const cols = Object.keys(data)
      if (!cols.length) return { done: false, err: new Error('No data to insert') }
      const sql = `INSERT INTO Rubric SET ${cols
        .map((k, i) => `${k}=$${i + 1}`)
        .join(', ')}, created=sysdate(), updated=sysdate()`
      const values = cols.map((k) => data[k])
      try {
        const res = await this.command(sql, values)
        const newRid = Array.isArray(res) ? (res[0]?.rid || res[0]?.['@rid']) : null
        if (!newRid) return { done: false, err: new Error('Cannot get RID of new rubric') }
        return { done: true, message: res, rid: newRid }
      } catch (err) {
        console.log('⚡ err::createRubric(root) => ', err)
        return { err, done: false }
      }
    }
    return this._createWithEdge('Rubric', 'HAS_CHILD', data, this._rid(parentRid))
  }

  async updateRubric(rid, data) {
    const built = this._buildUpdate(data)
    if (!built) return null
    const [setClause, values] = built
    return this.command(`UPDATE ${this._rid(rid)} SET ${setClause}`, values)
  }

  async setRubricStatus(rid, status) {
    const st = STATUSES.includes(status) ? status : 'draft'
    return this.command(
      `UPDATE ${this._rid(rid)} SET status=$1, updated=sysdate()`,
      [st],
    )
  }

  async publishRubric(rid) { return this.setRubricStatus(rid, 'published') }
  async unpublishRubric(rid) { return this.setRubricStatus(rid, 'draft') }

  /** Удалить рубрику со всем поддеревом (рубрики + статьи) в транзакции. */
  async deleteRubric(rid) {
    const r = this._rid(rid)
    try {
      await this.db.command('BEGIN')
      // все потомки (включая саму рубрику)
      const rubrics = await this.db.queryAll(
        `SELECT @rid as rid FROM (TRAVERSE in('HAS_CHILD') FROM ${r})`,
      )
      const rubricRids = (rubrics || []).map((x) => String(x.rid))
      for (const rr of rubricRids) {
        const articles = await this.db.queryAll(
          `SELECT @rid as rid FROM Article WHERE ${rr} IN out('HAS_ARTICLE')`,
        )
        for (const a of articles || []) {
          const ar = this._rid(a.rid)
          await this.db.command(`DELETE EDGE FROM ${ar}`)
          await this.db.command(`DELETE EDGE TO ${ar}`)
          await this.db.command(`DELETE VERTEX ${ar}`)
        }
      }
      for (const rr of rubricRids) {
        await this.db.command(`DELETE EDGE FROM ${rr}`)
        await this.db.command(`DELETE EDGE TO ${rr}`)
        await this.db.command(`DELETE VERTEX ${rr}`)
      }
      await this.db.command('COMMIT')
      return { done: true }
    } catch (err) {
      try { await this.db.command('ROLLBACK') } catch (_) { /* ignore */ }
      console.log('⚡ err::deleteRubric => ', err)
      return { err, done: false }
    }
  }

  /** Уникальность slug рубрики внутри родителя. */
  async rubricSlugExists(url, parentRid, excludeRid) {
    const s = String(url).replace(/'/g, "\\'")
    const exc = excludeRid ? ` AND @rid <> ${this._rid(excludeRid)}` : ''
    if (parentRid) {
      const r = await this.queryOne(
        `SELECT @rid FROM Rubric WHERE url = '${s}' AND ${this._rid(parentRid)} IN out('HAS_CHILD')${exc}`,
      )
      return !!r
    }
    const r = await this.queryOne(
      `SELECT @rid FROM Rubric WHERE url = '${s}' AND out('HAS_CHILD').size() = 0${exc}`,
    )
    return !!r
  }

  // ============================================================
  //  Article (статья)
  // ============================================================

  /** Статьи рубрики с пагинацией. */
  async getArticlesByRubric(rubricRid, { publishedOnly = true, limit = 20, offset = 0 } = {}) {
    const r = this._rid(rubricRid)
    const statusClause = publishedOnly ? " AND status = 'published'" : ''
    const lim = parseInt(limit, 10) || 20
    const off = parseInt(offset, 10) || 0
    return this.queryAll(
      `SELECT @rid as rid, title, h1, url, description, image, keyword, author, sortOrder, status, created
       FROM Article
       WHERE ${r} IN out('HAS_ARTICLE')${statusClause}
       ORDER BY sortOrder ASC, created DESC SKIP ${off} LIMIT ${lim}`,
    )
  }

  /** Счётчик статей рубрики (для пагинации). */
  async countByRubric(rubricRid, { publishedOnly = true } = {}) {
    const r = this._rid(rubricRid)
    const statusClause = publishedOnly ? " AND status = 'published'" : ''
    const row = await this.queryOne(
      `SELECT COUNT(*) as c FROM (
         SELECT FROM Article WHERE ${r} IN out('HAS_ARTICLE')${statusClause}
       )`,
    )
    return row ? Number(row.c) || 0 : 0
  }

  /** Статья по RID. */
  async getArticle(rid) {
    return this.queryOne(`SELECT *, @rid as rid FROM ${this._rid(rid)}`)
  }

  /** Статья по slug внутри рубрики (публичная — только published). */
  async getArticleBySlug(rubricRid, url, { publishedOnly = true } = {}) {
    const r = this._rid(rubricRid)
    const s = String(url).replace(/'/g, "\\'")
    const statusClause = publishedOnly ? " AND status = 'published'" : ''
    return this.queryOne(
      `SELECT *, @rid as rid FROM Article
       WHERE url = '${s}' AND ${r} IN out('HAS_ARTICLE')${statusClause}`,
    )
  }

  /** Похожие статьи: другие статьи той же рубрики. */
  async getRelatedArticles(rubricRid, excludeRid, limit = 6) {
    const r = this._rid(rubricRid)
    const lim = parseInt(limit, 10) || 6
    const exc = excludeRid ? ` AND @rid <> ${this._rid(excludeRid)}` : ''
    return this.queryAll(
      `SELECT @rid as rid, title, url, description, image
       FROM Article
       WHERE ${r} IN out('HAS_ARTICLE') AND status = 'published'${exc}
       ORDER BY sortOrder ASC, created DESC LIMIT ${lim}`,
    )
  }

  /** Создать статью в рубрике. */
  async createArticle(data, rubricRid) {
    return this._createWithEdge('Article', 'HAS_ARTICLE', data, this._rid(rubricRid))
  }

  async updateArticle(rid, data) {
    const built = this._buildUpdate(data)
    if (!built) return null
    const [setClause, values] = built
    return this.command(`UPDATE ${this._rid(rid)} SET ${setClause}`, values)
  }

  async setArticleStatus(rid, status) {
    const st = STATUSES.includes(status) ? status : 'draft'
    const published = st === 'published'
    return this.command(
      `UPDATE ${this._rid(rid)} SET status=$1, published=$2, updated=sysdate()`,
      [st, published],
    )
  }

  async publishArticle(rid) { return this.setArticleStatus(rid, 'published') }
  async unpublishArticle(rid) { return this.setArticleStatus(rid, 'draft') }

  async deleteArticle(rid) {
    return this._deleteVertex(this._rid(rid))
  }

  /** Глобальный поиск рубрик и статей (админ). Возвращает {rubrics, articles}. */
  async searchArticles(q, limit = 30) {
    const s = String(q).replace(/'/g, "\\'").toLowerCase()
    const like = `%${s}%`
    const lim = parseInt(limit, 10) || 30
    const rubrics = await this.queryAll(
      `SELECT @rid as rid, url, title, 'rubric' as kind FROM Rubric
       WHERE url LIKE '${like}' OR title LIKE '${like}' LIMIT ${lim}`,
    )
    const articles = await this.queryAll(
      `SELECT @rid as rid, url, title, 'article' as kind FROM Article
       WHERE url LIKE '${like}' OR title LIKE '${like}' LIMIT ${lim}`,
    )
    return { rubrics: rubrics || [], articles: articles || [] }
  }

  // ============================================================
  //  Перемещение и порядок (админ)
  // ============================================================

  /** Является ли `maybeDescRid` потомком `rid` (защита от циклов при move).
   *  Идём от кандидата ВВЕРХ по out('HAS_CHILD'); если встретили rid — он потомок. */
  async isDescendant(rid, maybeDescRid) {
    if (!rid || !maybeDescRid) return false
    if (String(rid) === String(maybeDescRid)) return true
    const rows = await this.queryAll(
      `SELECT @rid as rid FROM (
         TRAVERSE out('HAS_CHILD') FROM ${this._rid(maybeDescRid)}
       ) WHERE @rid = ${this._rid(rid)}`,
    )
    return (rows || []).length > 0
  }

  /** Сменить родителя рубрики. newParentRid=null → сделать корневой.
   *  Защита от циклов — на уровне контроллера (isDescendant). */
  async moveRubric(rid, newParentRid) {
    const r = this._rid(rid)
    try {
      await this.db.command('BEGIN')
      // удалить текущее ребро вверх: SELECT @rid FROM HAS_CHILD WHERE out = r → DELETE FROM <edgeRid>
      const edges = await this.db.queryAll(
        `SELECT @rid as rid FROM HAS_CHILD WHERE out = ${r}`,
      )
      for (const e of edges || []) {
        if (e && e.rid) await this.db.command(`DELETE FROM ${e.rid}`)
      }
      if (newParentRid) {
        await this.db.createEdge('HAS_CHILD', r, this._rid(newParentRid))
      }
      await this.db.command('COMMIT')
      return { done: true }
    } catch (err) {
      try { await this.db.command('ROLLBACK') } catch (_) { /* ignore */ }
      console.log('⚡ err::moveRubric => ', err)
      return { err, done: false }
    }
  }

  /** Перенести статью в другую рубрику (ребро HAS_ARTICLE). */
  async moveArticle(rid, newRubricRid) {
    const r = this._rid(rid)
    try {
      await this.db.command('BEGIN')
      const edges = await this.db.queryAll(
        `SELECT @rid as rid FROM HAS_ARTICLE WHERE out = ${r}`,
      )
      for (const e of edges || []) {
        if (e && e.rid) await this.db.command(`DELETE FROM ${e.rid}`)
      }
      await this.db.createEdge('HAS_ARTICLE', r, this._rid(newRubricRid))
      await this.db.command('COMMIT')
      return { done: true }
    } catch (err) {
      try { await this.db.command('ROLLBACK') } catch (_) { /* ignore */ }
      console.log('⚡ err::moveArticle => ', err)
      return { err, done: false }
    }
  }

  /** Переписать порядок соседей. orderedRids — сверху вниз; sortOrder = индекс. */
  async reorder(kind, orderedRids) {
    if (!Array.isArray(orderedRids) || !orderedRids.length) return { done: true, updated: 0 }
    try {
      await this.db.command('BEGIN')
      for (let i = 0; i < orderedRids.length; i++) {
        const r = this._rid(orderedRids[i])
        await this.db.command(`UPDATE ${r} SET sortOrder = $1`, [i])
      }
      await this.db.command('COMMIT')
      return { done: true, updated: orderedRids.length }
    } catch (err) {
      try { await this.db.command('ROLLBACK') } catch (_) { /* ignore */ }
      console.log('⚡ err::reorder => ', err)
      return { err, done: false }
    }
  }

  /** Счётчик подрубрик узла. */
  async countChildrenRubrics(rubricRid) {
    const row = await this.queryOne(
      `SELECT COUNT(*) as c FROM (
         SELECT FROM Rubric WHERE ${this._rid(rubricRid)} IN out('HAS_CHILD')
       )`,
    )
    return row ? Number(row.c) || 0 : 0
  }

  /** Счётчик статей рубрики. */
  async countArticlesInRubric(rubricRid) {
    const row = await this.queryOne(
      `SELECT COUNT(*) as c FROM (
         SELECT FROM Article WHERE ${this._rid(rubricRid)} IN out('HAS_ARTICLE')
       )`,
    )
    return row ? Number(row.c) || 0 : 0
  }

  /** Дерево рубрик со счётчиками (админ). */
  async getRubricTreeWithCounts() {
    const tree = await this.getRubricTree()
    for (const n of tree) {
      n.childCount = await this.countChildrenRubrics(n.rid)
      n.articleCount = await this.countArticlesInRubric(n.rid)
    }
    return tree
  }

  /** Sitemap: все опубликованные рубрики и статьи с полным путём.
   *  Возвращает [{kind, url(path), title, status, priority}]. */
  async getSitemapTree() {
    const closed = await this.getClosedRids()
    const slugMap = await this._slugMapRubrics()

    const rubrics = await this.queryAll(
      `SELECT @rid as rid, url, title, status, sortOrder, $path AS path FROM (
         TRAVERSE in('HAS_CHILD') FROM (SELECT FROM Rubric WHERE out('HAS_CHILD').size() = 0)
       )`,
    )
    const out = []
    for (const r of rubrics || []) {
      if (closed.has(String(r.rid))) continue
      const path = (r.path || []).map((rid) => slugMap[String(rid)]).filter(Boolean).join('/')
      if (!path) continue
      out.push({ kind: 'rubric', rid: String(r.rid), url: path, title: r.title, status: r.status })
    }

    const articles = await this.queryAll(
      `SELECT @rid as rid, url, title, status FROM Article WHERE status = 'published'`,
    )
    for (const a of articles || []) {
      if (closed.has(String(a.rid))) continue
      // рубрика статьи (in-ребро HAS_ARTICLE): берём первую опубликованную рубрику
      const row = await this.queryOne(
        `SELECT out('HAS_ARTICLE').@rid AS parents FROM ${this._rid(a.rid)}`,
      )
      const parents = (row && row.parents) || []
      const list = Array.isArray(parents) ? parents : [parents]
      let rubricPath = ''
      for (const p of list) {
        if (closed.has(String(p))) continue
        // путь рубрики собираем через цепочку предков (out('HAS_CHILD'))
        const chain = await this.parentsChain(p)
        const slugs = (chain || []).map((c) => c.url).reverse().filter(Boolean)
        if (slugs.length) { rubricPath = slugs.join('/'); break }
      }
      if (!rubricPath) continue
      out.push({ kind: 'article', rid: String(a.rid), url: `${rubricPath}/${a.url}`, title: a.title, status: a.status })
    }
    return out
  }
}

export { Model, STATUSES }
