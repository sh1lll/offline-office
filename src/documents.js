'use strict';
/* ============================== DOCUMENTS ============================== */
Mods.doc = (() => {
  const page = $('#docPage'),
    bar = $('#docBar'),
    desk = $('#docDesk');
  let name = 'Untitled document';
  let setup = { size: 'letter', orient: 'portrait', margin: 1 };
  const SIZES = { letter: [8.5, 11], a4: [8.27, 11.69], legal: [8.5, 14] };
  let saved = null; // last selection range inside the page

  const SAMPLE = `<h1>Harbor Street Community Garden — Season Plan</h1>
<p><i>Example document. Replace it with your own text, or open a .docx from the File menu.</i></p>
<h2>1. Goals for the season</h2>
<p>This plan sets out how the <b>Harbor Street Community Garden</b> will run from March to October. It covers plot assignments, the shared tool shed, the watering rota and the autumn harvest market.</p>
<ul><li>Assign all <b>42 raised beds</b> by 15 March</li><li>Cut mains-water use by 20% with two new rain barrels</li><li>Host four open days for neighbours and the local primary school</li></ul>
<h2>2. Watering rota</h2>
<table><tbody><tr><th>Week</th><th>Morning</th><th>Evening</th><th>Notes</th></tr><tr><td>1–4</td><td>R. Okafor</td><td>L. Brandt</td><td>Seedlings, water lightly</td></tr><tr><td>5–8</td><td>M. Haddad</td><td>J. Silva</td><td>Check barrel levels on Fridays</td></tr><tr><td>9–12</td><td>A. Novak</td><td>T. Chen</td><td>Peak season, double rounds</td></tr></tbody></table>
<h2>3. Budget</h2>
<p>The committee approved a budget of <span style="color:#1e7b47"><b>$1,850</b></span> for the season. The largest items are compost ($620), the rain barrels ($340) and replacement hand tools ($280).</p>
<blockquote>“A garden is a grand teacher. It teaches patience and careful watchfulness.” — Gertrude Jekyll</blockquote>
<h3>Next steps</h3>
<ol><li>Circulate this plan to plot holders</li><li>Confirm open-day dates with the school</li><li>Order compost before the end of February</li></ol>`;

  function restore() {
    if (saved) {
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(saved);
    }
  }
  document.addEventListener('selectionchange', () => {
    const s = getSelection();
    if (s.rangeCount && page.contains(s.anchorNode)) {
      saved = s.getRangeAt(0).cloneRange();
      syncBar();
    }
  });
  function exec(c, v = null) {
    page.focus();
    restore();
    document.execCommand(c, false, v);
    changed();
  }

  function syncBar() {
    $$('[data-c]', bar).forEach((b) => {
      try {
        if (
          [
            'bold',
            'italic',
            'underline',
            'strikeThrough',
            'superscript',
            'subscript',
            'insertUnorderedList',
            'insertOrderedList',
            'justifyLeft',
            'justifyCenter',
            'justifyRight',
            'justifyFull',
          ].includes(b.dataset.c)
        )
          b.setAttribute('aria-pressed', document.queryCommandState(b.dataset.c));
      } catch {}
    });
    try {
      const v = (document.queryCommandValue('formatBlock') || 'p').toLowerCase().replace(/[<>]/g, '');
      $('#docBlock').value = ['h1', 'h2', 'h3', 'h4', 'blockquote', 'pre'].includes(v) ? v : 'p';
    } catch {}
  }
  function stats() {
    const t = page.innerText || '';
    const words = (t.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
    const paras = $$('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre', page).filter((x) =>
      x.textContent.trim(),
    ).length;
    $('#docStatus').innerHTML =
      `<span><b>${esc(name)}</b></span><span>${words.toLocaleString()} words</span><span>${t.replace(/\s/g, '').length.toLocaleString()} characters</span><span>${paras} paragraphs</span><span>~${Math.max(1, Math.round(words / 230))} min read</span><span>${setup.size.toUpperCase()} · ${setup.orient}</span>`;
  }
  const autosave = debounce(() => {
    keepDraft('doc', 'doc2', page.innerHTML.length < 3e6 ? { name, html: page.innerHTML, setup } : null);
  }, 800);
  function changed() {
    stats();
    autosave();
  }
  page.addEventListener('input', changed);

  function applySetup() {
    let [w, h] = SIZES[setup.size];
    if (setup.orient === 'landscape') [w, h] = [h, w];
    page.style.setProperty('--pw', Math.round(w * 96) + 'px');
    page.style.setProperty('--ph', Math.round(h * 96) + 'px');
    page.style.setProperty('--pm', Math.round(setup.margin * 96) + 'px');
    stats();
  }
  function setHtml(html) {
    page.innerHTML =
      DOMPurify.sanitize(html, {
        FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input'],
        ADD_ATTR: ['contenteditable'],
      }) || '<p><br></p>';
    $$('.page-break', page).forEach((p) => p.setAttribute('contenteditable', 'false'));
    changed();
  }

  /* --- toolbar --- */
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c],[data-a]');
    if (!b) return;
    if (b.dataset.c) {
      if (b.dataset.c === 'removeFormat') {
        exec('removeFormat');
        exec('formatBlock', 'p');
      } else exec(b.dataset.c);
    } else action(b.dataset.a);
  });
  $('#docBlock').onchange = (e) => exec('formatBlock', e.target.value);
  $('#docFont').onchange = (e) => {
    document.execCommand('styleWithCSS', false, true);
    exec('fontName', e.target.value);
  };
  $('#docSize').onchange = (e) => setFontSize(e.target.value);
  $('#docColor').oninput = (e) => {
    document.execCommand('styleWithCSS', false, true);
    exec('foreColor', e.target.value);
  };
  $('#docHilite').oninput = (e) => {
    document.execCommand('styleWithCSS', false, true);
    restore();
    if (!document.execCommand('hiliteColor', false, e.target.value)) exec('backColor', e.target.value);
    changed();
  };
  $('#docZoom').onchange = (e) => {
    page.style.zoom = e.target.value;
  };
  $('#docSymbols').append(
    ...'© ® ™ § ¶ † • – — … ° ± × ÷ ≈ ≠ ≤ ≥ € £ ¥ ¢ → ← ↑ ↓ ✓ ✗ ★ ½ ¼ ¾ µ π Ω'
      .split(' ')
      .map((s) =>
        el('button', { class: 'btn sq ghost', type: 'button', onclick: () => exec('insertText', s) }, s),
      ),
  );

  function setFontSize(px) {
    page.focus();
    restore();
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontSize', false, '7');
    $$('font[size="7"]', page).forEach((f) => {
      const s = el('span', { style: { fontSize: px + 'px' } });
      s.innerHTML = f.innerHTML;
      f.replaceWith(s);
    });
    $$('span', page).forEach((s) => {
      if (s.style.fontSize === 'xxx-large' || s.style.fontSize === '-webkit-xxx-large')
        s.style.fontSize = px + 'px';
    });
    changed();
  }
  function cellAt() {
    const n = saved?.startContainer;
    const c = n && (n.nodeType === 1 ? n : n.parentElement)?.closest('td,th');
    return c && page.contains(c) ? c : null;
  }
  function tableOp(op) {
    const cell = cellAt();
    if (!cell) return UI.toast('Place the cursor inside a table first.', true);
    const tr = cell.parentElement,
      table = cell.closest('table'),
      idx = [...tr.children].indexOf(cell);
    const rows = $$('tr', table);
    if (op === 'rowAbove' || op === 'rowBelow') {
      const n = tr.cloneNode(true);
      $$('td,th', n).forEach((c) => {
        const td = el('td');
        td.innerHTML = '<br>';
        c.replaceWith(td);
      });
      op === 'rowAbove' ? tr.before(n) : tr.after(n);
    }
    if (op === 'colLeft' || op === 'colRight')
      rows.forEach((r) => {
        const ref = r.children[idx];
        if (!ref) return;
        const c = el(ref.tagName.toLowerCase());
        c.innerHTML = '<br>';
        op === 'colLeft' ? ref.before(c) : ref.after(c);
      });
    if (op === 'delRow') {
      tr.remove();
      if (!$('tr', table)) table.remove();
    }
    if (op === 'delCol') {
      rows.forEach((r) => r.children[idx]?.remove());
      if (!$('td,th', table)) table.remove();
    }
    if (op === 'delTable') table.remove();
    changed();
  }
  async function action(a) {
    switch (a) {
      case 'new':
        if (
          await UI.confirm(
            'Start a new document?',
            'The current document will be replaced. Export it first if you want to keep it.',
            'New document',
          )
        ) {
          name = 'Untitled document';
          setHtml('<p><br></p>');
        }
        break;
      case 'open':
        return open();
      case 'docx':
        return exportDocx();
      case 'pdf':
        return exportPdf();
      case 'html':
        return savedWhole('doc', await saveFile(name + '.html', fullHtml(), 'text/html'));
      case 'md':
        return saveFile(name + '.md', htmlToMd(page), 'text/markdown');
      case 'txt':
        return saveFile(name + '.txt', page.innerText, 'text/plain');
      case 'odt': {
        const d = UI.busy('Building OpenDocument…');
        try {
          return savedWhole('doc', await saveFile(name + '.odt', await Formats.htmlToOdt(page, name)));
        } catch (e) {
          UI.toast('ODT export failed: ' + e.message, true);
        } finally {
          d();
        }
        return;
      }
      case 'rtf':
        return savedWhole('doc', await saveFile(name + '.rtf', Formats.htmlToRtf(page), 'application/rtf'));
      case 'page': {
        const r = await UI.modal({
          title: 'Page setup',
          fields: [
            {
              id: 'size',
              label: 'Paper size',
              type: 'select',
              value: setup.size,
              options: [
                ['letter', 'US Letter (8.5 × 11 in)'],
                ['a4', 'A4 (210 × 297 mm)'],
                ['legal', 'US Legal (8.5 × 14 in)'],
              ],
            },
            {
              id: 'orient',
              label: 'Orientation',
              type: 'select',
              value: setup.orient,
              options: [
                ['portrait', 'Portrait'],
                ['landscape', 'Landscape'],
              ],
            },
            {
              id: 'margin',
              label: 'Margins',
              type: 'select',
              value: setup.margin,
              options: [
                [0.5, 'Narrow (0.5 in)'],
                [1, 'Normal (1 in)'],
                [1.25, 'Moderate (1.25 in)'],
                [1.5, 'Wide (1.5 in)'],
              ],
            },
          ],
        });
        if (r) {
          setup = { ...r, margin: parseFloat(r.margin) };
          applySetup();
          autosave();
        }
        break;
      }
      case 'link': {
        const sel = saved ? saved.toString() : '';
        const r = await UI.modal({
          title: 'Insert link',
          fields: [
            { id: 'url', label: 'Address', value: 'https://', placeholder: 'https://example.com' },
            ...(sel ? [] : [{ id: 'text', label: 'Text to show' }]),
          ],
        });
        if (r && r.url && /^(https?:|mailto:|#)/i.test(r.url)) {
          if (!sel) exec('insertHTML', `<a href="${esc(r.url)}">${esc(r.text || r.url)}</a>`);
          else exec('createLink', r.url);
        } else if (r) UI.toast('Links must start with https://, http://, mailto: or #', true);
        break;
      }
      case 'image': {
        const [f] = await pickFiles('image/*');
        if (f) exec('insertImage', await downscale(f, 1600));
        break;
      }
      case 'table': {
        const r = await UI.modal({
          title: 'Insert table',
          fields: [
            { id: 'rows', label: 'Rows', type: 'number', value: 3, min: 1, max: 100 },
            { id: 'cols', label: 'Columns', type: 'number', value: 3, min: 1, max: 20 },
            { id: 'head', label: 'First row is a header', type: 'checkbox', value: true },
          ],
        });
        if (r) {
          let h = '<table><tbody>';
          for (let i = 0; i < r.rows; i++) {
            h += '<tr>';
            for (let j = 0; j < r.cols; j++)
              h += i === 0 && r.head ? `<th>Header ${j + 1}</th>` : '<td><br></td>';
            h += '</tr>';
          }
          exec('insertHTML', h + '</tbody></table><p><br></p>');
        }
        break;
      }
      case 'hr':
        exec('insertHorizontalRule');
        break;
      case 'pagebreak':
        exec('insertHTML', '<div class="page-break" contenteditable="false"></div><p><br></p>');
        break;
      case 'date':
        exec(
          'insertText',
          new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
        );
        break;
      case 'toc': {
        const hs = $$('h1,h2,h3', page).filter((h) => !h.closest('nav.toc') && h.textContent.trim());
        if (!hs.length) return UI.toast('Add some headings first (Heading 1–3).', true);
        hs.forEach((h, i) => (h.id = h.id || 'sec-' + (i + 1)));
        const items = hs
          .map(
            (h) =>
              `<li style="margin-left:${(+h.tagName[1] - 1) * 18}px;list-style:none"><a href="#${h.id}">${esc(h.textContent.trim())}</a></li>`,
          )
          .join('');
        const html = `<nav class="toc"><b>Contents</b><ol style="padding-left:0">${items}</ol></nav>`;
        const old = $('nav.toc', page);
        if (old) {
          old.outerHTML = html;
          changed();
        } else exec('insertHTML', html + '<p><br></p>');
        break;
      }
      case 'rowAbove':
      case 'rowBelow':
      case 'colLeft':
      case 'colRight':
      case 'delRow':
      case 'delCol':
      case 'delTable':
        tableOp(a);
        break;
      case 'find':
        $('#docFind').hidden = false;
        $('#dfFind').value = saved && !saved.collapsed ? saved.toString() : $('#dfFind').value;
        $('#dfFind').focus();
        break;
      case 'closeFind':
        $('#docFind').hidden = true;
        break;
      case 'example':
        if (await replaceOk(page.innerText.trim().length > 0)) {
          name = 'Garden season plan (example)';
          setHtml(SAMPLE);
        }
        break;
      case 'findNext':
        findNext();
        break;
      case 'replaceOne':
        replaceOne();
        break;
      case 'replaceAll':
        replaceAll();
        break;
    }
  }
  $('#docFind').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (b) action(b.dataset.a);
  });
  $('#dfFind').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findNext();
    }
  });

  async function downscale(file, max) {
    const url = await readAs(file, 'url');
    if (file.type === 'image/svg+xml' || file.type === 'image/gif') return url;
    const img = await loadImg(url);
    if (img.width <= max && img.height <= max) return url;
    const k = max / Math.max(img.width, img.height);
    const c = el('canvas', { width: Math.round(img.width * k), height: Math.round(img.height * k) });
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
  }
  // images: click to select, double-click for size
  page.addEventListener('click', (e) => {
    $$('img.sel', page).forEach((i) => i.classList.remove('sel'));
    if (e.target.tagName === 'IMG') e.target.classList.add('sel');
  });
  page.addEventListener('dblclick', async (e) => {
    if (e.target.tagName !== 'IMG') return;
    const img = e.target;
    const r = await UI.modal({
      title: 'Image',
      fields: [
        {
          id: 'w',
          label: 'Width (% of text width)',
          type: 'number',
          value:
            Math.round(
              (img.offsetWidth / (page.clientWidth - 2 * parseFloat(getComputedStyle(page).paddingLeft))) *
                100,
            ) || 100,
          min: 5,
          max: 100,
        },
        {
          id: 'align',
          label: 'Alignment',
          type: 'select',
          value: 'inline',
          options: [
            ['inline', 'In line with text'],
            ['center', 'Centered'],
            ['left', 'Float left'],
            ['right', 'Float right'],
          ],
        },
        { id: 'alt', label: 'Alt text', value: img.alt },
      ],
      extra: [{ label: 'Delete image', value: 'del' }],
    });
    if (!r) return;
    if (r._extra === 'del') {
      img.remove();
      return changed();
    }
    img.style.width = clamp(r.w, 5, 100) + '%';
    img.style.height = 'auto';
    img.alt = r.alt;
    img.style.float = '';
    img.style.display = '';
    img.style.margin = '';
    if (r.align === 'center') Object.assign(img.style, { display: 'block', margin: '8px auto' });
    if (r.align === 'left' || r.align === 'right')
      Object.assign(img.style, {
        float: r.align,
        margin: r.align === 'left' ? '4px 14px 8px 0' : '4px 0 8px 14px',
      });
    changed();
  });
  page.addEventListener('keydown', (e) => {
    const s = $('img.sel', page);
    if (s && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      s.remove();
      changed();
      return;
    }
    const m = e.ctrlKey || e.metaKey;
    if (m && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      action('link');
    }
    if (m && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      action('find');
    }
    if (e.key === 'Tab' && cellAt()) {
      // move between table cells
      e.preventDefault();
      const cells = $$('td,th', cellAt().closest('table'));
      const i = cells.indexOf(cellAt());
      const nx = cells[i + (e.shiftKey ? -1 : 1)];
      if (nx) {
        const r = document.createRange();
        r.selectNodeContents(nx);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }
    }
  });
  page.addEventListener('paste', (e) => {
    // keep pasted HTML clean
    const html = e.clipboardData?.getData('text/html');
    if (!html) return;
    e.preventDefault();
    document.execCommand(
      'insertHTML',
      false,
      DOMPurify.sanitize(html, {
        FORBID_TAGS: ['style', 'script', 'meta', 'link', 'iframe', 'form'],
        FORBID_ATTR: ['class', 'id'],
      }),
    );
  });

  /* --- find & replace --- */
  function findRe() {
    const q = $('#dfFind').value;
    if (!q) return null;
    let src = $('#dfRegex').checked ? q : escRe(q);
    if ($('#dfWhole').checked) src = '\\b(?:' + src + ')\\b';
    try {
      return new RegExp(src, $('#dfCase').checked ? 'g' : 'gi');
    } catch {
      $('#dfInfo').textContent = 'Invalid regular expression';
      return null;
    }
  }
  function textNodes() {
    const w = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    const a = [];
    while (w.nextNode()) a.push(w.currentNode);
    return a;
  }
  function count(re) {
    let n = 0;
    textNodes().forEach((t) => (n += (t.nodeValue.match(re) || []).length));
    return n;
  }
  function findNext() {
    const re = findRe();
    if (!re) return;
    const nodes = textNodes();
    const total = count(re);
    $('#dfInfo').textContent = total ? `${total} match${total > 1 ? 'es' : ''}` : 'No matches';
    if (!total) return;
    let startNode = saved?.endContainer,
      startOff = saved?.endOffset || 0;
    let si = nodes.indexOf(startNode);
    if (si < 0) {
      si = 0;
      startOff = 0;
    }
    for (let pass = 0; pass < 2; pass++)
      for (let i = pass ? 0 : si; i < nodes.length; i++) {
        re.lastIndex = !pass && i === si ? startOff : 0;
        const m = re.exec(nodes[i].nodeValue);
        if (m && m[0].length) {
          const r = document.createRange();
          r.setStart(nodes[i], m.index);
          r.setEnd(nodes[i], m.index + m[0].length);
          const s = getSelection();
          s.removeAllRanges();
          s.addRange(r);
          saved = r.cloneRange();
          nodes[i].parentElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return;
        }
      }
  }
  function replaceOne() {
    const re = findRe();
    if (!re) return;
    const s = saved ? saved.toString() : '';
    re.lastIndex = 0;
    const m = re.exec(s);
    if (s && m && m[0] === s) {
      page.focus();
      restore();
      document.execCommand(
        'insertText',
        false,
        s.replace(new RegExp(re.source, re.flags.replace('g', '')), $('#dfRep').value),
      );
      changed();
    }
    findNext();
  }
  function replaceAll() {
    const re = findRe();
    if (!re) return;
    let n = 0;
    const rep = $('#dfRep').value;
    textNodes().forEach((t) => {
      const v = t.nodeValue;
      const c = (v.match(re) || []).length;
      if (c) {
        n += c;
        t.nodeValue = v.replace(re, rep);
      }
    });
    $('#dfInfo').textContent = `Replaced ${n} occurrence${n === 1 ? '' : 's'}`;
    changed();
  }

  /* --- load / export --- */
  async function open() {
    const [f] = await pickFiles('.docx,.docm,.dotx,.doc,.odt,.ott,.rtf,.epub,.html,.htm,.txt,.md,.pages');
    if (f) openFile(f);
  }
  async function load(file) {
    const e = ext(file.name);
    name = base(file.name);
    if (e === 'docx') {
      const res = await mammoth.convertToHtml(
        { arrayBuffer: await file.arrayBuffer() },
        { styleMap: ['u => u', 'strike => s'] },
      );
      setHtml(res.value);
      const warn = res.messages.filter((m) => m.type === 'warning').length;
      UI.toast(
        warn
          ? `Opened ${file.name}. ${warn} unsupported style${warn > 1 ? 's were' : ' was'} simplified.`
          : `Opened ${file.name}`,
      );
    } else if (e === 'doc' || e === 'dot') {
      setHtml(Formats.docToHtml(await file.arrayBuffer()));
      UI.toast(
        'Opened ' + file.name + '. Text, paragraphs and tables were kept; old Word formatting is simplified.',
      );
    } else if (e === 'odt' || e === 'ott') setHtml(await Formats.odtToHtml(await file.arrayBuffer()));
    else if (e === 'rtf') setHtml(Formats.rtfToHtml(await readAs(file, 'text')));
    else if (e === 'epub') setHtml(await Formats.epubToHtml(await file.arrayBuffer()));
    else if (e === 'docm' || e === 'dotx') {
      const res = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      setHtml(res.value);
    } else if (e === 'html' || e === 'htm' || e === 'xhtml' || e === 'mht') {
      const t = await readAs(file, 'text');
      const m = t.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      setHtml(m ? m[1] : t);
    } else if (e === 'md' || e === 'markdown') setHtml(marked.parse(await readAs(file, 'text')));
    else {
      const t = await readAs(file, 'text');
      setHtml(
        t
          .split(/\n{2,}/)
          .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
          .join(''),
      );
    }
  }
  function fromHtml(html, nm) {
    name = nm || 'Untitled document';
    setHtml(html);
    show('doc');
  }
  const DOC_CSS = `body{font-family:Georgia,serif;font-size:12pt;line-height:1.55;max-width:7in;margin:1in auto;color:#1a1f25}h1,h2,h3,h4{font-family:Arial,sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:5px 7px}th{background:#eef1f4}blockquote{border-left:3px solid #999;margin:.8em 0;padding-left:14px;color:#555}img{max-width:100%}.page-break{page-break-after:always;break-after:page}`;
  function fullHtml() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)}</title><style>${DOC_CSS}</style></head><body>${page.innerHTML}</body></html>`;
  }

  async function exportPdf() {
    const done = UI.busy('Building PDF…');
    try {
      let [w, h] = SIZES[setup.size];
      if (setup.orient === 'landscape') [w, h] = [h, w];
      const clone = el('div', { class: 'doc-page exporting' });
      clone.innerHTML = page.innerHTML;
      Object.assign(clone.style, {
        width: (w - 2 * setup.margin) * 96 + 'px',
        padding: '0',
        minHeight: '0',
        boxShadow: 'none',
        zoom: '1',
      });
      const holder = el('div', { style: { position: 'fixed', left: '-20000px', top: '0' } }, clone);
      document.body.append(holder);
      $$('.page-break', clone).forEach((p) => {
        p.style.border = '0';
        p.style.margin = '0';
        p.className = 'pb';
      });
      const { bytes, replaced } = await Formats.domToPdf(clone, {
        pageW: w * 72,
        pageH: h * 72,
        margin: setup.margin * 72,
        title: name,
      }).finally(() => holder.remove());
      warnReplaced(replaced);
      savedWhole('doc', await saveFile(name + '.pdf', new Blob([bytes], { type: 'application/pdf' })));
    } catch (e) {
      console.error(e);
      UI.toast('PDF export failed: ' + e.message, true);
    } finally {
      done();
    }
  }

  /* --- HTML → native .docx (docx library) --- */
  const BLOCK =
    /^(P|DIV|H[1-6]|UL|OL|LI|TABLE|BLOCKQUOTE|PRE|HR|NAV|SECTION|ARTICLE|HEADER|FOOTER|FIGURE|FIGCAPTION|ADDRESS|DL|DT|DD|MAIN|ASIDE)$/;
  const KW = {
    'xx-small': 9,
    'x-small': 10,
    small: 13,
    medium: 16,
    large: 18,
    'x-large': 24,
    'xx-large': 32,
    'xxx-large': 48,
  };
  const FONT_SIZE = { 1: 10, 2: 13, 3: 16, 4: 18, 5: 24, 6: 32, 7: 48 };
  function pxToHalfPt(v) {
    if (!v) return;
    if (KW[v]) return Math.round(KW[v] * 1.5);
    const n = parseFloat(v);
    if (!n) return;
    return Math.round(v.endsWith('pt') ? n * 2 : v.endsWith('em') || v.endsWith('rem') ? n * 24 : n * 1.5);
  }
  async function exportDocx() {
    if (!window.docx)
      return UI.toast('The Word export library did not load. Check your connection and reload.', true);
    const done = UI.busy('Building Word document…');
    try {
      const D = window.docx;
      const {
        Document,
        Packer,
        Paragraph,
        TextRun,
        HeadingLevel,
        AlignmentType,
        Table,
        TableRow,
        TableCell,
        WidthType,
        ImageRun,
        ExternalHyperlink,
        PageBreak,
        BorderStyle,
        LevelFormat,
        ShadingType,
        PageOrientation,
      } = D;
      const [pw, ph] = SIZES[setup.size];
      const marginTw = Math.round(setup.margin * 1440);
      const pageW = Math.round(pw * 1440),
        pageH = Math.round(ph * 1440);
      const contentTw = (setup.orient === 'landscape' ? pageH : pageW) - 2 * marginTw;
      const contentPx = contentTw / 15;
      let olInst = 0;
      const ALIGN = {
        center: AlignmentType.CENTER,
        right: AlignmentType.RIGHT,
        justify: AlignmentType.JUSTIFIED,
        left: AlignmentType.LEFT,
        start: AlignmentType.LEFT,
        end: AlignmentType.RIGHT,
      };
      const alignOf = (n) => ALIGN[(n.style && n.style.textAlign) || n.getAttribute('align') || ''];
      const fontOf = (f) => f && f.split(',')[0].replace(/["']/g, '').trim();
      function imgRun(n) {
        const src = n.getAttribute('src') || '';
        if (!src.startsWith('data:image/') || src.startsWith('data:image/svg')) return [];
        const nw = n.naturalWidth || 300,
          nh = n.naturalHeight || 200;
        const w = Math.min(n.offsetWidth || nw, contentPx);
        const hh = (w * nh) / nw;
        try {
          return [
            new ImageRun({
              data: dataURLtoBytes(src),
              transformation: { width: Math.round(w), height: Math.round(hh) },
            }),
          ];
        } catch {
          return [];
        }
      }
      function runs(n, f) {
        if (n.nodeType === 3) {
          const t = n.nodeValue.replace(/[\r\n\t ]+/g, ' ');
          return t ? [new TextRun({ text: t, ...f })] : [];
        }
        if (n.nodeType !== 1) return [];
        const t = n.tagName;
        if (t === 'BR') return [new TextRun({ text: '', break: 1 })];
        if (t === 'IMG') return imgRun(n);
        if (t === 'SCRIPT' || t === 'STYLE') return [];
        const g = { ...f };
        if (t === 'B' || t === 'STRONG' || t === 'TH') g.bold = true;
        if (t === 'I' || t === 'EM') g.italics = true;
        if (t === 'U' || t === 'INS') g.underline = {};
        if (t === 'S' || t === 'STRIKE' || t === 'DEL') g.strike = true;
        if (t === 'SUP') g.superScript = true;
        if (t === 'SUB') g.subScript = true;
        if (t === 'CODE' || t === 'KBD' || t === 'SAMP') g.font = 'Courier New';
        if (t === 'MARK') g.highlight = 'yellow';
        if (t === 'FONT') {
          const c = toHex(n.getAttribute('color'));
          if (c) g.color = c;
          if (n.getAttribute('face')) g.font = fontOf(n.getAttribute('face'));
          if (n.getAttribute('size')) g.size = Math.round((FONT_SIZE[n.getAttribute('size')] || 16) * 1.5);
        }
        const st = n.style;
        if (st) {
          if (st.fontWeight === 'bold' || parseInt(st.fontWeight) >= 600) g.bold = true;
          else if (st.fontWeight === 'normal' || parseInt(st.fontWeight) < 600) g.bold = false;
          if (st.fontStyle === 'italic') g.italics = true;
          const td = st.textDecorationLine || st.textDecoration || '';
          if (td.includes('underline')) g.underline = {};
          if (td.includes('line-through')) g.strike = true;
          const c = toHex(st.color);
          if (c) g.color = c;
          const bgc = toHex(st.backgroundColor);
          if (bgc) g.shading = { type: ShadingType.CLEAR, color: 'auto', fill: bgc };
          const sz = pxToHalfPt(st.fontSize);
          if (sz) g.size = sz;
          if (st.fontFamily) g.font = fontOf(st.fontFamily);
          if (st.verticalAlign === 'super') g.superScript = true;
          if (st.verticalAlign === 'sub') g.subScript = true;
        }
        const kids = [...n.childNodes].flatMap((c) => runs(c, g));
        const href = t === 'A' && n.getAttribute('href');
        if (href && /^(https?:|mailto:)/i.test(href))
          return [
            new ExternalHyperlink({
              link: href,
              children: [...n.childNodes].flatMap((c) => runs(c, { ...g, color: '1F56B8', underline: {} })),
            }),
          ];
        return kids;
      }
      const runsOfNodes = (nodes, f) => nodes.flatMap((n) => runs(n, f));
      function blocks(parent, ctx) {
        const out = [];
        let buf = [];
        const flush = () => {
          if (!buf.length) return;
          const r = runsOfNodes(buf, ctx.fmt || {});
          buf = [];
          if (r.length) out.push(new Paragraph({ children: r, ...ctx.para }));
        };
        for (const n of parent.childNodes) {
          if (n.nodeType === 3) {
            if (n.nodeValue.trim() || buf.length) buf.push(n);
            continue;
          }
          if (n.nodeType !== 1) continue;
          if (!BLOCK.test(n.tagName) && !n.classList.contains('page-break')) {
            buf.push(n);
            continue;
          }
          flush();
          out.push(...block(n, ctx));
        }
        flush();
        return out;
      }
      const hasBlock = (n) =>
        [...n.children].some((c) => BLOCK.test(c.tagName) || c.classList.contains('page-break'));
      function block(n, ctx) {
        const t = n.tagName,
          alignment = alignOf(n);
        const para = { ...ctx.para, ...(alignment ? { alignment } : {}) };
        if (n.classList.contains('page-break')) return [new Paragraph({ children: [new PageBreak()] })];
        if (/^H[1-6]$/.test(t))
          return [
            new Paragraph({ heading: HeadingLevel['HEADING_' + t[1]], ...para, children: runs(n, {}) }),
          ];
        if (t === 'UL' || t === 'OL') return list(n, ctx, 0);
        if (t === 'TABLE') return [table(n)];
        if (t === 'HR')
          return [
            new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'B5BDC5', space: 1 } },
              children: [],
            }),
          ];
        if (t === 'PRE') {
          const lines = n.textContent.split('\n');
          return [
            new Paragraph({
              ...para,
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F4F6' },
              children: lines.map(
                (l, i) => new TextRun({ text: l, font: 'Courier New', size: 19, break: i ? 1 : 0 }),
              ),
            }),
          ];
        }
        if (t === 'BLOCKQUOTE') {
          const plainIndent = (n.getAttribute('style') || '').includes('border: none');
          const p2 = {
            ...para,
            indent: { left: ((ctx.para && ctx.para.indent && ctx.para.indent.left) || 0) + 720 },
          };
          if (!plainIndent)
            p2.border = { left: { style: BorderStyle.SINGLE, size: 12, color: '9AA4AE', space: 10 } };
          return blocks(n, {
            ...ctx,
            para: p2,
            fmt: plainIndent ? ctx.fmt : { ...(ctx.fmt || {}), color: '4A525A' },
          });
        }
        if (hasBlock(n)) return blocks(n, { ...ctx, para });
        if (t === 'NAV') return blocks(n, ctx);
        return [new Paragraph({ ...para, children: runs(n, ctx.fmt || {}) })];
      }
      function list(n, ctx, level) {
        const ordered = n.tagName === 'OL';
        const inst = ordered ? ++olInst : 0;
        const out = [];
        for (const li of n.children) {
          if (li.tagName !== 'LI') {
            if (li.tagName === 'UL' || li.tagName === 'OL') out.push(...list(li, ctx, level + 1));
            continue;
          }
          const inline = [],
            subs = [];
          for (const c of li.childNodes)
            c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL') ? subs.push(c) : inline.push(c);
          const marker = ordered
            ? { numbering: { reference: 'ol', level: Math.min(level, 5), instance: inst } }
            : { bullet: { level: Math.min(level, 5) } };
          out.push(
            new Paragraph({
              ...marker,
              ...(alignOf(li) ? { alignment: alignOf(li) } : {}),
              children: runsOfNodes(inline, {}),
            }),
          );
          subs.forEach((s) => out.push(...list(s, ctx, level + 1)));
        }
        return out;
      }
      function table(n) {
        const trs = $$('tr', n).filter((r) => r.closest('table') === n);
        const cols = Math.max(
          1,
          ...trs.map((r) => [...r.children].reduce((a, c) => a + (+c.getAttribute('colspan') || 1), 0)),
        );
        const colW = Math.floor(contentTw / cols);
        return new Table({
          width: { size: contentTw, type: WidthType.DXA },
          columnWidths: Array(cols).fill(colW),
          rows: trs.map(
            (r) =>
              new TableRow({
                children: [...r.children].map((c) => {
                  const kids = blocks(c, { fmt: c.tagName === 'TH' ? { bold: true } : {} });
                  const span = +c.getAttribute('colspan') || 1;
                  return new TableCell({
                    children: kids.length ? kids : [new Paragraph('')],
                    columnSpan: span,
                    width: { size: colW * span, type: WidthType.DXA },
                    ...(c.tagName === 'TH'
                      ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF1F4' } }
                      : {}),
                  });
                }),
              }),
          ),
        });
      }
      const levels = [
        LevelFormat.DECIMAL,
        LevelFormat.LOWER_LETTER,
        LevelFormat.LOWER_ROMAN,
        LevelFormat.DECIMAL,
        LevelFormat.LOWER_LETTER,
        LevelFormat.LOWER_ROMAN,
      ].map((format, level) => ({
        level,
        format,
        text: `%${level + 1}.`,
        alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
      }));
      const children = blocks(page, { para: { spacing: { after: 120 } } });
      const hd = (sz) => ({
        run: { size: sz, bold: true, font: 'Arial', color: '1A1F25' },
        paragraph: { spacing: { before: 240, after: 120 } },
      });
      const doc = new Document({
        creator: 'Offline Office',
        title: name,
        styles: {
          default: {
            document: { run: { font: 'Georgia', size: 24 } },
            heading1: hd(44),
            heading2: hd(34),
            heading3: hd(28),
            heading4: hd(24),
            heading5: hd(22),
            heading6: hd(20),
          },
        },
        numbering: { config: [{ reference: 'ol', levels }] },
        sections: [
          {
            properties: {
              page: {
                size: {
                  width: pageW,
                  height: pageH,
                  orientation:
                    setup.orient === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
                },
                margin: { top: marginTw, right: marginTw, bottom: marginTw, left: marginTw },
              },
            },
            children: children.length ? children : [new Paragraph('')],
          },
        ],
      });
      savedWhole('doc', await saveFile(name + '.docx', await Packer.toBlob(doc)));
    } catch (e) {
      console.error(e);
      UI.toast('Word export failed: ' + e.message, true);
    } finally {
      done();
    }
  }

  /* --- HTML → Markdown --- */
  function htmlToMd(root) {
    const inl = (n) => [...n.childNodes].map(walk).join('');
    function walk(n) {
      if (n.nodeType === 3) return n.nodeValue.replace(/\s+/g, ' ');
      if (n.nodeType !== 1) return '';
      const t = n.tagName,
        inner = () => inl(n);
      switch (t) {
        case 'H1':
        case 'H2':
        case 'H3':
        case 'H4':
        case 'H5':
        case 'H6':
          return `\n\n${'#'.repeat(+t[1])} ${inner().trim()}\n\n`;
        case 'P':
        case 'DIV':
        case 'SECTION':
        case 'NAV':
          return `\n\n${inner().trim()}\n\n`;
        case 'BR':
          return '  \n';
        case 'B':
        case 'STRONG': {
          const s = inner();
          return s.trim() ? `**${s.trim()}** ` : s;
        }
        case 'I':
        case 'EM': {
          const s = inner();
          return s.trim() ? `_${s.trim()}_ ` : s;
        }
        case 'S':
        case 'DEL':
        case 'STRIKE':
          return `~~${inner()}~~`;
        case 'CODE':
          return '`' + n.textContent + '`';
        case 'PRE':
          return '\n\n```\n' + n.textContent.replace(/\n$/, '') + '\n```\n\n';
        case 'A':
          return `[${inner()}](${n.getAttribute('href') || ''})`;
        case 'IMG':
          return `![${n.alt || ''}](${n.getAttribute('src') || ''})`;
        case 'HR':
          return '\n\n---\n\n';
        case 'BLOCKQUOTE':
          return (
            '\n\n' +
            inner()
              .trim()
              .split('\n')
              .map((l) => '> ' + l)
              .join('\n') +
            '\n\n'
          );
        case 'UL':
        case 'OL': {
          let i = 0;
          const depth = $$('ul,ol', root).filter((x) => x.contains(n) && x !== n).length;
          return (
            '\n\n' +
            [...n.children]
              .map((li) => '  '.repeat(depth) + (t === 'OL' ? `${++i}. ` : '- ') + inl(li).trim())
              .join('\n') +
            '\n\n'
          );
        }
        case 'TABLE': {
          const rows = $$('tr', n).map((r) =>
            [...r.children].map((c) => inl(c).trim().replace(/\|/g, '\\|')),
          );
          if (!rows.length) return '';
          const w = Math.max(...rows.map((r) => r.length));
          const line = (r) => '| ' + Array.from({ length: w }, (_, i) => r[i] || '').join(' | ') + ' |';
          return (
            '\n\n' + [line(rows[0]), '|' + ' --- |'.repeat(w), ...rows.slice(1).map(line)].join('\n') + '\n\n'
          );
        }
        default:
          return inner();
      }
    }
    return (
      walk(root)
        .replace(/[ \t]+\n/g, (m) => (m.startsWith('  ') ? '  \n' : '\n'))
        .replace(/\n{3,}/g, '\n\n')
        .trim() + '\n'
    );
  }

  // boot
  const draft = store.get('doc2');
  if (draft && draft.html) {
    name = draft.name || name;
    setup = { ...setup, ...(draft.setup || {}) };
    page.innerHTML = DOMPurify.sanitize(draft.html);
  } else {
    name = 'Untitled document';
    page.innerHTML = '<p><br></p>';
  }
  applySetup();
  stats();
  return {
    load,
    act: action,
    open,
    save: exportDocx,
    fromHtml,
    htmlToMd,
    onShow() {
      stats();
    },
  };
})();
