// Run with: node --test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../src/formula.js'), 'utf8');
const ctx = { escRe: (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') };
vm.createContext(ctx);
vm.runInContext(src + '\nthis.Formula = Formula;', ctx);
const { compile, FN, FErr } = ctx.Formula;

// A tiny sheet: A1..A3 = 1,2,3, B1 = "Tools"
const cells = { A1: 1, A2: 2, A3: 3, B1: 'Tools' };
const C = (sheet, k) => cells[k] ?? 0;
const R = (sheet, a, b) => {
  const out = [];
  for (let r = +a.slice(1); r <= +b.slice(1); r++) out.push([cells[a[0] + r] ?? null]);
  return out;
};
const run = (f) => compile(f)(C, R, FN);
const rejects = (f) => {
  try {
    compile(f);
  } catch (e) {
    return e instanceof FErr;
  }
  return false;
};

test('normal formulas give the right result', () => {
  assert.strictEqual(run('SUM(A1:A3)'), 6);
  assert.strictEqual(run('A1+A2*A3'), 7);
  assert.strictEqual(run('2^10'), 1024);
  assert.strictEqual(run('50%'), 0.5);
  assert.strictEqual(run('IF(A3>=3,"big","small")'), 'big');
  assert.strictEqual(run('A1<>A2'), true);
  assert.strictEqual(run('A1=1'), true);
  assert.strictEqual(run('"a"&"b"'), 'ab');
  assert.strictEqual(run('ROUND(AVERAGE(A1:A3),1)'), 2);
  assert.strictEqual(run('UPPER(B1)'), 'TOOLS');
  assert.strictEqual(run('COUNTIF(A1:A3,">1")'), 2);
  assert.strictEqual(run('"say ""hi"""'), 'say "hi"');
  assert.strictEqual(run('TRUE'), true);
});

test('code injection attempts are rejected', () => {
  const attacks = [
    'alert(1)', // unknown function
    'constructor', // bare identifier
    'A1.constructor', // property access
    'F.constructor', // reach the function table
    'SUM.constructor("return this")()', // dotted name becomes SUM_CONSTRUCTOR, not in FN
    'this', // global object
    'globalThis', // global object
    '[].map', // brackets
    '{}', // braces
    '1;alert(1)', // statement separator
    '`x`', // template literal
    '(()=>1)()', // arrow function
    '\\u0061lert(1)', // unicode escape
    '"x".length', // property on a string
    'TOSTRING(1)', // object prototype method name
    '__PROTO__(1)', // prototype key
    'HASOWNPROPERTY("x")', // prototype method
    'Sheet1!A1.constructor', // property after a sheet reference
    '1e5', // exponent letter (no identifiers at all)
  ];
  for (const f of attacks) assert.ok(rejects(f), `should reject: ${f}`);
});

test('strings stay data even when they contain code', () => {
  assert.strictEqual(run('"alert(1)"'), 'alert(1)');
  // Backslash is not an escape in formulas, so this closes the string and exposes code: must be rejected.
  assert.ok(rejects('"\\"+alert(1)+\\""'));
});
