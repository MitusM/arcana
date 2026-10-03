import path from 'path'
import pkg from 'app-root-path'
import dotenv from 'dotenv'
import { createRequire } from 'module'

import { csrfOk } from '../service/csrf.js'
import { validateSectionInput, validateSubsectionInput, validateArticleInput } from '../service/validation.js'


const require = createRequire(import.meta.url)
const appRoot = pkg.path
dotenv.config()
/**  */
const lang = require('../lang/ru')
/** */
const templateDir = path.join(appRoot, process.env.VIEW_DIR || 'view/html/')

const errorHandler = (res, message) => {
  return res.status(200).json({ message: message })
}

const endpoints = async (app) => {
  /**  */
  const db = await app.options.db

  /**  */
  app.get('/article/', async (req, res) => {
    try {
      /**  page */
      // users = await db.getAll(limit);
      const { response } = await res.app.ask('render', {
        server: {
          action: 'html',
          meta: {
            dir: templateDir, // directory article template
            page: process.env.TEMPLATE_FILE, // file template
            // data for template
            data: {
              csrf: req.session.csrfSecret,
              title: 'Dashboard | cloudFRT',
              lang: lang,
              page: './page/main-content.html',
              breadcrumb: 'article',
              number: 1,
            },
          },
        },
      })

      // page = response.html

      res.status(200).end(response.html)
    } catch (err) {
      console.log('⚡ err::/article/', err)
      return errorHandler(res, err)
    }
  })



  // ============================================================
  //  Admin: Sections (разделы)
  // ============================================================

  // --- Страница со списком разделов ---
  app.get('/article/admin/', async (req, res) => {
    try {
      const sections = await db.getSections()
      const { response } = await res.app.ask('render', {
        server: {
          action: 'html',
          meta: {
            dir: templateDir,
            page: process.env.TEMPLATE_FILE,
            data: {
              csrf: req.session.csrfSecret,
              title: 'Разделы статей | cloudFRT',
              lang: lang,
              page: './page/article/sections.html',
              breadcrumb: 'article-admin',
              sections: sections,
            },
          },
        },
      })
      res.status(200).end(response.html)
    } catch (err) {
      console.log('⚡ err::/article/admin/', err)
      errorHandler(res, err)
    }
  })

  // --- Форма создания раздела ---
  app.get('/article/admin/section/create', async (req, res) => {
    try {
      const { response } = await res.app.ask('render', {
        server: {
          action: 'html',
          meta: {
            dir: templateDir,
            page: process.env.TEMPLATE_FILE,
            data: {
              csrf: req.session.csrfSecret,
              title: 'Создать раздел | cloudFRT',
              lang: lang,
              page: './page/article/section-form.html',
              breadcrumb: 'section-create',
              section: null,
            },
          },
        },
      })
      res.status(200).end(response.html)
    } catch (err) {
      console.log('⚡ err::section/create', err)
      errorHandler(res, err)
    }
  })

  // --- Форма редактирования раздела ---
  app.get('/article/admin/section/:rid/edit', async (req, res) => {
    try {
      const section = await db.getSection(req.params.rid)
      const { response } = await res.app.ask('render', {
        server: {
          action: 'html',
          meta: {
            dir: templateDir,
            page: process.env.TEMPLATE_FILE,
            data: {
              csrf: req.session.csrfSecret,
              title: 'Редактировать раздел | cloudFRT',
              lang: lang,
              page: './page/article/section-form.html',
              breadcrumb: 'section-edit',
              section: section,
            },
          },
        },
      })
      res.status(200).end(response.html)
    } catch (err) {
      console.log('⚡ err::section/edit', err)
      errorHandler(res, err)
    }
  })

  // --- Подразделы внутри раздела ---
  app.get('/article/admin/section/:rid', async (req, res) => {
    try {
      const section = await db.getSection(req.params.rid)
      const subs = await db.getSubsections(req.params.rid)
      const { response } = await res.app.ask('render', {
        server: {
          action: 'html',
          meta: {
            dir: templateDir,
            page: process.env.TEMPLATE_FILE,
            data: {
              csrf: req.session.csrfSecret,
              title: section?.title?.ru || 'Подразделы | cloudFRT',
              lang: lang,
              page: './page/article/subsections.html',
              breadcrumb: 'subsections',
              section: section,
              subsections: subs,
            },
          },
        },
      })
      res.status(200).end(response.html)
    } catch (err) {
      console.log('⚡ err::section/:rid', err)
      errorHandler(res, err)
    }
  })

  // --- CREATE Section (JSON) ---
  app.post('/article/admin/section', async (req, res) => {
    try {
      if (!csrfOk(req.body, req)) {
        return res.status(403).json({ status: 403, message: 'Forbidden' })
      }
      const { ok, errors, obj } = validateSectionInput(req.body)
      if (!ok) {
        return res.status(400).json({ status: 400, message: errors.join('; ') })
      }
      const result = await db.createSection(obj)
      if (result.done) {
        return res.status(201).json({ status: 201, rid: result.message?.[0]?.rid || result.message?.[0]?.['@rid'] })
      }
      res.status(200).json({ status: 200, done: false, err: result.err })
    } catch (err) {
      console.log('⚡ err::POST section', err)
      errorHandler(res, err)
    }
  })

  // --- UPDATE Section (JSON) ---
  app.put('/article/admin/section/:rid', async (req, res) => {
    try {
      if (!csrfOk(req.body, req)) {
        return res.status(403).json({ status: 403, message: 'Forbidden' })
      }
      const { ok, errors, obj } = validateSectionInput(req.body)
      if (!ok) {
        return res.status(400).json({ status: 400, message: errors.join('; ') })
      }
      const result = await db.updateSection(req.params.rid, obj)
      res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::PUT section', err)
      errorHandler(res, err)
    }
  })

  // --- DELETE Section ---
  app.delete('/article/admin/section/:rid', async (req, res) => {
    try {
      if (!csrfOk(req.body, req)) {
        return res.status(403).json({ status: 403, message: 'Forbidden' })
      }
      const result = await db.deleteSection(req.params.rid)
      res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::DELETE section', err)
      errorHandler(res, err)
    }
  })

  // ============================================================
  //  Admin: Subsections (подразделы)
  // ============================================================

  // --- Форма создания подраздела ---
  app.get('/article/admin/sub/create/:parentRid', async (req, res) => {
    try {
      const { response } = await res.app.ask('render', {
        server: {
          action: 'html',
          meta: {
            dir: templateDir,
            page: process.env.TEMPLATE_FILE,
            data: {
              csrf: req.session.csrfSecret,
              title: 'Создать подраздел | cloudFRT',
              lang: lang,
              page: './page/article/subsection-form.html',
              breadcrumb: 'subsection-create',
              parentRid: req.params.parentRid,
              subsection: null,
            },
          },
        },
      })
      res.status(200).end(response.html)
    } catch (err) {
      console.log('⚡ err::sub/create', err)
      errorHandler(res, err)
    }
  })

  // --- Форма редактирования подраздела ---
  app.get('/article/admin/sub/:rid/edit', async (req, res) => {
    try {
      const subsection = await db.getSubsection(req.params.rid)
      const { response } = await res.app.ask('render', {
        server: {
          action: 'html',
          meta: {
            dir: templateDir,
            page: process.env.TEMPLATE_FILE,
            data: {
              csrf: req.session.csrfSecret,
              title: 'Редактировать подраздел | cloudFRT',
              lang: lang,
              page: './page/article/subsection-form.html',
              breadcrumb: 'subsection-edit',
              parentRid: null,
              subsection: subsection,
            },
          },
        },
      })
      res.status(200).end(response.html)
    } catch (err) {
      console.log('⚡ err::sub/edit', err)
      errorHandler(res, err)
    }
  })

  // --- Статьи внутри подраздела ---
  app.get('/article/admin/sub/:rid', async (req, res) => {
    try {
      const subsection = await db.getSubsection(req.params.rid)
      const articles = await db.getArticles(req.params.rid)
      const { response } = await res.app.ask('render', {
        server: {
          action: 'html',
          meta: {
            dir: templateDir,
            page: process.env.TEMPLATE_FILE,
            data: {
              csrf: req.session.csrfSecret,
              title: subsection?.title?.ru || 'Статьи | cloudFRT',
              lang: lang,
              page: './page/article/articles.html',
              breadcrumb: 'articles',
              subsection: subsection,
              articles: articles,
            },
          },
        },
      })
      res.status(200).end(response.html)
    } catch (err) {
      console.log('⚡ err::sub/:rid', err)
      errorHandler(res, err)
    }
  })

  // --- CREATE Subsection (JSON) ---
  app.post('/article/admin/sub', async (req, res) => {
    try {
      if (!csrfOk(req.body, req)) {
        return res.status(403).json({ status: 403, message: 'Forbidden' })
      }
      const { ok, errors, obj } = validateSubsectionInput(req.body)
      if (!ok) {
        return res.status(400).json({ status: 400, message: errors.join('; ') })
      }
      const parentRid = req.body.parentRid
      if (!parentRid) {
        return res.status(400).json({ status: 400, message: 'parentRid required' })
      }
      const result = await db.createSubsection(obj, parentRid)
      if (result.done) {
        return res.status(201).json({ status: 201, rid: result.message?.[0]?.rid || result.message?.[0]?.['@rid'] })
      }
      res.status(200).json({ status: 200, done: false, err: result.err })
    } catch (err) {
      console.log('⚡ err::POST sub', err)
      errorHandler(res, err)
    }
  })

  // --- UPDATE Subsection (JSON) ---
  app.put('/article/admin/sub/:rid', async (req, res) => {
    try {
      if (!csrfOk(req.body, req)) {
        return res.status(403).json({ status: 403, message: 'Forbidden' })
      }
      const { ok, errors, obj } = validateSubsectionInput(req.body)
      if (!ok) {
        return res.status(400).json({ status: 400, message: errors.join('; ') })
      }
      const result = await db.updateSubsection(req.params.rid, obj)
      res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::PUT sub', err)
      errorHandler(res, err)
    }
  })

  // --- DELETE Subsection ---
  app.delete('/article/admin/sub/:rid', async (req, res) => {
    try {
      if (!csrfOk(req.body, req)) {
        return res.status(403).json({ status: 403, message: 'Forbidden' })
      }
      const result = await db.deleteSubsection(req.params.rid)
      res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::DELETE sub', err)
      errorHandler(res, err)
    }
  })

  // ============================================================
  //  Admin: Articles (статьи)
  // ============================================================

  // --- Форма создания статьи ---
  app.get('/article/admin/create/:parentRid', async (req, res) => {
    try {
      const { response } = await res.app.ask('render', {
        server: {
          action: 'html',
          meta: {
            dir: templateDir,
            page: process.env.TEMPLATE_FILE,
            data: {
              csrf: req.session.csrfSecret,
              title: 'Создать статью | cloudFRT',
              lang: lang,
              page: './page/article/article-form.html',
              breadcrumb: 'article-create',
              parentRid: req.params.parentRid,
              article: null,
            },
          },
        },
      })
      res.status(200).end(response.html)
    } catch (err) {
      console.log('⚡ err::article/create', err)
      errorHandler(res, err)
    }
  })

  // --- Форма редактирования статьи ---
  app.get('/article/admin/:rid/edit', async (req, res) => {
    try {
      const article = await db.getArticle(req.params.rid)
      const { response } = await res.app.ask('render', {
        server: {
          action: 'html',
          meta: {
            dir: templateDir,
            page: process.env.TEMPLATE_FILE,
            data: {
              csrf: req.session.csrfSecret,
              title: 'Редактировать статью | cloudFRT',
              lang: lang,
              page: './page/article/article-form.html',
              breadcrumb: 'article-edit',
              parentRid: null,
              article: article,
            },
          },
        },
      })
      res.status(200).end(response.html)
    } catch (err) {
      console.log('⚡ err::article/edit', err)
      errorHandler(res, err)
    }
  })

  // --- CREATE Article (JSON) ---
  app.post('/article/admin', async (req, res) => {
    try {
      if (!csrfOk(req.body, req)) {
        return res.status(403).json({ status: 403, message: 'Forbidden' })
      }
      const { ok, errors, obj } = validateArticleInput(req.body)
      if (!ok) {
        return res.status(400).json({ status: 400, message: errors.join('; ') })
      }
      const parentRid = req.body.parentRid
      if (!parentRid) {
        return res.status(400).json({ status: 400, message: 'parentRid required' })
      }
      const result = await db.createArticle(obj, parentRid)
      if (result.done) {
        return res.status(201).json({ status: 201, rid: result.message?.[0]?.rid || result.message?.[0]?.['@rid'] })
      }
      res.status(200).json({ status: 200, done: false, err: result.err })
    } catch (err) {
      console.log('⚡ err::POST article', err)
      errorHandler(res, err)
    }
  })

  // --- UPDATE Article (JSON) ---
  app.put('/article/admin/:rid', async (req, res) => {
    try {
      if (!csrfOk(req.body, req)) {
        return res.status(403).json({ status: 403, message: 'Forbidden' })
      }
      const { ok, errors, obj } = validateArticleInput(req.body)
      if (!ok) {
        return res.status(400).json({ status: 400, message: errors.join('; ') })
      }
      const result = await db.updateArticle(req.params.rid, obj)
      res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::PUT article', err)
      errorHandler(res, err)
    }
  })

  // --- Publish Article ---
  app.put('/article/admin/:rid/publish', async (req, res) => {
    try {
      if (!csrfOk(req.body, req)) {
        return res.status(403).json({ status: 403, message: 'Forbidden' })
      }
      const result = await db.publishArticle(req.params.rid)
      res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::publish', err)
      errorHandler(res, err)
    }
  })

  // --- Unpublish Article ---
  app.put('/article/admin/:rid/unpublish', async (req, res) => {
    try {
      if (!csrfOk(req.body, req)) {
        return res.status(403).json({ status: 403, message: 'Forbidden' })
      }
      const result = await db.unpublishArticle(req.params.rid)
      res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::unpublish', err)
      errorHandler(res, err)
    }
  })

  // --- DELETE Article ---
  app.delete('/article/admin/:rid', async (req, res) => {
    try {
      if (!csrfOk(req.body, req)) {
        return res.status(403).json({ status: 403, message: 'Forbidden' })
      }
      const result = await db.deleteArticle(req.params.rid)
      res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::DELETE article', err)
      errorHandler(res, err)
    }
  })

  return app
}

export { endpoints }
