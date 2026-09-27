// === === === === === === === === === === === ===
// db-pg.js — универсальная обёртка над pg для ArcadeDB (Postgres Wire)
// Все МС используют один этот класс.
//
// Поддерживает как позиционные ($1, $2), так и именованные (:param) параметры.
// Именованные params передаются как { params: { name: val } } — так исторически
// сложилось в cloudFRT (orientjs-совместимый формат).
// === === === === === === === === === === === ===
import pg from 'pg'
import crypto from 'crypto'

class PgDB {
  constructor(config = {}) {
    this.pool = new pg.Pool({
      host: config.host || 'localhost',
      port: config.port || 5432,
      user: config.username,
      password: ***,
      database: config.name || config.database,
      max: config.pool?.max || 25,
    })
  }

  /**
   * Конвертирует именованные :param в позиционные $1, $2
   * и возвращает [sql, valuesArray].
   *
   * Принимает два формата params:
   *   1) Массив — уже позиционный, пропускаем как есть
   *   2) Объект { params: { key: val } } — конвертируем :key → $N
   *   3) undefined/null — пустой массив значений
   */
  _resolveParams(sql, params) {
    if (Array.isArray(params)) return [sql, params]
    if (params && typeof params === 'object' && params.params) {
      const named = params.params
      const keys = Object.keys(named)
      if (!keys.length) return [sql, []]

      // Строим карту :name → значение, заменяем на $N
      const values = []
      const used = new Set()
      const result = sql.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, key) => {
        if (key in named) {
          if (!used.has(key)) {
            used.add(key)
            values.push(named[key])
          }
          return `$${Array.from(used).indexOf(key) + 1}`
        }
        return match // не нашлось — оставляем как есть
      })
      return [result, values]
    }
    return [sql, []]
  }

  /** Все строки результата */
  async queryAll(sql, params) {
    const [query, vals] = this._resolveParams(sql, params)
    const res = await this.pool.query(query, vals)
    return res.rows
  }

  /** Первая строка или null */
  async queryOne(sql, params) {
    const [query, vals] = this._resolveParams(sql, params)
    const res = await this.pool.query(query, vals)
    return res.rows[0] || null
  }

  /** Произвольная команда (INSERT/UPDATE/DELETE/CREATE) */
  async command(sql, params) {
    const [query, vals] = this._resolveParams(sql, params)
    const res = await this.pool.query(query, vals)
    return res.rows
  }

  /** Создать ребро (аналог session.create('EDGE', cls).from(f).to(t)) */
  async createEdge(edgeClass, fromRid, toRid) {
    const res = await this.pool.query(
      `CREATE EDGE ${edgeClass} FROM $1 TO $2`,
      [fromRid, toRid]
    )
    return res.rows[0] || null
  }

  /** Закрыть пул */
  async close() {
    await this.pool.end()
  }
}

export { PgDB }