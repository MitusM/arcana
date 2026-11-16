/**
 * topbar.js — shrink-on-scroll для .top-bar
 *
 * При прокрутке вниз: добавляет класс .scrolled → лого уменьшается
 * до высоты navbar, breadcrumb скрывается.
 * При прокрутке наверх: класс убирается.
 *
 * Использует requestAnimationFrame для производительности.
 */

export default function initTopbar () {
  const topBar = document.querySelector('.top-bar')

  if (!topBar) return

  let ticking = false

  const onScroll = () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        topBar.classList.toggle('scrolled', window.scrollY > 0)
        ticking = false
      })
      ticking = true
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
}