// ============================================================
// article — клиент админ-панели (page/admin.html)
//
// Архитектура (06.10.2026):
//   content-first: сайдбар дерева рубрик + рабочая область.
//   Два отдельных экрана: редактор рубрики и редактор статьи (табы).
//   Навигация — hash-роутинг: #/list[?rid=], #/rubric/<rid>, #/article/<rid>.
//   Rubric держит И подрубрики (HAS_CHILD), И статьи (HAS_ARTICLE).
// Данные из <script id="admin-data">:
//   { csrf, tree, api, upload }
// ============================================================
import '../scss/admin.scss'

;(function () {
  'use strict'
  var _$ = window._$

  var DATA = document.getElementById('admin-data')
  var parsed = {}
  try {
    parsed = DATA ? JSON.parse(DATA.textContent || '{}') : {}
  } catch (e) {
    parsed = {}
  }
  var CSRF = parsed.csrf || ''
  var API = parsed.api || '/article/admin'
  var UPLOAD_URL = parsed.upload || '/files/upload/article-article'

  function el(id) {
    return document.getElementById(id)
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
  function titleOf(t) {
    if (!t) return ''
    if (typeof t === 'string') return t
    return t.ru || Object.values(t).find(function (v) { return typeof v === 'string' }) || ''
  }
  function msg(kind, message) {
    if (_$ && _$.message) {
      _$.message(kind === 'error' ? 'error' : 'success', {
        title: kind === 'error' ? '✗' : '✓',
        message: message,
      })
    } else {
      console.log(kind, message)
    }
  }

  // ---- TinyMCE хелперы ----
  var CONTENT_EDITORS = ['r-content', 'a-content']
  function editorFor(id) {
    return window.tinymce && tinymce.get(id) ? tinymce.get(id) : null
  }
  function getContent(id) {
    var ed = editorFor(id)
    return ed ? ed.getContent() : (el(id) ? el(id).value : '')
  }
  function setContent(id, html) {
    var ed = editorFor(id)
    if (ed) ed.setContent(html || '')
    if (el(id)) el(id).value = html || ''
  }
  function initEditor(id) {
    if (!window.tinymce) return
    if (editorFor(id)) return
    tinymce.init({
      selector: '#' + id,
      license_key: 'gpl',
      language: 'ru',
      min_height: 500,
      menubar: false,
      branding: false,
      promotion: false,
      plugins: 'lists advlist link autolink image table wordcount emoticons fullscreen visualblocks autoresize searchreplace',
      toolbar:
        'undo redo | blocks | bold italic underline strikethrough | forecolor backcolor | ' +
        'bullist numlist | alignleft aligncenter alignright alignjustify | link image table | ' +
        'emoticons visualblocks searchreplace | fullscreen',
      link_default_target: '_blank',
      link_default_protocol: 'https',
      setup: function (ed) {
        ed.on('init', function () {
          var v = el(id).value
          if (v) ed.setContent(v)
        })
      },
    })
  }
  // при смене/скрытии экрана синхронизируем textarea → сохраняем содержимое
  function syncEditors() {
    CONTENT_EDITORS.forEach(function (id) {
      var ed = editorFor(id)
      if (ed && el(id)) el(id).value = ed.getContent()
    })
  }

  // ---- состояние ----
  var state = {
    tree: parsed.tree || [],
    currentNode: null, // {rid,url,title}
    ancestors: [],
    children: [],
    articles: [],
    editingRubric: null, // rid | null
    editingArticle: null,
    dropzones: {}, // по containerId
  }

  // ============================================================
  //  Hash-роутинг
  // ============================================================
  function parseHash() {
    var h = (location.hash || '').replace(/^#\/?/, '')
    var params = {}
    var qi = h.indexOf('?')
    if (qi > -1) {
      h.slice(qi + 1).split('&').forEach(function (kv) {
        if (!kv) return
        var p = kv.split('=')
        params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '')
      })
      h = h.slice(0, qi)
    }
    var parts = h.split('/')
    // ВАЖНО: hash приходит уже URL-закодированным (%237%3A1), а вызовы
    // fetch() кодируют rid повторно → %25237%253A1 и HTTP 500. Декодируем здесь.
    if (parts[0] === 'rubric' && parts[1]) return { view: 'rubric', rid: decodeURIComponent(parts[1]), params: params }
    if (parts[0] === 'article' && parts[1]) return { view: 'article', rid: decodeURIComponent(parts[1]), params: params }
    return { view: 'list', rid: params.rid || null, params: params }
  }
  function go(hash) {
    if (location.hash === hash) route()
    else location.hash = hash
  }
  window.addEventListener('hashchange', route)

  function route() {
    var r = parseHash()
    if (r.view === 'rubric') showRubric(r.rid === 'new' ? null : r.rid, r.rid === 'new')
    else if (r.view === 'article') showArticle(r.rid === 'new' ? null : r.rid, r.rid === 'new')
    else showList(r.rid)
  }

  // ============================================================
  //  Сайдбар: дерево рубрик
  // ============================================================
  function loadTree(cb) {
    fetch(API + '/tree')
      .then(function (x) { return x.json() })
      .then(function (j) {
        state.tree = j.tree || []
        renderTree()
        if (cb) cb()
      })
      .catch(function (e) { msg('error', 'Дерево: ' + e.message) })
  }

  function renderTree() {
    var box = el('adm-tree')
    box.innerHTML = ''
    var roots = buildNested(state.tree, '')
    if (!roots.length) {
      box.innerHTML = '<div class="adm-empty">Нет рубрик</div>'
      return
    }
    roots.forEach(function (n) { box.appendChild(treeNodes(n)) })
  }

  // собрать вложение по path (у корня path == url)
  function buildNested(flat, parentPath) {
    var map = {}
    flat.forEach(function (n) { map[n.path] = Object.assign({ children: [] }, n) })
    var roots = []
    flat.forEach(function (n) {
      var path = n.path || ''
      var idx = path.lastIndexOf('/')
      var parent = idx > -1 ? path.slice(0, idx) : ''
      if (parent && map[parent]) map[parent].children.push(map[path])
      else if (!parent) roots.push(map[path])
    })
    return roots
  }

  function treeNodes(n) {
    var wrap = document.createElement('div')
    var row = document.createElement('div')
    row.className = 'tree-node'
    row.setAttribute('data-rid', n.rid)
    row.setAttribute('data-url', n.url || '')
    if (state.currentNode && String(state.currentNode.rid) === String(n.rid)) row.classList.add('is-active')
    var hasKids = n.children && n.children.length
    row.innerHTML =
      '<span class="tree-toggle">' + (hasKids ? '▾' : '') + '</span>' +
      '<span class="tree-label">' + esc(titleOf(n.title) || n.url || '—') + '</span>' +
      '<span class="tree-counts">' + (n.articleCount || 0) + '</span>'
    row.addEventListener('click', function () {
      state.currentNode = { rid: n.rid, url: n.url, title: titleOf(n.title) }
      go('#/list?rid=' + encodeURIComponent(n.rid))
    })
    wrap.appendChild(row)
    if (hasKids) {
      var kids = document.createElement('div')
      kids.className = 'tree-children'
      n.children.forEach(function (c) { kids.appendChild(treeNodes(c)) })
      wrap.appendChild(kids)
    }
    return wrap
  }

  // ============================================================
  //  Экран: список рубрики (Подрубрики + Статьи)
  // ============================================================
  function showList(rid) {
    switchView('view-list')
    rid = rid || null
    loadChildren(rid, null)
  }

  function loadChildren(rid, nodeHint) {
    var url = API + '/children' + (rid ? '?parent=' + encodeURIComponent(rid) : '?root=1')
    fetch(url)
      .then(function (x) { return x.json() })
      .then(function (j) {
        state.currentNode = j.node || nodeHint || null
        state.ancestors = j.ancestors || []
        state.children = j.children || []
        state.articles = j.articles || []
        renderCrumbs()
        renderListHead()
        renderRubricList()
        renderArticleList()
        renderTree()
      })
      .catch(function (e) { msg('error', 'Список: ' + e.message) })
  }

  function renderCrumbs() {
    var c = el('adm-crumbs')
    c.innerHTML = ''
    var root = document.createElement('a')
    root.className = 'artadm-crumb'
    root.textContent = 'Статьи'
    root.href = '#/list'
    c.appendChild(root)
    state.ancestors.forEach(function (a) {
      var b = document.createElement('a')
      b.className = 'artadm-crumb'
      b.textContent = titleOf(a.title) || a.url
      b.href = '#/list?rid=' + encodeURIComponent(a.rid)
      b.addEventListener('click', function () { loadChildren(a.rid, null) })
      c.appendChild(b)
    })
    if (state.currentNode) {
      var cur = document.createElement('span')
      cur.className = 'artadm-crumb'
      cur.textContent = titleOf(state.currentNode.title) || state.currentNode.url
      c.appendChild(cur)
    }
  }

  function renderListHead() {
    el('list-title').textContent = state.currentNode
      ? (titleOf(state.currentNode.title) || state.currentNode.url)
      : 'Корневые рубрики'
  }

  function statusBadge(st) {
    var pub = st === 'published'
    return '<span class="adm-item-badge adm-badge-' + (pub ? 'pub' : 'draft') + '">' +
      (pub ? 'Опубликовано' : 'Черновик') + '</span>'
  }

  function renderRubricList() {
    var box = el('list-rubrics')
    box.innerHTML = ''
    if (!state.children.length) {
      box.innerHTML = '<div class="adm-empty">Нет подрубрик</div>'
      return
    }
    state.children.forEach(function (n) {
      box.appendChild(makeRubricRow(n))
    })
    makeSortable(box, 'rubric')
  }

  function renderArticleList() {
    var box = el('list-articles')
    box.innerHTML = ''
    if (!state.articles.length) {
      box.innerHTML = '<div class="adm-empty">Нет статей</div>'
      return
    }
    state.articles.forEach(function (n) {
      box.appendChild(makeArticleRow(n))
    })
    makeSortable(box, 'article')
  }

  function makeRubricRow(n) {
    var item = document.createElement('div')
    item.className = 'adm-item'
    item.setAttribute('data-rid', n.rid)
    item.setAttribute('draggable', 'true')
    var isPub = n.status === 'published'
    item.innerHTML =
      '<span class="adm-drag" title="Перетащите для сортировки">≡</span>' +
      '<span class="adm-item-title">' + esc(titleOf(n.title) || n.url) + '</span>' +
      statusBadge(n.status) +
      '<span class="adm-item-actions">' +
      '<button class="adm-btn adm-btn-mini" data-act="pub">' + (isPub ? 'Снять' : 'Опубликовать') + '</button>' +
      '<button class="adm-btn adm-btn-mini" data-act="edit">✎</button>' +
      '<button class="adm-btn adm-btn-mini adm-btn-danger" data-act="del">🗑</button>' +
      '<button class="adm-btn adm-btn-mini" data-act="open">›</button>' +
      '</span>'
    return item
  }

  function makeArticleRow(n) {
    var item = document.createElement('div')
    item.className = 'adm-item'
    item.setAttribute('data-rid', n.rid)
    item.setAttribute('draggable', 'true')
    var isPub = n.status === 'published'
    item.innerHTML =
      '<span class="adm-drag" title="Перетащите для сортировки">≡</span>' +
      '<span class="adm-item-title">' + esc(titleOf(n.title) || n.url) + '</span>' +
      statusBadge(n.status) +
      '<span class="adm-item-actions">' +
      '<button class="adm-btn adm-btn-mini" data-act="pub">' + (isPub ? 'Снять' : 'Опубликовать') + '</button>' +
      '<button class="adm-btn adm-btn-mini" data-act="edit">✎</button>' +
      '<button class="adm-btn adm-btn-mini adm-btn-danger" data-act="del">🗑</button>' +
      '</span>'
    return item
  }

  // делегирование кликов по спискам
  ;[el('list-rubrics'), el('list-articles')].forEach(function (box) {
    box.addEventListener('click', function (ev) {
      var item = ev.target.closest('.adm-item')
      if (!item) return
      var rid = item.getAttribute('data-rid')
      var btn = ev.target.closest('button[data-act]')
      var isRubric = box === el('list-rubrics')
      if (!btn) {
        // клик по строке — открыть
        if (isRubric) go('#/list?rid=' + encodeURIComponent(rid))
        else go('#/article/' + encodeURIComponent(rid))
        return
      }
      var act = btn.getAttribute('data-act')
      ev.stopPropagation()
      if (act === 'edit') isRubric ? go('#/rubric/' + encodeURIComponent(rid)) : go('#/article/' + encodeURIComponent(rid))
      else if (act === 'open') go('#/list?rid=' + encodeURIComponent(rid))
      else if (act === 'del') deleteNode(rid, isRubric)
      else if (act === 'pub') togglePublish(rid, isRubric, null)
    })
  })

  // ============================================================
  //  Drag-n-drop сортировка соседей
  // ============================================================
  function makeSortable(container, kind) {
    // HTML5 DnD: перетаскивание соседей внутри контейнера
    var dragEl = null
    container.querySelectorAll('.adm-item').forEach(function (item) {
      item.addEventListener('dragstart', function () { dragEl = item })
      item.addEventListener('dragend', function () { dragEl = null; saveOrder(container, kind) })
      item.addEventListener('dragover', function (ev) {
        ev.preventDefault()
        if (!dragEl || dragEl === item) return
        var rect = item.getBoundingClientRect()
        var after = ev.clientY > rect.top + rect.height / 2
        item.parentNode.insertBefore(dragEl, after ? item.nextSibling : item)
      })
    })
  }

  function saveOrder(container, kind) {
    var rids = Array.prototype.map.call(container.querySelectorAll('.adm-item'), function (n) {
      return n.getAttribute('data-rid')
    })
    fetch(API + '/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csrf: CSRF, kind: kind, orderedRids: rids }),
    })
      .then(function (r) { return r.json() })
      .then(function (j) {
        if (j.status === 200) { msg('success', 'Порядок сохранён'); loadTree() }
        else msg('error', 'Порядок: ' + (j.message || 'ошибка'))
      })
      .catch(function (e) { msg('error', 'Порядок: ' + e.message) })
  }

  // ============================================================
  //  Публикация / удаление
  // ============================================================
  function togglePublish(rid, isRubric, force) {
    var base = isRubric ? API + '/rubric/' : API + '/article/'
    var n = (isRubric ? state.children : state.articles).find(function (x) {
      return String(x.rid) === String(rid)
    })
    var curPub = n ? n.status === 'published' : false
    var pub = force == null ? !curPub : !!force
    fetch(base + encodeURIComponent(rid) + '/publish', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csrf: CSRF, publish: pub }),
    })
      .then(function (r) { return r.json() })
      .then(function (j) {
        if (j.status === 200) {
          msg('success', pub ? 'Опубликовано' : 'Снято с публикации')
          loadChildren(state.currentNode ? state.currentNode.rid : null, state.currentNode)
        } else msg('error', j.message || 'ошибка')
      })
      .catch(function (e) { msg('error', e.message) })
  }

  function deleteNode(rid, isRubric) {
    var what = isRubric ? 'рубрику со всем содержимым' : 'статью'
    if (!confirm('Удалить ' + what + '?')) return
    var base = isRubric ? API + '/rubric/' : API + '/article/'
    fetch(base + encodeURIComponent(rid), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csrf: CSRF }),
    })
      .then(function (r) { return r.json() })
      .then(function (j) {
        if (j.status === 200) { msg('success', 'Удалено'); loadChildren(state.currentNode ? state.currentNode.rid : null, state.currentNode); loadTree() }
        else msg('error', j.message || 'ошибка удаления')
      })
      .catch(function (e) { msg('error', e.message) })
  }

  // ============================================================
  //  Экран: редактор рубрики
  // ============================================================
  function switchView(id) {
    syncEditors()
    ;['view-list', 'view-rubric', 'view-article', 'view-search'].forEach(function (v) {
      el(v).style.display = v === id ? '' : 'none'
    })
  }

  function showRubric(rid, isNew) {
    switchView('view-rubric')
    state.editingRubric = isNew ? null : rid
    fillParentSelect('r-parent', rid)
    if (isNew) {
      el('rubric-title').textContent = 'Новая рубрика'
      ;['r-rid', 'r-title', 'r-url', 'r-h1', 'r-image', 'r-sort', 'r-description'].forEach(function (i) { el(i).value = '' })
      el('r-parent').value = state.currentNode ? state.currentNode.rid : ''
      setContent('r-content', '')
      renderRubricPubBar(null)
      el('rubric-save').textContent = el('rubric-save2').textContent = 'Создать'
      initEditor('r-content')
      return
    }
    el('rubric-title').textContent = 'Рубрика'
    fetch(API + '/rubric/' + encodeURIComponent(rid))
      .then(function (r) { return r.json() })
      .then(function (j) {
        if (!j.rubric) { msg('error', 'Рубрика не найдена'); return }
        var d = j.rubric
        el('r-rid').value = d.rid || ''
        el('r-title').value = titleOf(d.title)
        el('r-url').value = d.url || ''
        el('r-h1').value = d.h1 || ''
        el('r-image').value = d.image || ''
        el('r-sort').value = d.sortOrder != null ? d.sortOrder : ''
        el('r-description').value = d.description || ''
        setContent('r-content', titleOf(d.content))
        el('r-parent').value = d.parentRid || ''
        el('rubric-title').textContent = titleOf(d.title) || d.url
        renderRubricPubBar(d)
        el('rubric-save').textContent = el('rubric-save2').textContent = 'Сохранить'
        initEditor('r-content')
      })
      .catch(function (e) { msg('error', e.message) })
  }

  function renderRubricPubBar(d) {
    var lbl = el('rubric-pub-label')
    var btn = el('rubric-pub-toggle')
    if (!d || !d.rid) { lbl.textContent = ''; lbl.className = 'adm-pub-label'; btn.style.display = 'none'; return }
    btn.style.display = ''
    var pub = d.status === 'published'
    lbl.textContent = pub ? 'Опубликовано' : 'Черновик'
    lbl.className = 'adm-pub-label ' + (pub ? 'adm-pub-on' : 'adm-pub-off')
    btn.textContent = pub ? 'Снять с публикации' : 'Опубликовать'
    btn.onclick = function () { togglePublishR(d.rid, !pub) }
  }

  function togglePublishR(rid, pub) {
    fetch(API + '/rubric/' + encodeURIComponent(rid) + '/publish', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csrf: CSRF, publish: pub }),
    }).then(function (r) { return r.json() }).then(function (j) {
      if (j.status === 200) { msg('success', pub ? 'Опубликовано' : 'Снято'); showRubric(rid) }
      else msg('error', j.message || 'ошибка')
    }).catch(function (e) { msg('error', e.message) })
  }

  function fillParentSelect(selectId, selfRid) {
    fetch(API + '/tree')
      .then(function (r) { return r.json() })
      .then(function (j) {
        var nodes = j.tree || []
        var opts = '<option value="">— корень —</option>'
        nodes.forEach(function (n) {
          if (selfRid && String(n.rid) === String(selfRid)) return
          opts += '<option value="' + esc(n.rid) + '">' + esc(n.path || n.url) + '</option>'
        })
        el(selectId).innerHTML = opts
      })
      .catch(function () {})
  }

  function saveRubric() {
    var rid = el('r-rid').value
    var payload = {
      title: el('r-title').value.trim(),
      url: el('r-url').value.trim(),
      h1: el('r-h1').value.trim() || undefined,
      description: el('r-description').value || undefined,
      image: el('r-image').value.trim() || undefined,
      sortOrder: el('r-sort').value ? parseInt(el('r-sort').value, 10) : undefined,
      content: getContent('r-content') || undefined,
      parentRid: el('r-parent').value || null,
      csrf: CSRF,
    }
    var isNew = !rid
    fetch(isNew ? API + '/rubric' : API + '/rubric/' + encodeURIComponent(rid), {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j } }) })
      .then(function (o) {
        if (o.status >= 200 && o.status < 300) {
          msg('success', 'Сохранено')
          if (isNew && o.json.rid) go('#/rubric/' + encodeURIComponent(o.json.rid))
          loadTree()
        } else msg('error', o.json.message || ('HTTP ' + o.status))
      })
      .catch(function (e) { msg('error', e.message) })
  }

  // ============================================================
  //  Экран: редактор статьи
  // ============================================================
  function showArticle(rid, isNew) {
    switchView('view-article')
    state.editingArticle = isNew ? null : rid
    initEditor('a-content')
    if (isNew) {
      el('article-title').textContent = 'Новая статья'
      ;['a-rid', 'a-title', 'a-url', 'a-h1', 'a-description', 'a-keyword', 'a-author', 'a-tags', 'a-image', 'a-sort'].forEach(function (i) { el(i).value = '' })
      el('a-searchable').checked = true
      setContent('a-content', '')
      el('article-save').textContent = el('article-save2').textContent = 'Создать'
      renderArticlePubBar(null)
      fillRubricSelect(state.currentNode ? state.currentNode.rid : '')
      return
    }
    fetch(API + '/article/' + encodeURIComponent(rid))
      .then(function (r) { return r.json() })
      .then(function (j) {
        if (!j.article) { msg('error', 'Статья не найдена'); return }
        var d = j.article
        el('a-rid').value = d.rid || ''
        el('a-title').value = titleOf(d.title)
        el('a-url').value = d.url || ''
        el('a-h1').value = d.h1 || ''
        el('a-description').value = d.description || ''
        el('a-keyword').value = d.keyword || ''
        el('a-author').value = d.author || ''
        el('a-tags').value = titleOf(d.tags)
        el('a-image').value = d.image || ''
        el('a-sort').value = d.sortOrder != null ? d.sortOrder : ''
        el('a-searchable').checked = d.searchable !== false
        setContent('a-content', titleOf(d.content))
        el('article-title').textContent = titleOf(d.title) || d.url
        renderArticlePubBar(d)
        fillRubricSelect(d.rubricRid || '')
        el('article-save').textContent = el('article-save2').textContent = 'Сохранить'
      })
      .catch(function (e) { msg('error', e.message) })
  }

  function renderArticlePubBar(d) {
    var lbl = el('article-pub-label')
    var btn = el('article-pub-toggle')
    if (!d || !d.rid) { lbl.textContent = ''; lbl.className = 'adm-pub-label'; btn.style.display = 'none'; return }
    btn.style.display = ''
    var pub = d.status === 'published'
    lbl.textContent = pub ? 'Опубликовано' : 'Черновик'
    lbl.className = 'adm-pub-label ' + (pub ? 'adm-pub-on' : 'adm-pub-off')
    btn.textContent = pub ? 'Снять с публикации' : 'Опубликовать'
    btn.onclick = function () { togglePublish(d.rid, false, !pub) }
  }

  function fillRubricSelect(selected) {
    fetch(API + '/tree')
      .then(function (r) { return r.json() })
      .then(function (j) {
        var nodes = j.tree || []
        var opts = '<option value="">— выберите рубрику —</option>'
        nodes.forEach(function (n) {
          opts += '<option value="' + esc(n.rid) + '"' + (String(n.rid) === String(selected) ? ' selected' : '') + '>' + esc(n.path || n.url) + '</option>'
        })
        el('a-rubric').innerHTML = opts
      })
      .catch(function () {})
  }

  function saveArticle() {
    var rid = el('a-rid').value
    var rubricRid = el('a-rubric').value
    if (!rubricRid) { msg('error', 'Выберите рубрику (таб «Настройки»)'); return }
    var payload = {
      title: el('a-title').value.trim(),
      url: el('a-url').value.trim(),
      h1: el('a-h1').value.trim() || undefined,
      description: el('a-description').value || undefined,
      keyword: el('a-keyword').value || undefined,
      author: el('a-author').value || undefined,
      tags: el('a-tags').value || undefined,
      image: el('a-image').value.trim() || undefined,
      content: getContent('a-content') || undefined,
      sortOrder: el('a-sort').value ? parseInt(el('a-sort').value, 10) : undefined,
      searchable: el('a-searchable').checked,
      rubricRid: rubricRid,
      csrf: CSRF,
    }
    var isNew = !rid
    fetch(isNew ? API + '/article' : API + '/article/' + encodeURIComponent(rid), {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j } }) })
      .then(function (o) {
        if (o.status >= 200 && o.status < 300) {
          msg('success', 'Сохранено')
          // при смене рубрики у существующей статьи — перенести
          if (!isNew) return moveArticleIfNeeded(rid, rubricRid)
          if (o.json.rid) go('#/article/' + encodeURIComponent(o.json.rid))
        } else msg('error', o.json.message || ('HTTP ' + o.status))
      })
      .catch(function (e) { msg('error', e.message) })
  }

  function moveArticleIfNeeded(rid, rubricRid) {
    return fetch(API + '/article/' + encodeURIComponent(rid) + '/move', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csrf: CSRF, rubricRid: rubricRid }),
    })
      .then(function (r) { return r.json() })
      .then(function (j) {
        if (j.status === 200) loadTree()
        else msg('error', 'Перенос: ' + (j.message || 'ошибка'))
      })
      .catch(function (e) { msg('error', e.message) })
  }

  // ============================================================
  //  Табы редактора статьи
  // ============================================================
  Array.prototype.forEach.call(document.querySelectorAll('.artadm-tab'), function (tab) {
    tab.addEventListener('click', function () {
      var name = tab.getAttribute('data-tab')
      document.querySelectorAll('.artadm-tab').forEach(function (t) { t.classList.toggle('is-active', t === tab) })
      document.querySelectorAll('.artadm-tabpane').forEach(function (p) {
        var on = p.getAttribute('data-pane') === name
        p.classList.toggle('is-active', on)
        p.style.display = on ? '' : 'none'
      })
      if (name === 'content') initEditor('a-content')
    })
  })

  // ============================================================
  //  Поиск
  // ============================================================
  var searchTimer = null
  el('adm-search').addEventListener('input', function () {
    var q = this.value.trim()
    clearTimeout(searchTimer)
    if (q.length < 2) { if (parseHash().view === 'search') go('#/list') ; return }
    searchTimer = setTimeout(function () { doSearch(q) }, 300)
  })

  function doSearch(q) {
    fetch(API + '/search?q=' + encodeURIComponent(q))
      .then(function (r) { return r.json() })
      .then(function (j) {
        switchView('view-search')
        renderSearch('search-rubrics', j.rubrics || [], true)
        renderSearch('search-articles', j.articles || [], false)
      })
      .catch(function (e) { msg('error', e.message) })
  }

  function renderSearch(boxId, list, isRubric) {
    var box = el(boxId)
    box.innerHTML = ''
    if (!list.length) { box.innerHTML = '<div class="adm-empty">Ничего не найдено</div>'; return }
    list.forEach(function (n) {
      var item = document.createElement('div')
      item.className = 'adm-item'
      item.innerHTML = '<span class="adm-item-title">' + esc(titleOf(n.title) || n.url) + '</span>'
      item.addEventListener('click', function () {
        go((isRubric ? '#/rubric/' : '#/article/') + encodeURIComponent(n.rid))
      })
      box.appendChild(item)
    })
  }

  // ============================================================
  //  Dropzone (обложка + вставка <picture> в контент)
  // ============================================================
  function initDropzone(containerId, editorId) {
    if (!window.Dropzone || !el(containerId)) return
    if (state.dropzones[containerId]) return
    var dz = new window.Dropzone('#' + containerId, {
      url: UPLOAD_URL,
      acceptedFiles: 'image/jpeg,image/jpg,image/png,image/webp',
      uploadMultiple: false,
      parallelUploads: 1,
      addRemoveLinks: true,
      withCredentials: true,
      thumbnailWidth: 240,
      thumbnailHeight: 240,
      timeout: 300000,
      clickable: '#' + containerId + ' .adm-dropzone-hint',
    })
    state.dropzones[containerId] = dz
    dz.on('sending', function (file, xhr, formData) {
      formData.append('csrf', CSRF)
      formData.append('count', 1)
    })
    dz.on('success', function (file, response) {
      var body = response && response.body
      if (!body) { msg('error', 'Сервер не вернул данные изображения'); return }
      var scope = file.previewElement
      if (!scope) return
      // пути файлов для очистки с диска при удалении из дропзоны
      file.dzMeta = { files: body.files || [] }

      // вставка в контент по клику на миниатюру/детали
      function insert(ev) {
        if (ev && ev.target.closest && ev.target.closest('.dz-remove,.dz-cover-btn,.dz-progress')) return
        if (ev) { ev.preventDefault(); ev.stopPropagation() }
        var ed = editorFor(editorId)
        var html = pictureTag(body.resize, body.webpOriginal)
        if (ed) { ed.focus(); ed.insertContent(html) }
        else if (el(editorId)) el(editorId).value += html
        msg('success', 'Фото вставлено в текст')
      }
      ;['.dz-image', '.dz-details'].forEach(function (sel) {
        var node = scope.querySelector(sel)
        if (node) node.addEventListener('click', insert)
      })
      // фолбэк: если превью рендерилось без этих селекторов — клик по всей превью
      if (!scope.querySelector('.dz-image') && !scope.querySelector('.dz-details')) {
        scope.addEventListener('click', insert)
      }

      // кнопка «Сделать обложкой»: подставить ссылку главного webp в поле «Обложка (URL)».
      // Одна активная на форму.
      var cover = document.createElement('button')
      cover.type = 'button'
      cover.className = 'dz-cover-btn'
      cover.title = 'Использовать как обложку (поле «Обложка (URL)»)'
      cover.textContent = 'Сделать обложкой'
      var coverPath = body.webpOriginal && body.webpOriginal.pathFile
      cover.addEventListener('click', function (ev) {
        ev.preventDefault()
        ev.stopPropagation()
        var target = editorId === 'a-content' ? 'a-image' : 'r-image'
        if (!coverPath) { msg('error', 'Сервер не вернул ссылку на webp-изображение'); return }
        if (!el(target)) return
        el(target).value = coverPath
        // снять активность с кнопок других превью, отметить текущую
        var cont = scope && scope.parentNode
        ;(cont || document).querySelectorAll('.dz-cover-btn').forEach(function (b) {
          b.classList.remove('is-active')
        })
        cover.classList.add('is-active')
        msg('success', 'Обложка установлена')
      })
      scope.appendChild(cover)
    })
    dz.on('error', function (file, message) {
      msg('error', 'Загрузка: ' + (message && message.message ? message.message : message))
    })
    // удаление файлов с диска при удалении из дропзоны (крестик пользователя)
    dz.on('removedfile', function (file) {
      var meta = file.dzMeta
      if (meta && meta.files && meta.files.length) {
        fetch('/files/delete-image', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: meta.files, csrf: CSRF }),
        }).catch(function () {})
      }
    })
  }

  function pictureTag(resize, webpOriginal) {
    var W = [480, 960, 1280, 1920, 2700]
    var srcset = ''
    for (var i = W.length - 1; i >= 0; i--) {
      var s = resize && resize[W[i]]
      if (s && s.pathFile) { srcset = s.pathFile + ' ' + W[i] + 'w'; break }
    }
    var html = '<figure class="figure-picture-img"><picture>'
    if (srcset) html += '<source type="image/webp" srcset="' + srcset + '" />'
    if (webpOriginal && webpOriginal.pathFile) {
      html += '<img type="image/webp" loading="lazy" src="' + webpOriginal.pathFile + '" alt="" />'
    }
    html += '</picture></figure>'
    return html
  }

  // ============================================================
  //  Кнопки
  // ============================================================
  el('btn-new-rubric').onclick = function () { go('#/rubric/new') }
  el('btn-new-article').onclick = function () { go('#/article/new') }
  el('adm-add-root').onclick = function () { go('#/rubric/new') }
  ;['rubric-save', 'rubric-save2'].forEach(function (id) { el(id).onclick = saveRubric })
  ;['rubric-cancel', 'rubric-cancel2'].forEach(function (id) {
    el(id).onclick = function () { go('#/list' + (state.currentNode ? '?rid=' + encodeURIComponent(state.currentNode.rid) : '')) }
  })
  ;['article-save', 'article-save2'].forEach(function (id) { el(id).onclick = saveArticle })
  ;['article-cancel', 'article-cancel2'].forEach(function (id) {
    el(id).onclick = function () { go('#/list' + (state.currentNode ? '?rid=' + encodeURIComponent(state.currentNode.rid) : '')) }
  })

  // ============================================================
  //  Старт
  // ============================================================
  initDropzone('rubric-dropzone', 'r-content')
  initDropzone('article-dropzone', 'a-content')
  loadTree(function () { route() })
  if (!location.hash) location.hash = '#/list'
})()
