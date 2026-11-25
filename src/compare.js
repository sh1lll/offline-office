'use strict';
/* ============================== COMPARE ============================== */
Mods.compare = (() => {
  const desk = $('#cmpDesk'),
    bar = $('#cmpBar');
  const docs = { a: null, b: null }; // { name, paras }
  let view = 'side',
    result = null,
    cur = -1;
  const ACCEPT = '.docx,.docm,.dotx,.doc,.odt,.rtf,.epub,.html,.htm,.md,.markdown,.txt,.pdf,.pages';

  /* --- text extraction: every format becomes a list of paragraphs --- */
  function htmlToParas(html) {
    const out = [];
    const walk = (node) => {
      for (const n of node.children) {
        const t = n.tagName;
        // Cells joined with spaces, the way table rows read when text comes out of a PDF.
        if (t === 'TR') out.push([...n.children].map((c) => c.textContent.trim()).join(' '));
        else if (t === 'SCRIPT' || t === 'STYLE') continue;
        else if (
          /^(P|H[1-6]|LI|PRE|BLOCKQUOTE|DT|DD|CAPTION|FIGCAPTION)$/.test(t) &&
          !n.querySelector('p,li,h1,h2,h3,h4,h5,h6,table,ul,ol')
        )
          out.push(n.textContent);
        else if (n.children.length) walk(n);
        else out.push(n.textContent);
      }
    };
    // DOMParser documents are inert: no scripts run and nothing loads.
    walk(new DOMParser().parseFromString(html, 'text/html').body);
    return out;
  }
  let langs = null; // OCR languages, asked once
  async function pdfParas(buf) {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      let cur = '',
        lastY = null;
      for (const it of tc.items) {
        const y = it.transform[5],
          h = Math.abs(it.transform[3]) || 10;
        // A lone bullet or number at the start of a line begins a list item; drop it, since list
        // markers are not text in Word or HTML.
        if ((lastY === null || Math.abs(lastY - y) > h * 0.5) && /^([•●▪◦‣–*-]|\d{1,3}[.)])$/.test(it.str)) {
          if (cur.trim()) out.push(cur);
          cur = '';
          lastY = y;
          continue;
        }
        // A vertical jump of more than about one and a half lines starts a new paragraph.
        if (lastY !== null && Math.abs(lastY - y) > h * 1.6) {
          out.push(cur);
          cur = '';
        } else if (lastY !== null && Math.abs(lastY - y) > h * 0.5 && cur && !/\s$/.test(cur)) cur += ' ';
        cur += it.str;
        if (it.str.trim()) lastY = y;
      }
      out.push(cur);
    }
    // Scanned PDF: read the pages with OCR, one paragraph per blank-line-separated block.
    if (!out.join('').trim() && (langs ??= await Mods.addons.pickLangs()))
      for (let p = 1; p <= pdf.numPages; p++) {
        const pg = await pdf.getPage(p),
          vp = pg.getViewport({ scale: 2 });
        const c = el('canvas', { width: Math.floor(vp.width), height: Math.floor(vp.height) });
        await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        out.push(...(await Formats.ocr(c, langs)).text.split(/\n\s*\n/).map((x) => x.replace(/\n/g, ' ')));
      }
    return out;
  }
  async function extract(file) {
    const e = ext(file.name);
    if (e === 'pdf') return pdfParas(await file.arrayBuffer());
    if (e === 'pages') return extract(await Formats.iworkPreview(file));
    if (['docx', 'docm', 'dotx'].includes(e))
      return htmlToParas((await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })).value);
    if (e === 'doc') return htmlToParas(Formats.docToHtml(await file.arrayBuffer()));
    if (e === 'odt') return htmlToParas(await Formats.odtToHtml(await file.arrayBuffer()));
    if (e === 'rtf') return htmlToParas(Formats.rtfToHtml(await readAs(file, 'text')));
    if (e === 'epub') return htmlToParas(await Formats.epubToHtml(await file.arrayBuffer()));
    if (e === 'html' || e === 'htm') return htmlToParas(await readAs(file, 'text'));
    if (e === 'md' || e === 'markdown') return htmlToParas(marked.parse(await readAs(file, 'text')));
    if (e === 'txt' || TEXT_EXT.includes(e)) return (await readAs(file, 'text')).split(/\r?\n/);
    throw new Error(`.${e} files cannot be compared. Use Word, PDF, ODT, RTF, EPUB, HTML, Markdown or text.`);
  }

  /* --- loading --- */
  async function setDoc(slot, file) {
    const done = UI.busy('Reading ' + file.name + '…');
    try {
      // Leading bullets and list numbers are layout, and formats disagree on whether they are text.
      const paras = (await extract(file)).map((p) => p.replace(/^\s*([•●▪◦‣–*-]|\d{1,3}[.)])\s+/, ''));
      if (!paras.join('').trim()) throw new Error('no text found, even with OCR.');
      docs[slot] = { name: file.name, paras };
      run();
    } catch (err) {
      console.error(err);
      UI.toast(`Could not read ${file.name}: ${err.message}`, true);
    } finally {
      done();
    }
  }
  async function pick(slot) {
    const [f] = await pickFiles(ACCEPT);
    if (f) setDoc(slot, f);
  }
  // Two files fill both sides in order; one file fills the first empty side.
  async function drop(files) {
    if (files.length > 1) {
      await setDoc('a', files[0]);
      await setDoc('b', files[1]);
    } else await setDoc(!docs.a || docs.b ? 'a' : 'b', files[0]);
  }

  /* --- rendering --- */
  const partsHtml = (parts, side) =>
    parts
      .filter((p) => p.op === '=' || p.op === side)
      .map((p) =>
        p.op === '=' ? esc(p.t) : p.op === '-' ? `<del>${esc(p.t)}</del>` : `<ins>${esc(p.t)}</ins>`,
      )
      .join('');
  function run() {
    $('#cmpNameA').textContent = docs.a ? docs.a.name : 'No file';
    $('#cmpNameB').textContent = docs.b ? docs.b.name : 'No file';
    if (!docs.a || !docs.b) return renderPick();
    try {
      result = Diff.compare(docs.a.paras, docs.b.paras, { ignoreCase: $('#cmpCase').checked });
    } catch (err) {
      result = null;
      UI.toast('Could not compare: ' + err.message, true);
      return renderPick();
    }
    cur = -1;
    render();
  }
  function slotCard(slot, label) {
    const d = docs[slot];
    const card = el(
      'div',
      {
        class: 'cmp-slot' + (d ? ' filled' : ''),
        tabindex: '0',
        role: 'button',
        'aria-label': `Choose the ${label} file`,
      },
      el('span', { class: 'lbl' }, label),
      el('b', {}, d ? d.name : 'Choose a file'),
      el(
        'span',
        { class: 'sub' },
        d ? `${d.paras.filter((p) => p.trim()).length} paragraphs` : 'or drop it here',
      ),
    );
    card.onclick = () => pick(slot);
    card.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick(slot));
    card.ondragover = (e) => (e.preventDefault(), card.classList.add('over'));
    card.ondragleave = () => card.classList.remove('over');
    card.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('over');
      dragDepth = 0;
      $('#homeDrop').classList.remove('over');
      if (e.dataTransfer.files[0]) setDoc(slot, e.dataTransfer.files[0]);
    };
    return card;
  }
  function renderPick() {
    desk.innerHTML = '';
    desk.append(
      el(
        'div',
        { class: 'cmp-pick' },
        el(
          'div',
          { class: 'cmp-intro' },
          el('b', {}, 'Compare two versions'),
          el('p', {}, 'See exactly what changed between two versions.'),
        ),
        el('div', { class: 'cmp-slots' }, slotCard('a', 'Original'), slotCard('b', 'Revised')),
      ),
    );
    status();
  }
  function render() {
    const { rows, stats } = result;
    const only = $('#cmpOnly').checked;
    const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const chips = [
      [pl(stats.ins, 'word') + ' added', 'add'],
      [pl(stats.del, 'word') + ' removed', 'del'],
      [pl(stats.changed, 'paragraph') + ' edited', ''],
      [`${stats.added} added`, 'add'],
      [`${stats.removed} removed`, 'del'],
      [`${stats.moved} moved`, 'mov'],
    ];
    let html = `<div class="cmp-sum">${chips.map(([t, k]) => `<span class="cmp-chip ${k}">${t}</span>`).join('')}</div>`;
    if (!rows.some((r) => r.kind !== 'same'))
      html += '<p class="cmp-same">The two files have the same text.</p>';
    let n = 0;
    const tag = (r) =>
      r.kind === 'movedOut'
        ? '<span class="cmp-tag">moved from here</span>'
        : r.kind === 'movedIn' || r.moved
          ? '<span class="cmp-tag">moved here</span>'
          : '';
    if (view === 'side') {
      html += `<div class="cmp-grid"><div class="cmp-head">${esc(docs.a.name)}</div><div class="cmp-head">${esc(docs.b.name)}</div>`;
      for (const r of rows) {
        if (only && r.kind === 'same') continue;
        const id = r.kind === 'same' ? '' : ` data-chg="${n++}"`;
        const l = r.kind === 'changed' ? partsHtml(r.parts, '-') : r.l ? esc(r.l) : '';
        const rr = r.kind === 'changed' ? partsHtml(r.parts, '+') : r.r ? esc(r.r) : '';
        html += `<div class="cmp-cell l ${r.kind}"${id}>${l}${r.kind === 'movedOut' ? tag(r) : ''}</div><div class="cmp-cell r ${r.kind}">${rr}${r.kind !== 'movedOut' ? tag(r) : ''}</div>`;
      }
      html += '</div>';
    } else html += `<div class="cmp-red">${redline(only, () => n++)}</div>`;
    desk.innerHTML = html;
    status();
  }
  // One column: removals struck through, additions underlined. Also used for the exported report.
  function redline(only, next = () => 0) {
    return result.rows
      .filter((r) => !(only && r.kind === 'same'))
      .map((r) => {
        const id = r.kind === 'same' ? '' : ` data-chg="${next()}"`;
        const body =
          r.kind === 'changed'
            ? r.parts
                .map((p) =>
                  p.op === '='
                    ? esc(p.t)
                    : p.op === '-'
                      ? `<del>${esc(p.t)}</del>`
                      : `<ins>${esc(p.t)}</ins>`,
                )
                .join('')
            : r.kind === 'removed' || r.kind === 'movedOut'
              ? `<del>${esc(r.l)}</del>`
              : r.kind === 'added' || r.kind === 'movedIn'
                ? `<ins>${esc(r.r)}</ins>`
                : esc(r.r);
        const note =
          r.kind === 'movedOut'
            ? ' <i>(moved)</i>'
            : r.kind === 'movedIn' || r.moved
              ? ' <i>(moved here)</i>'
              : '';
        return `<p class="${r.kind}"${id}>${body}${note}</p>`;
      })
      .join('');
  }
  function status() {
    const total = desk.querySelectorAll('[data-chg]').length;
    $('#cmpStatus').innerHTML =
      result && docs.a && docs.b
        ? `<span><b>${esc(docs.a.name)}</b> → <b>${esc(docs.b.name)}</b></span><span>${total ? `Change ${cur + 1 || '–'} of ${total}` : 'No changes'}</span><span>Use the arrows or press N and P to jump between changes</span>`
        : '<span>Choose an original and a revised file</span>';
  }
  function go(d) {
    const all = [...desk.querySelectorAll('[data-chg]')];
    if (!all.length) return;
    cur = (cur + d + all.length) % all.length;
    desk.querySelectorAll('.cmp-cur').forEach((x) => x.classList.remove('cmp-cur'));
    const t = all[cur];
    t.classList.add('cmp-cur');
    t.nextElementSibling?.classList.toggle('cmp-cur', view === 'side');
    t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    status();
  }

  /* --- export --- */
  function reportHtml() {
    const s = result.stats;
    return `<h1>Comparison</h1><p><b>Original:</b> ${esc(docs.a.name)}<br><b>Revised:</b> ${esc(docs.b.name)}<br>${s.ins} words added, ${s.del} words removed, ${s.changed} paragraphs edited, ${s.added} added, ${s.removed} removed, ${s.moved} moved.</p><hr>${redline(false)}`;
  }
  const STYLE_INLINE = (h) =>
    h
      .replace(/<del>/g, '<del style="color:#b42318;text-decoration:line-through">')
      .replace(/<ins>/g, '<ins style="color:#1a7f37;text-decoration:underline">');
  async function act(a) {
    if (a === 'pickA') return pick('a');
    if (a === 'pickB') return pick('b');
    if (a === 'swap') {
      [docs.a, docs.b] = [docs.b, docs.a];
      return run();
    }
    if (a === 'prev') return go(-1);
    if (a === 'next') return go(1);
    if (a === 'example') return example();
    if (!result) return UI.toast('Choose two files to compare first.', true);
    if (a === 'toDoc')
      return Mods.doc.fromHtml(
        STYLE_INLINE(reportHtml()),
        `Comparison ${base(docs.a.name)} vs ${base(docs.b.name)}`,
      );
    if (a === 'html')
      return saveFile(
        `Comparison ${base(docs.a.name)} vs ${base(docs.b.name)}.html`,
        `<!doctype html><html><head><meta charset="utf-8"><title>Comparison</title><style>body{font-family:Georgia,serif;max-width:48rem;margin:2rem auto;padding:0 1rem;line-height:1.6}</style></head><body>${STYLE_INLINE(reportHtml())}</body></html>`,
        'text/html',
      );
  }
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (b) act(b.dataset.a);
  });
  $('#cmpView').onclick = (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    view = b.dataset.v;
    $$('#cmpView button').forEach((x) => x.classList.toggle('on', x === b));
    if (result && docs.a && docs.b) render();
  };
  $('#cmpOnly').onchange = () => result && docs.a && docs.b && render();
  $('#cmpCase').onchange = () => run();
  document.addEventListener('keydown', (e) => {
    if (curMod !== 'compare' || e.ctrlKey || e.metaKey || e.target.closest('input,textarea,select')) return;
    if (e.key === 'n' || e.key === 'j') go(1);
    if (e.key === 'p' || e.key === 'k') go(-1);
  });

  async function example() {
    if (!(await replaceOk(!!(docs.a || docs.b)))) return;
    const v1 = [
      'Harbor Street Community Garden: Season Plan',
      'This plan sets out how the garden will run from March to October. It covers plot assignments, the shared tool shed and the watering rota.',
      'Assign all 42 raised beds by 15 March.',
      'Cut mains-water use by 20% with two new rain barrels.',
      'The tool shed is open on weekends from 9:00 to 17:00.',
      'Volunteers water the beds every morning and every evening during July and August.',
      'Budget: the committee approved $1,850 for the season.',
    ];
    const v2 = [
      'Harbor Street Community Garden: Season Plan 2026',
      'This plan sets out how the garden will run from March to October. It covers plot assignments, the shared tool shed, the watering rota and the autumn harvest market.',
      'Assign all 48 raised beds by 1 April.',
      'Volunteers water the beds every morning and every evening during July and August.',
      'Cut mains-water use by 20% with two new rain barrels.',
      'Budget: the committee approved $2,100 for the season, including the market stall.',
      'Host a harvest market on the first Saturday of October.',
    ];
    docs.a = { name: 'season-plan-v1.docx (example)', paras: v1 };
    docs.b = { name: 'season-plan-v2.docx (example)', paras: v2 };
    run();
  }

  return {
    drop,
    open: () => pick(docs.a ? 'b' : 'a'),
    save: () => act('html'),
    onShow: () => (result && docs.a && docs.b ? status() : renderPick()),
  };
})();
