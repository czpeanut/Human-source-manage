const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/core.js');

function baseData() {
  const term = { id: 't115b', year: 115, sem: '下' };
  const g = (n) => C.GRADES.indexOf(n);
  return {
    settings: { dayStart: 480, dayEnd: 1320 },
    teachers: [{ id: 'tA', name: 'A' }, { id: 'tB', name: 'B' }],
    branches: [{ id: 'b1', name: '明道' }],
    terms: [term],
    classes: [
      { id: 'j1', branchId: 'b1', subject: '數學', label: '', anchorGrade: g('國一'), anchorYear: 115, startYear: 115, endYear: null },
      { id: 'j3', branchId: 'b1', subject: '數學', label: '', anchorGrade: g('國三'), anchorYear: 115, startYear: 115, endYear: null },
      { id: 'h3', branchId: 'b1', subject: '英文', label: '', anchorGrade: g('高三'), anchorYear: 115, startYear: 115, endYear: null },
      { id: 'x', branchId: 'b1', subject: '台北課程', label: '', anchorGrade: null, anchorYear: 115, startYear: 115, endYear: null },
    ],
    sessions: [
      { id: 's1', termId: 't115b', classId: 'j1', teacherId: 'tA', day: 0, start: 1110, end: 1260 },
      { id: 's2', termId: 't115b', classId: 'j3', teacherId: 'tA', day: 2, start: 1110, end: 1260 },
    ],
    blocks: [{ id: 'bl', termId: 't115b', teacherId: 'tA', day: 6, start: 1080, end: 1320, note: '無法接' }],
  };
}

test('time helpers', () => {
  assert.strictEqual(C.fmtTime(1110), '18:30');
  assert.strictEqual(C.parseTime('09:30'), 570);
  assert.deepStrictEqual(C.timeOptions(480, 570), [480, 510, 540, 570]);
});

test('terms order and next', () => {
  assert.deepStrictEqual(C.nextTerm({ year: 115, sem: '上' }), { year: 115, sem: '下' });
  assert.deepStrictEqual(C.nextTerm({ year: 115, sem: '下' }), { year: 116, sem: '上' });
  const sorted = C.sortTerms([{ year: 116, sem: '上' }, { year: 115, sem: '下' }, { year: 115, sem: '上' }]);
  assert.deepStrictEqual(sorted.map(C.termName), ['115上', '115下', '116上']);
});

test('grades advance by year and graduating classes are detected', () => {
  const d = baseData();
  const j1 = d.classes[0];
  const j3 = d.classes[1];
  assert.strictEqual(C.className(j1, 115), '國一數學');
  assert.strictEqual(C.className(j1, 116), '國二數學');
  assert.strictEqual(C.classStatus(j1, 117), 'graduating');
  assert.strictEqual(C.classStatus(j1, 118), 'graduated');
  assert.strictEqual(C.classStatus(j3, 115), 'graduating');
  assert.strictEqual(C.classStatus(j3, 116), 'graduated');
  assert.strictEqual(C.classStatus(j1, 114), 'future');
  assert.strictEqual(C.classStatus(d.classes[3], 120), 'active');
});

test('conflicts: teacher double booking, blocks, class overlap', () => {
  const d = baseData();
  const cand = { termId: 't115b', classId: 'x', teacherId: 'tA', day: 0, start: 1200, end: 1290 };
  const msgs = C.findConflicts(d, cand);
  assert.strictEqual(msgs.length, 1);
  assert.match(msgs[0], /講師衝堂/);

  assert.strictEqual(C.findConflicts(d, Object.assign({}, cand, { teacherId: 'tB' })).length, 0);
  assert.match(C.findConflicts(d, Object.assign({}, cand, { day: 6 }))[0], /不可排/);
  assert.match(C.findConflicts(d, { termId: 't115b', classId: 'j1', teacherId: 'tB', day: 0, start: 1110, end: 1140 })[0], /班級衝堂/);
  // 相鄰不算衝堂
  assert.strictEqual(C.findConflicts(d, Object.assign({}, cand, { start: 1260, end: 1320 })).length, 0);
  // 編輯自己不算衝堂
  assert.strictEqual(C.findConflicts(d, Object.assign({}, d.sessions[0]), 's1').length, 0);
});

test('new school year promotes classes, graduates and optionally continues', () => {
  const d = baseData();
  const plan = C.planNewTerm(d, 't115b', { year: 116, sem: '上' });
  const j3 = plan.find((r) => r.classId === 'j3');
  assert.strictEqual(j3.status, 'graduated');
  assert.strictEqual(j3.canContinue, true);
  assert.strictEqual(j3.continueTo, '高一數學');
  assert.strictEqual(plan.find((r) => r.classId === 'h3').canContinue, false);
  assert.strictEqual(plan.find((r) => r.classId === 'j1').to, '國二數學');

  const t = C.applyNewTerm(d, 't115b', { year: 116, sem: '上' }, { copySessions: true, copyBlocks: true, continueIds: ['j3'] });
  const newSessions = d.sessions.filter((s) => s.termId === t.id);
  assert.strictEqual(newSessions.length, 2);
  const cont = d.classes.find((c) => c.startYear === 116);
  assert.ok(cont);
  assert.strictEqual(C.className(cont, 116), '高一數學');
  assert.ok(newSessions.some((s) => s.classId === cont.id && s.teacherId === 'tA'));
  assert.strictEqual(d.blocks.filter((b) => b.termId === t.id).length, 1);
  // 舊學期仍保留原年級
  assert.strictEqual(C.className(d.classes[0], 115), '國一數學');
  assert.throws(() => C.applyNewTerm(d, 't115b', { year: 116, sem: '上' }, {}));
});

test('same-year new term copies without promotion and can drop teachers', () => {
  const d = baseData();
  d.terms = [{ id: 't115a', year: 115, sem: '上' }];
  d.sessions.forEach((s) => (s.termId = 't115a'));
  const t = C.applyNewTerm(d, 't115a', { year: 115, sem: '下' }, { copySessions: true, keepTeachers: false });
  const ns = d.sessions.filter((s) => s.termId === t.id);
  assert.strictEqual(ns.length, 2);
  assert.ok(ns.every((s) => s.teacherId === null));
});

test('layoutLanes splits overlapping items', () => {
  const items = C.layoutLanes([
    { day: 0, start: 600, end: 720 },
    { day: 0, start: 660, end: 780 },
    { day: 0, start: 780, end: 840 },
    { day: 1, start: 600, end: 720 },
  ]);
  assert.deepStrictEqual(items.map((i) => [i.lane, i.lanes]), [[0, 2], [1, 2], [0, 1], [0, 1]]);
});

test('buildBranchView only contains that branch', () => {
  const d = baseData();
  d.branches.push({ id: 'b2', name: '台北' });
  d.teachers[0].note = '0912-000-000';
  d.classes.push({ id: 'tp', branchId: 'b2', subject: '英文', label: '', anchorGrade: 6, anchorYear: 115, startYear: 115, endYear: null });
  d.sessions.push({ id: 's9', termId: 't115b', classId: 'tp', teacherId: 'tB', day: 1, start: 600, end: 700 });
  const v = C.buildBranchView(d, 'b1');
  assert.strictEqual(v.branch.name, '明道');
  assert.ok(v.classes.every((c) => c.branchId === 'b1'));
  assert.deepStrictEqual(v.sessions.map((s) => s.id).sort(), ['s1', 's2']);
  assert.deepStrictEqual(v.teachers.map((t) => t.id), ['tA']);
  assert.strictEqual(v.teachers[0].note, undefined);
  assert.strictEqual(v.blocks, undefined);
  assert.strictEqual(C.buildBranchView(d, 'nope'), null);
});

test('defaultTerm picks the term for today', () => {
  const terms = [{ id: 'a', year: 115, sem: '上' }, { id: 'b', year: 115, sem: '下' }, { id: 'c', year: 116, sem: '上' }];
  assert.strictEqual(C.defaultTerm(terms, new Date(2026, 9, 1)).id, 'a');
  assert.strictEqual(C.defaultTerm(terms, new Date(2027, 2, 1)).id, 'b');
  assert.strictEqual(C.defaultTerm(terms, new Date(2027, 0, 10)).id, 'a');
  assert.strictEqual(C.defaultTerm(terms, new Date(2030, 0, 1)).id, 'c');
  assert.strictEqual(C.defaultTerm(terms, new Date(2020, 0, 1)).id, 'a');
});
