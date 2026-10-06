/** ***** ***** ***** ***** ***** ***** *****
 * *  middleware - setup route middlewares  *
 * article: публичные SEO-страницы (/article/, /article/<rubric>/...,
 * /article/sitemap.xml) доступны БЕЗ авторизации — чтобы их индексировали
 * поисковики и открывались без логина. Защищён ТОЛЬКО раздел /article/admin/*
 * (требует авторизации req.session.auth), по образцу МС destinations.
 * ***** ***** ***** ***** ***** ***** ***** */
'use strict'

// Публичные пути просмотра (SEO-страницы). /article/admin/* — НЕ публичный.
function isPublicPath(path) {
  if (!path) return false
  // корневой хаб
  if (path === '/article' || path === '/article/') return true
  // любые вложенные страницы (рубрики/статьи/sitemap) — публичные, кроме админки
  return path.startsWith('/article/') && !path.startsWith('/article/admin')
}

const middlewares = (app) => {
  app.all(['/article(.*)'], async (req, res, next) => {
    const path = req.path || (req.url || '').split('?')[0]
    if (isPublicPath(path)) {
      return next()
    }

    // /article/admin/* без сессии: отдать форму авторизации (как в destinations),
    // а не голый JSON.
    if (!req.session.auth) {
      try {
        const redirect = await res.app.ask('auth', {
          server: {
            action: 'aut:redirect',
            meta: { csrf: req.session.csrfSecret },
          },
        })
        const html =
          (redirect && redirect.response && redirect.response.html) ||
          (redirect && redirect.html) ||
          (redirect && redirect.response) ||
          ''
        if (html) {
          return res.status(200).end(html)
        }
        return res.status(401).json({ error: 'unauthorized' })
      } catch (err) {
        console.log('⚡ err::article middleware aut:redirect', err)
        return res.status(401).json({ error: 'unauthorized' })
      }
    }
    next()
  })

  return app
}

export { middlewares }
