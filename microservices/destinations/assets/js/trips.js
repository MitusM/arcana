// ============================================================
// trips.js — кнопка «В поездку» (DestTrips)
// Вызывается из шаблона page/dest.html
// ============================================================
window.DestTrips = {
  // кеш поездок (загружаем один раз за сессию)
  _trips: null,
  _loading: false,

  // открыть/закрыть дропдаун
  open: function (btn) {
    var dropdown = btn.parentNode.querySelector('.dest-add-trip-dropdown')
    if (!dropdown) return

    // если уже открыт — закрыть
    if (dropdown.style.display === 'block') {
      this.close(dropdown)
      return
    }

    // закрыть все другие дропдауны (на случай если кнопок несколько)
    var all = document.querySelectorAll('.dest-add-trip-dropdown')
    for (var i = 0; i < all.length; i++) all[i].style.display = 'none'

    dropdown.style.display = 'block'

    // подгрузить поездки если ещё нет
    if (this._trips) {
      if (this._trips.length) {
        this._renderDropdown(dropdown, btn)
      } else {
        this._renderEmpty(dropdown)
      }
    } else if (!this._loading) {
      this._loadTrips(dropdown, btn)
    }
  },

  close: function (dropdown) {
    dropdown.style.display = 'none'
  },

  // параметры места из кнопки (для отметки «уже в поездке»)
  _placeOf: function (btn) {
    return {
      name: btn.getAttribute('data-name') || '',
      lat: btn.getAttribute('data-lat') || '',
      lng: btn.getAttribute('data-lng') || '',
      osmId: btn.getAttribute('data-osm-id') || '',
    }
  },

  _loadTrips: function (dropdown, btn) {
    var self = this
    self._loading = true
    dropdown.innerHTML = '<div class="dest-add-trip-loading">Загрузка…</div>'

    var p = this._placeOf(btn)
    var qs = []
    if (p.osmId) qs.push('osmId=' + encodeURIComponent(p.osmId))
    if (p.name) qs.push('name=' + encodeURIComponent(p.name))
    if (p.lat !== '') qs.push('lat=' + encodeURIComponent(p.lat))
    if (p.lng !== '') qs.push('lng=' + encodeURIComponent(p.lng))
    var url = '/destinations/my-trips' + (qs.length ? '?' + qs.join('&') : '')

    fetch(url)
      .then(function (r) {
        // неавторизован — предлагаем войти, а не «ошибка загрузки»
        if (r.status === 401) {
          self._loading = false
          self._trips = null
          self._renderLogin(dropdown)
          return null
        }
        return r.json()
      })
      .then(function (data) {
        if (!data) return
        self._trips = data.trips || []
        self._loading = false
        if (self._trips.length) {
          self._renderDropdown(dropdown, btn)
        } else {
          self._renderEmpty(dropdown)
        }
      })
      .catch(function (err) {
        self._loading = false
        dropdown.innerHTML = '<div class="dest-add-trip-error">Ошибка загрузки</div>'
        console.error('DestTrips load error:', err)
      })
  },

  // пустой список поездок — с CTA создать первую
  _renderEmpty: function (dropdown) {
    dropdown.innerHTML =
      '<div class="dest-add-trip-empty">Нет поездок. Создайте сначала.</div>' +
      '<a class="dest-add-trip-create" href="/trips/">Создать поездку →</a>'
  },

  // неавторизован — ссылка на вход
  _renderLogin: function (dropdown) {
    dropdown.innerHTML =
      '<div class="dest-add-trip-empty">Войдите, чтобы добавить в поездку.</div>' +
      '<a class="dest-add-trip-create" href="/auth/login">Войти →</a>'
  },

  _renderDropdown: function (dropdown, btn) {
    var trips = this._trips
    if (!trips || !trips.length) {
      this._renderEmpty(dropdown)
      return
    }

    var html = ''
    for (var i = 0; i < trips.length; i++) {
      var t = trips[i]
      var tripId = t._id || t.id || t['@rid']
      html +=
        '<a class="dest-add-trip-option' +
        (t.hasPlace ? ' dest-add-trip-option--has' : '') +
        '" href="#" data-trip="' + this._escapeHtml(tripId) + '">' +
        this._escapeHtml(t.title || 'Без названия') +
        (t.hasPlace ? '<span class="dest-add-trip-has">✓ уже добавлено</span>' : '') +
        '</a>'
    }
    dropdown.innerHTML = html

    // вешаем обработчики на option
    var opts = dropdown.querySelectorAll('.dest-add-trip-option')
    var self = this
    var name = btn.getAttribute('data-name')
    var lat = btn.getAttribute('data-lat')
    var lng = btn.getAttribute('data-lng')
    var osmId = btn.getAttribute('data-osm-id') || null

    for (var j = 0; j < opts.length; j++) {
      opts[j].addEventListener('click', (function (opt) {
        return function (e) {
          e.preventDefault()
          self._addToTrip(opt.getAttribute('data-trip'), name, lat, lng, osmId, opt)
        }
      })(opts[j]))
    }
  },

  _addToTrip: function (tripId, name, lat, lng, osmId, el) {
    var self = this
    el.textContent = 'Добавляю…'
    el.style.pointerEvents = 'none'

    fetch('/destinations/add-to-trip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tripId: tripId,
        name: name,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        osmId: osmId,
      }),
    })
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (data.place) {
          // ссылка на поездку, не закрываем дропдаун сразу
          var label = data.duplicated ? '✓ Уже добавлено' : '✓ Добавлено!'
          el.innerHTML =
            label +
            ' <a class="dest-add-trip-open" href="/trips/map/' +
            encodeURIComponent(tripId) +
            '">Открыть поездку →</a>'
          el.classList.add('dest-add-trip-option--has')
        } else if (data.error === 'unauthorized') {
          el.textContent = 'Войдите, чтобы добавить'
        } else {
          el.textContent = '✗ Ошибка: ' + (data.error || 'неизвестная')
        }
        // если добавили — больше не даём жать повторно в этой же сессии
        if (data.place) el.style.pointerEvents = 'none'
        else el.style.pointerEvents = ''
      })
      .catch(function (err) {
        el.textContent = '✗ Ошибка сети'
        el.style.pointerEvents = ''
        console.error('DestTrips add error:', err)
      })
  },

  _escapeHtml: function (s) {
    if (!s) return ''
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  },
}
