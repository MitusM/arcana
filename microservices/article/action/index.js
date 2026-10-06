// === === === === === === === === === === === ===
// action/index.js — RPC-действия МС article на шине
// === === === === === === === === === === === ===
const action = async (app) => {
  const db = () => app.options.db

  const okJson = (res, payload) => res.json(payload)

  // ---------- RPC: rubrics ----------

  /** article:rubric:list — корневые рубрики (публичные). meta: {}
   *  Ответ: { rubrics: [...] } */
  app.action('article:rubric:list', async (meta, res) => {
    try {
      const rubrics = await db().getRubricsRoot()
      okJson(res, { rubrics: rubrics || [] })
    } catch (err) {
      console.log('⚡ err::article:rubric:list', err)
      res.status(500).json({ error: err.message || 'rubric list failed' })
    }
  })

  /** article:rubric:get — рубрика по RID. meta: { rid } */
  app.action('article:rubric:get', async (meta, res) => {
    try {
      if (!meta?.rid) return okJson(res, { error: 'rid required' })
      const rubric = await db().getRubric(meta.rid)
      if (!rubric) return okJson(res, { error: 'not found' })
      okJson(res, { rubric })
    } catch (err) {
      console.log('⚡ err::article:rubric:get', err)
      res.status(500).json({ error: err.message || 'rubric get failed' })
    }
  })

  /** article:rubric:children — дети рубрики. meta: { parentRid, publishedOnly? } */
  app.action('article:rubric:children', async (meta, res) => {
    try {
      if (!meta?.parentRid) return okJson(res, { error: 'parentRid required' })
      const children = await db().getRubricChildren(meta.parentRid, {
        publishedOnly: meta.publishedOnly !== false,
      })
      okJson(res, { children: children || [] })
    } catch (err) {
      console.log('⚡ err::article:rubric:children', err)
      res.status(500).json({ error: err.message || 'rubric children failed' })
    }
  })

  /** article:rubric:getByPath — рубрика по пути slug'ов. meta: { slugs: [] } */
  app.action('article:rubric:getByPath', async (meta, res) => {
    try {
      if (!Array.isArray(meta?.slugs)) return okJson(res, { error: 'slugs required' })
      const rubric = await db().getRubricByPath(meta.slugs)
      okJson(res, { rubric: rubric || null })
    } catch (err) {
      console.log('⚡ err::article:rubric:getByPath', err)
      res.status(500).json({ error: err.message || 'rubric getByPath failed' })
    }
  })

  // ---------- RPC: articles ----------

  /** article:list — статьи рубрики. meta: { rubricRid, publishedOnly?, limit?, offset? } */
  app.action('article:list', async (meta, res) => {
    try {
      if (!meta?.rubricRid) return okJson(res, { error: 'rubricRid required' })
      const articles = await db().getArticlesByRubric(meta.rubricRid, {
        publishedOnly: meta.publishedOnly !== false,
        limit: meta.limit,
        offset: meta.offset,
      })
      const total = await db().countByRubric(meta.rubricRid, {
        publishedOnly: meta.publishedOnly !== false,
      })
      okJson(res, { articles: articles || [], total })
    } catch (err) {
      console.log('⚡ err::article:list', err)
      res.status(500).json({ error: err.message || 'article list failed' })
    }
  })

  /** article:get — статья по RID. meta: { rid } */
  app.action('article:get', async (meta, res) => {
    try {
      if (!meta?.rid) return okJson(res, { error: 'rid required' })
      const article = await db().getArticle(meta.rid)
      if (!article) return okJson(res, { error: 'not found' })
      okJson(res, { article })
    } catch (err) {
      console.log('⚡ err::article:get', err)
      res.status(500).json({ error: err.message || 'article get failed' })
    }
  })

  /** article:getBySlug — статья по slug внутри рубрики. meta: { rubricRid, url } */
  app.action('article:getBySlug', async (meta, res) => {
    try {
      if (!meta?.rubricRid || !meta?.url) return okJson(res, { error: 'rubricRid & url required' })
      const article = await db().getArticleBySlug(meta.rubricRid, meta.url)
      okJson(res, { article: article || null })
    } catch (err) {
      console.log('⚡ err::article:getBySlug', err)
      res.status(500).json({ error: err.message || 'article getBySlug failed' })
    }
  })

  /** article:related — похожие статьи. meta: { rubricRid, excludeRid?, limit? } */
  app.action('article:related', async (meta, res) => {
    try {
      if (!meta?.rubricRid) return okJson(res, { error: 'rubricRid required' })
      const related = await db().getRelatedArticles(meta.rubricRid, meta.excludeRid, meta.limit)
      okJson(res, { related: related || [] })
    } catch (err) {
      console.log('⚡ err::article:related', err)
      res.status(500).json({ error: err.message || 'related failed' })
    }
  })

  /** article:search — глобальный поиск. meta: { q, limit? } */
  app.action('article:search', async (meta, res) => {
    try {
      const q = (meta?.q || '').trim()
      if (q.length < 2) return okJson(res, { rubrics: [], articles: [] })
      const found = await db().searchArticles(q, meta.limit)
      okJson(res, found)
    } catch (err) {
      console.log('⚡ err::article:search', err)
      res.status(500).json({ error: err.message || 'search failed' })
    }
  })

  /** article:create — создать статью. meta: { rubricRid, ...fields } */
  app.action('article:create', async (meta, res) => {
    try {
      if (!meta?.rubricRid) return okJson(res, { error: 'rubricRid required' })
      if (!meta?.title) return okJson(res, { error: 'title required' })
      const { validateArticleInput } = await import('../service/validation.js')
      const { ok, errors, clean } = validateArticleInput(meta, { requireTitle: true })
      if (!ok) return okJson(res, { error: errors.join('; ') })
      const result = await db().createArticle(clean, meta.rubricRid)
      if (result.done) return okJson(res, { rid: result.rid, done: true })
      okJson(res, { error: 'create failed', details: result.err })
    } catch (err) {
      console.log('⚡ err::article:create', err)
      res.status(500).json({ error: err.message || 'article create failed' })
    }
  })

  /** article:update — обновить статью. meta: { rid, ...fields } */
  app.action('article:update', async (meta, res) => {
    try {
      if (!meta?.rid) return okJson(res, { error: 'rid required' })
      const { validateArticleInput } = await import('../service/validation.js')
      const { clean } = validateArticleInput(meta, { requireTitle: false })
      const result = await db().updateArticle(meta.rid, clean)
      okJson(res, { result })
    } catch (err) {
      console.log('⚡ err::article:update', err)
      res.status(500).json({ error: err.message || 'article update failed' })
    }
  })

  /** article:togglePublish — опубликовать/снять статью. meta: { rid, publish } */
  app.action('article:togglePublish', async (meta, res) => {
    try {
      if (!meta?.rid) return okJson(res, { error: 'rid required' })
      const result = meta.publish
        ? await db().publishArticle(meta.rid)
        : await db().unpublishArticle(meta.rid)
      okJson(res, { result })
    } catch (err) {
      console.log('⚡ err::article:togglePublish', err)
      res.status(500).json({ error: err.message || 'toggle publish failed' })
    }
  })

  /** article:delete — удалить статью. meta: { rid } */
  app.action('article:delete', async (meta, res) => {
    try {
      if (!meta?.rid) return okJson(res, { error: 'rid required' })
      const result = await db().deleteArticle(meta.rid)
      okJson(res, { result })
    } catch (err) {
      console.log('⚡ err::article:delete', err)
      res.status(500).json({ error: err.message || 'delete failed' })
    }
  })

  /** article:sitemap — карта сайта. meta: {} */
  app.action('article:sitemap', async (meta, res) => {
    try {
      const tree = await db().getSitemapTree()
      okJson(res, { tree: tree || [] })
    } catch (err) {
      console.log('⚡ err::article:sitemap', err)
      res.status(500).json({ error: err.message || 'sitemap failed' })
    }
  })

  /** article:count — счётчик статей рубрики. meta: { rubricRid } */
  app.action('article:count', async (meta, res) => {
    try {
      if (!meta?.rubricRid) return okJson(res, { error: 'rubricRid required' })
      const total = await db().countByRubric(meta.rubricRid, { publishedOnly: false })
      okJson(res, { total })
    } catch (err) {
      console.log('⚡ err::article:count', err)
      res.status(500).json({ error: err.message || 'count failed' })
    }
  })

  return app
}

export { action }
