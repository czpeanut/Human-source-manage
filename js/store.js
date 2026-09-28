/* 資料儲存（瀏覽器 localStorage），並提供範例資料與匯入匯出 */
(function (root) {
  'use strict';
  const C = root.Core;
  const KEY = 'hsm-data-v1';
  const UI_KEY = 'hsm-ui-v1';

  function empty() {
    return {
      version: 1,
      settings: { dayStart: 8 * 60, dayEnd: 22 * 60 },
      teachers: [],
      branches: [],
      classes: [],
      terms: [],
      sessions: [],
      blocks: [],
    };
  }

  function sample() {
    const d = empty();
    const t = (name, color) => { const x = { id: C.uid('tch'), name, color, note: '' }; d.teachers.push(x); return x; };
    const b = (name, color) => { const x = { id: C.uid('br'), name, color, note: '' }; d.branches.push(x); return x; };
    const yiyan = t('沂彥', C.PALETTE[0]);
    const chenxin = t('陳新', C.PALETTE[1]);
    const tainan = b('台南', C.PALETTE[2]);
    const mingdao = b('明道', C.PALETTE[3]);
    const taipei = b('台北', C.PALETTE[4]);

    const term = { id: C.uid('term'), year: 115, sem: '下' };
    d.terms.push(term);
    const cls = (branch, grade, subject, label) => {
      const x = { id: C.uid('cls'), branchId: branch.id, subject, label: label || '', anchorGrade: C.GRADES.indexOf(grade), anchorYear: 115, startYear: 115, endYear: null, note: '' };
      d.classes.push(x);
      return x;
    };
    const ses = (c, teacher, day, start, end, note) => {
      d.sessions.push({ id: C.uid('ses'), termId: term.id, classId: c.id, teacherId: teacher ? teacher.id : null, day, start: C.parseTime(start), end: C.parseTime(end), note: note || '' });
    };

    // 沂彥
    const tnH2 = cls(tainan, '高二', '數學');
    const mdH1 = cls(mingdao, '高一', '數學');
    const mdJ3 = cls(mingdao, '國三', '數學');
    const mdJ2 = cls(mingdao, '國二', '數學');
    ses(tnH2, yiyan, 0, '18:30', '21:00');
    ses(mdH1, yiyan, 1, '18:30', '21:00');
    ses(mdJ3, yiyan, 2, '18:30', '21:00');
    ses(mdJ2, yiyan, 3, '18:30', '21:00');
    ses(mdJ3, yiyan, 5, '17:00', '18:30', '會考衝刺');
    d.blocks.push({ id: C.uid('blk'), termId: term.id, teacherId: yiyan.id, day: 6, start: C.parseTime('18:00'), end: C.parseTime('22:00'), note: '無法接' });

    // 陳新
    const mdJ1 = cls(mingdao, '國一', '英文');
    const tpJ2 = cls(taipei, '國二', '英文');
    const tpJ3 = cls(taipei, '國三', '英文');
    const tpH1 = cls(taipei, '高一', '英文');
    const tpH2 = cls(taipei, '高二', '英文', 'A班');
    const tpE6 = cls(taipei, '小六', '英文');
    ses(mdJ1, chenxin, 0, '18:30', '21:00');
    ses(mdJ1, chenxin, 3, '18:30', '20:00');
    ses(tpJ2, chenxin, 1, '18:30', '21:00');
    ses(tpJ3, chenxin, 2, '18:30', '21:00');
    ses(tpH1, chenxin, 4, '18:30', '21:00');
    ses(tpE6, chenxin, 5, '09:00', '12:00');
    ses(tpH2, chenxin, 5, '13:30', '16:30');
    ses(tpJ3, chenxin, 5, '18:00', '21:00');
    ses(tpJ2, chenxin, 6, '09:00', '11:30');
    ses(tpH1, chenxin, 6, '13:00', '16:00');
    // 尚未指派講師
    const tnJ1 = cls(tainan, '國一', '自然');
    ses(tnJ1, null, 2, '19:00', '21:00');

    // 以「建立新學期」產生 116 上，示範年級自動進階與畢業
    C.applyNewTerm(d, term.id, { year: 116, sem: '上' }, { copySessions: true, copyBlocks: true, continueIds: [tpE6.id] });
    return d;
  }

  function normalize(d) {
    const base = empty();
    const out = Object.assign(base, d || {});
    out.settings = Object.assign(empty().settings, out.settings || {});
    ['teachers', 'branches', 'classes', 'terms', 'sessions', 'blocks'].forEach((k) => {
      if (!Array.isArray(out[k])) out[k] = [];
    });
    return out;
  }

  const Store = {
    data: null,
    ui: {},
    listeners: [],
    load() {
      let raw = null;
      try { raw = localStorage.getItem(KEY); } catch (e) { /* 無法使用儲存空間 */ }
      if (raw) {
        try { this.data = normalize(JSON.parse(raw)); } catch (e) { this.data = sample(); }
      } else {
        this.data = sample();
      }
      try { this.ui = JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch (e) { this.ui = {}; }
    },
    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
      this.listeners.forEach((fn) => fn());
    },
    saveUI() {
      try { localStorage.setItem(UI_KEY, JSON.stringify(this.ui)); } catch (e) { /* ignore */ }
    },
    replace(d) {
      this.data = normalize(d);
      this.save();
    },
    reset(withSample) {
      this.data = withSample ? sample() : empty();
      this.save();
    },
    exportJSON() {
      return JSON.stringify(this.data, null, 2);
    },
    onChange(fn) {
      this.listeners.push(fn);
    },
  };

  root.Store = Store;
})(window);
