// === === === === === === === === === === === ===
// validation.js — валидация данных Rubric / Article (МС article)
//
// Централизованная валидация с нормализацией slug и белым списком полей
// (по образцу МС destinations).
// === === === === === === === === === === === ===

export const STATUSES = ['draft', 'published', 'archived']

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Нормализовать slug: lower, пробелы→дефис, выкинуть мусор. */
export function normalizeSlug(raw) {
  if (typeof raw !== 'string') return null
  let s = raw.trim().toLowerCase()
  s = s.replace(/\s+/g, '-')
  s = s.replace(/[^a-z0-9-]/g, '')
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '')
  return s || null
}

/** Проверить формат slug. */
export function validateSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug)
}

/** Привести многоязычное поле к { ru: ... } (строка → map). */
function toLangMap(val) {
  if (val === undefined) return undefined
  if (typeof val === 'string') return { ru: val.trim() }
  return val
}

/**
 * Валидация рубрики. Возвращает { ok, errors, clean }.
 * @param {object} body
 * @param {{requireTitle?:boolean}} opts
 */
export function validateRubricInput(body, { requireTitle = true } = {}) {
  const errors = []
  const clean = {}

  if (!body || typeof body !== 'object') {
    return { ok: false, errors: ['Пустое тело запроса'], clean }
  }

  // title — обязателен при создании
  if (body.title !== undefined) {
    const t = toLangMap(body.title)
    if (!t || (!t.ru && !Object.keys(t).length)) {
      if (requireTitle) errors.push('title: обязательное поле')
    } else {
      clean.title = t
    }
  } else if (requireTitle) {
    errors.push('title: обязательное поле')
  }

  // url
  if (body.url !== undefined) {
    const s = normalizeSlug(body.url)
    if (s && validateSlug(s)) clean.url = s
    else if (body.url !== '') errors.push('url: только латиница, цифры и дефис')
  }

  if (body.h1 !== undefined) clean.h1 = String(body.h1).trim()
  if (body.description !== undefined) clean.description = String(body.description)
  if (body.image !== undefined) clean.image = String(body.image)
  if (body.content !== undefined) clean.content = toLangMap(body.content)

  if (body.sortOrder !== undefined) {
    const n = parseInt(body.sortOrder, 10)
    clean.sortOrder = Number.isNaN(n) ? 0 : n
  }

  if (body.status !== undefined && STATUSES.includes(body.status)) {
    clean.status = body.status
  }

  return { ok: errors.length === 0, errors, clean }
}

/**
 * Валидация статьи. Возвращает { ok, errors, clean }.
 */
export function validateArticleInput(body, { requireTitle = true } = {}) {
  const errors = []
  const clean = {}

  if (!body || typeof body !== 'object') {
    return { ok: false, errors: ['Пустое тело запроса'], clean }
  }

  if (body.title !== undefined) {
    const t = toLangMap(body.title)
    if (!t || (!t.ru && !Object.keys(t).length)) {
      if (requireTitle) errors.push('title: обязательное поле')
    } else {
      clean.title = t
    }
  } else if (requireTitle) {
    errors.push('title: обязательное поле')
  }

  if (body.url !== undefined) {
    const s = normalizeSlug(body.url)
    if (s && validateSlug(s)) clean.url = s
    else if (body.url !== '') errors.push('url: только латиница, цифры и дефис')
  }

  if (body.h1 !== undefined) clean.h1 = String(body.h1).trim()
  if (body.description !== undefined) clean.description = String(body.description)
  if (body.keyword !== undefined) clean.keyword = String(body.keyword)
  if (body.author !== undefined) clean.author = String(body.author)
  if (body.image !== undefined) clean.image = String(body.image)
  if (body.content !== undefined) clean.content = toLangMap(body.content)
  if (body.tags !== undefined) clean.tags = toLangMap(body.tags)

  if (body.gallery !== undefined) {
    clean.gallery = Array.isArray(body.gallery) ? body.gallery.map(String) : []
  }
  if (body.seo !== undefined && typeof body.seo === 'object') clean.seo = body.seo

  if (body.searchable !== undefined) {
    clean.searchable = body.searchable === true || body.searchable === 'true'
  }

  if (body.sortOrder !== undefined) {
    const n = parseInt(body.sortOrder, 10)
    clean.sortOrder = Number.isNaN(n) ? 0 : n
  }

  if (body.status !== undefined && STATUSES.includes(body.status)) {
    clean.status = body.status
  }

  return { ok: errors.length === 0, errors, clean }
}
