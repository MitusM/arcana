// === === === === === === === === === === === ===
// dbServices.js — соединение с ArcadeDB через Postgres Wire для МС destinations
// === === === === === === === === === === === ===
import { PgDB } from '../../../shared/db-pg.js'

class PDO {
  constructor(options = {}) {
    this.host = options.host || 'localhost'
    this.port = options.port || 5432
  }

  // Экранировать строку для ИНЛАЙНА в SQL (оставлено для обратной совместимости,
  // но лучше использовать параметризованные запросы).
  _sqlStr(v) {
    if (v == null) return "''"
    const s = String(v)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
    return `'${s}'`
  }

  async connect(options) {
    try {
      this.db = new PgDB({
        host: options.host || 'localhost',
        port: options.port || 5432,
        username: options.username,
        password: options.password,
        name: options.name,
        database: options.database || options.name,
        pool: { max: options.pool?.max || 25 },
      })
      console.log('🙏🏻 Connected to ArcadeDB (destinations)')
      return this
    } catch (err) {
      console.log('⚡ err::PDO.connect', err)
      throw err
    }
  }
}

export { PDO }