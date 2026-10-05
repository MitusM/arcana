import path from 'path'
import pkg from 'app-root-path'
import dotenv from 'dotenv'
import { createRequire } from 'module'

import { csrfOk } from '../service/csrf.js'
import { validateSectionInput, validateSubsectionInput, validateArticleInput } from '../service/validation.js'

const require = createRequire(import.meta.url)
const appRoot = pkg.path
dotenv.config()

const lang = require('../lang/ru')
const templateDir = path.join(appRoot, process.env.VIEW_DIR || 'view/html/')
const TEMPLATE_FILE = process.env.TEMPLATE_FILE || 'index'

/**
 * Отправить JSON-ответ с ошибкой
 * @param {object} res — Express-like response
 * @param {*} message — тело ошибки
 */
const jsonError = (res, message, status = 500) => {
  res.status(status).json({ status, message })
}

/**
 * Отрендерить HTML-страницу через render MC
 * @param {object} req — запрос
 * @param {object} res — ответ
 * @param {object} data — данные для шаблона { page, title, breadcrumb, ... }
 */
const renderPage = async (req, res, data) => {
  try {
    const { response } = await res.app.ask('render', {
      server: {
        action: 'html',
        meta: {
          dir: templateDir,
          page: TEMPLATE_FILE,
          data: {
            csrf: req.session.csrfSecret,
            title: data.title || 'cloudFRT',
            lang,
            page: data.page,
            breadcrumb: data.breadcrumb,
            ...data.extra,
          },
        },
      },
    })
    res.status(200).end(response.html)
  } catch (err) {
    console.log(`⚡ err::renderPage(${data.page}) => `, err)
    jsonError(res, err)
  }
}

const endpoints = async (app) => {
  const db = await app.options.db

  // --- Главная дашборда ---
  app.get('/article/', async (req, res) => {
    renderPage(req, res, {
      page: './page/main-content.html',
      title: 'Dashboard | cloudFRT',
      breadcrumb: 'article',
      extra: { number: 1 },
    })
  })

  // ============================================================
  //  Admin: Sections (разделы)
  // ============================================================

  // --- Страница со списком разделов ---
  app.get('/article/admin/', async (req, res) => {
    try {
      const sections = await db.getSections()
      renderPage(req, res, {
        page: './page/article/sections.html',
        title: 'Разделы статей | cloudFRT',
        breadcrumb: 'article-admin',
        extra: { sections },
      })
    } catch (err) {
      console.log('⚡ err::/article/admin/', err)
      jsonError(res, err)
    }
  })

  // --- Форма создания раздела ---
  app.get('/article/admin/section/create', async (req, res) => {
    renderPage(req, res, {
      page: './page/article/section-form.html',
      title: 'Создать раздел | cloudFRT',
      breadcrumb: 'section-create',
      extra: { section: null },
    })
  })

  // --- Форма редактирования раздела ---
  app.get('/article/admin/section/:rid/edit', async (req, res) => {
    try {
      const section = await db.getSection(req.params.rid)
      renderPage(req, res, {
        page: './page/article/section-form.html',
        title: 'Редактировать раздел | cloudFRT',
        breadcrumb: 'section-edit',
        extra: { section },
      })
    } catch (err) {
      console.log('⚡ err::section/edit', err)
      jsonError(res, err)
    }
  })

  // --- Подразделы внутри раздела ---
  app.get('/article/admin/section/:rid', async (req, res) => {
    try {
      const section = await db.getSection(req.params.rid)
      const subsections = await db.getSubsections(req.params.rid)
      renderPage(req, res, {
        page: './page/article/subsections.html',
        title: section?.title?.ru || 'Подразделы | cloudFRT',
        breadcrumb: 'subsections',
        extra: { section, subsections },
      })
    } catch (err) {
      console.log('⚡ err::section/:rid', err)
      jsonError(res, err)
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
      jsonError(res, err)
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
      jsonError(res, err)
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
      jsonError(res, err)
    }
  })

  // ============================================================
  //  Admin: Subsections (подразделы)
  // ============================================================

  // --- Форма создания подраздела ---
  app.get('/article/admin/sub/create/:parentRid', async (req, res) => {
    renderPage(req, res, {
      page: './page/article/subsection-form.html',
      title: 'Создать подраздел | cloudFRT',
      breadcrumb: 'subsection-create',
      extra: { parentRid: req.params.parentRid, subsection: null },
    })
  })

  // --- Форма редактирования подраздела ---
  app.get('/article/admin/sub/:rid/edit', async (req, res) => {
    try {
      const subsection = await db.getSubsection(req.params.rid)
      renderPage(req, res, {
        page: './page/article/subsection-form.html',
        title: 'Редактировать подраздел | cloudFRT',
        breadcrumb: 'subsection-edit',
        extra: { parentRid: null, subsection },
      })
    } catch (err) {
      console.log('⚡ err::sub/edit', err)
      jsonError(res, err)
    }
  })

  // --- Статьи внутри подраздела ---
  app.get('/article/admin/sub/:rid', async (req, res) => {
    try {
      const subsection = await db.getSubsection(req.params.rid)
      const articles = await db.getArticles(req.params.rid)
      renderPage(req, res, {
        page: './page/article/articles.html',
        title: subsection?.title?.ru || 'Статьи | cloudFRT',
        breadcrumb: 'articles',
        extra: { subsection, articles },
      })
    } catch (err) {
      console.log('⚡ err::sub/:rid', err)
      jsonError(res, err)
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
        return res.status(201).json({ status: 201, rid: result.rid })
      }
      res.status(200).json({ status: 200, done: false, err: result.err })
    } catch (err) {
      console.log('⚡ err::POST sub', err)
      jsonError(res, err)
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
      jsonError(res, err)
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
      jsonError(res, err)
    }
  })

  // ============================================================
  //  Admin: Articles (статьи)
  // ============================================================

  // --- Форма создания статьи ---
  app.get('/article/admin/create/:parentRid', async (req, res) => {
    renderPage(req, res, {
      page: './page/article/article-form.html',
      title: 'Создать статью | cloudFRT',
      breadcrumb: 'article-create',
      extra: { parentRid: req.params.parentRid, article: null },
    })
  })

  // --- Форма редактирования статьи ---
  app.get('/article/admin/:rid/edit', async (req, res) => {
    try {
      const article = await db.getArticle(req.params.rid)
      renderPage(req, res, {
        page: './page/article/article-form.html',
        title: 'Редактировать статью | cloudFRT',
        breadcrumb: 'article-edit',
        extra: { parentRid: null, article },
      })
    } catch (err) {
      console.log('⚡ err::article/edit', err)
      jsonError(res, err)
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
        return res.status(201).json({ status: 201, rid: result.rid })
      }
      res.status(200).json({ status: 200, done: false, err: result.err })
    } catch (err) {
      console.log('⚡ err::POST article', err)
      jsonError(res, err)
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
      jsonError(res, err)
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
      jsonError(res, err)
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
      jsonError(res, err)
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
      jsonError(res, err)
    }
  })

  return app
}

export { endpoints }