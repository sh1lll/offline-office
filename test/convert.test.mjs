// Converter tests in real Chrome: every sample source to every target format, each output checked by
// opening it again, plus one batch through the Convert screen. Needs Chrome; skipped without it.
// Run: node --test   (set SPEED=1 to print how long each conversion took)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { CHROME, open } from './chrome.mjs';

// Runs in the page. Builds sample files with the app's own exporters, so no fixtures are needed.
const SAMPLES = `
  const cap = async (fn) => { capture = { files: [], errors: [] }; try { await fn(); return capture.files[0]; } finally { capture = null; } };
  Mods.doc.fromHtml('<h1>Quarterly plan</h1><p>Hello <b>world</b>.</p><ul><li>First</li><li>Second</li></ul><table><tr><th>Name</th><th>Qty</th></tr><tr><td>Apples</td><td>3</td></tr></table>', 'sample');
  const docx = await cap(() => Mods.doc.act('docx'));
  const pdf = await cap(() => Mods.doc.act('pdf'));
  await Mods.sheet.load(new File(['name,qty\\napples,3\\npears,5'], 'data.csv'));
  const xlsx = await cap(() => Mods.sheet.act('xlsx'));
  await cap(() => Mods.slides.act('example'));
  const pptx = await cap(() => Mods.slides.act('pptx'));
  const c = el('canvas', { width: 900, height: 300 }), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 300); g.fillStyle = '#000'; g.font = '44px Arial';
  g.fillText('Invoice 4471', 40, 100); g.fillText('Total 1250', 40, 190);
  const png = new File([await new Promise((r) => c.toBlob(r, 'image/png'))], 'scan.png', { type: 'image/png' });
  window.SRC = {
    docx, pdf, xlsx, pptx, png,
    md: new File(['# Notes\\n\\nSome *markdown*.\\n\\n- one\\n- two'], 'notes.md'),
    json: new File([JSON.stringify([{ city: 'Oslo', temp: 4 }, { city: 'Lima', temp: 19 }])], 'cities.json'),
    html: new File(['<title>Page</title><h1>Hello</h1><p>A web page.</p>'], 'page.html'),
    csv: new File(['x,y\\n1,2'], 'pts.csv'),
    bin: new File([new Uint8Array([0, 1, 2, 250, 72, 105])], 'blob.bin'),
  };
  return Object.values(SRC).map((f) => f.name);
`;

// Runs in the page: converts the sample with this file name to target along the planned route and checks the result.
const CONVERT = (name, target) => `
  const f = Object.values(SRC).find((x) => x.name === ${JSON.stringify(name)}), t = ${JSON.stringify(target)};
  const k = ext(f.name) === 'bin' ? '?' : ext(f.name);
  const route = k === t ? [] : Mods.convert.plan(k, t);
  if (!route) return { ok: false, why: 'no route' };
  const t0 = performance.now();
  let files = [f];
  try {
    for (const e of route) {
      const out = [];
      for (const x of await e.run(files))
        if (/\\.zip$/.test(x.name)) { const z = await JSZip.loadAsync(x); for (const [p, v] of Object.entries(z.files)) if (!v.dir) out.push(new File([await v.async('blob')], p)); }
        else out.push(x);
      files = out;
    }
  } catch (e) { capture = null; return { ok: false, why: String(e.message || e) }; }
  const want = t === 'ocr' ? 'pdf' : t;
  files = files.filter((x) => ext(x.name) === want);
  if (!files.length) return { ok: false, why: 'nothing produced' };
  const x = files[0], e2 = ext(x.name);
  try {
    if (e2 === 'pdf') await pdfjsLib.getDocument({ data: new Uint8Array(await x.arrayBuffer()), isEvalSupported: false }).promise;
    else if (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'epub'].includes(e2)) await JSZip.loadAsync(x);
    else if (e2 === 'xls') XLSX.read(new Uint8Array(await x.arrayBuffer()), { type: 'array' });
    else if (['png', 'jpg', 'webp', 'gif', 'bmp', 'ico'].includes(e2)) await createImageBitmap(x);
    else if (e2 === 'svg') await loadImg(URL.createObjectURL(new Blob([await x.text()], { type: 'image/svg+xml' })));
    else if (e2 === 'tiff') await Formats.decodeImage(x);
    else { const s = await x.text(); if (!s.trim()) throw new Error('empty'); if (e2 === 'json') JSON.parse(s); }
  } catch (e) { return { ok: false, why: 'output does not open: ' + e.message }; }
  return { ok: true, ms: Math.round(performance.now() - t0), route: [k, ...route.map((e) => e.to)].join('>'), size: x.size };
`;

const pages = [
  'index.html',
  ...(existsSync(new URL('../dist/offline-office.html', import.meta.url))
    ? ['dist/offline-office.html']
    : []),
];

for (const page of pages)
  test(
    `convert every format to every format (${page})`,
    { skip: !CHROME && 'Chrome not found', timeout: 900000 },
    async (t) => {
      const app = await open(page);
      try {
        const names = await app.run(SAMPLES);
        const targets = await app.run(`return [...$('#cvTo').options].map((o) => o.value)`);
        const fails = [],
          times = [];
        for (const src of names)
          for (const target of targets) {
            const r = await app.run(CONVERT(src, target));
            if (!r.ok) fails.push(`${src} → ${target}: ${r.why}`);
            else times.push([r.ms, `${src} → ${target} (${r.route})`]);
          }
        if (process.env.SPEED) {
          times.sort((a, b) => b[0] - a[0]);
          t.diagnostic(
            `${times.length} conversions, total ${(times.reduce((s, [m]) => s + m, 0) / 1000).toFixed(1)} s`,
          );
          for (const [ms, what] of times.slice(0, 12)) t.diagnostic(`${String(ms).padStart(6)} ms  ${what}`);
        }
        assert.deepEqual(fails, []);
        assert.deepEqual(app.external(), [], 'no request may leave the machine');
      } finally {
        await app.close();
      }
    },
  );

test(
  'the Convert screen runs a batch with a zip inside',
  { skip: !CHROME && 'Chrome not found', timeout: 300000 },
  async () => {
    const app = await open('index.html');
    try {
      const r = await app.run(`
      let got = null; const orig = saveFile;
      saveFile = async (n, d) => (capture ? orig(n, d) : ((got = { n, d }), true));
      const z = new JSZip(); z.file('inside/readme.txt', 'Hello from a zip'); z.file('inside/nums.csv', 'a,b\\n1,2');
      show('convert');
      await Mods.convert.drop([new File([await z.generateAsync({ type: 'blob' })], 'bundle.zip'), new File(['# Hi'], 'hi.md'), new File([new Uint8Array([0, 9])], 'x.bin')]);
      $('#cvTo').value = 'docx'; $('#cvTo').onchange();
      $('#cvGo').click(); $('#cvGo').click(); // a second click while running must not start a second batch
      for (let i = 0; i < 600 && !got; i++) await sleep(100);
      saveFile = orig;
      const names = got ? Object.keys((await JSZip.loadAsync(got.d)).files) : [];
      return { file: got && got.n, names, rows: $$('#cvDesk .cv-row .sub').map((e) => e.textContent) };
    `);
      assert.equal(r.file, 'converted.zip');
      assert.deepEqual(r.names.sort(), ['hi.docx', 'nums.docx', 'readme.docx', 'x.docx']);
      assert.ok(
        r.rows.every((s) => s.startsWith('Done')),
        r.rows.join('; '),
      );
    } finally {
      await app.close();
    }
  },
);
