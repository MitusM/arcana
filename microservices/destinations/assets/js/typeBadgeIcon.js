/**
 * typeBadgeIcon.js — иконка типа объекта в бейдже (dest-type-badge-icon)
 * Вставляет инлайн-SVG по data-icon (slug типа: lake, waterfall, mountain…).
 * Иконки — те же формы, что в markers (maps renderMapHtml.js TYPE_SVG),
 * но перекрашены в тёмный #374151 на светлом кружке бейджа.
 */
const TYPE_SVG = {
  lake: '<svg viewBox="0 0 15 15" width="38" height="38"><path d="M1 11c3-2 6-2 9 0l2-3c-3-1-6-2-9 0z" fill="#374151" stroke="none"/></svg>',
  waterfall: '<svg viewBox="0 0 15 15" width="38" height="38"><path d="M5 2v8l3-2 2 2V1M3 11v3h9v-3" fill="none" stroke="#374151" stroke-width="1.5" stroke-linecap="round"/></svg>',
  mountain: '<svg viewBox="0 0 15 15" width="38" height="38"><path d="M7.5 2L2 12h11z" fill="#374151"/></svg>',
  peak: '<svg viewBox="0 0 15 15" width="38" height="38"><path d="M7.5 1L4 9h2l1.5-3L9 9h2z" fill="#374151"/></svg>',
  cave: '<svg viewBox="0 0 15 15" width="38" height="38"><path d="M1 12c0-2 2-4 6.5-4S14 10 14 12M3 9V6h9v3" fill="none" stroke="#374151" stroke-width="1.5" stroke-linecap="round"/></svg>',
  river: '<svg viewBox="0 0 15 15" width="38" height="38"><path d="M1 3c3 3 5-2 8 0 2 1 4 0 5-1M1 8c3 2 5-2 8 0 2 2 4 0 5-1M1 13c3 1 5-2 8 0 2 1 4 0 5-1" fill="none" stroke="#374151" stroke-width="1" stroke-linecap="round"/></svg>',
  valley: '<svg viewBox="0 0 15 15" width="38" height="38"><path d="M1 3c2 4 3 0 6 6 2-5 4 0 7-6" fill="none" stroke="#374151" stroke-width="1.5" stroke-linecap="round"/></svg>',
  beach: '<svg viewBox="0 0 15 15" width="38" height="38"><path d="M1 11c1-1 3-2 6.5-2S14 10 14 11H1z" fill="#374151"/><path d="M3 11V8h9v3" fill="none" stroke="#374151" stroke-width="1.2"/></svg>',
  island: '<svg viewBox="0 0 15 15" width="38" height="38"><ellipse cx="7.5" cy="10" rx="6" ry="3" fill="#374151"/><path d="M7.5 10L5 6h5z" fill="#374151"/></svg>',
  park: '<svg viewBox="0 0 15 15" width="38" height="38"><path d="M7.5 2L4 8h2l-.5 5h4l-.5-5h2z" fill="#374151"/></svg>',
  reserve: '<svg viewBox="0 0 15 15" width="38" height="38"><path d="M7 3l-3 5h2l-1 5h6l-1-5h2z" fill="#374151"/></svg>',
  museum: '<svg viewBox="0 0 15 15" width="38" height="38"><path d="M7.5 1L2 4v1h11V4zM3 6v5l-1 1v1h11v-1l-1-1V6" fill="#374151"/></svg>',
  viewpoint: '<svg viewBox="0 0 15 15" width="38" height="38"><circle cx="7.5" cy="7.5" r="2" fill="#374151"/><circle cx="7.5" cy="7.5" r="4.5" fill="none" stroke="#374151" stroke-width="1.2"/></svg>',
  spring: '<svg viewBox="0 0 15 15" width="38" height="38"><ellipse cx="7.5" cy="10" rx="3.5" ry="3" fill="#374151"/><path d="M5 8c1-3 2-4 2.5-6.5" fill="none" stroke="#374151" stroke-width="1.2" stroke-linecap="round"/></svg>'
};

export default function initTypeBadgeIcon () {
  document.querySelectorAll('.dest-type-badge-icon').forEach((el) => {
    const slug = el.getAttribute('data-icon');
    const svg = slug && TYPE_SVG[slug];
    if (svg && !el.querySelector('svg')) el.innerHTML = svg;
  });
}