/* 分校展示頁：分校以帳號密碼登入，只能看到自己分校的課表（唯讀） */
(function () {
  'use strict';
  const C = window.Core;
  const esc = window.Grid.esc;
  const $ = (sel, el) => (el || document).querySelector(sel);

  const params = new URLSearchParams(location.search);
  const presetCode = (params.get('b') || '').trim().toLowerCase();
  const previewId = params.get('preview');
  let cloud = null;
  let unwatch = null;
  let view = null;
  let updatedAt = null;
  let termId = null;

  function adminUrl() {
    const q = new URLSearchParams();
    if (params.get('emulator')) q.set('emulator', params.get('emulator'));
    const qs = q.toString();
    return 'index.html' + (qs ? '?' + qs : '');
  }

  function authMessage(e) {
    const code = (e && e.code) || '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(code)) return '帳號或密碼錯誤';
    if (/too-many-requests/.test(code)) return '嘗試次數過多，請稍後再試';
    if (/network/.test(code)) return '無法連線，請檢查網路';
    return (e && e.message) || '登入失敗';
  }

  function setAccount(html) {
    $('#account').innerHTML = html;
    const btn = $('#logout');
    if (btn) btn.onclick = async () => {
      if (unwatch) unwatch();
      await cloud.signOut();
      location.reload();
    };
  }

  function showLogin(message) {
    $('#term-box').hidden = true;
    setAccount('');
    $('#main').innerHTML =
      '<div class="login-wrap"><form class="login-card" novalidate>' +
      '<h2>分校課表</h2><p class="muted">請輸入補習班提供的' + (presetCode ? '密碼' : '帳號與密碼') + '</p>' +
      '<label' + (presetCode ? ' hidden' : '') + '>分校帳號<input name="code" value="' + esc(presetCode) + '" autocomplete="username" autocapitalize="off" spellcheck="false"></label>' +
      '<label>密碼<input name="password" type="password" autocomplete="current-password"></label>' +
      '<p class="login-error" role="alert">' + esc(message || '') + '</p>' +
      '<button class="btn primary block" type="submit">登入</button>' +
      '</form></div>';
    const form = $('.login-card');
    (presetCode ? form.password : form.code).focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      btn.textContent = '登入中…';
      try {
        await cloud.signInBranch(form.code.value.trim().toLowerCase(), form.password.value);
        route();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '登入';
        $('.login-error', form).textContent = authMessage(err);
      }
    };
  }

  function showMessage(title, text) {
    $('#main').innerHTML = '<div class="empty-state"><h2>' + esc(title) + '</h2><p class="muted">' + esc(text) + '</p></div>';
  }

  async function route() {
    const user = await cloud.waitAuth();
    if (previewId && (cloud.mode === 'local' || user)) {
      $('#banner').innerHTML = '<div class="preview-banner">管理員預覽：以下是分校登入後看到的畫面</div>';
      setAccount('<a class="btn sm" href="' + adminUrl() + '">回管理頁</a>');
      return watch(previewId);
    }
    if (!user) return showLogin();
    const bid = await cloud.myBranchId();
    setAccount('<button class="btn sm" id="logout">登出</button>');
    if (!bid) {
      showMessage('此帳號不是分校帳號', '管理員請到管理頁使用「預覽」功能。');
      $('#main').insertAdjacentHTML('beforeend', '<p class="center"><a class="btn" href="' + adminUrl() + '">前往管理頁</a></p>');
      return;
    }
    watch(bid);
  }

  function watch(branchId) {
    if (unwatch) unwatch();
    $('#main').innerHTML = '<div class="loading">載入課表中…</div>';
    unwatch = cloud.watchView(branchId, (doc) => {
      if (!doc) {
        view = null;
        showMessage('尚無課表資料', '補習班尚未發布此分校的課表，請稍後再試。');
        return;
      }
      try {
        view = JSON.parse(doc.json);
      } catch (e) {
        return; // 忽略無效資料，保留目前畫面
      }
      updatedAt = doc.updatedAt;
      render();
    }, (e) => {
      if (e && e.code === 'permission-denied') showMessage('沒有權限', '此帳號無法查看這個分校的課表，請聯絡補習班。');
      else showMessage('無法載入', (e && e.message) || '');
    });
  }

  function render() {
    const v = view;
    const terms = C.sortTerms(v.terms);
    if (!termId || !terms.some((t) => t.id === termId)) {
      const t = C.defaultTerm(terms, new Date());
      termId = t && t.id;
    }
    const tm = terms.find((t) => t.id === termId);
    document.title = v.branch.name + ' 分校課表';
    $('#brand').innerHTML = esc(v.branch.name) + ' <small>分校課表</small>';

    const sel = $('#term-select');
    $('#term-box').hidden = !terms.length;
    sel.innerHTML = terms.map((t) => '<option value="' + t.id + '"' + (t.id === termId ? ' selected' : '') + '>' + C.termName(t) + '</option>').join('');
    sel.onchange = () => { termId = sel.value; render(); };

    if (!tm) { showMessage('尚無學期資料', ''); return; }

    const byId = (list, id) => list.find((x) => x.id === id) || null;
    const sessions = v.sessions.filter((s) => s.termId === tm.id);
    const classes = v.classes.filter((c) => C.isActive(c, tm.year)).sort((a, b) =>
      (C.gradeAt(a, tm.year) == null ? 99 : C.gradeAt(a, tm.year)) - (C.gradeAt(b, tm.year) == null ? 99 : C.gradeAt(b, tm.year)) ||
      a.subject.localeCompare(b.subject, 'zh-Hant'));
    const teacherIds = Array.from(new Set(sessions.map((s) => s.teacherId).filter(Boolean)));
    const minutes = sessions.reduce((n, s) => n + s.end - s.start, 0);
    const nGrad = classes.filter((c) => C.classStatus(c, tm.year) === 'graduating').length;

    $('#main').innerHTML =
      '<section class="content full">' +
      '<div class="toolbar"><div><h2>' + esc(v.branch.name) + ' <span class="sub">' + esc(C.termName(tm)) + ' 課表</span></h2>' +
      '<div class="chips"><span class="chip strong">' + classes.length + ' 班 · ' + sessions.length + ' 堂 · 每週 ' + C.hours(minutes) + ' 小時</span>' +
      (nGrad ? '<span class="chip grad">' + nGrad + ' 個畢業班</span>' : '') +
      teacherIds.map((id) => { const t = byId(v.teachers, id); return t ? '<span class="chip" style="--c:' + esc(t.color) + '"><span class="dot"></span>' + esc(t.name) + '</span>' : ''; }).join('') +
      '</div></div>' +
      '<div class="actions branch-actions">' + (updatedAt ? '<span class="updated">最後更新：' + updatedAt.toLocaleString('zh-TW', { hour12: false }) + '</span>' : '') +
      '<button class="btn" id="print">列印</button></div></div>' +
      '<div id="grid" style="margin-top:12px"></div>' +
      '<h3 class="section-title">班級與授課講師</h3>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>班級</th><th>授課講師</th><th>上課時間</th><th>每週</th></tr></thead><tbody>' +
      classes.map((c) => {
        const ss = sessions.filter((s) => s.classId === c.id).sort((a, b) => a.day - b.day || a.start - b.start);
        const status = C.classStatus(c, tm.year);
        const names = Array.from(new Set(ss.map((s) => s.teacherId))).map((id) => { const t = id && byId(v.teachers, id); return t ? esc(t.name) : '<span class="badge warn">未定</span>'; });
        return '<tr class="' + (status === 'graduating' ? 'row-graduating' : '') + '"><td><b>' + esc(C.className(c, tm.year)) + '</b>' + (status === 'graduating' ? ' <span class="badge grad">畢業班</span>' : '') + '</td>' +
          '<td>' + (names.join('、') || '<span class="muted">—</span>') + '</td>' +
          '<td class="small">' + (ss.map((s) => '週' + C.DAYS_SHORT[s.day] + ' ' + C.fmtTime(s.start) + '–' + C.fmtTime(s.end) + (s.note ? '（' + esc(s.note) + '）' : '')).join('<br>') || '—') + '</td>' +
          '<td>' + C.hours(ss.reduce((n, s) => n + s.end - s.start, 0)) + 'h</td></tr>';
      }).join('') +
      (classes.length ? '' : '<tr><td colspan="4" class="empty">本學期尚無班級</td></tr>') +
      '</tbody></table></div></section>';

    const items = sessions.map((s) => {
      const cls = byId(v.classes, s.classId);
      const t = s.teacherId ? byId(v.teachers, s.teacherId) : null;
      const grad = cls && C.classStatus(cls, tm.year) === 'graduating';
      return {
        id: s.id, kind: 'session', day: s.day, start: s.start, end: s.end,
        title: cls ? C.className(cls, tm.year) : '',
        sub: (t ? t.name : '講師未定') + (s.note ? ' · ' + s.note : ''),
        color: t ? t.color : null,
        cls: (t ? '' : 'unassigned ') + (grad ? 'graduating' : ''),
        badge: grad ? '畢業班' : '',
      };
    });
    window.Grid.render($('#grid'), { dayStart: v.settings.dayStart, dayEnd: v.settings.dayEnd, items });
    $('#print').onclick = () => window.print();
  }

  async function init() {
    try {
      cloud = await window.CloudReady;
    } catch (e) {
      showMessage('無法連線', '請檢查網路後重新整理。');
      return;
    }
    route();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
