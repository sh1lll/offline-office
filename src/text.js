'use strict';
/* ============================== TEXT & CODE ============================== */
Mods.text = (() => {
  const ta = $('#txArea'),
    gut = $('#txGutter'),
    prev = $('#txPreview'),
    work = $('#txWork'),
    edBox = $('#txEdBox');
  let name = 'README.md',
    mode = 'md',
    view = 'split',
    size = 13.5,
    wrapOn = false,
    booted = false;
  const MODES = {
    md: 'md',
    markdown: 'md',
    json: 'json',
    html: 'html',
    htm: 'html',
    csv: 'csv',
    tsv: 'csv',
    txt: 'plain',
    log: 'plain',
  };
  const modeFor = (e) => MODES[e] || (TEXT_EXT.includes(e) ? 'code' : 'plain');
  const SAMPLE = `# Harbor Street Garden — volunteer handbook

_Example Markdown file. Edit on the left, see the preview on the right._

## Opening the shed

1. Code for the padlock is on the noticeboard
2. Sign the **tool log** when you take anything out
3. Return tools *clean* and hang them on the marked hooks

## Watering

| Time    | Beds     | Notes                   |
|---------|----------|-------------------------|
| 07:00   | A1 – B4  | Use the rain barrels first |
| 19:00   | C1 – D6  | Skip if it rained today |

> Tip: Water the soil, not the leaves.

\`\`\`json
{ "beds": 42, "barrels": 2, "openDays": ["Apr 12", "Jun 7", "Aug 9", "Oct 4"] }
\`\`\`

- [ ] Order compost
- [x] Fix the gate latch
`;
  function setView(v) {
    view = v;
    $$('#txView button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    edBox.hidden = v === 'preview';
    prev.hidden = v === 'edit';
    work.classList.toggle('split', v === 'split');
    renderPreview();
  }
  function lines() {
    return ta.value.split('\n').length;
  }
  function gutter() {
    if (wrapOn) {
      gut.hidden = true;
      return;
    }
    gut.hidden = false;
    const n = lines();
    let s = '';
    for (let i = 1; i <= n; i++) s += i + '\n';
    gut.textContent = s;
    gut.scrollTop = ta.scrollTop;
  }
  function status() {
    const v = ta.value,
      pos = ta.selectionStart,
      before = v.slice(0, pos);
    const ln = before.split('\n').length,
      col = pos - before.lastIndexOf('\n');
    const words = (v.match(/[\p{L}\p{N}'’_-]+/gu) || []).length;
    const selLen = ta.selectionEnd - ta.selectionStart;
    $('#txStatus').innerHTML =
      `<span><b>${esc(name)}</b></span><span>Ln ${ln}, Col ${col}</span><span>${lines()} lines</span><span>${words.toLocaleString()} words</span><span>${v.length.toLocaleString()} chars</span>${selLen ? `<span>${selLen} selected</span>` : ''}<span>${{ md: 'Markdown', json: 'JSON', html: 'HTML', csv: 'CSV', code: 'Code', plain: 'Plain text' }[mode]}</span>`;
    $('#txName').textContent = name;
    $('#txMd').hidden = mode !== 'md';
  }
  function parseCsv(t) {
    const rows = [];
    let row = [],
      f = '',
      q = false;
    const d = t.includes('\t') && !t.includes(',') ? '\t' : ',';
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) {
        if (c === '"') {
          if (t[i + 1] === '"') {
            f += '"';
            i++;
          } else q = false;
        } else f += c;
      } else if (c === '"') q = true;
      else if (c === d) {
        row.push(f);
        f = '';
      } else if (c === '\n') {
        row.push(f);
        rows.push(row);
        row = [];
        f = '';
      } else if (c !== '\r') f += c;
    }
    if (f || row.length) {
      row.push(f);
      rows.push(row);
    }
    return rows;
  }
  const renderPreview = debounce(() => {
    if (prev.hidden) return;
    const v = ta.value;
    if (mode === 'md') {
      prev.className = 'panel preview md';
      prev.innerHTML = DOMPurify.sanitize(marked.parse(v, { gfm: true }));
    } else if (mode === 'html') {
      prev.className = 'panel preview';
      prev.innerHTML = '';
      const f = el('iframe', { sandbox: '', title: 'HTML preview' });
      f.srcdoc = v;
      prev.append(f);
    } else if (mode === 'csv') {
      const rows = parseCsv(v).slice(0, 1000);
      prev.className = 'panel preview';
      prev.innerHTML =
        '<table>' +
        rows
          .map(
            (r, i) =>
              '<tr>' + r.map((c) => `<${i ? 'td' : 'th'}>${esc(c)}</${i ? 'td' : 'th'}>`).join('') + '</tr>',
          )
          .join('') +
        '</table>';
    } else if (mode === 'json') {
      prev.className = 'panel preview';
      try {
        const o = JSON.parse(v);
        prev.innerHTML = `<p style="color:var(--ok)">✓ Valid JSON · ${Array.isArray(o) ? 'array of ' + o.length : typeof o === 'object' && o ? Object.keys(o).length + ' keys' : typeof o}</p><pre>${esc(JSON.stringify(o, null, 2))}</pre>`;
      } catch (e) {
        prev.innerHTML = `<p style="color:var(--danger)">✗ ${esc(e.message)}</p>`;
      }
    } else {
      prev.className = 'panel preview';
      prev.innerHTML = `<pre style="white-space:pre-wrap">${esc(v)}</pre>`;
    }
  }, 150);
  const autosave = debounce(() => {
    keepDraft('text', 'text2', ta.value.length < 2e6 ? { name, v: ta.value, mode } : null);
  }, 800);
  function update() {
    gutter();
    status();
    renderPreview();
    autosave();
  }
  ta.addEventListener('input', update);
  ta.addEventListener('scroll', () => (gut.scrollTop = ta.scrollTop));
  ['keyup', 'click', 'select'].forEach((ev) => ta.addEventListener(ev, status));
  function replaceSel(fn, whole) {
    const a = ta.selectionStart,
      b = ta.selectionEnd;
    const all = whole || a === b;
    const s = all ? 0 : a,
      e = all ? ta.value.length : b;
    const out = fn(ta.value.slice(s, e));
    ta.focus();
    ta.setSelectionRange(s, e);
    if (!document.execCommand('insertText', false, out)) ta.setRangeText(out, s, e, 'select');
    update();
  }
  function wrapSel(pre, post = pre, placeholder = 'text') {
    const a = ta.selectionStart,
      b = ta.selectionEnd;
    const t = ta.value.slice(a, b) || placeholder;
    ta.focus();
    ta.setSelectionRange(a, b);
    if (!document.execCommand('insertText', false, pre + t + post)) ta.setRangeText(pre + t + post, a, b);
    ta.setSelectionRange(a + pre.length, a + pre.length + t.length);
    update();
  }
  function prefixLines(fn) {
    const v = ta.value;
    let a = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let b = v.indexOf('\n', ta.selectionEnd);
    if (b < 0) b = v.length;
    ta.setSelectionRange(a, b);
    replaceSel((t) => t.split('\n').map(fn).join('\n'));
  }
  $('#txMd').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    const m = b.dataset.m;
    if (m === '**' || m === '_' || m === '`') wrapSel(m);
    else if (m === 'h') prefixLines((l) => (l.startsWith('#') ? '#' + l : '## ' + l));
    else if (m === 'ul') prefixLines((l) => '- ' + l);
    else if (m === 'ol') {
      let i = 0;
      prefixLines((l) => `${++i}. ` + l);
    } else if (m === 'quote') prefixLines((l) => '> ' + l);
    else if (m === 'link') wrapSel('[', '](https://)', 'link text');
    else if (m === 'table')
      wrapSel('\n| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n| ', ' |  |  |\n', 'Cell');
  });
  ta.addEventListener('keydown', (e) => {
    const m = e.ctrlKey || e.metaKey;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (
        ta.selectionStart !== ta.selectionEnd &&
        ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')
      )
        prefixLines((l) => (e.shiftKey ? l.replace(/^ {1,2}/, '') : '  ' + l));
      else if (!e.shiftKey) document.execCommand('insertText', false, '  ');
    }
    if (m && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      act('find');
    }
    if (m && e.key.toLowerCase() === 'b' && mode === 'md') {
      e.preventDefault();
      wrapSel('**');
    }
    if (m && e.key.toLowerCase() === 'i' && mode === 'md') {
      e.preventDefault();
      wrapSel('_');
    }
    if (e.key === 'Enter' && !m) {
      const v = ta.value,
        p = ta.selectionStart;
      const ls = v.lastIndexOf('\n', p - 1) + 1;
      const line = v.slice(ls, p);
      const mm = /^(\s*)([-*+] (\[[ x]\] )?|\d+\. |> )?/.exec(line);
      if (mm && (mm[1] || mm[2])) {
        e.preventDefault();
        let marker = mm[2] || '';
        if (marker && line.trim() === marker.trim()) {
          ta.setSelectionRange(ls, p);
          document.execCommand('insertText', false, '');
          update();
          return;
        }
        if (/^\d+\. $/.test(marker)) marker = parseInt(marker) + 1 + '. ';
        if (mm[3]) marker = marker.replace('[x]', '[ ]');
        document.execCommand('insertText', false, '\n' + mm[1] + marker);
        update();
      }
    }
  });
  // find bar
  function fre() {
    const q = $('#tfFind').value;
    if (!q) return null;
    try {
      return new RegExp($('#tfRegex').checked ? q : escRe(q), $('#tfCase').checked ? 'g' : 'gi');
    } catch {
      $('#tfInfo').textContent = 'Invalid regex';
      return null;
    }
  }
  function fNext() {
    const re = fre();
    if (!re) return;
    const v = ta.value;
    const total = (v.match(re) || []).length;
    $('#tfInfo').textContent = total ? `${total} found` : 'No matches';
    if (!total) return;
    re.lastIndex = ta.selectionEnd;
    let m = re.exec(v);
    if (!m) {
      re.lastIndex = 0;
      m = re.exec(v);
    }
    if (!m) return;
    ta.focus();
    ta.setSelectionRange(m.index, m.index + m[0].length);
    const ln = v.slice(0, m.index).split('\n').length;
    ta.scrollTop = Math.max(0, (ln - 5) * size * 1.6);
  }
  function act(a) {
    const T = (fn) => replaceSel(fn);
    switch (a) {
      case 'new':
        return (async () => {
          if (
            ta.value &&
            !(await UI.confirm('Start a new file?', 'The current text will be replaced.', 'New file'))
          )
            return;
          ta.value = '';
          name = 'untitled.txt';
          mode = 'plain';
          $('#txMode').value = mode;
          setView('edit');
          update();
        })();
      case 'open':
        return pickFiles('.' + TEXT_EXT.join(',.') + ',text/*').then(async ([f]) => {
          if (!f) return;
          try {
            await load(f);
          } catch (e) {
            UI.toast(e.message, true);
          }
        });
      case 'save':
        return saveFile(name, ta.value, 'text/plain').then((ok) => savedWhole('text', ok));
      case 'example':
        return replaceOk(ta.value.trim().length > 0).then((ok) => {
          if (ok) setContent(SAMPLE, 'README.md');
        });
      case 'saveAs':
        return UI.modal({
          title: 'Save as',
          fields: [{ id: 'n', label: 'File name', value: name }],
          ok: 'Save',
        }).then((r) => {
          if (r && r.n) {
            name = r.n;
            mode = modeFor(ext(name));
            $('#txMode').value = mode;
            update();
            saveFile(name, ta.value, 'text/plain').then((ok) => savedWhole('text', ok));
          }
        });
      case 'toHtml': {
        const body =
          mode === 'md' ? DOMPurify.sanitize(marked.parse(ta.value)) : `<pre>${esc(ta.value)}</pre>`;
        return saveFile(
          base(name) + '.html',
          `<!doctype html><html><head><meta charset="utf-8"><title>${esc(base(name))}</title><style>body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.6}pre{background:#f4f6f8;padding:12px;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style></head><body>${body}</body></html>`,
          'text/html',
        );
      }
      case 'toDoc':
        return Mods.doc.fromHtml(
          mode === 'md'
            ? marked.parse(ta.value)
            : ta.value
                .split(/\n{2,}/)
                .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
                .join(''),
          base(name),
        );
      case 'toPdf': {
        const d = UI.busy('Building PDF…');
        // Letter paper, 0.75 in margins: 7 in of text width at 96 px per inch. Reuses the Documents page styles.
        const node = el('div', {
          class: 'doc-page exporting',
          style: { width: '672px', padding: '0', minHeight: '0', boxShadow: 'none', fontSize: '13px' },
        });
        node.innerHTML =
          mode === 'md'
            ? DOMPurify.sanitize(marked.parse(ta.value))
            : `<pre style="white-space:pre-wrap;font:12px 'Courier New',monospace;background:none;padding:0">${esc(ta.value)}</pre>`;
        const holder = el('div', { style: { position: 'fixed', left: '-20000px', top: '0' } }, node);
        document.body.append(holder);
        return Formats.domToPdf(node, { pageW: 612, pageH: 792, margin: 54, title: base(name) })
          .then(({ bytes, replaced }) => {
            warnReplaced(replaced);
            return saveFile(base(name) + '.pdf', new Blob([bytes], { type: 'application/pdf' }));
          })
          .catch((e) => UI.toast('PDF export failed: ' + e.message, true))
          .finally(() => (holder.remove(), d()));
      }
      case 'jsonFmt':
        try {
          ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
          update();
          UI.toast('Formatted');
        } catch (e) {
          UI.toast('Invalid JSON: ' + e.message, true);
        }
        break;
      case 'jsonMin':
        try {
          ta.value = JSON.stringify(JSON.parse(ta.value));
          update();
        } catch (e) {
          UI.toast('Invalid JSON: ' + e.message, true);
        }
        break;
      case 'jsonCheck':
        try {
          JSON.parse(ta.value);
          UI.toast('✓ Valid JSON');
        } catch (e) {
          const m = /position (\d+)/.exec(e.message);
          if (m) {
            const p = +m[1];
            ta.focus();
            ta.setSelectionRange(p, p + 1);
          }
          UI.toast('Invalid JSON: ' + e.message, true);
        }
        break;
      case 'upper':
        T((s) => s.toUpperCase());
        break;
      case 'lower':
        T((s) => s.toLowerCase());
        break;
      case 'title':
        T((s) => s.toLowerCase().replace(/(^|[\s(\["'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()));
        break;
      case 'sort':
        T((s) =>
          s
            .split('\n')
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .join('\n'),
        );
        break;
      case 'sortR':
        T((s) =>
          s
            .split('\n')
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
            .join('\n'),
        );
        break;
      case 'reverse':
        T((s) => s.split('\n').reverse().join('\n'));
        break;
      case 'dedupe':
        T((s) => [...new Set(s.split('\n'))].join('\n'));
        break;
      case 'empty':
        T((s) =>
          s
            .split('\n')
            .filter((l) => l.trim())
            .join('\n'),
        );
        break;
      case 'trim':
        T((s) =>
          s
            .split('\n')
            .map((l) => l.replace(/\s+$/, ''))
            .join('\n'),
        );
        break;
      case 'number':
        T((s) =>
          s
            .split('\n')
            .map((l, i) => `${i + 1}. ${l}`)
            .join('\n'),
        );
        break;
      case 'b64e':
        T((s) => {
          // Chunked: spreading a large byte array into fromCharCode overflows the call stack.
          const b = new TextEncoder().encode(s);
          let bin = '';
          for (let i = 0; i < b.length; i += 32768) bin += String.fromCharCode(...b.subarray(i, i + 32768));
          return btoa(bin);
        });
        break;
      case 'b64d':
        try {
          T((s) => new TextDecoder().decode(Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0))));
        } catch {
          UI.toast('That is not valid Base64.', true);
        }
        break;
      case 'urle':
        T((s) => encodeURIComponent(s));
        break;
      case 'urld':
        try {
          T((s) => decodeURIComponent(s));
        } catch {
          UI.toast('That is not valid URL encoding.', true);
        }
        break;
      case 'freq': {
        const f = {};
        (ta.value.toLowerCase().match(/[\p{L}'’]+/gu) || []).forEach((w) => (f[w] = (f[w] || 0) + 1));
        const top = Object.entries(f)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 40);
        UI.modal({
          title: 'Word frequency',
          body: el(
            'pre',
            {
              style: {
                maxHeight: '50vh',
                overflow: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: '12.5px',
              },
            },
            top.map(([w, n]) => `${String(n).padStart(5)}  ${w}`).join('\n') || 'No words',
          ),
          cancel: null,
          ok: 'Close',
        });
        break;
      }
      case 'find':
        $('#txFind').hidden = false;
        if (ta.selectionStart !== ta.selectionEnd)
          $('#tfFind').value = ta.value.slice(ta.selectionStart, ta.selectionEnd);
        $('#tfFind').focus();
        $('#tfFind').select();
        break;
      case 'fNext':
        fNext();
        break;
      case 'fRep': {
        const re = fre();
        if (!re) return;
        const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
        const one = new RegExp(re.source, re.flags.replace('g', ''));
        if (sel && one.test(sel) && sel.match(one)[0] === sel) {
          document.execCommand('insertText', false, sel.replace(one, $('#tfRep').value));
          update();
        }
        fNext();
        break;
      }
      case 'fAll': {
        const re = fre();
        if (!re) return;
        const n = (ta.value.match(re) || []).length;
        ta.focus();
        ta.select();
        document.execCommand('insertText', false, ta.value.replace(re, $('#tfRep').value));
        update();
        $('#tfInfo').textContent = `Replaced ${n}`;
        break;
      }
      case 'fClose':
        $('#txFind').hidden = true;
        ta.focus();
        break;
      case 'smaller':
        size = Math.max(10, size - 1);
        document.documentElement.style.setProperty('--tsize', size + 'px');
        gutter();
        break;
      case 'bigger':
        size = Math.min(28, size + 1);
        document.documentElement.style.setProperty('--tsize', size + 'px');
        gutter();
        break;
    }
  }
  $('#txBar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (b) act(b.dataset.a);
  });
  $('#txFind').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (b) act(b.dataset.a);
  });
  $('#tfFind').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fNext();
    }
    if (e.key === 'Escape') act('fClose');
  });
  $('#txView').onclick = (e) => {
    const b = e.target.closest('[data-v]');
    if (b) setView(b.dataset.v);
  };
  $('#txMode').onchange = (e) => {
    mode = e.target.value;
    status();
    renderPreview();
  };
  $('#txWrap').onclick = () => {
    wrapOn = !wrapOn;
    ta.classList.toggle('wrap', wrapOn);
    $('#txWrap').setAttribute('aria-pressed', wrapOn);
    gutter();
  };
  function setContent(text, nm) {
    ta.value = text;
    name = nm;
    mode = modeFor(ext(nm));
    $('#txMode').value = mode;
    booted = true;
    setView(['md', 'html', 'csv'].includes(mode) ? 'split' : 'edit');
    update();
    show('text');
  }
  async function load(file) {
    const t = await readAs(file, 'text');
    setContent(t, file.name);
  }
  return {
    load,
    act,
    setContent,
    open: () => act('open'),
    save: () => act('save'),
    onShow() {
      if (!booted) {
        booted = true;
        const d = store.get('text2');
        if (d && typeof d.v === 'string') {
          ta.value = d.v;
          name = d.name;
          mode = d.mode || modeFor(ext(name));
        } else {
          ta.value = '';
          name = 'untitled.txt';
          mode = 'plain';
        }
        $('#txMode').value = mode;
        setView(mode === 'md' ? 'split' : 'edit');
        update();
      }
      setTimeout(() => ta.focus({ preventScroll: true }), 0);
    },
  };
})();
