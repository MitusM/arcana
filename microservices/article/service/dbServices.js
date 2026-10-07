// === === === === === === === === === === === ===
// dbServices.js — соединение с ArcadeDB через Postgres Wire
// === === === === === === === === === === === ===
import { PgDB } from '../../../shared/db-pg.js'

class PDO {
  constructor(options = {}) {
    this.host = options.host || 'localhost'
    this.port = options.port || 5432
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
      // Иначе «error» на idle-клиенте уходит в process → UNHANDLED → МС падает,
      // а gateway висит на запросах к мёртвому МС (см. arcana-article-admin).
      this.db.pool.on('error', (err) => console.log('⚡ pool error => ', err))
      console.log('🙏🏻 Connected to ArcadeDB')
      return this
    } catch (err) {
      console.log('⚡ err::PDO.connect', err)
      throw err
    }
  }
}

export { PDO }