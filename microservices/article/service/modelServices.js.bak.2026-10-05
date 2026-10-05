// === === === === === === === === === === === ===
// modelServices.js — слой доступа к ArcadeDB (article MC)
// Исправлено: все RID параметризованы ($1), транзакции создания,
//             дублирование кода вынесено в общие методы.
// === === === === === === === === === === === ===

import { PDO } from './dbServices.js'

class Model extends PDO {
  constructor(options) {
    super(options)
  }

  // ============================================================
  //  Примитивы (базовые операции)
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

  /** Выполнить INSERT, вернуть { done, message, err } */
  async insert(query, params) {
    try {
      const res = await this.db.command(query, params)
      return { message: res, type: 'insert', done: true }
    } catch (err) {
      console.log('⚡ err::insert => ', err)
      return { err: err, done: false }
    }
  }

  /** Создать ребро */
  async createEdge(edgeClass, from, to) {
    try {
      return await this.db.createEdge(edgeClass, from, to)
    } catch (err) {
      console.log('⚡ err::createEdge => ', err)
      return { err: err, done: false }
    }
  }

  /** Выполнить произвольную команду (UPDATE/DELETE/CREATE) */
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

  /** Построить SET-часть UPDATE и массив значений для $1..$N.
   *  Поле rid/@rid пропускаются. updated=sysdate() добавляется автоматически.
   *  Возвращает [setClause, values] или null если данных нет.
   */
  _buildUpdate(data) {
    const keys = Object.keys(data).filter(k => k !== 'rid' && k !== '@rid')
    if (!keys.length) return null
    const clauses = keys.map((k, i) => `${k}=$${i + 1}`)
    clauses.push('updated=sysdate()')
    const values = keys.map(k => data[k])
    return [clauses.join(', '), values]
  }

  /** Удалить вершину вместе со всеми входящими/исходящими рёбрами.
   *  Оборачивается в BEGIN/COMMIT — чтобы не было частичного удаления.
   *  @param {string} rid — RID вершины ($1)
   *  @returns {Promise<{done: boolean, err?: *}>}
   */
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

  /** Создать вершину + ребро в одной транзакции.
   *  @param {string} vertexType — 'Subsection' | 'Article'
   *  @param {string} edgeType   — 'HAS_SUBSECTION' | 'HAS_ARTICLE'
   *  @param {object} data       — поля для INSERT
   *  @param {string} parentRid  — RID родителя ($1)
   *  @returns {Promise<{done: boolean, message?: *, rid?: string, err?: *}>}
   */
  async _createWithEdge(vertexType, edgeType, data, parentRid) {
    const cols = Object.keys(data)
    if (!cols.length) {
      return { done: false, err: new Error('No data to insert') }
    }
    const sql = `INSERT INTO ${vertexType} SET ${cols.map((k, i) => `${k}=$${i + 1}`).join(', ')}, created=sysdate(), updated=sysdate()`
    const values = cols.map(k => data[k])

    try {
      await this.db.command('BEGIN')
      const res = await this.db.command(sql, values)
      const newRid = res[0]?.rid || res[0]?.['@rid']
      if (!newRid) {
        await this.db.command('ROLLBACK')
        return { done: false, err: new Error('Cannot get RID of new vertex') }
      }
      await this.db.createEdge(edgeType, parentRid, newRid)
      await this.db.command('COMMIT')
      return { done: true, message: res, rid: newRid }
    } catch (err) {
      try { await this.db.command('ROLLBACK') } catch (_) { /* ignore */ }
      console.log(`⚡ err::_createWithEdge(${vertexType}) => `, err)
      return { err, done: false }
    }
  }

  // ============================================================
  //  Section (раздел)
  // ============================================================

  async getSections() {
    return this.queryAll('SELECT *, @rid as rid FROM Section ORDER BY sortOrder ASC')
  }

  async getSection(rid) {
    return this.queryOne('SELECT *, @rid as rid FROM $1', [rid])
  }

  async createSection(data) {
    return this.insert(
      'INSERT INTO Section SET title=:title, description=:description, url=:url, sortOrder=:sortOrder, image=:image, created=sysdate(), updated=sysdate()',
      { params: { ...data } },
    )
  }

  async updateSection(rid, data) {
    const built = this._buildUpdate(data)
    if (!built) return null
    const [setClause, values] = built
    return this.command(`UPDATE $1 SET ${setClause}`, [rid, ...values])
  }

  async deleteSection(rid) {
    return this._deleteVertex(rid)
  }

  // ============================================================
  //  Subsection (подраздел)
  // ============================================================

  async getSubsections(parentRid) {
    return this.queryAll(
      'SELECT *, @rid as rid FROM Subsection WHERE in(\'HAS_SUBSECTION\') = $1 ORDER BY sortOrder ASC',
      [parentRid],
    )
  }

  async getSubsection(rid) {
    return this.queryOne('SELECT *, @rid as rid FROM $1', [rid])
  }

  async createSubsection(data, parentRid) {
    return this._createWithEdge('Subsection', 'HAS_SUBSECTION', data, parentRid)
  }

  async updateSubsection(rid, data) {
    const built = this._buildUpdate(data)
    if (!built) return null
    const [setClause, values] = built
    return this.command(`UPDATE $1 SET ${setClause}`, [rid, ...values])
  }

  async deleteSubsection(rid) {
    // Сначала удаляем статьи этого подраздела (в той же транзакции)
    try {
      await this.db.command('BEGIN')
      const articles = await this.db.queryAll(
        'SELECT @rid as rid FROM Article WHERE in(\'HAS_ARTICLE\') = $1',
        [rid],
      )
      for (const a of articles || []) {
        if (a.rid) {
          await this.db.command('DELETE EDGE FROM $1', [a.rid])
          await this.db.command('DELETE EDGE TO $1', [a.rid])
          await this.db.command('DELETE VERTEX $1', [a.rid])
        }
      }
      await this.db.command('DELETE EDGE FROM $1', [rid])
      await this.db.command('DELETE EDGE TO $1', [rid])
      await this.db.command('DELETE VERTEX $1', [rid])
      await this.db.command('COMMIT')
      return { done: true }
    } catch (err) {
      try { await this.db.command('ROLLBACK') } catch (_) { /* ignore */ }
      console.log('⚡ err::deleteSubsection => ', err)
      return { err, done: false }
    }
  }

  // ============================================================
  //  Article (статья)
  // ============================================================

  async getArticles(parentRid) {
    return this.queryAll(
      'SELECT *, @rid as rid FROM Article WHERE in(\'HAS_ARTICLE\') = $1 ORDER BY sortOrder ASC, created DESC',
      [parentRid],
    )
  }

  async getArticle(rid) {
    return this.queryOne('SELECT *, @rid as rid FROM $1', [rid])
  }

  async createArticle(data, parentRid) {
    return this._createWithEdge('Article', 'HAS_ARTICLE', data, parentRid)
  }

  async updateArticle(rid, data) {
    const built = this._buildUpdate(data)
    if (!built) return null
    const [setClause, values] = built
    return this.command(`UPDATE $1 SET ${setClause}`, [rid, ...values])
  }

  async publishArticle(rid) {
    return this.command('UPDATE $1 SET published=true, updated=sysdate()', [rid])
  }

  async unpublishArticle(rid) {
    return this.command('UPDATE $1 SET published=false, updated=sysdate()', [rid])
  }

  async deleteArticle(rid) {
    return this._deleteVertex(rid)
  }
}

export { Model }