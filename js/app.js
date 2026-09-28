/* 補習班講師人力管理系統 — 主程式 */
(function () {
  'use strict';
  const C = window.Core;
  const S = window.Store;
  const Sync = window.Sync;
  const esc = window.Grid.esc;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  const D = () => S.data;
  const ui = () => S.ui;

  /* ================= 共用 ================= */
  function currentTerm() {
    const d = D();
    let t = C.byId(d.terms, ui().termId);
    if (!t) {
      const sorted = C.sortTerms(d.terms);
      t = sorted[sorted.length - 1] || null;
      if (t) { ui().termId = t.id; S.saveUI(); }
    }
    return t;
  }
  function ensureTerm() {
    const d = D();
    if (d.terms.length) return;
    const now = new Date();
    const roc = now.getFullYear() - 1911;
    const m = now.getMonth() + 1;
    const t = m >= 8 ? { year: roc, sem: '上' } : { year: roc - 1, sem: m >= 2 ? '下' : '上' };
    d.terms.push({ id: C.uid('term'), year: t.year, sem: t.sem });
    S.save();
  }
  function teacherName(id) {
    const t = id ? C.byId(D().teachers, id) : null;
    return t ? t.name : '';
  }
  function branchOfClass(cls) {
    return cls ? C.byId(D().branches, cls.branchId) : null;
  }
  function activeClasses(year, branchId) {
    return D().classes
      .filter((c) => C.isActive(c, year) && (!branchId || c.branchId === branchId))
      .sort(classSort(year));
  }
  function classSort(year) {
    const d = D();
    const bi = (c) => d.branches.findIndex((b) => b.id === c.branchId);
    return (a, b) => bi(a) - bi(b) ||
      (C.gradeAt(a, year) == null ? 99 : C.gradeAt(a, year)) - (C.gradeAt(b, year) == null ? 99 : C.gradeAt(b, year)) ||
      a.subject.localeCompare(b.subject, 'zh-Hant') || (a.label || '').localeCompare(b.label || '', 'zh-Hant');
  }
  function sessionMinutes(list) {
    return list.reduce((sum, s) => sum + (s.end - s.start), 0);
  }
  function nextColor(list) {
    const used = new Set(list.map((x) => x.color));
    return C.PALETTE.find((c) => !used.has(c)) || C.PALETTE[list.length % C.PALETTE.length];
  }
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2600);
  }
  function timeSelect(name, value, from, to) {
    let o = '';
    for (let t = Math.min(from, value); t <= Math.max(to, value); t += C.SLOT) {
      o += '<option value="' + t + '"' + (t === value ? ' selected' : '') + '>' + C.fmtTime(t) + '</option>';
    }
    return '<select name="' + name + '">' + o + '</select>';
  }
  function daySelect(name, value) {
    return '<select name="' + name + '">' + C.DAYS.map((d, i) => '<option value="' + i + '"' + (i === value ? ' selected' : '') + '>' + d + '</option>').join('') + '</select>';
  }
  function gradeSelect(name, value, allowNone) {
    let o = allowNone ? '<option value=""' + (value == null ? ' selected' : '') + '>不分年級</option>' : '';
    C.STAGES.forEach((st) => {
      o += '<optgroup label="' + st.name + '">';
      for (let i = st.from; i <= st.to; i++) o += '<option value="' + i + '"' + (i === value ? ' selected' : '') + '>' + C.GRADES[i] + '</option>';
      o += '</optgroup>';
    });
    return '<select name="' + name + '">' + o + '</select>';
  }
  function statusBadge(status) {
    const map = { graduating: ['畢業班', 'grad'], graduated: ['已畢業', 'muted'], archived: ['已結束', 'muted'], future: ['尚未開班', 'muted'], active: ['', ''] };
    const [txt, cls] = map[status] || ['', ''];
    return txt ? '<span class="badge ' + cls + '">' + txt + '</span>' : '';
  }
  function formValues(form) {
    const out = {};
    $$('input,select,textarea', form).forEach((el) => {
      if (!el.name) return;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else out[el.name] = el.value;
    });
    return out;
  }

  /* ================= 對話框 ================= */
  function modal(opts) {
    const root = $('#modal');
    root.innerHTML =
      '<div class="modal-card' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(opts.title) + '">' +
      '<header><h3>' + esc(opts.title) + '</h3><button type="button" class="icon-btn" data-close aria-label="關閉">×</button></header>' +
      '<form class="modal-body" novalidate>' + opts.html + '</form>' +
      '<footer>' + (opts.actions || []).map((a, i) => '<button type="button" class="btn ' + (a.cls || '') + '" data-act="' + i + '">' + esc(a.label) + '</button>').join('') + '</footer>' +
      '</div>';
    root.classList.add('open');
    const form = $('form', root);
    const close = () => { root.classList.remove('open'); root.innerHTML = ''; };
    $('[data-close]', root).onclick = close;
    root.onclick = (e) => { if (e.target === root) close(); };
    form.onsubmit = (e) => e.preventDefault();
    $$('[data-act]', root).forEach((btn) => {
      btn.onclick = () => {
        const a = opts.actions[+btn.dataset.act];
        const res = a.onClick ? a.onClick(form) : undefined;
        if (res !== false) close();
      };
    });
    if (opts.onMount) opts.onMount(form);
    const first = $('input:not([type=checkbox]),select', form);
    if (first && !opts.noFocus) first.focus();
    return { close, form };
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#modal').classList.contains('open')) {
      $('#modal').classList.remove('open');
      $('#modal').innerHTML = '';
    }
  });

  /* ================= 排課視窗 ================= */
  function openSessionModal(init) {
    const d = D();
    const tm = currentTerm();
    const editing = init.id ? C.byId(d.sessions, init.id) : null;
    const s = editing ? Object.assign({}, editing) : {
      termId: tm.id,
      classId: init.classId || '',
      teacherId: init.teacherId || null,
      day: init.day != null ? init.day : 0,
      start: init.start != null ? init.start : 18 * 60 + 30,
      end: init.end != null ? init.end : 21 * 60,
      note: '',
    };
    const curCls = s.classId ? C.byId(d.classes, s.classId) : null;
    const branchId = curCls ? curCls.branchId : (init.branchId || (d.branches[0] && d.branches[0].id) || '');
    const { dayStart, dayEnd } = d.settings;

    if (!d.branches.length) {
      toast('請先到「設定」新增分校');
      return;
    }

    const html =
      '<div class="grid2">' +
      '<label>分校<select name="branchId">' + d.branches.map((b) => '<option value="' + b.id + '"' + (b.id === branchId ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</select></label>' +
      '<label>講師<select name="teacherId"><option value="">（未指派）</option>' + d.teachers.map((t) => '<option value="' + t.id + '"' + (t.id === s.teacherId ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') + '</select></label>' +
      '</div>' +
      '<label>班級 / 課程<select name="classId"></select></label>' +
      '<fieldset class="newcls" hidden><legend>新增班級</legend><div class="grid3">' +
      '<label>年級' + gradeSelect('ncGrade', null, true) + '</label>' +
      '<label>科目<input name="ncSubject" placeholder="例：數學" list="subjects"></label>' +
      '<label>班別<input name="ncLabel" placeholder="例：A班（選填）"></label>' +
      '</div></fieldset>' +
      '<div class="grid3">' +
      '<label>星期' + daySelect('day', s.day) + '</label>' +
      '<label>開始' + timeSelect('start', s.start, dayStart, dayEnd) + '</label>' +
      '<label>結束' + timeSelect('end', s.end, dayStart, dayEnd) + '</label>' +
      '</div>' +
      '<label>備註（教室、特殊時段說明等）<input name="note" value="' + esc(s.note || '') + '"></label>' +
      '<div class="conflicts" aria-live="polite"></div>' +
      subjectDatalist();

    const readCand = (form) => {
      const v = formValues(form);
      return {
        termId: tm.id,
        classId: v.classId,
        teacherId: v.teacherId || null,
        day: +v.day,
        start: +v.start,
        end: +v.end,
        note: v.note.trim(),
      };
    };

    const actions = [];
    if (editing) {
      actions.push({
        label: '刪除', cls: 'danger left', onClick: () => {
          if (!confirm('確定刪除這堂課？')) return false;
          d.sessions = d.sessions.filter((x) => x.id !== editing.id);
          S.save();
          toast('已刪除');
        },
      });
    }
    actions.push({ label: '取消' });
    actions.push({
      label: editing ? '儲存' : '排入課表', cls: 'primary', onClick: (form) => {
        const cand = readCand(form);
        const v = formValues(form);
        if (cand.end <= cand.start) { alert('結束時間必須晚於開始時間'); return false; }
        let newCls = null;
        if (cand.classId === '__new') {
          if (!v.ncSubject.trim()) { alert('請輸入科目'); return false; }
          newCls = {
            id: C.uid('cls'), branchId: v.branchId, subject: v.ncSubject.trim(), label: v.ncLabel.trim(),
            anchorGrade: v.ncGrade === '' ? null : +v.ncGrade, anchorYear: tm.year, startYear: tm.year, endYear: null, note: '',
          };
          cand.classId = newCls.id;
        }
        if (!cand.classId) { alert('請選擇班級'); return false; }
        const conflicts = newCls ? C.findConflicts(Object.assign({}, d, { classes: d.classes.concat(newCls) }), cand, editing && editing.id) : C.findConflicts(d, cand, editing && editing.id);
        if (conflicts.length && !confirm('有以下衝突，仍要儲存嗎？\n\n' + conflicts.join('\n'))) return false;
        if (newCls) d.classes.push(newCls);
        if (editing) Object.assign(editing, cand);
        else d.sessions.push(Object.assign({ id: C.uid('ses') }, cand));
        S.save();
        toast(editing ? '已更新' : '已排入課表');
      },
    });

    modal({
      title: editing ? '編輯課程' : '排課',
      html,
      actions,
      onMount(form) {
        const fillClasses = () => {
          const bid = form.branchId.value;
          const list = activeClasses(tm.year, bid);
          const keep = form.classId.value || s.classId;
          form.classId.innerHTML =
            (list.length ? '' : '<option value="">（此分校尚無班級）</option>') +
            list.map((c) => '<option value="' + c.id + '"' + (c.id === keep ? ' selected' : '') + '>' + esc(C.className(c, tm.year)) + (C.classStatus(c, tm.year) === 'graduating' ? '（畢業班）' : '') + '</option>').join('') +
            '<option value="__new">＋ 新增班級…</option>';
          if (!list.length) form.classId.value = '__new';
          toggleNew();
        };
        const toggleNew = () => {
          $('.newcls', form).hidden = form.classId.value !== '__new';
        };
        const refresh = () => {
          const cand = readCand(form);
          const box = $('.conflicts', form);
          if (cand.classId === '__new') cand.classId = '__pending';
          const msgs = C.findConflicts(d, cand, editing && editing.id);
          box.innerHTML = msgs.length ? '<strong>⚠ 衝突提醒</strong><ul>' + msgs.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul>' : '';
        };
        form.branchId.onchange = () => { fillClasses(); refresh(); };
        form.classId.onchange = () => { toggleNew(); refresh(); };
        ['teacherId', 'day', 'start', 'end'].forEach((n) => (form[n].onchange = refresh));
        form.start.addEventListener('change', () => {
          if (+form.end.value <= +form.start.value) {
            const want = +form.start.value + 3 * C.SLOT;
            const opt = $$('option', form.end).find((o) => +o.value >= want) || $$('option', form.end).pop();
            form.end.value = opt.value;
            refresh();
          }
        });
        fillClasses();
        refresh();
      },
    });
  }

  function subjectDatalist() {
    const subs = Array.from(new Set(D().classes.map((c) => c.subject).concat(['數學', '英文', '國文', '自然', '理化', '物理', '化學', '生物', '社會'])));
    return '<datalist id="subjects">' + subs.map((x) => '<option value="' + esc(x) + '">').join('') + '</datalist>';
  }

  /* ================= 不可排時段 ================= */
  function openBlockModal(init) {
    const d = D();
    const tm = currentTerm();
    const editing = init.id ? C.byId(d.blocks, init.id) : null;
    const b = editing ? Object.assign({}, editing) : { teacherId: init.teacherId, day: init.day, start: init.start, end: init.end, note: '無法接' };
    const { dayStart, dayEnd } = d.settings;
    const actions = [];
    if (editing) {
      actions.push({
        label: '刪除', cls: 'danger left', onClick: () => {
          d.blocks = d.blocks.filter((x) => x.id !== editing.id);
          S.save();
        },
      });
    }
    actions.push({ label: '取消' });
    actions.push({
      label: '儲存', cls: 'primary', onClick: (form) => {
        const v = formValues(form);
        const rec = { termId: tm.id, teacherId: v.teacherId, day: +v.day, start: +v.start, end: +v.end, note: v.note.trim() };
        if (rec.end <= rec.start) { alert('結束時間必須晚於開始時間'); return false; }
        if (editing) Object.assign(editing, rec);
        else d.blocks.push(Object.assign({ id: C.uid('blk') }, rec));
        S.save();
      },
    });
    modal({
      title: editing ? '編輯不可排時段' : '標記不可排時段',
      html:
        '<label>講師<select name="teacherId">' + d.teachers.map((t) => '<option value="' + t.id + '"' + (t.id === b.teacherId ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') + '</select></label>' +
        '<div class="grid3"><label>星期' + daySelect('day', b.day) + '</label><label>開始' + timeSelect('start', b.start, dayStart, dayEnd) + '</label><label>結束' + timeSelect('end', b.end, dayStart, dayEnd) + '</label></div>' +
        '<label>說明<input name="note" value="' + esc(b.note || '') + '" placeholder="例：無法接、私人行程"></label>',
      actions,
    });
  }

  /* ================= 講師 / 分校 / 班級 編輯 ================= */
  function openTeacherModal(id) {
    const d = D();
    const t = id ? C.byId(d.teachers, id) : null;
    const actions = [];
    if (t) {
      actions.push({
        label: '刪除', cls: 'danger left', onClick: () => {
          const n = d.sessions.filter((s) => s.teacherId === t.id).length;
          if (!confirm('刪除講師「' + t.name + '」？' + (n ? '\n其 ' + n + ' 堂課會變成「未指派」。' : ''))) return false;
          d.sessions.forEach((s) => { if (s.teacherId === t.id) s.teacherId = null; });
          d.blocks = d.blocks.filter((b) => b.teacherId !== t.id);
          d.teachers = d.teachers.filter((x) => x.id !== t.id);
          S.save();
        },
      });
    }
    actions.push({ label: '取消' });
    actions.push({
      label: '儲存', cls: 'primary', onClick: (form) => {
        const v = formValues(form);
        if (!v.name.trim()) { alert('請輸入姓名'); return false; }
        const rec = { name: v.name.trim(), color: v.color, note: v.note.trim() };
        if (t) Object.assign(t, rec);
        else { const n = Object.assign({ id: C.uid('tch') }, rec); d.teachers.push(n); ui().teacherId = n.id; S.saveUI(); }
        S.save();
      },
    });
    modal({
      title: t ? '編輯講師' : '新增講師',
      html:
        '<label>姓名<input name="name" value="' + esc(t ? t.name : '') + '" required></label>' +
        '<label>代表色<input type="color" name="color" value="' + esc(t ? t.color : nextColor(d.teachers)) + '"></label>' +
        '<label>備註（科目、聯絡方式等）<input name="note" value="' + esc(t ? t.note : '') + '"></label>',
      actions,
    });
  }

  function openBranchModal(id) {
    const d = D();
    const b = id ? C.byId(d.branches, id) : null;
    const actions = [];
    if (b) {
      actions.push({
        label: '刪除', cls: 'danger left', onClick: () => {
          const cls = d.classes.filter((c) => c.branchId === b.id).map((c) => c.id);
          if (!confirm('刪除分校「' + b.name + '」？' + (cls.length ? '\n將一併刪除 ' + cls.length + ' 個班級與其所有課程。' : ''))) return false;
          d.sessions = d.sessions.filter((s) => !cls.includes(s.classId));
          d.classes = d.classes.filter((c) => c.branchId !== b.id);
          d.branches = d.branches.filter((x) => x.id !== b.id);
          S.save();
          cloud.removeLogin(b.id).catch(() => {});
          cloud.deleteView(b.id).catch(() => {});
        },
      });
    }
    actions.push({ label: '取消' });
    actions.push({
      label: '儲存', cls: 'primary', onClick: (form) => {
        const v = formValues(form);
        if (!v.name.trim()) { alert('請輸入分校名稱'); return false; }
        const rec = { name: v.name.trim(), color: v.color, note: v.note.trim() };
        if (b) Object.assign(b, rec);
        else { const n = Object.assign({ id: C.uid('br') }, rec); d.branches.push(n); ui().branchId = n.id; S.saveUI(); }
        S.save();
      },
    });
    modal({
      title: b ? '編輯分校' : '新增分校',
      html:
        '<label>分校名稱<input name="name" value="' + esc(b ? b.name : '') + '" required></label>' +
        '<label>代表色<input type="color" name="color" value="' + esc(b ? b.color : nextColor(d.branches)) + '"></label>' +
        '<label>備註（地址等）<input name="note" value="' + esc(b ? b.note : '') + '"></label>',
      actions,
    });
  }

  function openClassModal(id, preset) {
    const d = D();
    const tm = currentTerm();
    const c = id ? C.byId(d.classes, id) : null;
    const g = c ? C.gradeAt(c, tm.year) : (preset && preset.grade != null ? preset.grade : null);
    const gValid = g != null && g >= 0 && g < C.GRADES.length ? g : null;
    if (!d.branches.length) { toast('請先到「設定」新增分校'); return; }
    const actions = [];
    if (c) {
      actions.push({
        label: '刪除', cls: 'danger left', onClick: () => {
          const n = d.sessions.filter((s) => s.classId === c.id).length;
          if (!confirm('刪除班級「' + C.className(c, tm.year) + '」？' + (n ? '\n將一併刪除所有學期共 ' + n + ' 堂課。' : ''))) return false;
          d.sessions = d.sessions.filter((s) => s.classId !== c.id);
          d.classes = d.classes.filter((x) => x.id !== c.id);
          S.save();
        },
      });
    }
    actions.push({ label: '取消' });
    actions.push({
      label: '儲存', cls: 'primary', onClick: (form) => {
        const v = formValues(form);
        if (!v.subject.trim()) { alert('請輸入科目'); return false; }
        const rec = {
          branchId: v.branchId, subject: v.subject.trim(), label: v.label.trim(), note: v.note.trim(),
          startYear: +v.startYear || tm.year,
          endYear: v.endYear ? +v.endYear : null,
        };
        const newGrade = v.grade === '' ? null : +v.grade;
        if (!c || newGrade !== gValid) {
          rec.anchorGrade = newGrade;
          rec.anchorYear = tm.year;
        }
        if (c) Object.assign(c, rec);
        else d.classes.push(Object.assign({ id: C.uid('cls') }, rec));
        S.save();
      },
    });
    modal({
      title: c ? '編輯班級' : '新增班級',
      html:
        '<label>分校<select name="branchId">' + d.branches.map((b) => '<option value="' + b.id + '"' + (b.id === (c ? c.branchId : (preset && preset.branchId)) ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</select></label>' +
        '<div class="grid3">' +
        '<label>年級（' + esc(C.termName(tm)) + '）' + gradeSelect('grade', gValid, true) + '</label>' +
        '<label>科目<input name="subject" value="' + esc(c ? c.subject : '') + '" list="subjects" placeholder="例：數學"></label>' +
        '<label>班別<input name="label" value="' + esc(c ? c.label : '') + '" placeholder="選填"></label>' +
        '</div>' +
        '<div class="grid2">' +
        '<label>開班學年<input type="number" name="startYear" value="' + (c ? c.startYear : tm.year) + '"></label>' +
        '<label>結束學年（選填，之後不再顯示）<input type="number" name="endYear" value="' + (c && c.endYear != null ? c.endYear : '') + '"></label>' +
        '</div>' +
        '<label>備註<input name="note" value="' + esc(c ? c.note : '') + '"></label>' +
        '<p class="help">年級會在每學年自動進階（例如 國一 → 國二）；國小六年級、國三、高三為畢業班，會以黃色標示，升上新學年後自動畢業。</p>' +
        subjectDatalist(),
      actions,
    });
  }

  /* ================= 建立新學期 / 年級進階 ================= */
  function openNewTermModal() {
    const d = D();
    const sorted = C.sortTerms(d.terms);
    const latest = sorted[sorted.length - 1];
    const tgt = latest ? C.nextTerm(latest) : { year: 115, sem: '上' };
    const src = currentTerm() || latest;

    modal({
      title: '建立新學期 / 年級進階',
      wide: true,
      noFocus: true,
      html:
        '<div class="grid3">' +
        '<label>複製來源學期<select name="source"><option value="">（不複製，建立空白學期）</option>' + sorted.map((t) => '<option value="' + t.id + '"' + (src && t.id === src.id ? ' selected' : '') + '>' + C.termName(t) + '</option>').join('') + '</select></label>' +
        '<label>新學年度<input type="number" name="year" value="' + tgt.year + '"></label>' +
        '<label>學期<select name="sem"><option' + (tgt.sem === '上' ? ' selected' : '') + '>上</option><option' + (tgt.sem === '下' ? ' selected' : '') + '>下</option></select></label>' +
        '</div>' +
        '<div class="checks">' +
        '<label class="check"><input type="checkbox" name="copySessions" checked> 複製課表</label>' +
        '<label class="check"><input type="checkbox" name="keepTeachers" checked> 保留講師指派</label>' +
        '<label class="check"><input type="checkbox" name="copyBlocks" checked> 複製講師不可排時段</label>' +
        '</div>' +
        '<div class="preview"></div>',
      actions: [
        { label: '取消' },
        {
          label: '建立學期', cls: 'primary', onClick: (form) => {
            const v = formValues(form);
            const target = { year: +v.year, sem: v.sem };
            if (!target.year) { alert('請輸入學年度'); return false; }
            const cont = $$('input[name^="cont_"]', form).filter((x) => x.checked).map((x) => x.name.slice(5));
            try {
              const t = C.applyNewTerm(d, v.source, target, { copySessions: v.copySessions, keepTeachers: v.keepTeachers, copyBlocks: v.copyBlocks, continueIds: cont });
              ui().termId = t.id;
              S.saveUI();
              S.save();
              toast('已建立 ' + C.termName(t));
            } catch (e) {
              alert(e.message);
              return false;
            }
          },
        },
      ],
      onMount(form) {
        const draw = () => {
          const v = formValues(form);
          const box = $('.preview', form);
          const target = { year: +v.year, sem: v.sem };
          const source = C.byId(d.terms, v.source);
          if (d.terms.some((t) => t.year === target.year && t.sem === target.sem)) {
            box.innerHTML = '<p class="warn">⚠ ' + C.termName(target) + ' 已存在。</p>';
            return;
          }
          if (!source) { box.innerHTML = '<p class="help">將建立空白學期。</p>'; return; }
          const order = d.classes.slice().sort(classSort(source.year)).map((c) => c.id);
          const rows = C.planNewTerm(d, source.id, target).sort((a, b) => order.indexOf(a.classId) - order.indexOf(b.classId));
          const promoting = target.year > source.year;
          const nGrad = rows.filter((r) => r.status === 'graduated').length;
          box.innerHTML =
            '<p class="help">' + (promoting
              ? '跨學年：所有班級年級自動 <b>+1</b>，畢業班（' + nGrad + ' 班）不再出現在新學期；可勾選「延續」讓畢業班直接升為下一學制的新班（例：國三數學 → 高一數學）。'
              : '同學年：班級年級不變，直接複製。') + '</p>' +
            '<div class="table-wrap"><table class="table"><thead><tr><th>分校</th><th>' + esc(C.termName(source)) + '</th><th></th><th>' + esc(C.termName(target)) + '</th><th>延續</th></tr></thead><tbody>' +
            rows.map((r) => {
              const cls = C.byId(d.classes, r.classId);
              const br = branchOfClass(cls);
              const grad = r.status === 'graduated';
              return '<tr class="' + (grad ? 'row-grad' : r.status === 'graduating' ? 'row-graduating' : '') + '">' +
                '<td>' + esc(br ? br.name : '') + '</td><td>' + esc(r.from) + '</td><td class="arrow">→</td>' +
                '<td>' + (r.to ? esc(r.to) + (r.status === 'graduating' ? ' ' + statusBadge('graduating') : '') : '<span class="badge grad">畢業</span>') + '</td>' +
                '<td>' + (r.canContinue ? '<label class="check"><input type="checkbox" name="cont_' + r.classId + '"> 升 ' + esc(r.continueTo) + '</label>' : '') + '</td></tr>';
            }).join('') +
            (rows.length ? '' : '<tr><td colspan="5" class="empty">來源學期沒有班級</td></tr>') +
            '</tbody></table></div>';
        };
        form.source.onchange = draw;
        form.year.oninput = draw;
        form.sem.onchange = draw;
        draw();
      },
    });
  }

  /* ================= 畫面：講師課表 ================= */
  function renderTeacherView(main) {
    const d = D();
    const tm = currentTerm();
    let t = C.byId(d.teachers, ui().teacherId) || d.teachers[0];
    if (t && ui().teacherId !== t.id) { ui().teacherId = t.id; S.saveUI(); }
    const sessions = C.termSessions(d, tm.id);

    const side = '<aside class="side"><div class="side-head"><h3>講師</h3><button class="btn sm" data-add-teacher>＋ 新增</button></div><ul class="side-list">' +
      d.teachers.map((x) => {
        const h = C.hours(sessionMinutes(sessions.filter((s) => s.teacherId === x.id)));
        return '<li><button class="side-item' + (t && x.id === t.id ? ' active' : '') + '" data-teacher="' + x.id + '"><span class="dot" style="--c:' + esc(x.color) + '"></span><span class="grow">' + esc(x.name) + '</span><span class="muted">' + h + 'h</span></button></li>';
      }).join('') + '</ul>' + (d.teachers.length ? '' : '<p class="empty">尚未新增講師</p>') + '</aside>';

    if (!t) {
      main.innerHTML = '<div class="layout">' + side + '<section class="content"><div class="empty-state"><h2>尚無講師</h2><p>先新增講師，再開始排課。</p><button class="btn primary" data-add-teacher>＋ 新增講師</button></div></section></div>';
      bindSide(main);
      return;
    }

    const mine = sessions.filter((s) => s.teacherId === t.id);
    const blocks = d.blocks.filter((b) => b.termId === tm.id && b.teacherId === t.id);
    const perBranch = {};
    mine.forEach((s) => {
      const br = branchOfClass(C.byId(d.classes, s.classId));
      const k = br ? br.id : '';
      perBranch[k] = (perBranch[k] || 0) + (s.end - s.start);
    });
    const mode = ui().mode === 'block' ? 'block' : 'session';

    main.innerHTML = '<div class="layout">' + side +
      '<section class="content">' +
      '<div class="toolbar"><div><h2>' + esc(t.name) + ' <span class="sub">' + esc(C.termName(tm)) + ' 課表</span></h2>' +
      '<div class="chips"><span class="chip strong">每週 ' + C.hours(sessionMinutes(mine)) + ' 小時 · ' + mine.length + ' 堂</span>' +
      d.branches.filter((b) => perBranch[b.id]).map((b) => '<span class="chip" style="--c:' + esc(b.color) + '"><span class="dot"></span>' + esc(b.name) + ' ' + C.hours(perBranch[b.id]) + 'h</span>').join('') +
      (t.note ? '<span class="chip muted">' + esc(t.note) + '</span>' : '') + '</div></div>' +
      '<div class="actions">' +
      '<div class="seg" role="group" aria-label="點選格子時"><button class="' + (mode === 'session' ? 'on' : '') + '" data-mode="session">排課</button><button class="' + (mode === 'block' ? 'on' : '') + '" data-mode="block">標記不可排</button></div>' +
      '<button class="btn" data-edit-teacher="' + t.id + '">編輯講師</button>' +
      '<button class="btn" data-print>列印</button>' +
      '</div></div>' +
      '<p class="hint">' + (mode === 'block' ? '拖曳選取講師「無法接課」的時段。' : '在空白格子上拖曳選取時段即可排課（每格 30 分鐘）；點課程可編輯或刪除。') + '</p>' +
      '<div id="grid"></div>' +
      '</section></div>';

    const items = mine.map((s) => {
      const cls = C.byId(d.classes, s.classId);
      const br = branchOfClass(cls);
      const grad = cls && C.classStatus(cls, tm.year) === 'graduating';
      return {
        id: s.id, kind: 'session', day: s.day, start: s.start, end: s.end,
        title: (br ? br.name : '') + ' ' + (cls ? C.className(cls, tm.year) : '?'),
        sub: s.note, color: br ? br.color : '#888', cls: grad ? 'graduating' : '', badge: grad ? '畢業班' : '',
      };
    }).concat(blocks.map((b) => ({
      id: b.id, kind: 'block', day: b.day, start: b.start, end: b.end, title: b.note || '不可排', cls: 'block',
    })));

    window.Grid.render($('#grid', main), {
      dayStart: d.settings.dayStart, dayEnd: d.settings.dayEnd, items,
      onSelect(day, start, end) {
        if (ui().mode === 'block') openBlockModal({ teacherId: t.id, day, start, end });
        else openSessionModal({ teacherId: t.id, day, start, end });
      },
      onItem(kind, id) {
        if (kind === 'block') openBlockModal({ id });
        else openSessionModal({ id });
      },
    });
    bindSide(main);
    $$('[data-mode]', main).forEach((b) => (b.onclick = () => { ui().mode = b.dataset.mode; S.saveUI(); render(); }));
  }

  /* ================= 畫面：分校課表 ================= */
  function renderBranchView(main) {
    const d = D();
    const tm = currentTerm();
    let b = C.byId(d.branches, ui().branchId) || d.branches[0];
    if (b && ui().branchId !== b.id) { ui().branchId = b.id; S.saveUI(); }
    const sessions = C.termSessions(d, tm.id);
    const classOf = (s) => C.byId(d.classes, s.classId);

    const side = '<aside class="side"><div class="side-head"><h3>分校</h3><button class="btn sm" data-add-branch>＋ 新增</button></div><ul class="side-list">' +
      d.branches.map((x) => {
        const list = sessions.filter((s) => { const c = classOf(s); return c && c.branchId === x.id; });
        const un = list.filter((s) => !s.teacherId).length;
        return '<li><button class="side-item' + (b && x.id === b.id ? ' active' : '') + '" data-branch="' + x.id + '"><span class="dot" style="--c:' + esc(x.color) + '"></span><span class="grow">' + esc(x.name) + '</span>' + (un ? '<span class="badge warn" title="未指派講師">' + un + '</span>' : '') + '<span class="muted">' + list.length + '堂</span></button></li>';
      }).join('') + '</ul>' + (d.branches.length ? '' : '<p class="empty">尚未新增分校</p>') + '</aside>';

    if (!b) {
      main.innerHTML = '<div class="layout">' + side + '<section class="content"><div class="empty-state"><h2>尚無分校</h2><p>先新增分校，再建立班級與排課。</p><button class="btn primary" data-add-branch>＋ 新增分校</button></div></section></div>';
      bindSide(main);
      return;
    }

    const mine = sessions.filter((s) => { const c = classOf(s); return c && c.branchId === b.id; });
    const classes = activeClasses(tm.year, b.id);
    const unassigned = mine.filter((s) => !s.teacherId).length;
    const teachersHere = Array.from(new Set(mine.map((s) => s.teacherId).filter(Boolean))).map((id) => C.byId(d.teachers, id)).filter(Boolean);

    main.innerHTML = '<div class="layout">' + side +
      '<section class="content">' +
      '<div class="toolbar"><div><h2>' + esc(b.name) + ' <span class="sub">' + esc(C.termName(tm)) + ' 分校課表</span></h2>' +
      '<div class="chips"><span class="chip strong">' + classes.length + ' 班 · ' + mine.length + ' 堂 · 每週 ' + C.hours(sessionMinutes(mine)) + ' 小時</span>' +
      (unassigned ? '<span class="chip warn">' + unassigned + ' 堂未指派講師</span>' : '') +
      teachersHere.map((t) => '<span class="chip" style="--c:' + esc(t.color) + '"><span class="dot"></span>' + esc(t.name) + '</span>').join('') +
      '</div></div>' +
      '<div class="actions"><button class="btn" data-new-class>＋ 新增班級</button><button class="btn" data-branch-login="' + b.id + '">分校展示帳號</button><button class="btn" data-edit-branch="' + b.id + '">編輯分校</button><button class="btn" data-print>列印</button></div></div>' +
      '<p class="hint">分校課表與講師課表連動：在這裡排課並指定講師，講師課表會同步出現；顏色代表講師。</p>' +
      '<div id="grid"></div>' +
      '<h3 class="section-title">班級與授課講師</h3>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>班級</th><th>授課講師</th><th>上課時間</th><th>每週</th><th></th></tr></thead><tbody>' +
      classes.map((c) => {
        const ss = mine.filter((s) => s.classId === c.id).sort((x, y) => x.day - y.day || x.start - y.start);
        const status = C.classStatus(c, tm.year);
        const tnames = Array.from(new Set(ss.map((s) => s.teacherId))).map((id) => id ? esc(teacherName(id)) : '<span class="badge warn">未指派</span>');
        return '<tr class="' + (status === 'graduating' ? 'row-graduating' : '') + '"><td><b>' + esc(C.className(c, tm.year)) + '</b> ' + statusBadge(status) + '</td>' +
          '<td>' + (tnames.join('、') || '<span class="muted">尚未排課</span>') + '</td>' +
          '<td class="small">' + (ss.map((s) => '週' + C.DAYS_SHORT[s.day] + ' ' + C.fmtTime(s.start) + '–' + C.fmtTime(s.end)).join('<br>') || '—') + '</td>' +
          '<td>' + C.hours(sessionMinutes(ss)) + 'h</td>' +
          '<td class="right"><button class="btn sm" data-edit-class="' + c.id + '">編輯</button></td></tr>';
      }).join('') +
      (classes.length ? '' : '<tr><td colspan="5" class="empty">本學期尚無班級</td></tr>') +
      '</tbody></table></div>' +
      '</section></div>';

    const items = mine.map((s) => {
      const cls = classOf(s);
      const t = s.teacherId ? C.byId(d.teachers, s.teacherId) : null;
      const grad = C.classStatus(cls, tm.year) === 'graduating';
      return {
        id: s.id, kind: 'session', day: s.day, start: s.start, end: s.end,
        title: C.className(cls, tm.year),
        sub: (t ? t.name : '未指派講師') + (s.note ? ' · ' + s.note : ''),
        color: t ? t.color : null,
        cls: (t ? '' : 'unassigned ') + (grad ? 'graduating' : ''),
        badge: grad ? '畢業班' : '',
      };
    });
    window.Grid.render($('#grid', main), {
      dayStart: d.settings.dayStart, dayEnd: d.settings.dayEnd, items,
      onSelect(day, start, end) { openSessionModal({ branchId: b.id, day, start, end }); },
      onItem(kind, id) { openSessionModal({ id }); },
    });
    bindSide(main);
    $$('[data-new-class]', main).forEach((x) => (x.onclick = () => openClassModal(null, { branchId: b.id })));
  }

  /* ================= 畫面：班級管理 ================= */
  function renderClassesView(main) {
    const d = D();
    const tm = currentTerm();
    const filter = ui().classBranch || '';
    const showEnded = !!ui().showEnded;
    const sessions = C.termSessions(d, tm.id);
    const list = d.classes
      .filter((c) => (!filter || c.branchId === filter) && (showEnded || C.isActive(c, tm.year)))
      .sort(classSort(tm.year));
    const nGrad = list.filter((c) => C.classStatus(c, tm.year) === 'graduating').length;

    main.innerHTML = '<section class="content full">' +
      '<div class="toolbar"><div><h2>班級管理 <span class="sub">' + esc(C.termName(tm)) + '</span></h2>' +
      '<div class="chips"><span class="chip strong">' + list.length + ' 班</span>' + (nGrad ? '<span class="chip grad">' + nGrad + ' 個畢業班</span>' : '') + '</div></div>' +
      '<div class="actions">' +
      '<select data-filter aria-label="篩選分校"><option value="">全部分校</option>' + d.branches.map((b) => '<option value="' + b.id + '"' + (b.id === filter ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</select>' +
      '<label class="check"><input type="checkbox" data-show-ended' + (showEnded ? ' checked' : '') + '> 顯示已畢業 / 已結束</label>' +
      '<button class="btn" data-new-term>建立新學期 / 年級進階</button>' +
      '<button class="btn primary" data-new-class>＋ 新增班級</button>' +
      '</div></div>' +
      '<p class="hint">年級依學年自動進階；<span class="badge grad">畢業班</span> 為國小六年級、國三、高三，建立下一學年時會自動畢業。</p>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>分校</th><th>班級</th><th>狀態</th><th>授課講師（本學期）</th><th>每週</th><th>開班</th><th>備註</th><th></th></tr></thead><tbody>' +
      list.map((c) => {
        const br = branchOfClass(c);
        const ss = sessions.filter((s) => s.classId === c.id);
        const status = C.classStatus(c, tm.year);
        const tnames = Array.from(new Set(ss.map((s) => s.teacherId))).map((id) => id ? esc(teacherName(id)) : '<span class="badge warn">未指派</span>');
        return '<tr class="' + (status === 'graduating' ? 'row-graduating' : (status === 'active' ? '' : 'row-muted')) + '">' +
          '<td><span class="dot" style="--c:' + esc(br ? br.color : '#999') + '"></span> ' + esc(br ? br.name : '?') + '</td>' +
          '<td><b>' + esc(C.className(c, tm.year)) + '</b></td>' +
          '<td>' + (statusBadge(status) || '<span class="muted">上課中</span>') + '</td>' +
          '<td>' + (tnames.join('、') || '<span class="muted">—</span>') + '</td>' +
          '<td>' + C.hours(sessionMinutes(ss)) + 'h</td>' +
          '<td>' + c.startYear + '</td>' +
          '<td class="small">' + esc(c.note || '') + '</td>' +
          '<td class="right"><button class="btn sm" data-edit-class="' + c.id + '">編輯</button></td></tr>';
      }).join('') +
      (list.length ? '' : '<tr><td colspan="8" class="empty">沒有符合的班級</td></tr>') +
      '</tbody></table></div></section>';

    $('[data-filter]', main).onchange = (e) => { ui().classBranch = e.target.value; S.saveUI(); render(); };
    $('[data-show-ended]', main).onchange = (e) => { ui().showEnded = e.target.checked; S.saveUI(); render(); };
    $('[data-new-class]', main).onclick = () => openClassModal(null, { branchId: filter || undefined });
    bindSide(main);
  }

  /* ================= 畫面：設定 ================= */
  function renderSettingsView(main) {
    const d = D();
    const opts = (sel) => {
      let o = '';
      for (let t = 5 * 60; t <= 24 * 60; t += 60) o += '<option value="' + t + '"' + (t === sel ? ' selected' : '') + '>' + C.fmtTime(t) + '</option>';
      return o;
    };
    const sorted = C.sortTerms(d.terms);
    main.innerHTML = '<section class="content full settings">' +
      '<div class="cards">' +
      '<div class="card"><div class="card-head"><h3>講師</h3><button class="btn sm" data-add-teacher>＋ 新增</button></div><ul class="plain">' +
      d.teachers.map((t) => '<li><span class="dot" style="--c:' + esc(t.color) + '"></span><span class="grow">' + esc(t.name) + ' <span class="muted small">' + esc(t.note || '') + '</span></span><button class="btn sm" data-edit-teacher="' + t.id + '">編輯</button></li>').join('') +
      (d.teachers.length ? '' : '<li class="empty">尚無講師</li>') + '</ul></div>' +
      '<div class="card"><div class="card-head"><h3>分校</h3><button class="btn sm" data-add-branch>＋ 新增</button></div><ul class="plain">' +
      d.branches.map((b) => '<li><span class="dot" style="--c:' + esc(b.color) + '"></span><span class="grow">' + esc(b.name) + ' <span class="muted small">' + esc(b.note || '') + '</span></span><button class="btn sm" data-edit-branch="' + b.id + '">編輯</button></li>').join('') +
      (d.branches.length ? '' : '<li class="empty">尚無分校</li>') + '</ul></div>' +
      '<div class="card"><div class="card-head"><h3>學期</h3><button class="btn sm" data-new-term>＋ 建立新學期</button></div><ul class="plain">' +
      sorted.map((t) => '<li><span class="grow">' + C.termName(t) + ' <span class="muted small">' + d.sessions.filter((s) => s.termId === t.id).length + ' 堂課</span></span><button class="btn sm danger" data-del-term="' + t.id + '">刪除</button></li>').join('') + '</ul></div>' +
      '<div class="card"><div class="card-head"><h3>課表顯示時間</h3></div>' +
      '<div class="grid2"><label>最早<select data-day-start>' + opts(d.settings.dayStart) + '</select></label><label>最晚<select data-day-end>' + opts(d.settings.dayEnd) + '</select></label></div>' +
      '<p class="help">每格 30 分鐘。只影響顯示範圍。</p></div>' +
      '<div class="card wide"><div class="card-head"><h3>分校展示帳號</h3></div>' +
      '<p class="help">為每個分校設定帳號與密碼，分校用專屬連結登入後<b>只能看到自己分校的課表</b>（唯讀）。課表修改後會自動更新。</p>' +
      '<div data-logins><p class="muted">載入中…</p></div></div>' +
      '<div class="card"><div class="card-head"><h3>資料備份</h3></div>' +
      (cloud && cloud.mode === 'firebase'
        ? '<p class="help">資料儲存在雲端（Firebase），所有管理員即時同步。仍建議定期匯出備份。</p>'
        : '<p class="help warn">目前為本機模式：資料只存在這台電腦的瀏覽器。請依 README 設定 Firebase 以啟用雲端儲存。</p>') +
      '<div class="btn-row"><button class="btn primary" data-export>匯出備份 (JSON)</button><button class="btn" data-import>匯入備份</button><input type="file" accept=".json,application/json" data-import-file hidden></div>' +
      '<div class="btn-row"><button class="btn" data-sample>載入範例資料</button><button class="btn danger" data-clear>清空所有資料</button></div></div>' +
      '</div></section>';

    $('[data-day-start]', main).onchange = (e) => {
      const v = +e.target.value;
      if (v >= d.settings.dayEnd) { alert('最早時間必須早於最晚時間'); render(); return; }
      d.settings.dayStart = v; S.save();
    };
    $('[data-day-end]', main).onchange = (e) => {
      const v = +e.target.value;
      if (v <= d.settings.dayStart) { alert('最晚時間必須晚於最早時間'); render(); return; }
      d.settings.dayEnd = v; S.save();
    };
    $$('[data-del-term]', main).forEach((btn) => (btn.onclick = () => {
      const t = C.byId(d.terms, btn.dataset.delTerm);
      if (d.terms.length <= 1) { alert('至少需保留一個學期'); return; }
      const n = d.sessions.filter((s) => s.termId === t.id).length;
      if (!confirm('刪除學期 ' + C.termName(t) + '？' + (n ? '\n將一併刪除該學期 ' + n + ' 堂課。' : ''))) return;
      d.sessions = d.sessions.filter((s) => s.termId !== t.id);
      d.blocks = d.blocks.filter((b) => b.termId !== t.id);
      d.terms = d.terms.filter((x) => x.id !== t.id);
      S.save();
    }));
    $('[data-export]', main).onclick = () => {
      const blob = new Blob([S.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      const now = new Date();
      a.href = URL.createObjectURL(blob);
      a.download = '講師課表備份_' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    };
    const file = $('[data-import-file]', main);
    $('[data-import]', main).onclick = () => file.click();
    file.onchange = () => {
      const f = file.files[0];
      if (!f) return;
      f.text().then((txt) => {
        let parsed;
        try { parsed = JSON.parse(txt); } catch (e) { alert('檔案格式錯誤'); return; }
        if (!parsed || !Array.isArray(parsed.terms)) { alert('這不是本系統的備份檔'); return; }
        if (!confirm('匯入將覆蓋目前所有資料，確定嗎？')) return;
        S.replace(parsed);
        ensureTerm();
        toast('匯入完成');
      });
    };
    renderLoginsCard($('[data-logins]', main));
    $('[data-sample]', main).onclick = () => { if (confirm('載入範例資料將覆蓋目前所有資料，確定嗎？')) { S.reset(true); ui().termId = null; render(); } };
    $('[data-clear]', main).onclick = () => { if (confirm('確定清空所有資料？此動作無法復原（建議先匯出備份）。')) { S.reset(false); ensureTerm(); ui().termId = null; render(); } };
    bindSide(main);
  }

  /* ================= 分校展示帳號 ================= */
  async function renderLoginsCard(el) {
    if (!el) return;
    const d = D();
    let logins;
    try {
      logins = await cloud.listLogins();
    } catch (e) {
      el.innerHTML = '<p class="warn">無法讀取分校帳號：' + esc(e.message) + '</p>';
      return;
    }
    if (!document.body.contains(el)) return;
    el.innerHTML = '<div class="table-wrap"><table class="table"><thead><tr><th>分校</th><th>帳號</th><th>密碼</th><th>專屬連結</th><th></th></tr></thead><tbody>' +
      d.branches.map((b) => {
        const l = logins[b.id];
        return '<tr><td><span class="dot" style="--c:' + esc(b.color) + '"></span> ' + esc(b.name) + '</td>' +
          (l
            ? '<td><code>' + esc(l.code) + '</code></td><td><code class="secret" tabindex="0" title="點一下顯示">' + esc(l.password) + '</code></td>' +
              '<td><button class="btn sm" data-copy="' + esc(branchPageUrl('b=' + l.code)) + '">複製連結</button></td>'
            : '<td colspan="3" class="muted">尚未設定</td>') +
          '<td class="right nowrap"><a class="btn sm" target="_blank" rel="noopener" href="' + esc(branchPageUrl('preview=' + b.id)) + '">預覽</a> ' +
          '<button class="btn sm" data-branch-login="' + b.id + '">' + (l ? '修改' : '設定') + '</button></td></tr>';
      }).join('') +
      (d.branches.length ? '' : '<tr><td colspan="5" class="empty">尚無分校</td></tr>') +
      '</tbody></table></div>';
    $$('[data-branch-login]', el).forEach((b) => (b.onclick = () => openLoginModal(b.dataset.branchLogin)));
    $$('.secret', el).forEach((x) => (x.onclick = () => x.classList.toggle('show')));
    $$('[data-copy]', el).forEach((b) => (b.onclick = () => copyText(b.dataset.copy)));
  }

  function copyText(text) {
    const done = () => toast('已複製連結');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => prompt('請複製以下連結', text));
    else prompt('請複製以下連結', text);
  }

  function randomPassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    const arr = new Uint32Array(8);
    crypto.getRandomValues(arr);
    return Array.from(arr, (n) => chars[n % chars.length]).join('');
  }

  async function openLoginModal(branchId) {
    const d = D();
    const b = C.byId(d.branches, branchId);
    if (!b) return;
    let logins = {};
    try { logins = await cloud.listLogins(); } catch (e) { alert('無法讀取分校帳號：' + e.message); return; }
    const cur = logins[branchId];
    const actions = [];
    if (cur) {
      actions.push({
        label: '停用帳號', cls: 'danger left', onClick: () => {
          if (!confirm('停用「' + b.name + '」的展示帳號？分校將無法再登入。')) return false;
          cloud.removeLogin(branchId).then(() => { toast('已停用'); render(); }, (e) => alert(e.message));
        },
      });
    }
    actions.push({ label: '取消' });
    actions.push({
      label: '儲存', cls: 'primary', onClick: (form) => {
        const v = formValues(form);
        const code = v.code.trim().toLowerCase();
        const pw = v.password.trim();
        if (!cloud.codeRe.test(code)) { alert('帳號只能使用小寫英文、數字與 -（2–30 字）'); return false; }
        if (pw.length < 6) { alert('密碼至少 6 個字'); return false; }
        const dup = Object.entries(logins).find(([id, l]) => id !== branchId && l.code === code);
        if (dup) { alert('此帳號已被其他分校使用'); return false; }
        const btn = $('#modal .primary');
        btn.disabled = true;
        btn.textContent = '儲存中…';
        cloud.setLogin(branchId, code, pw)
          .then(() => (cloud.mode === 'firebase' ? Sync.publishBranch(branchId) : null))
          .then(() => {
            $('#modal').classList.remove('open');
            $('#modal').innerHTML = '';
            toast('已設定「' + b.name + '」展示帳號');
            render();
          }, (e) => {
            btn.disabled = false;
            btn.textContent = '儲存';
            alert('設定失敗：' + (e.message || e));
          });
        return false;
      },
    });
    modal({
      title: b.name + ' · 分校展示帳號',
      html:
        '<p class="help">分校人員用這組帳號密碼登入後，只能看到「' + esc(b.name) + '」的課表。</p>' +
        '<label>帳號（小寫英文、數字）<input name="code" value="' + esc(cur ? cur.code : '') + '" placeholder="例：mingdao" autocapitalize="off" spellcheck="false"></label>' +
        '<label>密碼（至少 6 字）<span class="input-row"><input name="password" value="' + esc(cur ? cur.password : randomPassword()) + '" autocomplete="off" spellcheck="false"><button type="button" class="btn" data-gen>重新產生</button></span></label>' +
        '<p class="help">儲存後，把「專屬連結」和密碼交給分校即可。修改密碼後，舊密碼立即失效。</p>',
      actions,
      onMount(form) {
        $('[data-gen]', form).onclick = () => { form.password.value = randomPassword(); };
      },
    });
  }

  /* ================= 共用事件 ================= */
  function bindSide(main) {
    $$('[data-teacher]', main).forEach((b) => (b.onclick = () => { ui().teacherId = b.dataset.teacher; S.saveUI(); render(); }));
    $$('[data-branch]', main).forEach((b) => (b.onclick = () => { ui().branchId = b.dataset.branch; S.saveUI(); render(); }));
    $$('[data-add-teacher]', main).forEach((b) => (b.onclick = () => openTeacherModal(null)));
    $$('[data-edit-teacher]', main).forEach((b) => (b.onclick = () => openTeacherModal(b.dataset.editTeacher)));
    $$('[data-add-branch]', main).forEach((b) => (b.onclick = () => openBranchModal(null)));
    $$('[data-edit-branch]', main).forEach((b) => (b.onclick = () => openBranchModal(b.dataset.editBranch)));
    $$('[data-edit-class]', main).forEach((b) => (b.onclick = () => openClassModal(b.dataset.editClass)));
    $$('[data-new-term]', main).forEach((b) => (b.onclick = openNewTermModal));
    $$('[data-print]', main).forEach((b) => (b.onclick = () => window.print()));
    $$('[data-branch-login]', main).forEach((b) => (b.onclick = () => openLoginModal(b.dataset.branchLogin)));
  }

  /* ================= 主畫面 ================= */
  const VIEWS = {
    teacher: ['講師課表', renderTeacherView],
    branch: ['分校課表', renderBranchView],
    classes: ['班級管理', renderClassesView],
    settings: ['設定', renderSettingsView],
  };

  function render() {
    ensureTerm();
    const d = D();
    const tm = currentTerm();
    const view = VIEWS[ui().view] ? ui().view : 'teacher';

    const sel = $('#term-select');
    sel.innerHTML = C.sortTerms(d.terms).map((t) => '<option value="' + t.id + '"' + (t.id === tm.id ? ' selected' : '') + '>' + C.termName(t) + '</option>').join('');
    $$('#nav [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    const main = $('#main');
    const scroll = window.scrollY;
    VIEWS[view][1](main);
    document.title = VIEWS[view][0] + ' · 講師人力管理';
    window.scrollTo(0, scroll);
  }

  let cloud = null;

  function showLogin(message) {
    document.body.classList.add('logged-out');
    $('#main').innerHTML =
      '<div class="login-wrap"><form class="login-card" novalidate>' +
      '<h2>講師人力管理</h2><p class="muted">管理員登入</p>' +
      '<label>Email<input name="email" type="email" autocomplete="username" required></label>' +
      '<label>密碼<input name="password" type="password" autocomplete="current-password" required></label>' +
      '<p class="login-error" role="alert">' + esc(message || '') + '</p>' +
      '<button class="btn primary block" type="submit">登入</button>' +
      '<p class="help center">分校人員請使用 <a href="' + branchPageUrl() + '">分校課表頁面</a> 登入</p>' +
      '</form></div>';
    const form = $('.login-card');
    form.email.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      btn.textContent = '登入中…';
      try {
        await cloud.signIn(form.email.value, form.password.value);
        afterLogin();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '登入';
        $('.login-error', form).textContent = authMessage(err);
      }
    };
  }

  function authMessage(e) {
    const code = (e && e.code) || '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(code)) return '帳號或密碼錯誤';
    if (/too-many-requests/.test(code)) return '嘗試次數過多，請稍後再試';
    if (/network/.test(code)) return '無法連線，請檢查網路';
    return (e && e.message) || '登入失敗';
  }

  function branchPageUrl(query) {
    const p = new URLSearchParams(location.search);
    const q = new URLSearchParams(query || '');
    if (p.get('emulator')) q.set('emulator', p.get('emulator'));
    const qs = q.toString();
    return new URL('branch.html' + (qs ? '?' + qs : ''), location.href).href;
  }

  async function afterLogin() {
    $('#main').innerHTML = '<div class="loading">載入雲端資料中…</div>';
    const user = cloud.user();
    Sync.onStatus = renderSyncStatus;
    Sync.start(cloud, () => {
      document.body.classList.remove('logged-out');
      renderAccount(user);
      render();
    }, async () => {
      const bid = await cloud.myBranchId();
      if (bid) { location.href = branchPageUrl(); return; }
      await cloud.signOut();
      showLogin('此帳號沒有管理權限（請確認已加入 firestore.rules 的管理員名單）');
    });
  }

  function renderAccount(user) {
    const el = $('#account');
    if (cloud.mode === 'local') {
      el.innerHTML = '<span class="sync-chip warn" title="資料只存在這台電腦的瀏覽器。請在 js/config.js 設定 Firebase 以使用雲端儲存。">本機模式</span>';
      return;
    }
    el.innerHTML = '<span class="sync-chip" id="sync"></span><span class="user" title="' + esc(user.email) + '">' + esc(user.email) + '</span><button class="btn sm" id="logout">登出</button>';
    $('#logout').onclick = async () => {
      if (Sync.seq !== Sync.savedSeq && !confirm('還有修改尚未儲存完成，確定登出？')) return;
      await cloud.signOut();
      location.reload();
    };
    renderSyncStatus(Sync.status, Sync.error);
  }

  function renderSyncStatus(status, error) {
    const el = $('#sync');
    if (!el) return;
    const map = {
      saved: ['☁ 已同步', ''],
      saving: ['儲存中…', 'busy'],
      large: ['☁ 已同步（資料量接近上限）', 'warn'],
      error: ['⚠ 儲存失敗，重試中', 'error'],
      idle: ['', ''],
    };
    const [txt, cls] = map[status] || map.idle;
    el.textContent = txt;
    el.className = 'sync-chip ' + cls;
    el.title = error || '';
  }

  window.addEventListener('beforeunload', (e) => {
    if (cloud && cloud.mode === 'firebase' && Sync.seq !== Sync.savedSeq) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('hsm-remote-update', (e) => toast(e.detail + ' 更新了資料'));

  async function init() {
    $('#term-select').onchange = (e) => { ui().termId = e.target.value; S.saveUI(); render(); };
    $('#new-term').onclick = openNewTermModal;
    $$('#nav [data-view]').forEach((b) => (b.onclick = () => { ui().view = b.dataset.view; S.saveUI(); render(); }));
    S.onChange(() => { if (!document.body.classList.contains('logged-out')) render(); });
    try {
      cloud = await window.CloudReady;
    } catch (e) {
      $('#main').innerHTML = '<div class="loading error">無法載入雲端服務，請檢查網路後重新整理。<br><small>' + esc(e.message) + '</small></div>';
      return;
    }
    if (cloud.mode === 'local') {
      S.load('local');
      renderAccount(null);
      render();
      return;
    }
    S.load('cloud');
    document.body.classList.add('logged-out');
    const user = await cloud.waitAuth();
    if (user) afterLogin();
    else showLogin();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
