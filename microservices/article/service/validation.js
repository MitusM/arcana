// === === === === === === === === === === === ===
// validation.js — валидация данных для Section/Subsection/Article
// === === === === === === === === === === === ===

/** Поля Section (строковые, trim) */
const SECTION_FIELDS = ['url', 'description', 'image']

/** Поля Subsection (строковые, trim) */
const SUBSECTION_FIELDS = ['url', 'description', 'image']

/** Поля Article (строковые, trim) */
const ARTICLE_FIELDS = ['url', 'description', 'keyword', 'author']

/**
 * Провалидировать данные для Section/Subsection
 * title — EMBEDDED { ru: строку } или строку (конвертится в { ru: ... })
 * sortOrder — integer, по умолчанию 0
 */
export function validateSectionInput(body) {
  const errors = []
  const obj = {}

  if (!body || typeof body !== 'object') {
    return { ok: false, errors: ['Пустое тело запроса'], obj }
  }

  // title
  if (body.title === undefined || body.title === '') {
    errors.push('title: обязательное поле')
  } else if (typeof body.title === 'string') {
    obj.title = { ru: body.title.trim() }
  } else {
    obj.title = body.title
  }

  // строковые поля
  for (const f of SECTION_FIELDS) {
    if (body[f] !== undefined) obj[f] = String(body[f]).trim()
  }

  // sortOrder
  if (body.sortOrder !== undefined) {
    obj.sortOrder = parseInt(body.sortOrder, 10)
  }

  return { ok: errors.length === 0, errors, obj }
}

/**
 * Валидация Subsection (те же поля что и у Section)
 */
export const validateSubsectionInput = validateSectionInput

/**
 * Провалидировать данные для Article
 * content/tags — EMBEDDED { ru: ... }, можно строку
 */
export function validateArticleInput(body) {
  const errors = []
  const obj = {}

  if (!body || typeof body !== 'object') {
    return { ok: false, errors: ['Пустое тело запроса'], obj }
  }

  // title
  if (body.title === undefined || body.title === '') {
    errors.push('title: обязательное поле')
  } else if (typeof body.title === 'string') {
    obj.title = { ru: body.title.trim() }
  } else {
    obj.title = body.title
  }

  // строковые поля
  for (const f of ARTICLE_FIELDS) {
    if (body[f] !== undefined) obj[f] = String(body[f]).trim()
  }

  // content → EMBEDDED { ru: ... }
  if (body.content !== undefined) {
    obj.content = typeof body.content === 'string'
      ? { ru: body.content.trim() }
      : body.content
  }

  // tags → EMBEDDED { ru: ... }
  if (body.tags !== undefined) {
    obj.tags = typeof body.tags === 'string'
      ? { ru: body.tags }
      : body.tags
  }

  // image
  if (body.image !== undefined) obj.image = String(body.image).trim()

  // searchable (boolean)
  if (body.searchable !== undefined) obj.searchable = body.searchable === true || body.searchable === 'true'

  // sortOrder
  if (body.sortOrder !== undefined) obj.sortOrder = parseInt(body.sortOrder, 10)

  return { ok: errors.length === 0, errors, obj }
}