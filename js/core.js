/*
 * 核心邏輯（不依賴 DOM，可在 Node 中測試）
 * - 年級 / 學制 / 學期計算
 * - 時間（以分鐘表示，半小時為一格）
 * - 衝堂檢查
 * - 新學期建立與年級進階
 */
(function (root) {
  'use strict';

  const GRADES = ['小一', '小二', '小三', '小四', '小五', '小六', '國一', '國二', '國三', '高一', '高二', '高三'];
  const STAGES = [
    { name: '國小', from: 0, to: 5 },
    { name: '國中', from: 6, to: 8 },
    { name: '高中', from: 9, to: 11 },
  ];
  const DAYS = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
  const DAYS_SHORT = ['一', '二', '三', '四', '五', '六', '日'];
  const SLOT = 30; // 分鐘

  const PALETTE = ['#2a78d6', '#e0582e', '#1f9e6e', '#8a5cd1', '#d4488f', '#c98a12', '#15919b', '#6b7a1f', '#b8463b', '#4a5fc1'];

  let uidCounter = 0;
  function uid(prefix) {
    uidCounter += 1;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + uidCounter.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------- 時間 ---------- */
  function fmtTime(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  function parseTime(str) {
    const [h, m] = String(str).split(':').map(Number);
    return h * 60 + (m || 0);
  }
  function timeOptions(dayStart, dayEnd) {
    const out = [];
    for (let t = dayStart; t <= dayEnd; t += SLOT) out.push(t);
    return out;
  }
  function overlaps(a, b) {
    return a.day === b.day && a.start < b.end && b.start < a.end;
  }
  function hours(min) {
    return Math.round((min / 60) * 10) / 10;
  }

  /* ---------- 學期 ---------- */
  function termKey(t) {
    return t.year * 2 + (t.sem === '下' ? 1 : 0);
  }
  function termName(t) {
    return t.year + t.sem;
  }
  function nextTerm(t) {
    return t.sem === '上' ? { year: t.year, sem: '下' } : { year: t.year + 1, sem: '上' };
  }
  function sortTerms(terms) {
    return terms.slice().sort((a, b) => termKey(a) - termKey(b));
  }

  /* ---------- 年級 / 班級 ---------- */
  function stageOf(gradeIdx) {
    return STAGES.find((s) => gradeIdx >= s.from && gradeIdx <= s.to) || null;
  }
  function gradeAt(cls, year) {
    if (cls.anchorGrade == null) return null;
    return cls.anchorGrade + (year - cls.anchorYear);
  }
  function gradeName(idx) {
    if (idx == null) return '';
    if (idx < 0) return '未入學';
    return GRADES[idx] || '已畢業';
  }
  /**
   * 班級在某學年的狀態
   * future: 尚未開班 / active: 上課中 / graduating: 畢業班 / graduated: 已畢業 / archived: 已結束
   */
  function classStatus(cls, year) {
    if (year < cls.startYear) return 'future';
    if (cls.endYear != null && year > cls.endYear) return 'archived';
    const g = gradeAt(cls, year);
    if (g == null) return 'active';
    if (g < 0) return 'future';
    const stage = stageOf(cls.anchorGrade);
    const end = stage ? stage.to : GRADES.length - 1;
    if (g > end) return 'graduated';
    if (g === end) return 'graduating';
    return 'active';
  }
  function isActive(cls, year) {
    const s = classStatus(cls, year);
    return s === 'active' || s === 'graduating';
  }
  function className(cls, year) {
    const g = gradeAt(cls, year);
    return gradeName(g) + cls.subject + (cls.label ? ' ' + cls.label : '');
  }
  function shortClassName(cls, year) {
    const g = gradeAt(cls, year);
    return gradeName(g) + cls.subject;
  }

  /* ---------- 查詢 ---------- */
  function byId(list, id) {
    return list.find((x) => x.id === id) || null;
  }
  function termSessions(data, termId) {
    return data.sessions.filter((s) => s.termId === termId);
  }

  /* ---------- 衝堂檢查 ---------- */
  function findConflicts(data, cand, ignoreId) {
    const term = byId(data.terms, cand.termId);
    const year = term ? term.year : 0;
    const msgs = [];
    if (cand.end <= cand.start) {
      msgs.push('結束時間必須晚於開始時間');
      return msgs;
    }
    const describe = (s) => {
      const cls = byId(data.classes, s.classId);
      const br = cls ? byId(data.branches, cls.branchId) : null;
      return (br ? br.name + ' ' : '') + (cls ? className(cls, year) : '?') + '（' + DAYS[s.day] + ' ' + fmtTime(s.start) + '–' + fmtTime(s.end) + '）';
    };
    for (const s of data.sessions) {
      if (s.id === ignoreId || s.termId !== cand.termId || !overlaps(s, cand)) continue;
      if (cand.teacherId && s.teacherId === cand.teacherId) {
        msgs.push('講師衝堂：已排 ' + describe(s));
      } else if (s.classId === cand.classId) {
        msgs.push('班級衝堂：同班已有 ' + describe(s));
      }
    }
    if (cand.teacherId) {
      for (const b of data.blocks) {
        if (b.termId === cand.termId && b.teacherId === cand.teacherId && overlaps(b, cand)) {
          msgs.push('講師不可排時段：' + DAYS[b.day] + ' ' + fmtTime(b.start) + '–' + fmtTime(b.end) + (b.note ? '（' + b.note + '）' : ''));
        }
      }
    }
    return msgs;
  }

  /* ---------- 課表排版（重疊時分欄） ---------- */
  function layoutLanes(items) {
    const byDay = {};
    items.forEach((it) => (byDay[it.day] = byDay[it.day] || []).push(it));
    Object.values(byDay).forEach((list) => {
      list.sort((a, b) => a.start - b.start || b.end - a.end);
      let cluster = [];
      let clusterEnd = -1;
      const flush = () => {
        const lanes = [];
        cluster.forEach((it) => {
          let lane = lanes.findIndex((end) => end <= it.start);
          if (lane === -1) {
            lane = lanes.length;
            lanes.push(0);
          }
          lanes[lane] = it.end;
          it.lane = lane;
        });
        cluster.forEach((it) => (it.lanes = lanes.length));
        cluster = [];
      };
      list.forEach((it) => {
        if (cluster.length && it.start >= clusterEnd) flush();
        cluster.push(it);
        clusterEnd = Math.max(clusterEnd, it.end);
      });
      if (cluster.length) flush();
    });
    return items;
  }

  /* ---------- 新學期 / 年級進階 ---------- */
  function planNewTerm(data, sourceTermId, target) {
    const src = byId(data.terms, sourceTermId);
    if (!src) return [];
    return data.classes
      .filter((c) => isActive(c, src.year))
      .map((c) => {
        const status = classStatus(c, target.year);
        const g = gradeAt(c, src.year);
        const stage = g == null ? null : stageOf(c.anchorGrade);
        const canContinue = status === 'graduated' && stage && stage.to + 1 < GRADES.length;
        return {
          classId: c.id,
          from: className(c, src.year),
          to: isActive(c, target.year) ? className(c, target.year) : null,
          status,
          promoted: target.year > src.year && g != null,
          canContinue,
          continueTo: canContinue ? gradeName(stage.to + 1) + c.subject + (c.label ? ' ' + c.label : '') : null,
        };
      });
  }

  /**
   * 建立新學期。跨學年時，班級年級自動 +1；畢業班不再出現，
   * 可選擇延續為下一學制的新班級（例如 國三數學 → 高一數學）。
   */
  function applyNewTerm(data, sourceTermId, target, opts) {
    opts = opts || {};
    const src = byId(data.terms, sourceTermId);
    if (data.terms.some((t) => t.year === target.year && t.sem === target.sem)) {
      throw new Error('學期 ' + termName(target) + ' 已存在');
    }
    const term = { id: uid('term'), year: target.year, sem: target.sem };
    data.terms.push(term);
    if (!src) return term;

    const continueIds = new Set(opts.continueIds || []);
    const classMap = {}; // 舊班級 id -> 新學期使用的班級 id
    data.classes
      .filter((c) => isActive(c, src.year))
      .forEach((c) => {
        if (isActive(c, target.year)) {
          classMap[c.id] = c.id;
        } else if (continueIds.has(c.id) && classStatus(c, target.year) === 'graduated' && c.anchorGrade != null) {
          const stage = stageOf(c.anchorGrade);
          if (stage && stage.to + 1 < GRADES.length) {
            const nc = {
              id: uid('cls'),
              branchId: c.branchId,
              subject: c.subject,
              label: c.label,
              anchorGrade: stage.to + 1,
              anchorYear: target.year,
              startYear: target.year,
              endYear: null,
              note: c.note || '',
            };
            data.classes.push(nc);
            classMap[c.id] = nc.id;
          }
        }
      });

    if (opts.copySessions) {
      termSessions(data, src.id).forEach((s) => {
        const cid = classMap[s.classId];
        if (!cid) return;
        data.sessions.push(Object.assign({}, s, { id: uid('ses'), termId: term.id, classId: cid, teacherId: opts.keepTeachers === false ? null : s.teacherId }));
      });
    }
    if (opts.copyBlocks) {
      data.blocks
        .filter((b) => b.termId === src.id)
        .forEach((b) => data.blocks.push(Object.assign({}, b, { id: uid('blk'), termId: term.id })));
    }
    return term;
  }

  /* ---------- 分校展示資料（只含該分校，不含其他分校與講師私人資訊） ---------- */
  function buildBranchView(data, branchId) {
    const branch = byId(data.branches, branchId);
    if (!branch) return null;
    const classes = data.classes.filter((c) => c.branchId === branchId);
    const ids = new Set(classes.map((c) => c.id));
    const sessions = data.sessions
      .filter((s) => ids.has(s.classId))
      .map((s) => ({ id: s.id, termId: s.termId, classId: s.classId, teacherId: s.teacherId, day: s.day, start: s.start, end: s.end, note: s.note || '' }));
    const tids = new Set(sessions.map((s) => s.teacherId).filter(Boolean));
    return {
      version: 1,
      settings: Object.assign({}, data.settings),
      branch: { id: branch.id, name: branch.name, color: branch.color },
      branches: [{ id: branch.id, name: branch.name, color: branch.color }],
      teachers: data.teachers.filter((t) => tids.has(t.id)).map((t) => ({ id: t.id, name: t.name, color: t.color })),
      classes: classes.map((c) => ({ id: c.id, branchId: c.branchId, subject: c.subject, label: c.label, anchorGrade: c.anchorGrade, anchorYear: c.anchorYear, startYear: c.startYear, endYear: c.endYear })),
      terms: data.terms.map((t) => ({ id: t.id, year: t.year, sem: t.sem })),
      sessions,
    };
  }

  /** 依日期推算目前學期（8 月起為上學期，2–7 月為下學期），找不到就用最接近的學期 */
  function defaultTerm(terms, date) {
    if (!terms.length) return null;
    const d = date || new Date();
    const roc = d.getFullYear() - 1911;
    const m = d.getMonth() + 1;
    const now = m >= 8 ? { year: roc, sem: '上' } : { year: roc - 1, sem: m >= 2 ? '下' : '上' };
    const sorted = sortTerms(terms);
    const exact = sorted.find((t) => t.year === now.year && t.sem === now.sem);
    if (exact) return exact;
    const past = sorted.filter((t) => termKey(t) <= termKey(now));
    return past.length ? past[past.length - 1] : sorted[0];
  }

  const api = {
    GRADES, STAGES, DAYS, DAYS_SHORT, SLOT, PALETTE,
    uid, fmtTime, parseTime, timeOptions, overlaps, hours,
    termKey, termName, nextTerm, sortTerms,
    stageOf, gradeAt, gradeName, classStatus, isActive, className, shortClassName,
    byId, termSessions, findConflicts, layoutLanes, planNewTerm, applyNewTerm, buildBranchView, defaultTerm,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
