// === === === === === === === === === === === ===
// action/index.js — RPC-действия МС article на шине
// === === === === === === === === === === === ===
const action = async (app) => {
  const db = () => app.options.db

  /**
   * article:section:list — список всех разделов.
   * meta: {}
   * Ответ: { sections: [{ rid, title, url, description, sortOrder, ... }] }
   */
  app.action('article:section:list', async (meta, res) => {
    try {
      const sections = await db().getSections()
      res.json({ sections: sections || [] })
    } catch (err) {
      console.log('⚡ err::article:section:list', err)
      res.status(500).json({ error: err.message || 'section list failed' })
    }
  })

  /**
   * article:section:get — один раздел.
   * meta: { rid }
   * Ответ: { section } или { error: 'not found' }
   */
  app.action('article:section:get', async (meta, res) => {
    try {
      if (!meta?.rid) return res.json({ error: 'rid required' })
      const section = await db().getSection(meta.rid)
      if (!section) return res.json({ error: 'not found' })
      res.json({ section })
    } catch (err) {
      console.log('⚡ err::article:section:get', err)
      res.status(500).json({ error: err.message || 'section get failed' })
    }
  })

  /**
   * article:subsection:list — подразделы внутри родителя.
   * meta: { parentRid }
   * Ответ: { subsections: [...] }
   */
  app.action('article:subsection:list', async (meta, res) => {
    try {
      if (!meta?.parentRid) return res.json({ error: 'parentRid required' })
      const subs = await db().getSubsections(meta.parentRid)
      res.json({ subsections: subs || [] })
    } catch (err) {
      console.log('⚡ err::article:subsection:list', err)
      res.status(500).json({ error: err.message || 'subsection list failed' })
    }
  })

  /**
   * article:list — статьи внутри подраздела.
   * meta: { parentRid, onlyPublished? (по умолч. false — все статьи) }
   * Ответ: { articles: [...] }
   */
  app.action('article:list', async (meta, res) => {
    try {
      if (!meta?.parentRid) return res.json({ error: 'parentRid required' })
      let articles = await db().getArticles(meta.parentRid) || []
      if (meta.onlyPublished) {
        articles = articles.filter(a => a.published)
      }
      res.json({ articles })
    } catch (err) {
      console.log('⚡ err::article:list', err)
      res.status(500).json({ error: err.message || 'article list failed' })
    }
  })

  /**
   * article:get — одна статья по RID.
   * meta: { rid }
   * Ответ: { article }
   */
  app.action('article:get', async (meta, res) => {
    try {
      if (!meta?.rid) return res.json({ error: 'rid required' })
      const article = await db().getArticle(meta.rid)
      if (!article) return res.json({ error: 'not found' })
      res.json({ article })
    } catch (err) {
      console.log('⚡ err::article:get', err)
      res.status(500).json({ error: err.message || 'article get failed' })
    }
  })

  /**
   * article:create — создать статью (RPC, с авто-привязкой к подразделу).
   * meta: { parentRid, title, url?, description?, content?, tags?, image?,
   *        keyword?, author?, sortOrder?, searchable? }
   * Ответ: { rid, done: true } или { error }
   */
  app.action('article:create', async (meta, res) => {
    try {
      if (!meta?.parentRid) return res.json({ error: 'parentRid required' })
      if (!meta?.title) return res.json({ error: 'title required' })
      const data = {
        title: meta.title,
        url: meta.url || '',
        description: meta.description || '',
        content: meta.content || '',
        tags: meta.tags || '',
        image: meta.image || '',
        keyword: meta.keyword || '',
        author: meta.author || '',
        sortOrder: parseInt(meta.sortOrder || '0', 10),
        searchable: meta.searchable !== false,
      }
      const result = await db().createArticle(data, meta.parentRid)
      if (result.done) {
        const rid = result.message?.[0]?.rid || result.message?.[0]?.['@rid']
        return res.json({ rid, done: true })
      }
      res.json({ error: 'create failed', details: result.err })
    } catch (err) {
      console.log('⚡ err::article:create', err)
      res.status(500).json({ error: err.message || 'article create failed' })
    }
  })

  /**
   * article:update — обновить статью.
   * meta: { rid, ...поля для обновления }
   * Ответ: { result }
   */
  app.action('article:update', async (meta, res) => {
    try {
      if (!meta?.rid) return res.json({ error: 'rid required' })
      const data = {}
      for (const k of ['title', 'description', 'url', 'content', 'tags',
                       'image', 'keyword', 'author']) {
        if (meta[k] !== undefined) data[k] = meta[k]
      }
      if (meta.sortOrder !== undefined) data.sortOrder = parseInt(meta.sortOrder, 10)
      if (meta.searchable !== undefined) data.searchable = meta.searchable
      const result = await db().updateArticle(meta.rid, data)
      res.json({ result })
    } catch (err) {
      console.log('⚡ err::article:update', err)
      res.status(500).json({ error: err.message || 'article update failed' })
    }
  })

  /**
   * article:togglePublish — опубликовать/снять статью.
   * meta: { rid, publish (true=опубл., false=снять) }
   * Ответ: { result }
   */
  app.action('article:togglePublish', async (meta, res) => {
    try {
      if (!meta?.rid) return res.json({ error: 'rid required' })
      const result = meta.publish
        ? await db().publishArticle(meta.rid)
        : await db().unpublishArticle(meta.rid)
      res.json({ result })
    } catch (err) {
      console.log('⚡ err::article:togglePublish', err)
      res.status(500).json({ error: err.message || 'toggle publish failed' })
    }
  })

  /**
   * article:delete — удалить статью.
   * meta: { rid }
   * Ответ: { result }
   */
  app.action('article:delete', async (meta, res) => {
    try {
      if (!meta?.rid) return res.json({ error: 'rid required' })
      const result = await db().deleteArticle(meta.rid)
      res.json({ result })
    } catch (err) {
      console.log('⚡ err::article:delete', err)
      res.status(500).json({ error: err.message || 'delete failed' })
    }
  })

  return app
}

export { action }