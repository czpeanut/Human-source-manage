/* 半小時為單位的週課表元件：可拖曳選取時段、點擊課程編輯 */
(function (root) {
  'use strict';
  const C = root.Core;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /**
   * opts: {
   *   dayStart, dayEnd,                          // 分鐘
   *   items: [{ id, kind, day, start, end, title, sub, meta, color, cls }],
   *   onSelect(day, start, end),                 // 拖曳選取空白時段
   *   onItem(kind, id),                          // 點擊課程
   * }
   */
  function render(container, opts) {
    const { dayStart, dayEnd } = opts;
    const rows = Math.max(1, (dayEnd - dayStart) / C.SLOT);
    const items = C.layoutLanes(opts.items.map((x) => Object.assign({}, x)))
      .filter((x) => x.end > dayStart && x.start < dayEnd);

    let head = '<div class="tt-corner"></div>';
    C.DAYS.forEach((d, i) => { head += '<div class="tt-day' + (i >= 5 ? ' weekend' : '') + '">' + d + '</div>'; });

    let times = '';
    for (let r = 0; r < rows; r++) {
      const t = dayStart + r * C.SLOT;
      times += '<div class="tt-time' + (t % 60 === 0 ? ' hour' : '') + '">' + C.fmtTime(t) + '</div>';
    }

    let cols = '';
    for (let d = 0; d < 7; d++) {
      let slots = '';
      for (let r = 0; r < rows; r++) {
        const t = dayStart + r * C.SLOT;
        slots += '<div class="tt-slot' + (t % 60 === 0 ? ' hour' : '') + '" data-day="' + d + '" data-slot="' + r + '"></div>';
      }
      let blocks = '';
      items.filter((it) => it.day === d).forEach((it) => {
        const s = Math.max(it.start, dayStart);
        const e = Math.min(it.end, dayEnd);
        const top = ((s - dayStart) / C.SLOT);
        const h = ((e - s) / C.SLOT);
        const w = 100 / it.lanes;
        const style = 'top:calc(var(--h) * ' + top + ');height:calc(var(--h) * ' + h + ' - 2px);' +
          'left:calc(' + (w * it.lane) + '% + 2px);width:calc(' + w + '% - 4px);' +
          (it.color ? '--c:' + it.color + ';' : '');
        blocks += '<button type="button" class="tt-item ' + esc(it.cls || '') + (h <= 2 ? ' compact' : '') + '" style="' + style + '" data-kind="' + esc(it.kind) + '" data-id="' + esc(it.id) + '" title="' + esc([it.title, it.sub, C.fmtTime(it.start) + '–' + C.fmtTime(it.end), it.meta].filter(Boolean).join('\n')) + '">' +
          '<span class="tt-item-time">' + C.fmtTime(it.start) + '–' + C.fmtTime(it.end) + '</span>' +
          '<span class="tt-item-title">' + esc(it.title) + '</span>' +
          (it.sub ? '<span class="tt-item-sub">' + esc(it.sub) + '</span>' : '') +
          (it.badge ? '<span class="tt-badge">' + esc(it.badge) + '</span>' : '') +
          '</button>';
      });
      cols += '<div class="tt-col' + (d >= 5 ? ' weekend' : '') + '" data-day="' + d + '">' + slots + blocks + '</div>';
    }

    container.innerHTML =
      '<div class="tt-scroll"><div class="tt" style="--rows:' + rows + '">' +
      '<div class="tt-head">' + head + '</div>' +
      '<div class="tt-body"><div class="tt-times">' + times + '</div>' + cols + '</div>' +
      '</div></div>';

    // 點擊課程
    container.querySelectorAll('.tt-item').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        opts.onItem && opts.onItem(el.dataset.kind, el.dataset.id);
      });
    });

    // 拖曳選取空白時段
    let sel = null;
    const paint = () => {
      container.querySelectorAll('.tt-slot.sel').forEach((el) => el.classList.remove('sel'));
      if (!sel) return;
      const a = Math.min(sel.from, sel.to);
      const b = Math.max(sel.from, sel.to);
      container.querySelectorAll('.tt-slot[data-day="' + sel.day + '"]').forEach((el) => {
        const r = +el.dataset.slot;
        if (r >= a && r <= b) el.classList.add('sel');
      });
    };
    const slotAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el && el.classList && el.classList.contains('tt-slot') ? el : null;
    };
    const body = container.querySelector('.tt-body');
    let touchTap = false;
    body.addEventListener('pointerdown', (ev) => { touchTap = ev.pointerType === 'touch'; }, true);
    body.addEventListener('pointerdown', (ev) => {
      const el = ev.target.closest('.tt-slot');
      if (!el || ev.button > 0) return;
      if (ev.pointerType === 'touch') return; // 觸控裝置：以點擊處理，保留捲動
      ev.preventDefault();
      sel = { day: +el.dataset.day, from: +el.dataset.slot, to: +el.dataset.slot };
      paint();
      const move = (e) => {
        const s = slotAt(e.clientX, e.clientY);
        if (s && +s.dataset.day === sel.day) { sel.to = +s.dataset.slot; paint(); }
      };
      const cleanup = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', cancel);
      };
      const cancel = () => { cleanup(); sel = null; paint(); };
      const up = () => {
        cleanup();
        const a = Math.min(sel.from, sel.to);
        const b = Math.max(sel.from, sel.to);
        const day = sel.day;
        sel = null;
        paint();
        // 單點一格時預設排 1.5 小時（可在視窗中調整）
        const start = dayStart + a * C.SLOT;
        let end = dayStart + (b + 1) * C.SLOT;
        if (a === b) end = Math.min(dayEnd, start + 3 * C.SLOT);
        opts.onSelect && opts.onSelect(day, start, end);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', cancel);
    });
    body.addEventListener('click', (ev) => {
      if (!touchTap) return;
      touchTap = false;
      const el = ev.target.closest('.tt-slot');
      if (!el) return;
      const start = dayStart + (+el.dataset.slot) * C.SLOT;
      opts.onSelect && opts.onSelect(+el.dataset.day, start, Math.min(dayEnd, start + 3 * C.SLOT));
    });
  }

  root.Grid = { render, esc };
})(window);
