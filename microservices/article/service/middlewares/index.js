/** ***** ***** ***** ***** ***** ***** *****
 * *  middleware - setup route middlewares  *
 * article admin: /article/admin/* — защищён авторизацией.
 * ***** ***** ***** ***** ***** ***** ***** */
'use strict'

const middlewares = (app) => {
  app.all(
    [
      '/article/',
      '/article/admin(.*)',
    ],
    async (req, res, next) => {
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
    },
  )

  return app
}

export { middlewares }