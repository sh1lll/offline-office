'use strict';
/* ============================== CONVERT ============================== */
// Any file to any listed format. Conversions are edges between formats: an editor's own export
// (load the file, run its Save as action, with saveFile captured; see `capture` in core.js) or a
// small writer below. For each file the cheapest chain of edges is planned (XLSX → HTML → PDF → PNG
// …), so every pair works, sensible or not.
Mods.convert = (() => {
  const desk = $('#cvDesk'),
    bar = $('#cvBar'),
    to = $('#cvTo');
  let items = []; // { file, state, msg }
  let running = false;

  /* --- editor exports: [editor, action] steps per editor and output format --- */
  const d = (a) => [['doc', a]];
  const viaDoc = (a) => [
    ['text', 'toDoc'],
    ['doc', a],
  ];
  const PATHS = {
    doc: {
      pdf: d('pdf'),
      docx: d('docx'),
      odt: d('odt'),
      rtf: d('rtf'),
      html: d('html'),
      md: d('md'),
      txt: d('txt'),
    },
    text: {
      pdf: [['text', 'toPdf']],
      html: [['text', 'toHtml']],
      docx: viaDoc('docx'),
      odt: viaDoc('odt'),
      rtf: viaDoc('rtf'),
    },
    sheet: {
      xlsx: [['sheet', 'xlsx']],
      xls: [['sheet', 'xls']],
      ods: [['sheet', 'ods']],
      csv: [['sheet', 'csv']],
      html: [['sheet', 'html']],
    },
    slides: { pptx: [['slides', 'pptx']], pdf: [['slides', 'pdf']] },
    image: {
      png: [['image', 'png']],
      jpg: [['image', 'jpg']],
      webp: [['image', 'webp']],
      pdf: [
        ['image', 'toPdf'],
        ['pdf', 'export'],
      ],
      txt: [
        ['image', 'ocrText'],
        ['text', 'save'],
      ],
    },
    pdf: {
      ocr: [
        ['pdf', 'ocr'],
        ['pdf', 'export'],
      ],
      txt: [
        ['pdf', 'text'],
        ['text', 'save'],
      ],
      docx: [
        ['pdf', 'toDoc'],
        ['doc', 'docx'],
      ],
    },
  };
  async function viaEditor(f, steps) {
    capture = { files: [], errors: [] };
    try {
      const m = routeOf(f);
      await Mods[m].load(f);
      unsaved.delete(m);
      for (const [m2, a] of steps) {
        await Mods[m2].act(a);
        if (capture.errors.length) throw new Error(capture.errors[0]);
      }
      return capture.files;
    } finally {
      capture = null;
    }
  }

  /* --- writers the editors do not have --- */
  const RASTER = ['png', 'jpg', 'webp', 'gif', 'bmp', 'tiff', 'ico', 'svg'];
  const canvasOf = async (f) => {
    const im = await Formats.decodeImage(f);
    const c = el('canvas', { width: im.naturalWidth || im.width, height: im.naturalHeight || im.height });
    c.getContext('2d').drawImage(im, 0, 0);
    return c;
  };
  const toBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));
  const rgba = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  function onWhite(c) {
    const w = el('canvas', { width: c.width, height: c.height }),
      g = w.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w.width, w.height);
    g.drawImage(c, 0, 0);
    return w;
  }
  // 8-bit GIF with a fixed 6×7×6 color cube, flattened onto white.
  function gif(c) {
    const { width: w, height: h } = c,
      px = rgba(onWhite(c)),
      n = w * h,
      idx = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4)
      idx[i] = Math.round(px[j] / 51) * 42 + Math.round(px[j + 1] / 42.5) * 6 + Math.round(px[j + 2] / 51);
    const out = [];
    const u16 = (v) => out.push(v & 255, v >> 8);
    out.push(...[...'GIF89a'].map((ch) => ch.charCodeAt(0)));
    u16(w), u16(h), out.push(0xf7, 0, 0);
    for (let i = 0; i < 256; i++)
      out.push(
        ...(i < 252
          ? [Math.floor(i / 42) * 51, Math.round(Math.floor((i % 42) / 6) * 42.5), (i % 6) * 51]
          : [0, 0, 0]),
      );
    out.push(0x2c), u16(0), u16(0), u16(w), u16(h), out.push(0, 8);
    // LZW, codes packed least significant bit first, as GIF requires
    const data = [];
    let cur = 0,
      bits = 0,
      size = 9,
      next = 258;
    const emit = (code) => {
      cur |= code << bits;
      bits += size;
      while (bits >= 8) data.push(cur & 255), (cur >>>= 8), (bits -= 8);
    };
    const dict = new Map();
    emit(256);
    let prefix = idx[0];
    for (let i = 1; i < n; i++) {
      const k = idx[i],
        key = (prefix << 8) | k,
        code = dict.get(key);
      if (code !== undefined) {
        prefix = code;
        continue;
      }
      emit(prefix);
      // The decoder adds each code one step later, so the width grows once `next` passes it.
      if (next >= 1 << size && size < 12) size++;
      if (next < 4096) dict.set(key, next++);
      else emit(256), dict.clear(), (next = 258), (size = 9);
      prefix = k;
    }
    emit(prefix);
    if (next >= 1 << size && size < 12) size++;
    emit(257);
    if (bits) data.push(cur & 255);
    for (let i = 0; i < data.length; i += 255) {
      const block = data.slice(i, i + 255);
      out.push(block.length, ...block);
    }
    out.push(0, 0x3b);
    return new Blob([new Uint8Array(out)], { type: 'image/gif' });
  }
  // 24-bit BMP, rows bottom-up and padded to 4 bytes.
  function bmp(c) {
    const { width: w, height: h } = c,
      px = rgba(onWhite(c)),
      row = (w * 3 + 3) & ~3,
      buf = new DataView(new ArrayBuffer(54 + row * h));
    [66, 77].forEach((b, i) => buf.setUint8(i, b));
    buf.setUint32(2, 54 + row * h, true);
    buf.setUint32(10, 54, true);
    buf.setUint32(14, 40, true);
    buf.setInt32(18, w, true);
    buf.setInt32(22, h, true);
    buf.setUint16(26, 1, true);
    buf.setUint16(28, 24, true);
    buf.setUint32(34, row * h, true);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4,
          o = 54 + (h - 1 - y) * row + x * 3;
        buf.setUint8(o, px[s + 2]), buf.setUint8(o + 1, px[s + 1]), buf.setUint8(o + 2, px[s]);
      }
    return new Blob([buf], { type: 'image/bmp' });
  }
  async function encode(c, fmt) {
    if (fmt === 'png') return toBlob(c, 'image/png');
    if (fmt === 'jpg') return toBlob(onWhite(c), 'image/jpeg', 0.92);
    if (fmt === 'webp') {
      const b = await toBlob(c, 'image/webp', 0.92);
      if (b.type !== 'image/webp') throw new Error('this browser cannot write WebP');
      return b;
    }
    if (fmt === 'gif') return gif(c);
    if (fmt === 'bmp') return bmp(c);
    if (fmt === 'tiff') {
      await Formats.loadScript('vendor/UTIF.js');
      return new Blob([UTIF.encodeImage(rgba(c), c.width, c.height)], { type: 'image/tiff' });
    }
    if (fmt === 'ico') {
      // One PNG inside an icon container; icons are at most 256 pixels.
      const k = Math.min(1, 256 / Math.max(c.width, c.height)),
        s = el('canvas', {
          width: Math.max(1, Math.round(c.width * k)),
          height: Math.max(1, Math.round(c.height * k)),
        });
      s.getContext('2d').drawImage(c, 0, 0, s.width, s.height);
      const png = new Uint8Array(await (await toBlob(s, 'image/png')).arrayBuffer());
      const head = new DataView(new ArrayBuffer(22));
      head.setUint16(2, 1, true);
      head.setUint16(4, 1, true);
      head.setUint8(6, s.width & 255);
      head.setUint8(7, s.height & 255);
      head.setUint16(10, 1, true);
      head.setUint16(12, 32, true);
      head.setUint32(14, png.length, true);
      head.setUint32(18, 22, true);
      return new Blob([head, png], { type: 'image/x-icon' });
    }
    if (fmt === 'svg')
      return new Blob(
        [
          `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}"><image width="${c.width}" height="${c.height}" href="${c.toDataURL('image/png')}"/></svg>`,
        ],
        { type: 'image/svg+xml' },
      );
  }
  // Every PDF page as an image, at 144 dpi.
  // shortcut: holds all pages in memory at once; stream page by page if long PDFs run out of memory.
  async function pdfPages(f) {
    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(await f.arrayBuffer()),
      isEvalSupported: false,
    }).promise;
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i),
        vp = pg.getViewport({ scale: 2 });
      const c = el('canvas', { width: Math.floor(vp.width), height: Math.floor(vp.height) });
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      out.push(c);
    }
    return out;
  }
  const text = (f) => f.text();
  const named = (f, e, data, type) => new File([data], base(f.name) + '.' + e, { type });
  // Bytes of an unknown file as text: itself if it reads as text, else a hex dump of the start.
  async function rawText(f) {
    const b = new Uint8Array(await f.arrayBuffer());
    if (!b.subarray(0, 8192).includes(0)) return new TextDecoder().decode(b);
    const max = 65536,
      lines = [];
    for (let i = 0; i < Math.min(b.length, max); i += 16) {
      const row = b.subarray(i, i + 16);
      lines.push(
        i.toString(16).padStart(8, '0') +
          '  ' +
          [...row]
            .map((x) => x.toString(16).padStart(2, '0'))
            .join(' ')
            .padEnd(48) +
          '  ' +
          [...row].map((x) => (x > 31 && x < 127 ? String.fromCharCode(x) : '.')).join(''),
      );
    }
    return `${f.name}: ${b.length} bytes of binary data${b.length > max ? ', first 64 KB shown' : ''}\n\n${lines.join('\n')}\n`;
  }
  // A one-chapter EPUB 3 book from an HTML file.
  async function epub(f) {
    const doc = new DOMParser().parseFromString(await text(f), 'text/html');
    doc.querySelectorAll('script,style,link,meta').forEach((n) => n.remove());
    const title = esc(doc.title || base(f.name));
    const body = [...doc.body.childNodes].map((n) => new XMLSerializer().serializeToString(n)).join('');
    const z = new JSZip();
    z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    z.file(
      'META-INF/container.xml',
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    );
    z.file(
      'OEBPS/book.opf',
      `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:${crypto.randomUUID()}</dc:identifier><dc:title>${title}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="text"/></spine></package>`,
    );
    const page = (t, b) =>
      `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${t}</title></head><body>${b}</body></html>`;
    z.file(
      'OEBPS/nav.xhtml',
      page(title, `<nav epub:type="toc"><ol><li><a href="text.xhtml">${title}</a></li></ol></nav>`),
    );
    z.file('OEBPS/text.xhtml', page(title, body));
    return named(f, 'epub', await z.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' }));
  }
  // One slide per image, scaled to fit a 16:9 slide.
  async function deck(files) {
    const p = new PptxGenJS();
    p.layout = 'LAYOUT_16x9';
    for (const f of files) {
      const c = await canvasOf(f),
        k = Math.min(10 / c.width, 5.625 / c.height),
        w = c.width * k,
        h = c.height * k;
      p.addSlide().addImage({ data: c.toDataURL('image/png'), x: (10 - w) / 2, y: (5.625 - h) / 2, w, h });
    }
    return [named(files[0], 'pptx', await p.write({ outputType: 'blob' }))];
  }
  const sheetOf = async (f) => {
    const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' });
    return wb.Sheets[wb.SheetNames[0]];
  };

  /* --- the graph --- */
  const mod = (x) => (x === '?' ? null : routeOf({ name: 'f.' + x, type: '' }));
  const is = (m) => (x) => mod(x) === m;
  const textLike = (x) =>
    mod(x) === 'text' || ['csv', 'tsv', 'html', 'htm', 'xhtml', 'svg', 'md'].includes(x);
  // One file at a time: the editors hold one document each.
  const each = (fn) => async (files) => {
    const out = [];
    for (const f of files) out.push(...(await fn(f)));
    return out;
  };
  const E = [];
  for (const [m, outs] of Object.entries(PATHS))
    for (const [t, steps] of Object.entries(outs))
      E.push({
        from: is(m),
        to: t,
        cost: 1,
        mods: steps.map(([s]) => s),
        run: each((f) => viaEditor(f, steps)),
      });
  for (const t of RASTER) {
    E.push({
      from: (x) => x === 'pdf',
      to: t,
      cost: 1,
      run: each(async (f) => {
        const pages = await pdfPages(f),
          num = (i) => (pages.length > 1 ? '-' + String(i + 1).padStart(3, '0') : '');
        const out = [];
        for (const [i, c] of pages.entries())
          out.push(new File([await encode(c, t)], `${base(f.name)}${num(i)}.${t}`));
        return out;
      }),
    });
    E.push({
      from: is('image'),
      to: t,
      cost: 1,
      run: each(async (f) => [named(f, t, await encode(await canvasOf(f), t))]),
    });
  }
  E.push({
    from: (x) => ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(x),
    to: 'pptx',
    cost: 2,
    run: deck,
  });
  E.push({
    from: textLike,
    to: 'txt',
    cost: 3,
    run: each(async (f) => [named(f, 'txt', await text(f), 'text/plain')]),
  });
  E.push({
    from: (x) => x === 'txt',
    to: 'md',
    cost: 3,
    run: each(async (f) => [named(f, 'md', await text(f), 'text/markdown')]),
  });
  E.push({
    from: (x) => x === 'txt',
    to: 'tsv',
    cost: 2,
    run: each(async (f) => [named(f, 'tsv', await text(f), 'text/tab-separated-values')]),
  });
  E.push({
    from: is('sheet'),
    to: 'tsv',
    cost: 1,
    run: each(async (f) => [named(f, 'tsv', XLSX.utils.sheet_to_csv(await sheetOf(f), { FS: '\t' }))]),
  });
  E.push({
    from: is('sheet'),
    to: 'json',
    cost: 1,
    run: each(async (f) => [
      named(
        f,
        'json',
        JSON.stringify(XLSX.utils.sheet_to_json(await sheetOf(f)), null, 2),
        'application/json',
      ),
    ]),
  });
  E.push({
    from: textLike,
    to: 'json',
    cost: 3,
    run: each(async (f) => [
      named(f, 'json', JSON.stringify({ name: f.name, text: await text(f) }, null, 2), 'application/json'),
    ]),
  });
  E.push({
    from: (x) => x === 'json',
    to: 'csv',
    cost: 1,
    run: each(async (f) => {
      let v = JSON.parse(await text(f));
      if (!Array.isArray(v)) v = [v];
      const ws = v.every((r) => r && typeof r === 'object' && !Array.isArray(r))
        ? XLSX.utils.json_to_sheet(
            v.map((r) =>
              Object.fromEntries(
                Object.entries(r).map(([k, x]) => [k, typeof x === 'object' ? JSON.stringify(x) : x]),
              ),
            ),
          )
        : XLSX.utils.aoa_to_sheet(
            v.map((r) => (Array.isArray(r) ? r : [typeof r === 'object' ? JSON.stringify(r) : r])),
          );
      return [named(f, 'csv', XLSX.utils.sheet_to_csv(ws), 'text/csv')];
    }),
  });
  E.push({
    from: (x) => x === 'html' || x === 'htm',
    to: 'epub',
    cost: 1,
    run: each(async (f) => [await epub(f)]),
  });
  E.push({
    from: (x) => x === '?',
    to: 'txt',
    cost: 1,
    run: each(async (f) => [named(f, 'txt', await rawText(f), 'text/plain')]),
  });

  // The cheapest chain of edges from a file's format to the target (Dijkstra over a few dozen formats).
  function plan(from, target) {
    const dist = new Map([[from, 0]]),
      prev = new Map(), // format → { e: edge that reached it, n: format it came from }
      todo = [from],
      seen = new Set();
    while (todo.length) {
      todo.sort((a, b) => dist.get(a) - dist.get(b));
      const n = todo.shift();
      if (n === target) break;
      if (seen.has(n) || n === 'ocr') continue;
      seen.add(n);
      for (const e of E)
        if (e.from(n) && !(dist.get(e.to) <= dist.get(n) + e.cost)) {
          dist.set(e.to, dist.get(n) + e.cost);
          prev.set(e.to, { e, n });
          todo.push(e.to);
        }
    }
    if (!prev.has(target)) return null;
    const route = [];
    for (let n = target; n !== from; n = prev.get(n).n) route.unshift(prev.get(n).e);
    return route;
  }
  const kind = (f) => {
    const e = ext(f.name);
    return e === 'pages' || e === 'key' ? 'pdf' : routeOf(f) ? e : '?';
  };
  // Same format in and out: save it again through its editor if one can, else copy it.
  const routeFor = (it) => {
    const k = kind(it.file);
    if (k === to.value) return E.filter((e) => e.from(k) && e.to === k).slice(0, 1);
    return plan(k, to.value);
  };
  const label = (n) => (n === 'ocr' ? 'searchable PDF' : n === '?' ? 'raw data' : n.toUpperCase());
  const outExt = (t) => (t === 'ocr' ? 'pdf' : t);

  const TARGETS = [
    ['pdf', 'PDF'],
    ['ocr', 'Searchable PDF (OCR)'],
    ['docx', 'Word (.docx)'],
    ['odt', 'OpenDocument text (.odt)'],
    ['rtf', 'Rich text (.rtf)'],
    ['epub', 'E-book (.epub)'],
    ['html', 'Web page (.html)'],
    ['md', 'Markdown (.md)'],
    ['txt', 'Plain text (.txt)'],
    ['json', 'JSON'],
    ['xlsx', 'Excel (.xlsx)'],
    ['xls', 'Excel 97 (.xls)'],
    ['ods', 'OpenDocument spreadsheet (.ods)'],
    ['csv', 'CSV'],
    ['tsv', 'TSV'],
    ['pptx', 'PowerPoint (.pptx)'],
    ['png', 'PNG'],
    ['jpg', 'JPG'],
    ['webp', 'WebP'],
    ['gif', 'GIF'],
    ['bmp', 'BMP'],
    ['tiff', 'TIFF'],
    ['ico', 'Icon (.ico)'],
    ['svg', 'SVG'],
  ];
  to.append(...TARGETS.map(([v, l]) => el('option', { value: v }, l)));

  /* --- screen --- */
  async function add(files) {
    if (running) return;
    for (const file of files) {
      // A zip is opened and each file in it converted on its own.
      if (ext(file.name) === 'zip')
        try {
          const z = await JSZip.loadAsync(file);
          for (const [p, e] of Object.entries(z.files))
            if (!e.dir && !/(^|\/)(__MACOSX|\.)/.test(p))
              items.push({ file: new File([await e.async('blob')], p.split('/').pop()), state: '', msg: '' });
          continue;
        } catch {}
      items.push({ file, state: '', msg: '' });
    }
    render();
  }
  function render() {
    desk.innerHTML = '';
    const list = el(
      'div',
      { class: 'cv-list' },
      ...items.map((it, i) => {
        const r = routeFor(it);
        const chain = r && [kind(it.file), ...r.map((e) => e.to)].map(label).join(' → ');
        return el(
          'div',
          { class: 'cv-row ' + (it.state || (r ? '' : 'skip')) },
          el('b', {}, it.file.name),
          el(
            'span',
            { class: 'sub' },
            it.msg || (r ? (r.length ? chain : 'Copied as is') : 'No way to convert this file'),
          ),
          running
            ? ''
            : el('button', {
                class: 'btn sq ghost',
                title: 'Remove',
                'aria-label': 'Remove ' + it.file.name,
                html: icon('x'),
                onclick: () => (items.splice(i, 1), render()),
              }),
        );
      }),
    );
    desk.append(
      el(
        'div',
        { class: 'cmp-pick' },
        el(
          'div',
          { class: 'cmp-intro' },
          el('b', {}, 'Convert anything to anything'),
          el('p', {}, 'Any file to any format. Nothing is uploaded.'),
        ),
        el(
          'div',
          {
            class: 'cmp-slot',
            tabindex: 0,
            role: 'button',
            onclick: pick,
            onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick()),
          },
          el('b', {}, items.length ? 'Add more files' : 'Choose files'),
          el('span', { class: 'sub' }, 'or drop them here'),
        ),
        items.length ? list : '',
      ),
    );
    const n = items.filter(routeFor).length;
    $('#cvGo').disabled = running || !n;
    $('#cvStatus').textContent = items.length
      ? `${items.length} file${items.length > 1 ? 's' : ''}, ${n} can be converted`
      : '';
  }
  async function pick() {
    add(await pickFiles('', true));
  }

  // Zips produced on the way (PDF pages as images) are unpacked, so the next step sees each file.
  async function unzip(files) {
    const out = [];
    for (const f of files)
      if (/\.zip$/i.test(f.name)) {
        const z = await JSZip.loadAsync(f);
        for (const [p, e] of Object.entries(z.files))
          if (!e.dir) out.push(new File([await e.async('blob')], p.split('/').pop()));
      } else out.push(f);
    return out;
  }
  function addOut(zip, f) {
    let n = f.name,
      k = 2;
    while (zip.file(n)) n = `${base(f.name)} (${k++}).${ext(f.name)}`;
    zip.file(n, f);
  }

  async function go() {
    if (running) return;
    const todo = items.filter(routeFor);
    const mods = new Set(todo.flatMap((it) => routeFor(it).flatMap((e) => e.mods || [])));
    const busyMods = [...mods].filter((m) => unsaved.has(m));
    if (
      busyMods.length &&
      !(await UI.confirm(
        'Replace open work?',
        `Converting goes through the editors, so it replaces what is open in ${busyMods.map((m) => $(`.tab[data-mod="${m}"]`).textContent).join(', ')}. Save that first if you want to keep it.`,
        'Convert',
      ))
    )
      return;
    items.forEach((it) => (it.state = it.msg = ''));
    running = true;
    const zip = new JSZip();
    const out = [];
    const prog = el('span', {}, 'Converting…');
    const bg = el('div', { class: 'busy' }, el('div', {}, el('span', { class: 'spin' }), prog));
    try {
      for (const [i, it] of todo.entries()) {
        prog.textContent = `Converting ${i + 1} of ${todo.length}: ${it.file.name}`;
        document.body.append(bg); // keep the progress on top of the editors' own busy overlays
        try {
          let files = [it.file];
          if (/^(pages|key)$/.test(ext(it.file.name))) files = [await Formats.iworkPreview(it.file)];
          for (const e of routeFor(it)) {
            files = await unzip(await e.run(files));
            if (!files.length) throw new Error('nothing was produced');
            document.body.append(bg);
          }
          // Only the requested format goes in the zip (an editor may save extra files on the way).
          const want = outExt(to.value);
          const res = files.filter((f) => ext(f.name) === want || (want === 'jpg' && ext(f.name) === 'jpeg'));
          if (!res.length) throw new Error('nothing was produced');
          res.forEach((r) => (addOut(zip, r), out.push(r)));
          it.state = 'done';
          it.msg = 'Done: ' + (res.length > 3 ? `${res.length} files` : res.map((r) => r.name).join(', '));
        } catch (e) {
          console.error(e);
          it.state = 'fail';
          it.msg = 'Failed: ' + (e.message || e);
        }
        render();
      }
    } finally {
      capture = null;
      running = false;
      bg.remove();
      show('convert');
      render();
    }
    const fails = todo.filter((it) => it.state === 'fail').length;
    if (out.length === 1) await saveFile(out[0].name, out[0]);
    else if (out.length) await saveFile('converted.zip', await zip.generateAsync({ type: 'blob' }));
    if (fails) UI.toast(`${fails} file${fails > 1 ? 's' : ''} could not be converted. See the list.`, true);
  }

  to.onchange = () => {
    if (!running) items.forEach((it) => (it.state = it.msg = ''));
    render();
  };
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'add') pick();
    if (b.dataset.a === 'go') go();
    if (b.dataset.a === 'clear' && !running) (items = []), render();
  });
  render();
  return { drop: add, plan, encode };
})();
