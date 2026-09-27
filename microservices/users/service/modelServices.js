// === === === === === === === === === === === ===
//
// === === === === === === === === === === === ===

import { PDO } from './dbServices.js'
import Authorization from './autServices.js'

class UserModel extends PDO {
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
      return res
    } catch (err) {
      console.log('⚡ err::insert => ', err)
      return err
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

  //username, password
  async getLogin(obj) {
    try {
      return await this.queryOne('SELECT FROM User WHERE username= :username', {
        params: {
          username: obj.username,
        },
      }).then((user) => {
        if (!user) {
          // if the user does not exist | если пользователя не существует
          return null
        } else {
          // If the login matched (the user exists) | если совпал логин (пользователь существует)
          let salt = new Authorization().hashPassword(obj.password, user.salt)
          if (user.hashedPassword === salt && user.block === false) {
            // если совпал логин, и совпадают пароли
            return user
          } else {
            // если совпал логин, но не совпадают пароли
            return false
          }
        }
      })
    } catch (err) {
      console.log('⚡ err::getLogin', err)
    }
  }

  getUserAll(limit = 10) {
    // ORDER BY created DESC
    return this.queryAll(
      'SELECT @rid as rid, _id, username, email, block, group, created, quota FROM User LIMIT ' +
        limit,
    )
  }

  /**
   * Получаем все данные о пользователе, по его логину, или @rid
   * @param {Object} user логин пользователя
   * @returns {Object}
   */
  async getUser(user) {
    try {
      let select = // , hashedPassword, salt,
        'SELECT @rid as rid, _id, username, email, block, group, created, quota FROM User WHERE '
      if (typeof user === 'Object') {
        return this.queryOne(select + 'username =: username ', {
          params: { username: user },
        })
      } else if (typeof user === 'string') {
        return this.queryRid(select + '@rid = ' + user)
      }
    } catch (err) {
      console.log('⚡ err::', err)
      return err
    }
  }

  /**
   * Получаем @rid пользователя, по его логину
   * @param {Object} user логин пользователя
   * @returns { '@rid': RecordID { cluster: integer, position: integer } }
   */
  getRid(user) {
    return this.queryOne('SELECT @rid FROM User WHERE username =: name ', {
      params: {
        name: user,
      },
    })
  }

  setCreated(obj) {
    return this.insert(
      'INSERT INTO User SET username =:username, hashedPassword =:hashedPassword, salt =:salt, email =:email, group =:group, quota =:quota, block=:block, created =sysdate(), _id =:_id',
      { params: { ...obj } },
    )
  }

  update(set, rid, obj) {
    return this.insert(
      'UPDATE User SET ' + set + ' UPSERT WHERE @rid =' + rid,
      { params: { ...obj } },
    )
  }

  async deleteUser(rid) {
    try {
      return await this.command('DELETE VERTEX User WHERE @rid = $1', [rid])
    } catch (err) {
      console.log('⚡ err::deleteUser => ', err)
      return err
    }
  }

  async paginate(lowerRid, limit) {
    return this.queryAll(
      'SELECT @rid as rid, _id, username, email, block, group, created, quota FROM User WHERE @rid > ' +
        lowerRid +
        ' LIMIT ' +
        limit,
    )
  }

  validateFields(field, value) {
    return this.queryOne(
      'SELECT ' + field + ' FROM User WHERE ' + field + " ='" + value + "'",
    )
  }

  hashPassword(password) {
    let auth = new Authorization()
    return {
      password: auth.hashPassword(password),
      salt: auth.salt,
    }
  }

  getSettings() {
    return this.queryOne('SELECT * FROM Settings WHERE microservice="users"')
  }

  /** Сохранить настройки МС users (UPSERT по полю microservice). */
  async setSettings(obj) {
    try {
      const res = await this.db.pool.query(
        'UPDATE Settings SET settings=:settings, microservice="users", created=sysdate() UPSERT WHERE microservice="users"',
        { params: { settings: obj } },
      )
      return res.rows[0] || null
    } catch (err) {
      console.log('⚡ err::Model.setSettings', err)
      return null
    }
  }
}

export { UserModel }
