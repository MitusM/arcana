// === === === === === === === === === === === ===
//
// === === === === === === === === === === === ===

import { PDO } from './dbServices.js'

class Model extends PDO {
  constructor(options) {
    super(options)
  }

  async queryAll(query, params) {
    try {
      return await this.db.queryAll(query, params)
    } catch (err) {
      console.log('⚡ err::queryAll => ', err)
      process.exit()
    }
  }

  async queryOne(query, params) {
    try {
      return await this.db.queryOne(query, params)
    } catch (err) {
      console.log('⚡ err::queryOne => ', err)
      process.exit()
    }
  }

  async queryRid(query) {
    try {
      return await this.db.queryOne(query)
    } catch (err) {
      return err
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

  async create(edgeClass, from, to) {
    try {
      return await this.db.createEdge(edgeClass, from, to)
    } catch (err) {
      console.log('⚡ err::create => ', err)
      process.exit()
    }
  }

  async command(query, params = []) {
    try {
      return await this.db.command(query, params)
    } catch (err) {
      console.log('⚡ err::command => ', err)
      return err
    }
  }

  // ============================================================
  //  Section / Subsection / Article — методы админки
  // ============================================================

  // ---------- Разделы (Section) ----------

  /** Все разделы, сортированные по sortOrder */
  async getSections() {
    return this.queryAll('SELECT *, @rid as rid FROM Section ORDER BY sortOrder ASC')
  }

  /** Один раздел по RID */
  async getSection(rid) {
    return this.queryOne(`SELECT *, @rid as rid FROM ${rid}`)
  }

  /** Создать раздел */
  async createSection(data) {
    return this.insert(
      'INSERT INTO Section SET title=:title, description=:description, url=:url, sortOrder=:sortOrder, image=:image, created=sysdate(), updated=sysdate()',
      { params: { ...data } },
    )
  }

  /** Обновить раздел */
  async updateSection(rid, data) {
    const sets = []
    const p = {}
    for (const [k, v] of Object.entries(data)) {
      sets.push(`${k}=:${k}`)
      p[k] = v
    }
    if (!sets.length) return null
    sets.push('updated=sysdate()')
    return this.command(
      `UPDATE ${rid} SET ${sets.join(', ')}`,
      { params: p },
    )
  }

  /** Удалить раздел (и все рёбра к подразделам) */
  async deleteSection(rid) {
    // Удалить входящие/исходящие рёбра
    await this.command(`DELETE EDGE FROM ${rid}`)
    await this.command(`DELETE EDGE TO ${rid}`)
    return this.command(`DELETE VERTEX ${rid}`)
  }

  // ---------- Подразделы (Subsection) ----------

  /** Подразделы внутри одного родителя (Section или Subsection) */
  async getSubsections(parentRid) {
    return this.queryAll(
      `SELECT *, @rid as rid FROM Subsection WHERE in('HAS_SUBSECTION') = ${parentRid} ORDER BY sortOrder ASC`,
    )
  }

  /** Один подраздел по RID */
  async getSubsection(rid) {
    return this.queryOne(`SELECT *, @rid as rid FROM ${rid}`)
  }

  /** Создать подраздел и привязать к родителю */
  async createSubsection(data, parentRid) {
    const result = await this.insert(
      'INSERT INTO Subsection SET title=:title, description=:description, url=:url, sortOrder=:sortOrder, image=:image, created=sysdate(), updated=sysdate()',
      { params: { ...data } },
    )
    if (!result.done || !result.message || !result.message.length) {
      return result
    }
    const newRid = result.message[0].rid || result.message[0]['@rid']
    if (newRid) {
      await this.create('HAS_SUBSECTION', parentRid, newRid)
    }
    return result
  }

  /** Обновить подраздел */
  async updateSubsection(rid, data) {
    const sets = []
    const p = {}
    for (const [k, v] of Object.entries(data)) {
      sets.push(`${k}=:${k}`)
      p[k] = v
    }
    if (!sets.length) return null
    sets.push('updated=sysdate()')
    return this.command(
      `UPDATE ${rid} SET ${sets.join(', ')}`,
      { params: p },
    )
  }

  /** Удалить подраздел (и все рёбра, и дочерние объекты) */
  async deleteSubsection(rid) {
    // Удалить статьи, привязанные к этому подразделу
    const articles = await this.queryAll(
      `SELECT @rid as rid FROM Article WHERE in('HAS_ARTICLE') = ${rid}`,
    )
    for (const a of articles || []) {
      if (a.rid) await this.command(`DELETE VERTEX ${a.rid}`)
    }
    // Удалить дочерние подразделы (рекурсивно не идём — пользователь
    // должен сначала очистить вложенные подразделы)
    await this.command(`DELETE EDGE FROM ${rid}`)
    await this.command(`DELETE EDGE TO ${rid}`)
    return this.command(`DELETE VERTEX ${rid}`)
  }

  // ---------- Статьи (Article) ----------

  /** Статьи внутри подраздела */
  async getArticles(parentRid) {
    return this.queryAll(
      `SELECT *, @rid as rid FROM Article WHERE in('HAS_ARTICLE') = ${parentRid} ORDER BY sortOrder ASC, created DESC`,
    )
  }

  /** Одна статья по RID */
  async getArticle(rid) {
    return this.queryOne(`SELECT *, @rid as rid FROM ${rid}`)
  }

  /** Создать статью (published = false по умолчанию) и привязать к подразделу */
  async createArticle(data, parentRid) {
    const result = await this.insert(
      'INSERT INTO Article SET title=:title, description=:description, url=:url, content=:content, tags=:tags, image=:image, keyword=:keyword, searchable=:searchable, config=:config, author=:author, sortOrder=:sortOrder, published=false, created=sysdate(), updated=sysdate()',
      { params: { ...data } },
    )
    if (!result.done || !result.message || !result.message.length) {
      return result
    }
    const newRid = result.message[0].rid || result.message[0]['@rid']
    if (newRid) {
      await this.create('HAS_ARTICLE', parentRid, newRid)
    }
    return result
  }

  /** Обновить статью */
  async updateArticle(rid, data) {
    const sets = []
    const p = {}
    for (const [k, v] of Object.entries(data)) {
      if (k === 'rid' || k === '@rid') continue
      sets.push(`${k}=:${k}`)
      p[k] = v
    }
    if (!sets.length) return null
    sets.push('updated=sysdate()')
    return this.command(
      `UPDATE ${rid} SET ${sets.join(', ')}`,
      { params: p },
    )
  }

  /** Опубликовать статью */
  async publishArticle(rid) {
    return this.command(
      `UPDATE ${rid} SET published=true, updated=sysdate()`,
    )
  }

  /** Снять с публикации */
  async unpublishArticle(rid) {
    return this.command(
      `UPDATE ${rid} SET published=false, updated=sysdate()`,
    )
  }

  /** Удалить статью */
  async deleteArticle(rid) {
    await this.command(`DELETE EDGE FROM ${rid}`)
    await this.command(`DELETE EDGE TO ${rid}`)
    return this.command(`DELETE VERTEX ${rid}`)
  }


}

export { Model }
