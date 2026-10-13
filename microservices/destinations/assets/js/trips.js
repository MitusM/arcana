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
    if (this._trips && this._trips.length) {
      this._renderDropdown(dropdown, btn)
    } else if (this._trips && this._trips.length === 0) {
      dropdown.innerHTML = '<div class="dest-add-trip-empty">Нет поездок. Создайте сначала.</div>'
    } else if (!this._loading) {
      this._loadTrips(dropdown, btn)
    }
  },

  close: function (dropdown) {
    dropdown.style.display = 'none'
  },

  _loadTrips: function (dropdown, btn) {
    var self = this
    self._loading = true
    dropdown.innerHTML = '<div class="dest-add-trip-loading">Загрузка…</div>'

    fetch('/destinations/my-trips')
      .then(function (r) { return r.json() })
      .then(function (data) {
        self._trips = data.trips || []
        self._loading = false
        self._renderDropdown(dropdown, btn)
      })
      .catch(function (err) {
        self._loading = false
        dropdown.innerHTML = '<div class="dest-add-trip-error">Ошибка загрузки</div>'
        console.error('DestTrips load error:', err)
      })
  },

  _renderDropdown: function (dropdown, btn) {
    var trips = this._trips
    if (!trips || !trips.length) {
      dropdown.innerHTML = '<div class="dest-add-trip-empty">Нет поездок</div>'
      return
    }

    var html = ''
    for (var i = 0; i < trips.length; i++) {
      var t = trips[i]
      html += '<a class="dest-add-trip-option" href="#" data-trip="' + (t._id || t.id || t['@rid']) + '">' +
        this._escapeHtml(t.title || 'Без названия') + '</a>'
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
          el.textContent = data.duplicated ? '✓ Уже добавлено' : '✓ Добавлено!'
        } else {
          el.textContent = '✗ Ошибка: ' + (data.error || 'неизвестная')
        }
        setTimeout(function () {
          // закрыть дропдаун
          var dd = el.parentNode
          if (dd) self.close(dd)
        }, 1500)
      })
      .catch(function (err) {
        el.textContent = '✗ Ошибка сети'
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