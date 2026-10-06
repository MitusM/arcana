// === === === === === === === === === === === ===
// controllers/index.js — эндпоинты МС article (arcana)
//
// SEO-структура: frt.su/article/<рубрика>/<подрубрика>/.../<статья>
//   GET /article/                 → корневой хаб
//   GET /article/sitemap.xml      → карта сайта
//   GET /article/(.*)             → разбор пути: рубрика либо статья
//   /article/admin/*              → админ-SPA + REST CRUD (JSON)
//
// Рендер через МС render (Nunjucks, action 'html').
// Публичные страницы кэшируются в Redis: 'articlePage:<path>' TTL 300.
// === === === === === === === === === === === ===
import 'dotenv/config' // важно: .env ПЕРВЫМ (до создания CacheRedis)
import path from 'path'
import pkg from 'app-root-path'
import dotenv from 'dotenv'
import { validateRubricInput, validateArticleInput } from '../service/validation.js'
import { Cache } from '../service/cacheServices.js'
import { csrfOk } from '../service/csrf.js'

const appRoot = pkg.path
dotenv.config()
const templateDir = path.join(appRoot, process.env.VIEW_DIR || 'view/html/')
const APP_URL = process.env.APP_URL || 'https://cloud.frt.su'
const CACHE_TTL = 300

// Кэш публичных страниц
const CacheRedis = new Cache({ db: 0 })

const ARTICLE_PAGE_LIMIT = parseInt(process.env.ARTICLE_LIMIT || '20', 10)

// ---- Утилиты ----

/** RID из URL приходит закодированным (%23%3A) — декодируем. */
function decodeRid(input) {
  if (input == null) return input
  const s = String(input)
  try {
    return s.includes('%') ? decodeURIComponent(s) : s
  } catch (e) {
    return s
  }
}

const errorHandler = (res, message, status = 404) => res.status(status).json({ message })

/** Достать строку/HTML из многоязычного поля ({ru:...}, {html:...} или строка). */
function langString(src) {
  if (!src) return ''
  if (typeof src === 'string') return src
  if (typeof src === 'object') {
    if (typeof src.ru === 'string') return src.ru
    if (typeof src.html === 'string') return src.html
    if (src.html && typeof src.html === 'object') return String(src.html.ru || src.html.html || '')
    const first = Object.values(src).find((v) => typeof v === 'string')
    return first || ''
  }
  return String(src)
}

/** Первый абзац HTML (превью карточки). */
function firstParagraph(html) {
  if (!html) return ''
  const src = String(html)
  const m = src.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
  if (m) return m[1].trim()
  const b = src.match(/^([\s\S]*?)(?=<h[1-6]|<div|<ul|<ol|<table|$)/i)
  return (b ? b[1] : src).trim()
}

/** Поля карточки (title/h1/image/intro) из вершины. */
function cardFields(row) {
  const title = row && row.title ? langString(row.title).trim() : ''
  const h1 = row && row.h1 ? String(row.h1).trim() : ''
  const cardTitle = h1 && h1 !== title ? h1 : title
  return {
    cardTitle,
    title,
    image: (row && row.image) || '',
    intro: firstParagraph(langString(row && row.content)),
  }
}

/** Хлебные крошки из цепочки предков. chain = [текущий, ..., корень]. */
function buildBreadcrumb(chain, currentSlug, prefix = '/article') {
  const reversed = [...(chain || [])].reverse()
  const crumbs = []
  let acc = ''
  for (const node of reversed) {
    if (!node || !node.url) continue
    acc = acc ? `${acc}/${node.url}` : node.url
    crumbs.push({
      name: langString(node.title) || node.url,
      url: `${prefix}/${acc}`,
      current: node.url === currentSlug,
    })
  }
  crumbs.unshift({ name: 'Статьи', url: '/article/', current: false })
  return crumbs
}

/** BreadcrumbList JSON-LD. */
function breadcrumbSchema(breadcrumb) {
  const items = breadcrumb.map((b, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: b.name,
    item: `${APP_URL}${b.url}`,
  }))
  return `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items,
  })}</script>`
}

function invalidatePageCache() {
  try {
    return CacheRedis.delPattern('articlePage:*')
  } catch (e) {
    return Promise.resolve()
  }
}

const endpoints = async (app) => {
  const db = await app.options.db

  // ============================================================
  //  ПУБЛИЧНЫЕ СТРАНИЦЫ
  // ============================================================

  /** ---- Корневой хаб /article/ ---- */
  app.get('/article/', async (req, res) => {
    try {
      const cached = await CacheRedis.get('articlePage:__root__')
      if (cached) return res.status(200).end(cached)

      const roots = await db.getRubricsRoot()
      const rubrics = roots.map((r) => {
        const cf = cardFields(r)
        return {
          url: `/article/${r.url}`,
          title: cf.title,
          cardTitle: cf.cardTitle,
          image: cf.image,
          intro: cf.intro,
          description: r.description || '',
        }
      })

      const crumbs = [{ name: 'Статьи', url: '/article/', current: true }]
      const data = {
        title: 'Статьи — рубрики',
        h1: 'Статьи',
        description: 'Статьи и рубрики туристического портала.',
        page: './page/root.html',
        breadcrumb: crumbs,
        breadcrumb_schema: breadcrumbSchema(crumbs),
        rubrics,
        robots: 'index, follow',
        current_year: new Date().getFullYear(),
      }

      const { response } = await res.app.ask('render', {
        server: { action: 'html', meta: { dir: templateDir, page: 'index.html', data } },
      })
      CacheRedis.set('articlePage:__root__', response.html, CACHE_TTL)
      res.status(200).end(response.html)
    } catch (err) {
      console.log('⚡ err::article root', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  /** ---- Sitemap ---- */
  app.get('/article/sitemap.xml', async (req, res) => {
    try {
      const tree = await db.getSitemapTree()
      const urls = tree.filter((n) => n.url)
      const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ]
      // корневой хаб
      const items = [{ loc: `${APP_URL}/article/`, prio: 0.9 }, ...urls.map((n) => ({
        loc: `${APP_URL}/article/${n.url}`,
        prio: n.kind === 'rubric' ? 0.8 : 0.6,
      }))]
      for (const u of items) {
        lines.push('  <url>', `    <loc>${u.loc}</loc>`, `    <priority>${(u.prio || 0.6).toFixed(1)}</priority>`, '  </url>')
      }
      lines.push('</urlset>')
      res.status(200).end(lines.join('\n'))
    } catch (err) {
      console.log('⚡ err::article sitemap', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  // ============================================================
  //  ADMX: SPA + служебные JSON (регистрируются ДО catch-all)
  // ============================================================

  /** ---- SPA-админка ---- */
  app.get('/article/admin/page', async (req, res) => {
    try {
      const tree = await db.getRubricTree()
      const adminData = JSON.stringify({
        csrf: req.session.csrfSecret,
        tree,
        api: '/article/admin',
        upload: '/files/upload/article-article',
      })
      const data = {
        title: 'Статьи — админ',
        page: './page/admin.html',
        adminData,
        admin_page: true,
        robots: 'noindex, nofollow',
        current_year: new Date().getFullYear(),
      }
      const { response } = await res.app.ask('render', {
        server: { action: 'html', meta: { dir: templateDir, page: 'index.html', data } },
      })
      return res.status(200).end(response.html)
    } catch (err) {
      console.log('⚡ err::article admin page', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  /** ---- Дерево рубрик (селект родителя) ---- */
  app.get('/article/admin/tree', async (req, res) => {
    try {
      const tree = await db.getRubricTreeWithCounts()
      return res.status(200).json({ tree })
    } catch (err) {
      console.log('⚡ err::article admin tree', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  /** ---- Children (drill-down + хлебные крошки) ---- */
  app.get('/article/admin/children', async (req, res) => {
    try {
      const parent = decodeRid(req.query.parent)
      const isRoot = req.query.root === '1' || req.query.root === 'true'
      let children, node = null, ancestors = []
      if (isRoot || !parent) {
        children = await db.getRubricsRootAdmin()
      } else {
        const rid = String(parent)
        node = await db.getRubric(rid)
        if (!node) return errorHandler(res, 'Рубрика не найдена', 404)
        children = await db.getRubricChildren(rid, { publishedOnly: false })
        const chain = await db.parentsChain(rid)
        const reversed = [...(chain || [])].reverse()
        for (const c of reversed) {
          if (!c || !c.url) continue
          if (String(c.rid) === String(node['@rid'])) continue
          ancestors.push({ rid: String(c.rid), url: c.url, title: langString(c.title) || c.url })
        }
      }
      const articles = node ? await db.getArticlesByRubric(node['@rid'], { publishedOnly: false }) : []
      return res.status(200).json({ children, articles, node: node || null, ancestors })
    } catch (err) {
      console.log('⚡ err::article admin children', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  /** ---- Поиск ---- */
  app.get('/article/admin/search', async (req, res) => {
    try {
      const q = (req.query.q || '').trim()
      if (q.length < 2) return res.status(200).json({ rubrics: [], articles: [] })
      const found = await db.searchArticles(q)
      return res.status(200).json(found)
    } catch (err) {
      console.log('⚡ err::article admin search', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  // ---------- Rubric CRUD ----------

  app.get('/article/admin/rubric/:rid', async (req, res) => {
    try {
      const rid = decodeRid(req.params.rid)
      const rubric = await db.getRubric(rid)
      if (!rubric) return errorHandler(res, 'Not found')
      const parentRow = await db.queryOne(
        `SELECT out('HAS_CHILD').@rid AS parents FROM ${rid}`,
      )
      const parents = (parentRow && parentRow.parents) || []
      return res.status(200).json({ rubric: { ...rubric, parentRid: parents[0] || null } })
    } catch (err) {
      console.log('⚡ err::article admin rubric get', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  app.post('/article/admin/rubric', async (req, res) => {
    try {
      const body = req.body || {}
      if (!csrfOk(body, req)) return res.status(403).json({ status: 403, message: 'Forbidden' })
      const { ok, errors, clean } = validateRubricInput(body, { requireTitle: true })
      if (!ok) return res.status(400).json({ status: 400, message: errors.join('; ') })
      if (!clean.url) return res.status(400).json({ status: 400, message: 'url: обязательное поле' })

      const parentRid = decodeRid(body.parentRid) || null
      const dup = await db.rubricSlugExists(clean.url, parentRid)
      if (dup) return res.status(409).json({ status: 409, message: 'url уже занят в этой рубрике' })

      if (!clean.status) clean.status = 'draft'
      const result = await db.createRubric(clean, parentRid)
      if (!result.done) return errorHandler(res, result.err || 'Ошибка создания', 500)
      await invalidatePageCache()
      return res.status(201).json({ status: 201, rid: result.rid, done: true })
    } catch (err) {
      console.log('⚡ err::article admin rubric create', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  app.put('/article/admin/rubric/:rid', async (req, res) => {
    try {
      const rid = decodeRid(req.params.rid)
      const body = req.body || {}
      if (!csrfOk(body, req)) return res.status(403).json({ status: 403, message: 'Forbidden' })
      const { ok, errors, clean } = validateRubricInput(body, { requireTitle: false })
      if (!ok) return res.status(400).json({ status: 400, message: errors.join('; ') })

      if (clean.url) {
        const parentRid = decodeRid(body.parentRid) || null
        const dup = await db.rubricSlugExists(clean.url, parentRid, rid)
        if (dup) return res.status(409).json({ status: 409, message: 'url уже занят в этой рубрике' })
      }
      const result = await db.updateRubric(rid, clean)
      await invalidatePageCache()
      return res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::article admin rubric update', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  app.put('/article/admin/rubric/:rid/publish', async (req, res) => {
    try {
      const rid = decodeRid(req.params.rid)
      if (!csrfOk(req.body || {}, req)) return res.status(403).json({ status: 403, message: 'Forbidden' })
      const publish = req.body && req.body.publish
      const result = publish
        ? await db.publishRubric(rid)
        : await db.unpublishRubric(rid)
      await invalidatePageCache()
      return res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::article admin rubric publish', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  app.delete('/article/admin/rubric/:rid', async (req, res) => {
    try {
      const rid = decodeRid(req.params.rid)
      if (!csrfOk(req.body || {}, req)) return res.status(403).json({ status: 403, message: 'Forbidden' })
      const result = await db.deleteRubric(rid)
      await invalidatePageCache()
      return res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::article admin rubric delete', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  // ---------- Article CRUD ----------

  app.get('/article/admin/article/:rid', async (req, res) => {
    try {
      const rid = decodeRid(req.params.rid)
      const article = await db.getArticle(rid)
      if (!article) return errorHandler(res, 'Not found')
      const parentRow = await db.queryOne(
        `SELECT out('HAS_ARTICLE').@rid AS parents FROM ${rid}`,
      )
      const parents = (parentRow && parentRow.parents) || []
      return res.status(200).json({ article: { ...article, rubricRid: parents[0] || null } })
    } catch (err) {
      console.log('⚡ err::article admin article get', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  app.post('/article/admin/article', async (req, res) => {
    try {
      const body = req.body || {}
      if (!csrfOk(body, req)) return res.status(403).json({ status: 403, message: 'Forbidden' })
      const { ok, errors, clean } = validateArticleInput(body, { requireTitle: true })
      if (!ok) return res.status(400).json({ status: 400, message: errors.join('; ') })
      if (!clean.url) return res.status(400).json({ status: 400, message: 'url: обязательное поле' })
      const rubricRid = decodeRid(body.rubricRid)
      if (!rubricRid) return res.status(400).json({ status: 400, message: 'rubricRid обязателен' })

      if (!clean.status) clean.status = 'draft'
      const result = await db.createArticle(clean, rubricRid)
      if (!result.done) return errorHandler(res, result.err || 'Ошибка создания', 500)
      await invalidatePageCache()
      return res.status(201).json({ status: 201, rid: result.rid, done: true })
    } catch (err) {
      console.log('⚡ err::article admin article create', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  app.put('/article/admin/article/:rid', async (req, res) => {
    try {
      const rid = decodeRid(req.params.rid)
      const body = req.body || {}
      if (!csrfOk(body, req)) return res.status(403).json({ status: 403, message: 'Forbidden' })
      const { ok, errors, clean } = validateArticleInput(body, { requireTitle: false })
      if (!ok) return res.status(400).json({ status: 400, message: errors.join('; ') })
      const result = await db.updateArticle(rid, clean)
      await invalidatePageCache()
      return res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::article admin article update', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  app.put('/article/admin/article/:rid/publish', async (req, res) => {
    try {
      const rid = decodeRid(req.params.rid)
      if (!csrfOk(req.body || {}, req)) return res.status(403).json({ status: 403, message: 'Forbidden' })
      const publish = req.body && req.body.publish
      const result = publish
        ? await db.publishArticle(rid)
        : await db.unpublishArticle(rid)
      await invalidatePageCache()
      return res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::article admin article publish', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  app.delete('/article/admin/article/:rid', async (req, res) => {
    try {
      const rid = decodeRid(req.params.rid)
      if (!csrfOk(req.body || {}, req)) return res.status(403).json({ status: 403, message: 'Forbidden' })
      const result = await db.deleteArticle(rid)
      await invalidatePageCache()
      return res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::article admin article delete', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  // ---------- Перемещение ----------

  /** Перенос рубрики к другому родителю (null → в корень). Защита от циклов. */
  app.put('/article/admin/rubric/:rid/move', async (req, res) => {
    try {
      const rid = decodeRid(req.params.rid)
      const body = req.body || {}
      if (!csrfOk(body, req)) return res.status(403).json({ status: 403, message: 'Forbidden' })
      const newParent = decodeRid(body.parentRid) || null
      if (newParent && String(newParent) === String(rid)) {
        return res.status(409).json({ status: 409, message: 'Нельзя переместить рубрику в саму себя' })
      }
      if (newParent && (await db.isDescendant(rid, newParent))) {
        return res.status(409).json({ status: 409, message: 'Нельзя переместить рубрику в своего потомка' })
      }
      const result = await db.moveRubric(rid, newParent)
      await invalidatePageCache()
      return res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::article admin rubric move', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  /** Перенос статьи в другую рубрику. */
  app.put('/article/admin/article/:rid/move', async (req, res) => {
    try {
      const rid = decodeRid(req.params.rid)
      const body = req.body || {}
      if (!csrfOk(body, req)) return res.status(403).json({ status: 403, message: 'Forbidden' })
      const rubricRid = decodeRid(body.rubricRid)
      if (!rubricRid) return res.status(400).json({ status: 400, message: 'rubricRid обязателен' })
      const rubric = await db.getRubric(rubricRid)
      if (!rubric) return errorHandler(res, 'Рубрика не найдена', 404)
      const result = await db.moveArticle(rid, rubricRid)
      await invalidatePageCache()
      return res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::article admin article move', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  /** Drag-n-drop сортировка соседей (рубрики внутри родителя ИЛИ статьи внутри рубрики). */
  app.put('/article/admin/reorder', async (req, res) => {
    try {
      const body = req.body || {}
      if (!csrfOk(body, req)) return res.status(403).json({ status: 403, message: 'Forbidden' })
      const kind = body.kind
      if (kind !== 'rubric' && kind !== 'article') {
        return res.status(400).json({ status: 400, message: "kind: 'rubric' | 'article'" })
      }
      const orderedRids = Array.isArray(body.orderedRids) ? body.orderedRids.map(decodeRid) : []
      if (!orderedRids.length) return res.status(400).json({ status: 400, message: 'orderedRids обязателен' })
      const result = await db.reorder(kind, orderedRids)
      await invalidatePageCache()
      return res.status(200).json({ status: 200, result })
    } catch (err) {
      console.log('⚡ err::article admin reorder', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  // ============================================================
  //  ПУБЛИЧНЫЙ РАЗБОР ПУТИ /article/<...> (catch-all — ПОСЛЕДНИМ)
  // ============================================================
  app.get('/article/(.*)', async (req, res, next) => {
    try {
      const fullPath = (req.path || '').replace(/^\/+/, '').split('/').filter(Boolean)
      const slugs = fullPath.slice(1) // после 'article'

      if (slugs[0] === 'admin') return next()
      if (slugs[0] === 'sitemap.xml') return next()
      if (!slugs.length) return errorHandler(res, 'Not found')

      const cacheKey = `articlePage:${slugs.join('/')}`
      const cachedHtml = await CacheRedis.get(cacheKey)
      if (cachedHtml) return res.status(200).end(cachedHtml)

      // 1) пробуем как рубрику по пути
      const rubric = await db.getRubricByPath(slugs)
      if (rubric) {
        const chain = await db.parentsChain(rubric['@rid'])
        const breadcrumb = buildBreadcrumb(chain, rubric.url)

        const kids = await db.getRubricChildren(rubric['@rid'], { publishedOnly: true })
        const children = kids.map((k) => {
          const cf = cardFields(k)
          return {
            url: `/article/${slugs.join('/')}/${k.url}`,
            title: cf.title,
            cardTitle: cf.cardTitle,
            image: cf.image,
            intro: cf.intro,
            description: k.description || '',
          }
        })

        const arts = await db.getArticlesByRubric(rubric['@rid'], {
          publishedOnly: true,
          limit: ARTICLE_PAGE_LIMIT,
          offset: 0,
        })
        const articles = arts.map((a) => {
          const cf = cardFields(a)
          return {
            url: `/article/${slugs.join('/')}/${a.url}`,
            title: cf.title,
            cardTitle: cf.cardTitle,
            image: cf.image,
            intro: cf.intro,
            description: a.description || '',
          }
        })

        const data = {
          title: `${cardFields(rubric).title} — статьи`,
          h1: rubric.h1 || cardFields(rubric).title,
          description: rubric.description || '',
          image: rubric.image || '',
          page: './page/rubric.html',
          slug: rubric.url,
          breadcrumb,
          breadcrumb_schema: breadcrumbSchema(breadcrumb),
          content: langString(rubric.content),
          children,
          articles,
          current_year: new Date().getFullYear(),
        }
        const { response } = await res.app.ask('render', {
          server: { action: 'html', meta: { dir: templateDir, page: 'index.html', data } },
        })
        CacheRedis.set(cacheKey, response.html, CACHE_TTL)
        return res.status(200).end(response.html)
      }

      // 2) пробуем как статью: последний сегмент = slug статьи, префикс = рубрика
      if (slugs.length >= 2) {
        const rubricSlugs = slugs.slice(0, -1)
        const articleSlug = slugs[slugs.length - 1]
        const parentRubric = await db.getRubricByPath(rubricSlugs)
        if (parentRubric) {
          const article = await db.getArticleBySlug(parentRubric['@rid'], articleSlug, { publishedOnly: true })
          if (article) {
            const chain = await db.parentsChain(parentRubric['@rid'])
            const breadcrumb = buildBreadcrumb(chain, parentRubric.url)
            breadcrumb.push({
              name: cardFields(article).title,
              url: `/article/${slugs.join('/')}`,
              current: true,
            })

            const rel = await db.getRelatedArticles(parentRubric['@rid'], article['@rid'], 6)
            const related = rel.map((a) => {
              const cf = cardFields(a)
              return { url: `/article/${rubricSlugs.join('/')}/${a.url}`, title: cf.title, cardTitle: cf.cardTitle, image: cf.image, intro: cf.intro }
            })

            const data = {
              title: `${cardFields(article).title} — статьи`,
              h1: article.h1 || cardFields(article).title,
              description: article.description || '',
              image: article.image || '',
              page: './page/article.html',
              slug: article.url,
              breadcrumb,
              breadcrumb_schema: breadcrumbSchema(breadcrumb),
              content: langString(article.content),
              author: article.author || '',
              related,
              current_year: new Date().getFullYear(),
            }
            const { response } = await res.app.ask('render', {
              server: { action: 'html', meta: { dir: templateDir, page: 'index.html', data } },
            })
            CacheRedis.set(cacheKey, response.html, CACHE_TTL)
            return res.status(200).end(response.html)
          }
        }
      }

      return errorHandler(res, 'Not found')
    } catch (err) {
      console.log('⚡ err::article path', err)
      return errorHandler(res, 'Server error', 500)
    }
  })

  // ============================================================
  //  Служебные эндпоинты загрузки/удаления изображений
  // ------------------------------------------------------------
  //  ВАЖНО: приём файлов (multipart + webp-конвейер) вынесен в единый МС
  //  uploads и идёт в обход gateway:
  //    клиент → POST /files/upload/article-article
  //    nginx location /files/ → uploads :7620 (срезает /files/)
  //    uploads POST /upload/:microservice-:mi  (ms=article, mi=article)
  //    → диск /images/article/{original,webp,resize,thumbnail}/ (mi == ms)
  //  МС article НЕ принимает multipart сам — только удаляет файлы
  //  (клиент шлёт /files/delete-image напрямую в uploads).
  //  Здесь оставлен лишь fallback-роут удаления на случай прямого вызова
  //  через gateway; основной путь — uploads.
  // ============================================================
  app.delete('/article/delete-image', async (req, res) => {
    try {
      const body = req.body || {}
      if (!csrfOk(body, req)) return res.status(403).json({ status: 403, message: 'Forbidden' })
      return res.status(501).json({
        status: 501,
        message: 'Удаление изображений выполняет МС uploads (DELETE /files/delete-image)',
      })
    } catch (err) {
      console.log('⚡ err::article delete-image', err)
      return res.status(500).json({ status: 500, message: 'Server error' })
    }
  })

  return app
}

export { endpoints }
