// Run with: node --test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/diff.js'), 'utf8') + '\nthis.Diff = Diff;', ctx);
const { seq, words, compare } = ctx.Diff;
const kinds = (r) => r.rows.map((x) => x.kind).join(',');

test('seq finds the shortest edit', () => {
  const ops = seq([...'abcde'], [...'abxde'])
    .map((o) => o[0])
    .join('');
  assert.strictEqual(ops, '==-+==');
  assert.strictEqual(seq([], []).length, 0);
  assert.strictEqual(
    seq(['a'], [])
      .map((o) => o[0])
      .join(''),
    '-',
  );
});

test('words marks only the changed words and keeps spacing', () => {
  const w = words('Assign all 42 beds by 15 March', 'Assign all 48 beds by 1 April');
  assert.strictEqual(w.ins, 3);
  assert.strictEqual(w.del, 3);
  const rebuilt = (op) =>
    w.parts
      .filter((p) => p.op === '=' || p.op === op)
      .map((p) => p.t)
      .join('');
  assert.strictEqual(rebuilt('-'), 'Assign all 42 beds by 15 March');
  assert.strictEqual(rebuilt('+'), 'Assign all 48 beds by 1 April');
});

test('compare: unchanged, edited, added, removed and moved paragraphs', () => {
  const A = [
    'Title',
    'The garden has 42 raised beds for the season.',
    'This paragraph will be deleted entirely from the plan.',
    'Watering happens every morning and every evening.',
    'Compost is ordered in February each year.',
  ];
  const B = [
    'Title',
    'Compost is ordered in February each year.',
    'The garden has 48 raised beds for the season.',
    'A brand new paragraph about the harvest market in October.',
    'Watering happens every morning and every evening.',
  ];
  const r = compare(A, B);
  assert.strictEqual(r.stats.changed, 1);
  assert.strictEqual(r.stats.removed, 1);
  assert.strictEqual(r.stats.added, 1);
  // Which paragraph counts as moved depends on the match, but one move must be reported.
  assert.ok(r.stats.moved >= 1);
  const changed = r.rows.find((x) => x.kind === 'changed');
  assert.strictEqual(changed.l, A[1]);
  assert.strictEqual(changed.r, B[2]);
  // Every paragraph of both versions appears exactly once on its own side, and B stays in order.
  // (spread copies the arrays out of the vm sandbox, whose Array prototype differs)
  assert.deepStrictEqual([...r.rows.filter((x) => x.l).map((x) => x.l)].sort(), [...A].sort());
  assert.deepStrictEqual([...r.rows.filter((x) => x.r).map((x) => x.r)], B);
});

test('compare: identical documents and whitespace or case differences', () => {
  assert.strictEqual(
    compare(['a  b', 'c'], ['a b', ' c ']).rows.every((x) => x.kind === 'same'),
    true,
  );
  assert.strictEqual(compare(['Hello World'], ['hello world']).stats.changed, 1);
  assert.strictEqual(compare(['Hello World'], ['hello world'], { ignoreCase: true }).stats.changed, 0);
});

test('compare: an empty side shows everything as added or removed', () => {
  assert.strictEqual(compare([], ['One paragraph.', 'Two.']).stats.added, 2);
  assert.strictEqual(compare(['One paragraph.'], []).stats.removed, 1);
});
