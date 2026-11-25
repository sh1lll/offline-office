'use strict';
/* ============================== YOUR FILES ============================== */
// Files the user keeps in the app, in this browser's IndexedDB (never uploaded), so they stay across
// visits: fonts show up in every font menu and are embedded in PDFs, images are offered wherever a
// picture is inserted, templates open as a fresh copy from the home screen, and OCR languages join
// the language choice.
Mods.addons = (() => {
  const desk = $('#adDesk');
  const FONT_EXT = ['ttf', 'otf', 'woff', 'woff2'];
  const LANGS = {
    eng: 'English',
    deu: 'German',
    fra: 'French',
    spa: 'Spanish',
    ita: 'Italian',
    por: 'Portuguese',
    nld: 'Dutch',
    pol: 'Polish',
    ces: 'Czech',
    swe: 'Swedish',
    dan: 'Danish',
    nor: 'Norwegian',
    fin: 'Finnish',
    tur: 'Turkish',
    rus: 'Russian',
    ukr: 'Ukrainian',
    ell: 'Greek',
    ara: 'Arabic',
    heb: 'Hebrew',
    hin: 'Hindi',
    chi_sim: 'Chinese (simplified)',
    chi_tra: 'Chinese (traditional)',
    jpn: 'Japanese',
    kor: 'Korean',
    vie: 'Vietnamese',
    tha: 'Thai',
    ind: 'Indonesian',
  };
  const langName = (c) => LANGS[c] || c;
  let items = []; // { id, kind: 'font' | 'lang' | 'image' | 'template', key, name, data }
  const KIND = { font: 'Font', lang: 'OCR language', image: 'Image', template: 'Template', file: 'File' };
  const fileOf = (it) => new File([it.data], it.name, { type: it.type || '' });

  /* --- storage --- */
  const db = new Promise((res, rej) => {
    const r = indexedDB.open('offline-office', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('addons', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const t = (await db).transaction('addons', mode);
    const req = fn(t.objectStore('addons'));
    return new Promise((res, rej) => {
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  };

  async function register(it) {
    if (it.kind !== 'font' || userFonts.includes(it.key)) return;
    const ff = new FontFace(it.key, it.data);
    await ff.load(); // throws on a file that is not a font
    document.fonts.add(ff);
    userFonts.push(it.key);
    $('#docFont').append(el('option', { value: it.key }, it.key));
    $('#pdfFont').append(el('option', { value: 'user:' + it.key }, it.key));
  }

  async function add(files) {
    let n = 0;
    for (const f of files) {
      const e = ext(f.name),
        nm = f.name.replace(/\.gz$/i, '');
      try {
        let it;
        if (FONT_EXT.includes(e)) {
          // The file name is the family name people will see: "Inter-Bold.ttf" becomes "Inter Bold".
          const key = base(f.name).replace(/[-_]+/g, ' ').trim();
          if (items.some((x) => x.kind === 'font' && x.key === key))
            throw new Error('a font with this name is already added');
          it = { id: uid(), kind: 'font', key, name: f.name, data: await f.arrayBuffer() };
          await register(it);
        } else if (/\.traineddata$/i.test(nm)) {
          const key = base(nm);
          if (key === 'eng' || items.some((x) => x.kind === 'lang' && x.key === key))
            throw new Error(`${langName(key)} is already available`);
          it = { id: uid(), kind: 'lang', key, name: f.name, data: await f.arrayBuffer() };
        } else if (ROUTES[e] === 'image') {
          it = {
            id: uid(),
            kind: 'image',
            key: f.name,
            name: f.name,
            type: f.type,
            data: await f.arrayBuffer(),
          };
        } else if (routeOf(f) || e === 'pages' || e === 'key') {
          it = {
            id: uid(),
            kind: 'template',
            key: f.name,
            name: f.name,
            type: f.type,
            data: await f.arrayBuffer(),
          };
        }
        // Anything else is kept as is, to convert or save again later.
        else
          it = {
            id: uid(),
            kind: 'file',
            key: f.name,
            name: f.name,
            type: f.type,
            data: await f.arrayBuffer(),
          };
        await tx('readwrite', (s) => s.put(it));
        items.push(it);
        n++;
      } catch (err) {
        UI.toast(`Could not add ${f.name}: ${err.message}`, true);
      }
    }
    if (n) UI.toast(`Added ${n} file${n > 1 ? 's' : ''}`);
    render();
  }
  async function remove(it) {
    if (
      !(await UI.confirm(
        `Remove ${it.kind === 'lang' ? langName(it.key) : it.key}?`,
        it.kind === 'font'
          ? 'Text that uses it will show in another font. Files you already saved keep it.'
          : 'It is deleted from this browser. Files you already saved are not affected.',
        'Remove',
      ))
    )
      return;
    await tx('readwrite', (s) => s.delete(it.id));
    items = items.filter((x) => x !== it);
    if (it.kind === 'font') {
      // Fonts already in the menus stay usable until the page reloads.
      [...document.fonts]
        .filter((f) => f.family === it.key || f.family === `"${it.key}"`)
        .forEach((f) => document.fonts.delete(f));
      userFonts.splice(userFonts.indexOf(it.key), 1);
      $$(`#docFont option, #pdfFont option`).forEach(
        (o) => (o.value === it.key || o.value === 'user:' + it.key) && o.remove(),
      );
    }
    render();
  }

  /* --- screen --- */
  function render() {
    renderHome();
    const row = (it) =>
      el(
        'div',
        { class: 'cv-row' },
        el(
          'b',
          { style: it.kind === 'font' ? { fontFamily: `"${it.key}"`, fontSize: '17px' } : {} },
          it.kind === 'lang' ? langName(it.key) : it.key,
        ),
        el(
          'span',
          { class: 'sub' },
          `${KIND[it.kind]} · ${it.kind === 'lang' ? it.name + ' · ' : ''}${(it.data.byteLength / 1024).toFixed(0)} KB`,
        ),
        el(
          'span',
          { class: 'ad-acts' },
          it.kind === 'template'
            ? el('button', { class: 'btn ghost', onclick: () => useTemplate(it) }, 'Open a copy')
            : '',
          it.kind === 'font' || it.kind === 'lang'
            ? ''
            : el(
                'button',
                { class: 'btn ghost', onclick: () => (show('convert'), Mods.convert.drop([fileOf(it)])) },
                'Convert',
              ),
          it.kind === 'file'
            ? el('button', { class: 'btn ghost', onclick: () => saveFile(it.name, fileOf(it)) }, 'Save')
            : '',
        ),
        el('button', {
          class: 'btn sq ghost',
          title: 'Remove',
          'aria-label': 'Remove ' + it.name,
          html: icon('x'),
          onclick: () => remove(it),
        }),
      );
    desk.innerHTML = '';
    desk.append(
      el(
        'div',
        { class: 'cmp-pick' },
        el(
          'div',
          { class: 'cmp-intro' },
          el('b', {}, 'Your files'),
          el('p', {}, 'Fonts, images, templates and OCR languages you reuse.'),
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
          el('b', {}, 'Choose files'),
          el('span', { class: 'sub' }, 'or drop them here'),
        ),
        items.length ? el('div', { class: 'cv-list' }, ...items.map(row)) : '',
      ),
    );
    const count = (k, w, plus = 0) => {
      const n = items.filter((x) => x.kind === k).length + plus;
      return `${n} ${w}${n === 1 ? '' : 's'}`;
    };
    $('#adStatus').textContent = [
      count('font', 'font'),
      count('image', 'image'),
      count('template', 'template'),
      count('file', 'other file'),
      count('lang', 'OCR language', 1) + ' (English built in)',
    ].join(', ');
  }
  async function pick() {
    add(await pickFiles('', true));
  }
  // Templates on the home screen; opening one gives an untitled copy, the saved template is untouched.
  const MOD_ICON = {
    doc: 'fDoc',
    sheet: 'fSheet',
    slides: 'fSlides',
    pdf: 'fPdf',
    image: 'fImg',
    text: 'fText',
  };
  function useTemplate(it) {
    openFile(new File([it.data], 'Copy of ' + it.name, { type: it.type || '' }));
  }
  function renderHome() {
    const tpl = items.filter((x) => x.kind === 'template');
    $('#homeTpl').hidden = !tpl.length;
    $('#homeTplList').replaceChildren(
      ...tpl.map((it) =>
        el(
          'button',
          { class: 'new-row', style: '--k:var(--c-doc)', onclick: () => useTemplate(it) },
          el('span', { class: 'ico', html: icon(MOD_ICON[routeOf(fileOf(it))] || 'fDoc') }),
          el('b', {}, base(it.name)),
          el('span', {}, 'Start from this template'),
        ),
      ),
    );
  }
  // Picker shown before the device file dialog when the user has saved images. Resolves to [file],
  // [] when cancelled, or null to pick from the device instead.
  function chooseImage() {
    return new Promise((resolve) => {
      const bg = el('div', { class: 'modal-bg' });
      const done = (v) => (bg.remove(), resolve(v));
      const grid = el(
        'div',
        { class: 'ad-grid' },
        ...items
          .filter((x) => x.kind === 'image')
          .map((it) => {
            const url = URL.createObjectURL(fileOf(it));
            return el(
              'button',
              { class: 'ad-thumb', title: it.name, onclick: () => done([fileOf(it)]) },
              el('img', { src: url, alt: '', onload: () => URL.revokeObjectURL(url) }),
              el('span', {}, it.name),
            );
          }),
      );
      bg.onclick = (e) => e.target === bg && done([]);
      bg.onkeydown = (e) => e.key === 'Escape' && done([]);
      bg.append(
        el(
          'div',
          { class: 'modal wide', role: 'dialog', 'aria-label': 'Choose an image' },
          el('h3', {}, 'Choose an image'),
          grid,
          el(
            'div',
            { class: 'acts' },
            el('button', { class: 'btn ghost', type: 'button', onclick: () => done([]) }, 'Cancel'),
            el(
              'button',
              { class: 'btn primary', type: 'button', onclick: () => done(null) },
              'From this device…',
            ),
          ),
        ),
      );
      document.body.append(bg);
      $('button', grid)?.focus();
    });
  }
  $('#adBar').addEventListener('click', (e) => e.target.closest('[data-a="add"]') && pick());

  /* --- used by OCR and PDF export --- */
  const data = (kind, key) => {
    const it = items.find((x) => x.kind === kind && x.key === key);
    if (!it) throw new Error(`${key} is not added`);
    return it.data;
  };
  // The OCR languages to use: English unless the user added others, then they choose (remembered).
  async function pickLangs() {
    const codes = items.filter((x) => x.kind === 'lang').map((x) => x.key);
    const last = store.get('ocrLangs') || ['eng'];
    const valid = (l) => l.every((c) => c === 'eng' || codes.includes(c));
    if (!codes.length) return ['eng'];
    if (capture) return valid(last) ? last : ['eng'];
    const opts = [
      ['eng', 'English'],
      ...codes.flatMap((c) => [
        [c, langName(c)],
        ['eng+' + c, 'English and ' + langName(c)],
      ]),
    ];
    const r = await UI.modal({
      title: 'Text recognition language',
      fields: [
        {
          id: 'l',
          label: 'Language of the text',
          type: 'select',
          options: opts,
          value: valid(last) ? last.join('+') : 'eng',
        },
      ],
      ok: 'Read text',
    });
    if (!r) return null;
    const langs = r.l.split('+');
    store.set('ocrLangs', langs);
    return langs;
  }

  // Load what was added on earlier visits.
  tx('readonly', (s) => s.getAll())
    .then(async (all) => {
      items = all || [];
      for (const it of items) await register(it).catch((e) => console.warn('Font not loaded', it.name, e));
      render();
    })
    .catch((e) => {
      console.warn('Add-ons unavailable', e);
      render();
    });
  render();

  return {
    drop: add,
    hasImages: () => items.some((x) => x.kind === 'image'),
    chooseImage,
    pickLangs,
    fontData: (fam) => data('font', fam),
    ocrData: (code) => data('lang', code),
  };
})();
