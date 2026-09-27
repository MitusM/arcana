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
      const res = await this.db.pool.query(query)
      return res.rows[0] || null
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
      const res = await this.db.pool.query(
        `CREATE EDGE ${edgeClass} FROM $1 TO $2`,
        [from, to]
      )
      return res.rows[0] || null
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

  /** Экранировать строку от SQL-инъекции для инлайна в запрос (одинарные кавычки) */
  sq(v) {
    return v == null ? "''" : `'${String(v).replace(/'/g, "\\'")}'`
  }

  getAll(limit = 10) {
    // ORDER BY created DESC
    return this.queryAll('SELECT @rid as rid, _id FROM article LIMIT ' + limit)
  }

  update(set, rid, obj) {
    return this.insert(
      'UPDATE article SET ' + set + ' UPSERT WHERE @rid =' + rid,
      { params: { ...obj } },
    )
  }

  async paginate(lowerRid, limit) {
    return this.queryAll(
      'SELECT @rid as rid,  FROM article WHERE @rid > ' +
        lowerRid +
        ' LIMIT ' +
        limit,
    )
  }

  getSettings() {
    return this.queryOne('SELECT * FROM Settings WHERE microservice="article"')
  }

  /** Сохранить настройки МС article (UPSERT по полю microservice). */
  async setSettings(obj) {
    try {
      const res = await this.db.pool.query(
        'UPDATE Settings SET settings=:settings, microservice="article", created=sysdate() UPSERT WHERE microservice="article"',
        { params: { settings: obj } },
      )
      return res.rows[0] || null
    } catch (err) {
      console.log('⚡ err::Model.setSettings', err)
      return null
    }
  }

  setCreated(table, obj, location) {
    // Безопасность: номер-место передаётся инлайном в SQL → экранируем кавычки,
    // допускаем только числа/пробел/запятую (координаты в формате "lng, lat").
    const safeLoc = String(location || '').replace(/[^0-9.,\-\s]/g, '')
    return this.insert(
      'INSERT INTO ' +
        table +
        ' SET title=:title, country=:country, country_id=:country_id,img_upload=:img_upload, created=sysdate(), id=:id, content=:content, description=:description, url=:url, keyword=:keyword, searchable=:searchable, tags=:tags, config=:config, image=:image, main=:main, location=geo.geomFromText("POINT(' +
        safeLoc +
        ')")',
      { params: { ...obj } },
    )
  }

  // Допустимые значения для /article/validate (белый список классов и полей).
  // Защита от SQL-инъекции: table/params приходят из body напрямую.
  static SELECT_TABLES = ['Country', 'Territorial', 'City', 'article']

  select(table, params, value) {
    // --- белый список таблиц ---
    const tables = Model.SELECT_TABLES
    if (!tables.includes(table)) {
      throw new Error('select: недопустимая таблица ' + table)
    }
    // --- белый список полей (разрешаем печатаймые идентификаторы + точку для вложенных) ---
    if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(params)) {
      throw new Error('select: недопустимое поле ' + params)
    }
    // --- экранируем значение (double-quote для строкового литерала OrientSQL) ---
    const safeValue = String(value == null ? '' : value).replace(/"/g, '\\"')
    return this.queryAll(
      `SELECT ${params} FROM ${table} WHERE ${params} = "${safeValue}"`,
    )
  }
}

export { Model }
