'use strict';
/* ============================== FORMAT CONVERTERS ============================== */
const Formats = (() => {
  const loading = {};
  // Libraries needed only for some files (HEIC, TIFF, Unicode PDF text). Embedded copies run in place.
  function loadScript(src) {
    return (
      loading[src] ||
      (loading[src] = new Promise((res, rej) => {
        if (embedded(src))
          return asset(src).then((b) => {
            document.head.append(el('script', { text: new TextDecoder().decode(b) }));
            res();
          }, rej);
        const s = el('script', { src });
        s.onload = res;
        s.onerror = () => {
          delete loading[src];
          s.remove();
          rej(new Error(`${src} could not be loaded`));
        };
        document.head.append(s);
      }))
    );
  }
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const kids = (n, t) => (n ? [...n.children].filter((c) => c.tagName === t) : []);
  const CP1252 = {
    128: 8364,
    130: 8218,
    131: 402,
    132: 8222,
    133: 8230,
    134: 8224,
    135: 8225,
    136: 710,
    137: 8240,
    138: 352,
    139: 8249,
    140: 338,
    142: 381,
    145: 8216,
    146: 8217,
    147: 8220,
    148: 8221,
    149: 8226,
    150: 8211,
    151: 8212,
    152: 732,
    153: 8482,
    154: 353,
    155: 8250,
    156: 339,
    158: 382,
    159: 376,
  };
  const cp1252 = (b) => String.fromCharCode(CP1252[b] || b);
  const cfbOpen = (buf) => {
    const c = XLSX.CFB.read(new Uint8Array(buf), { type: 'array' });
    return (n) => {
      const e = XLSX.CFB.find(c, n);
      return e && e.content && e.content.length ? new Uint8Array(e.content) : null;
    };
  };
  const mimeOf = (p) =>
    ({
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      bmp: 'image/bmp',
      webp: 'image/webp',
    })[ext(p)];
  async function zipImage(zip, path) {
    const f = zip.file(path);
    const m = mimeOf(path);
    if (!f || !m) return null;
    return `data:${m};base64,` + (await f.async('base64'));
  }

  /* --- Word 97–2003 (.doc): text from the piece table --- */
  function docToHtml(buf) {
    const get = cfbOpen(buf);
    const wd = get('WordDocument');
    if (!wd) throw new Error('this is not a Word 97–2003 document');
    const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    if (dv.getUint16(0, true) !== 0xa5ec) throw new Error('this is not a Word 97–2003 document');
    const flags = dv.getUint16(0x0a, true);
    if (flags & 0x0100) throw new Error('this document is password-protected');
    const tbl = get(flags & 0x0200 ? '1Table' : '0Table');
    if (!tbl) throw new Error('the document table is missing');
    const tv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);
    let off = 32;
    const csw = dv.getUint16(off, true);
    off += 2 + csw * 2;
    const lwOff = off + 2;
    const cslw = dv.getUint16(off, true);
    off += 2 + cslw * 4 + 2;
    const ccpText = dv.getInt32(lwOff + 12, true);
    const fcClx = dv.getUint32(off + 33 * 8, true),
      lcbClx = dv.getUint32(off + 33 * 8 + 4, true);
    let p = fcClx;
    const end = fcClx + lcbClx;
    while (p < end && tbl[p] === 0x01) p += 3 + tv.getInt16(p + 1, true);
    if (tbl[p] !== 0x02) throw new Error('the text index could not be read');
    const lcb = tv.getUint32(p + 1, true);
    p += 5;
    const n = (lcb - 4) / 12;
    const cps = [];
    for (let i = 0; i <= n; i++) cps.push(tv.getUint32(p + i * 4, true));
    const pcd = p + (n + 1) * 4;
    let text = '';
    for (let i = 0; i < n && text.length < ccpText; i++) {
      const raw = tv.getUint32(pcd + i * 8 + 2, true);
      const comp = (raw & 0x40000000) !== 0;
      const fc = raw & 0x3fffffff;
      const len = cps[i + 1] - cps[i];
      if (comp) {
        const s = fc / 2;
        for (let j = 0; j < len; j++) text += cp1252(wd[s + j]);
      } else
        for (let j = 0; j < len && fc + j * 2 + 1 < wd.length; j++)
          text += String.fromCharCode(dv.getUint16(fc + j * 2, true));
    }
    text = text.slice(0, ccpText);
    for (let k = 0; k < 5; k++)
      text = text
        .replace(/\x13[^\x13\x14\x15]*\x14([^\x13\x15]*)\x15/g, '$1')
        .replace(/\x13[^\x13\x15]*\x15/g, '');
    text = text
      .replace(/[\x01\x08\x02\x05]/g, '')
      .replace(/\x0b/g, '\n')
      .replace(/\x1e/g, '-')
      .replace(/\x1f/g, '')
      .replace(/\x0c/g, '\r\x0c\r');
    let html = '',
      rows = [],
      cells = [],
      cur = '',
      first = true,
      cellEnd = false;
    const flushTable = () => {
      if (!rows.length) return;
      flushList();
      html +=
        '<table><tbody>' +
        rows
          .map(
            (r) =>
              '<tr>' + r.map((c) => `<td>${esc(c).replace(/\n/g, '<br>') || '<br>'}</td>`).join('') + '</tr>',
          )
          .join('') +
        '</tbody></table>';
      rows = [];
    };
    let list = null;
    const flushList = () => {
      if (list) {
        html += `<${list.t}>` + list.items.map((x) => `<li>${x}</li>`).join('') + `</${list.t}>`;
        list = null;
      }
    };
    const para = (t) => {
      const m = /^\s*(?:([•·▪◦\uf0b7\uf0a7o§\-–])|(\d+|[a-zA-Z])[.)])\s*\t\s*/.exec(t);
      if (m && t.length > m[0].length) {
        flushTable();
        const lt = m[1] ? 'ul' : 'ol';
        if (!list || list.t !== lt) {
          flushList();
          list = { t: lt, items: [] };
        }
        list.items.push(esc(t.slice(m[0].length)).replace(/\n/g, '<br>'));
        first = false;
        return;
      }
      flushList();
      flushTable();
      if (t === '\x0c') {
        html += '<div class="page-break" contenteditable="false"></div>';
        return;
      }
      if (!t.trim()) return;
      const h = esc(t).replace(/\n/g, '<br>');
      if (first && t.length < 90) html += `<h1>${h}</h1>`;
      else html += `<p>${h}</p>`;
      first = false;
    };
    for (const ch of text) {
      if (ch === '\x07') {
        if (cur === '' && cellEnd) {
          rows.push(cells);
          cells = [];
          cellEnd = false;
        } else {
          cells.push(cur);
          cur = '';
          cellEnd = true;
        }
        continue;
      }
      cellEnd = false;
      if (ch === '\r') {
        if (cells.length) cur += '\n';
        else {
          para(cur);
          cur = '';
        }
        continue;
      }
      cur += ch;
    }
    if (cells.length) rows.push(cells);
    para(cur);
    flushList();
    flushTable();
    return html || '<p><br></p>';
  }

  /* --- PowerPoint 97–2003 (.ppt): slide text --- */
  function pptToDeck(buf) {
    const get = cfbOpen(buf);
    const d = get('PowerPoint Document');
    if (!d) throw new Error('this is not a PowerPoint 97–2003 file');
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    let aspect = 16 / 9;
    const slwt = [];
    const drawings = [];
    let curSlide = null,
      inSlwt = false,
      curType = 1,
      inSlideCont = null;
    const text16 = (o, l) => {
      let s = '';
      for (let i = 0; i + 1 < l; i += 2) s += String.fromCharCode(dv.getUint16(o + i, true));
      return s;
    };
    const text8 = (o, l) => {
      let s = '';
      for (let i = 0; i < l; i++) s += cp1252(d[o + i]);
      return s;
    };
    function walk(start, end, depth) {
      let p = start;
      while (p + 8 <= end) {
        const vi = dv.getUint16(p, true),
          type = dv.getUint16(p + 2, true),
          len = dv.getUint32(p + 4, true);
        const body = p + 8;
        if (body + len > end + 1 && len > 0) break;
        const container = (vi & 0xf) === 0xf,
          inst = vi >> 4;
        if (type === 0x03e9 && len >= 8) {
          const x = dv.getInt32(body, true),
            y = dv.getInt32(body + 4, true);
          if (x > 0 && y > 0) aspect = x / y;
        }
        if (type === 0x0ff0) {
          const was = inSlwt;
          inSlwt = inst === 0;
          walk(body, body + len, depth + 1);
          inSlwt = was;
          curSlide = null;
        } else if (type === 0x03ee) {
          const was = inSlideCont;
          inSlideCont = [];
          walk(body, body + len, depth + 1);
          drawings.push(inSlideCont);
          inSlideCont = was;
        } else if (container) walk(body, body + len, depth + 1);
        else if (inSlwt && type === 0x03f3) {
          curSlide = { parts: [] };
          slwt.push(curSlide);
        } else if (type === 0x0f9f) curType = dv.getUint32(body, true);
        else if (type === 0x0fa0 || type === 0x0fa8) {
          const t = (type === 0x0fa0 ? text16(body, len) : text8(body, len))
            .replace(/\r/g, '\n')
            .replace(/\x0b/g, '\n')
            .trim();
          if (t) {
            if (inSlwt && curSlide) curSlide.parts.push({ type: curType, t });
            else if (inSlideCont) inSlideCont.push({ type: curType, t });
          }
        }
        p = body + len;
      }
    }
    walk(0, d.length, 0);
    const count = Math.max(slwt.length, drawings.length);
    if (!count) throw new Error('no slides found');
    const W = 960,
      H = Math.round(W / aspect);
    const slides = [];
    for (let i = 0; i < count; i++) {
      const parts = [...(slwt[i]?.parts || [])];
      for (const x of drawings[i] || []) if (!parts.some((q) => q.t === x.t)) parts.push(x);
      let titleI = parts.findIndex((q) => q.type === 0 || q.type === 6);
      if (titleI < 0 && parts.length && parts[0].t.length < 120 && !parts[0].t.includes('\n')) titleI = 0;
      const title = titleI >= 0 ? parts.splice(titleI, 1)[0].t : '';
      const body = parts
        .filter((q) => q.type !== 2)
        .map((q) =>
          q.type === 1 || q.type === 7 || q.type === 8
            ? q.t
                .split('\n')
                .map((l) => (l.trim() ? '• ' + l : l))
                .join('\n')
            : q.t,
        )
        .join('\n');
      const els = [];
      if (title)
        els.push({
          id: uid(),
          type: 'box',
          x: 60,
          y: 30,
          w: W - 120,
          h: 90,
          text: title,
          fontSize: 40,
          color: '#1a1f25',
          bold: true,
          italic: false,
          underline: false,
          align: 'left',
          valign: 'middle',
          font: 'Arial',
          fill: '',
          stroke: '',
          strokeW: 0,
          shape: 'rect',
          opacity: 1,
          rot: 0,
        });
      if (body)
        els.push({
          id: uid(),
          type: 'box',
          x: 60,
          y: title ? 135 : 40,
          w: W - 120,
          h: H - (title ? 175 : 80),
          text: body,
          fontSize: 24,
          color: '#3a434d',
          bold: false,
          italic: false,
          underline: false,
          align: 'left',
          valign: 'top',
          font: 'Arial',
          fill: '',
          stroke: '',
          strokeW: 0,
          shape: 'rect',
          opacity: 1,
          rot: 0,
        });
      slides.push({
        id: uid(),
        bg: '#ffffff',
        bgImage: '',
        notes: parts
          .filter((q) => q.type === 2)
          .map((q) => q.t)
          .join('\n'),
        els,
      });
    }
    return { w: W, h: H, theme: 'paper', slides };
  }

  /* --- OpenDocument styles --- */
  function odStyles(...docs) {
    const m = {};
    for (const doc of docs)
      if (doc) for (const s of doc.getElementsByTagName('style:style')) m[s.getAttribute('style:name')] = s;
    return m;
  }
  function odCss(styleEl, styles, depth = 0) {
    if (!styleEl || depth > 5) return {};
    const parent = styleEl.getAttribute('style:parent-style-name');
    const base = parent ? odCss(styles[parent], styles, depth + 1) : {};
    const tp = styleEl.getElementsByTagName('style:text-properties')[0],
      pp = styleEl.getElementsByTagName('style:paragraph-properties')[0],
      gp =
        styleEl.getElementsByTagName('style:graphic-properties')[0] ||
        styleEl.getElementsByTagName('style:drawing-page-properties')[0];
    const o = { ...base };
    if (tp) {
      const g = (a) => tp.getAttribute(a);
      if (g('fo:font-weight')) o.bold = /bold|[6-9]00/.test(g('fo:font-weight'));
      if (g('fo:font-style')) o.italic = g('fo:font-style') === 'italic';
      if (g('style:text-underline-style')) o.underline = g('style:text-underline-style') !== 'none';
      if (g('style:text-line-through-style')) o.strike = g('style:text-line-through-style') !== 'none';
      if (g('fo:color')) o.color = g('fo:color');
      if (g('fo:font-size') && /pt$/.test(g('fo:font-size'))) o.size = parseFloat(g('fo:font-size'));
      if (g('style:font-name')) o.font = g('style:font-name');
      if (g('fo:background-color') && g('fo:background-color') !== 'transparent')
        o.bg = g('fo:background-color');
      if (g('style:text-position'))
        o.pos =
          /^super|^\d/.test(g('style:text-position')) && !/^-/.test(g('style:text-position')) ? 'sup' : 'sub';
    }
    if (pp) {
      const a = pp.getAttribute('fo:text-align');
      if (a)
        o.align = {
          start: 'left',
          end: 'right',
          center: 'center',
          justify: 'justify',
          left: 'left',
          right: 'right',
        }[a];
      if (pp.getAttribute('fo:break-before') === 'page') o.pageBreak = true;
    }
    if (gp) {
      if (gp.getAttribute('draw:fill') !== 'none' && gp.getAttribute('draw:fill-color'))
        o.fill = gp.getAttribute('draw:fill-color');
      if (gp.getAttribute('draw:fill') === 'none') o.fill = '';
      if (gp.getAttribute('draw:stroke') && gp.getAttribute('draw:stroke') !== 'none') {
        o.stroke = gp.getAttribute('svg:stroke-color') || '#000000';
        o.strokeW = parseLen(gp.getAttribute('svg:stroke-width') || '0.03cm') || 1;
      }
      if (gp.getAttribute('draw:textarea-vertical-align'))
        o.valign = { top: 'top', middle: 'middle', bottom: 'bottom' }[
          gp.getAttribute('draw:textarea-vertical-align')
        ];
    }
    return o;
  }
  const parseLen = (v) => {
    if (!v) return 0;
    const n = parseFloat(v);
    return v.endsWith('cm')
      ? n * 37.795
      : v.endsWith('mm')
        ? n * 3.7795
        : v.endsWith('in')
          ? n * 96
          : v.endsWith('pt')
            ? (n * 4) / 3
            : v.endsWith('pc')
              ? n * 16
              : n;
  };
  const cssOf = (o) =>
    [
      o.bold && 'font-weight:bold',
      o.italic && 'font-style:italic',
      o.underline && 'text-decoration:underline',
      o.strike && 'text-decoration:line-through',
      o.color && `color:${o.color}`,
      o.size && `font-size:${Math.round((o.size * 4) / 3)}px`,
      o.bg && `background-color:${o.bg}`,
      o.font && `font-family:'${o.font}'`,
    ]
      .filter(Boolean)
      .join(';');

  /* --- OpenDocument text (.odt) → HTML --- */
  async function odtToHtml(buf) {
    const zip = await JSZip.loadAsync(buf);
    const cx = zip.file('content.xml');
    if (!cx) throw new Error('this is not an OpenDocument file');
    const content = xml(await cx.async('string'));
    const sx = zip.file('styles.xml');
    const stylesDoc = sx ? xml(await sx.async('string')) : null;
    const styles = odStyles(stylesDoc, content);
    const listStyles = {};
    for (const d of [stylesDoc, content])
      if (d)
        for (const l of d.getElementsByTagName('text:list-style'))
          listStyles[l.getAttribute('style:name')] = !!l.getElementsByTagName(
            'text:list-level-style-number',
          )[0];
    const imgs = [];
    async function conv(n, listOrdered) {
      if (n.nodeType === 3) return esc(n.nodeValue);
      if (n.nodeType !== 1) return '';
      const t = n.tagName;
      const inner = async (lo) => {
        let s = '';
        for (const c of n.childNodes) s += await conv(c, lo);
        return s;
      };
      const st = odCss(styles[n.getAttribute('text:style-name')], styles);
      switch (t) {
        case 'text:h': {
          const lv = Math.min(6, +(n.getAttribute('text:outline-level') || 1));
          return `${st.pageBreak ? '<div class="page-break" contenteditable="false"></div>' : ''}<h${lv}${st.align ? ` style="text-align:${st.align}"` : ''}>${await inner()}</h${lv}>`;
        }
        case 'text:p': {
          const s = await inner();
          return `${st.pageBreak ? '<div class="page-break" contenteditable="false"></div>' : ''}<p${st.align ? ` style="text-align:${st.align}"` : ''}>${s || '<br>'}</p>`;
        }
        case 'text:span': {
          const css = cssOf(st);
          const s = await inner();
          const w =
            st.pos === 'sup' ? ['<sup>', '</sup>'] : st.pos === 'sub' ? ['<sub>', '</sub>'] : ['', ''];
          return css ? `${w[0]}<span style="${css}">${s}</span>${w[1]}` : w[0] + s + w[1];
        }
        case 'text:a':
          return `<a href="${esc(n.getAttribute('xlink:href') || '#')}">${await inner()}</a>`;
        case 'text:line-break':
          return '<br>';
        case 'text:tab':
          return '&emsp;';
        case 'text:s':
          return '&nbsp;'.repeat(+(n.getAttribute('text:c') || 1));
        case 'text:list': {
          const nm = n.getAttribute('text:style-name');
          const ord = nm ? !!listStyles[nm] : listOrdered;
          return `<${ord ? 'ol' : 'ul'}>${await inner(ord)}</${ord ? 'ol' : 'ul'}>`;
        }
        case 'text:list-item':
        case 'text:list-header': {
          let s = '';
          for (const c of n.childNodes)
            s +=
              c.tagName === 'text:p' || c.tagName === 'text:h'
                ? await inner2(c, listOrdered)
                : await conv(c, listOrdered);
          return `<li>${s}</li>`;
        }
        case 'table:table':
          return `<table><tbody>${await inner()}</tbody></table>`;
        case 'table:table-header-rows':
        case 'table:table-rows':
        case 'table:table-row-group':
          return inner();
        case 'table:table-row':
          return `<tr>${await inner()}</tr>`;
        case 'table:table-cell': {
          const span = n.getAttribute('table:number-columns-spanned');
          return `<td${span && span !== '1' ? ` colspan="${span}"` : ''}>${(await inner()) || '<br>'}</td>`;
        }
        case 'table:covered-table-cell':
        case 'table:table-column':
        case 'table:table-columns':
        case 'text:soft-page-break':
        case 'office:annotation':
        case 'text:tracked-changes':
        case 'text:sequence-decls':
        case 'office:forms':
        case 'text:note-citation':
          return '';
        case 'text:note':
          return '';
        case 'draw:frame': {
          const im = n.getElementsByTagName('draw:image')[0];
          if (im) {
            const src = await zipImage(zip, im.getAttribute('xlink:href') || '');
            const w = parseLen(n.getAttribute('svg:width'));
            return src
              ? `<img src="${src}"${w ? ` style="width:${Math.round(w)}px;max-width:100%"` : ''} alt="">`
              : '';
          }
          return inner();
        }
        default:
          return inner(listOrdered);
      }
    }
    async function inner2(p, lo) {
      let s = '';
      for (const c of p.childNodes) s += await conv(c, lo);
      return s;
    }
    const body = content.getElementsByTagName('office:text')[0];
    if (!body) throw new Error('no text body found');
    let out = '';
    for (const c of body.childNodes) out += await conv(c, false);
    return out || '<p><br></p>';
  }

  /* --- OpenDocument presentation (.odp) → deck --- */
  async function odpToDeck(buf) {
    const zip = await JSZip.loadAsync(buf);
    const content = xml(await zip.file('content.xml').async('string'));
    const sx = zip.file('styles.xml');
    const stylesDoc = sx ? xml(await sx.async('string')) : null;
    const styles = odStyles(stylesDoc, content);
    let pw = 28 * 37.795,
      ph = 15.75 * 37.795;
    const pl = stylesDoc && stylesDoc.getElementsByTagName('style:page-layout-properties')[0];
    if (pl && pl.getAttribute('fo:page-width')) {
      pw = parseLen(pl.getAttribute('fo:page-width'));
      ph = parseLen(pl.getAttribute('fo:page-height'));
    }
    const k = 960 / pw,
      W = 960,
      H = Math.round(ph * k);
    const textOf = (n) => {
      const lines = [];
      const walk = (x, bullet) => {
        for (const c of x.children) {
          if (c.tagName === 'text:p' || c.tagName === 'text:h')
            lines.push((bullet ? '• ' : '') + c.textContent);
          else if (c.tagName === 'text:list') walk(c, true);
          else walk(c, bullet);
        }
      };
      walk(n, false);
      return lines.join('\n');
    };
    const firstText = (n) => {
      const sp = n.getElementsByTagName('text:span')[0],
        p = n.getElementsByTagName('text:p')[0];
      return {
        ...odCss(styles[p?.getAttribute('text:style-name')], styles),
        ...odCss(styles[sp?.getAttribute('text:style-name')], styles),
      };
    };
    const slides = [];
    for (const page of content.getElementsByTagName('draw:page')) {
      const pst = odCss(styles[page.getAttribute('draw:style-name')], styles);
      const s = { id: uid(), bg: pst.fill || '#ffffff', bgImage: '', notes: '', els: [] };
      const notes = page.getElementsByTagName('presentation:notes')[0];
      if (notes) s.notes = textOf(notes);
      for (const n of page.children) {
        if (n.tagName === 'presentation:notes' || n.tagName === 'office:forms') continue;
        const g = {
          x: parseLen(n.getAttribute('svg:x')) * k,
          y: parseLen(n.getAttribute('svg:y')) * k,
          w: parseLen(n.getAttribute('svg:width')) * k,
          h: parseLen(n.getAttribute('svg:height')) * k,
          rot: 0,
        };
        const gs = odCss(
          styles[n.getAttribute('draw:style-name')] || styles[n.getAttribute('presentation:style-name')],
          styles,
        );
        const cls = n.getAttribute('presentation:class') || '';
        const isTitle = /title/.test(cls) && cls !== 'subtitle';
        if (n.tagName === 'draw:frame') {
          const im = n.getElementsByTagName('draw:image')[0];
          const tb = n.getElementsByTagName('draw:text-box')[0];
          if (im && !tb) {
            const src = await zipImage(zip, im.getAttribute('xlink:href') || '');
            if (src) s.els.push({ id: uid(), type: 'image', ...g, src, opacity: 1 });
            continue;
          }
          if (tb) {
            const txt = textOf(tb);
            if (!txt.trim()) continue;
            const ft = firstText(tb);
            s.els.push(box(g, txt, ft, gs, isTitle ? 40 : cls === 'subtitle' ? 24 : 20, isTitle));
          }
        } else if (['draw:custom-shape', 'draw:rect', 'draw:ellipse'].includes(n.tagName)) {
          const geo =
            n.getElementsByTagName('draw:enhanced-geometry')[0]?.getAttribute('draw:type') ||
            (n.tagName === 'draw:ellipse' ? 'ellipse' : 'rect');
          const ft = firstText(n);
          const b = box(g, textOf(n), ft, gs, 18, false);
          b.fill = gs.fill ?? '#729fcf';
          b.shape = /ellipse|circle/.test(geo)
            ? 'ellipse'
            : /round/.test(geo)
              ? 'roundRect'
              : /triangle/.test(geo)
                ? 'triangle'
                : 'rect';
          b.align = 'center';
          b.valign = 'middle';
          s.els.push(b);
        } else if (n.tagName === 'draw:line') {
          const x1 = parseLen(n.getAttribute('svg:x1')) * k,
            y1 = parseLen(n.getAttribute('svg:y1')) * k,
            x2 = parseLen(n.getAttribute('svg:x2')) * k,
            y2 = parseLen(n.getAttribute('svg:y2')) * k;
          s.els.push({
            id: uid(),
            type: 'box',
            x: Math.min(x1, x2),
            y: Math.min(y1, y2),
            w: Math.max(2, Math.hypot(x2 - x1, y2 - y1)),
            h: 2,
            rot: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI,
            shape: 'line',
            stroke: gs.stroke || '#000000',
            strokeW: gs.strokeW || 2,
            text: '',
            fill: '',
            fontSize: 18,
            color: '#000',
            font: 'Arial',
            align: 'left',
            valign: 'top',
            opacity: 1,
          });
        }
      }
      slides.push(s);
    }
    if (!slides.length) throw new Error('no slides found');
    function box(g, text, ft, gs, defSize, bold) {
      return {
        id: uid(),
        type: 'box',
        ...g,
        text,
        fontSize: Math.round((((ft.size || defSize) * 4) / 3) * k * 10) / 10,
        color: ft.color || '#1a1f25',
        bold: ft.bold ?? bold,
        italic: !!ft.italic,
        underline: !!ft.underline,
        align: ft.align || 'left',
        valign: gs.valign || (bold ? 'middle' : 'top'),
        font: ft.font || 'Arial',
        fill: gs.fill || '',
        stroke: gs.stroke || '',
        strokeW: gs.stroke ? gs.strokeW : 0,
        shape: 'rect',
        opacity: 1,
      };
    }
    return { w: W, h: H, theme: 'paper', slides };
  }

  /* --- RTF → HTML --- */
  function rtfToHtml(rtf) {
    if (!rtf.startsWith('{\\rtf')) throw new Error('this is not an RTF file');
    const SKIP = new Set([
      'fonttbl',
      'colortbl',
      'stylesheet',
      'info',
      'pict',
      'object',
      'header',
      'footer',
      'headerl',
      'headerr',
      'headerf',
      'footerl',
      'footerr',
      'footerf',
      'footnote',
      'themedata',
      'colorschememapping',
      'latentstyles',
      'datastore',
      'xmlnstbl',
      'listtable',
      'listoverridetable',
      'rsidtbl',
      'generator',
      'fldinst',
      'bkmkstart',
      'bkmkend',
      'pgdsctbl',
      'filetbl',
      'revtbl',
      'listtext',
      'pntext',
      'shp',
      'nonshppict',
      'blipuid',
      'mmathPr',
      'wgrffmtfilter',
      'docvar',
      'xe',
      'tc',
      'atnid',
      'annotation',
    ]);
    const colors = [];
    const ct = /\{\\colortbl;?([^}]*)\}/.exec(rtf);
    if (ct)
      ct[1].split(';').forEach((c) => {
        const m = /\\red(\d+)\\green(\d+)\\blue(\d+)/.exec(c);
        colors.push(m ? `rgb(${m[1]},${m[2]},${m[3]})` : null);
      });
    let st = { b: 0, i: 0, u: 0, s: 0, skip: 0, uc: 1, cf: 0, fs: 0, sup: 0, sub: 0 };
    const stack = [];
    let html = '',
      para = '',
      align = '',
      pendingSkip = 0,
      cells = [],
      rows = [],
      inTable = false,
      paraFs = 0;
    const run = (t) => {
      if (!t || st.skip) return;
      if (t.trim() && st.fs > paraFs) paraFs = st.fs;
      let h = esc(t);
      if (st.b) h = `<b>${h}</b>`;
      if (st.i) h = `<i>${h}</i>`;
      if (st.u) h = `<u>${h}</u>`;
      if (st.s) h = `<s>${h}</s>`;
      if (st.sup) h = `<sup>${h}</sup>`;
      if (st.sub) h = `<sub>${h}</sub>`;
      const css = [
        st.cf && colors[st.cf] ? `color:${colors[st.cf]}` : '',
        st.fs && st.fs !== 24 ? `font-size:${Math.round(((st.fs / 2) * 4) / 3)}px` : '',
      ]
        .filter(Boolean)
        .join(';');
      if (css) h = `<span style="${css}">${h}</span>`;
      para += h;
    };
    const flushTable = () => {
      if (rows.length) {
        html +=
          '<table><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => `<td>${c || '<br>'}</td>`).join('') + '</tr>').join('') +
          '</tbody></table>';
        rows = [];
      }
    };
    const endPara = () => {
      if (inTable) {
        return;
      }
      flushTable();
      const tag = paraFs >= 40 ? 'h1' : paraFs >= 32 ? 'h2' : paraFs >= 28 ? 'h3' : 'p';
      if (tag !== 'p')
        para = para
          .replace(/<span style="font-size:\d+px">([\s\S]*)<\/span>/, '$1')
          .replace(/^<b>([\s\S]*)<\/b>$/, '$1');
      html += `<${tag}${align ? ` style="text-align:${align}"` : ''}>${para || '<br>'}</${tag}>`;
      para = '';
      paraFs = 0;
    };
    let i = 0;
    const L = rtf.length;
    while (i < L) {
      const c = rtf[i];
      if (c === '{') {
        stack.push({ ...st });
        i++;
        if (rtf[i] === '\\' && rtf[i + 1] === '*') {
          st.skip = 1;
          i += 2;
        }
        continue;
      }
      if (c === '}') {
        st = stack.pop() || st;
        i++;
        continue;
      }
      if (c === '\\') {
        const nx = rtf[i + 1];
        if (nx === '\\' || nx === '{' || nx === '}') {
          run(nx);
          i += 2;
          continue;
        }
        if (nx === "'") {
          const code = parseInt(rtf.substr(i + 2, 2), 16);
          if (pendingSkip > 0) pendingSkip--;
          else run(cp1252(code));
          i += 4;
          continue;
        }
        if (nx === '~') {
          run('\u00a0');
          i += 2;
          continue;
        }
        if (nx === '-' || nx === '_') {
          i += 2;
          continue;
        }
        if (nx === '\n' || nx === '\r') {
          endPara();
          i += 2;
          continue;
        }
        const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40));
        if (!m) {
          i++;
          continue;
        }
        i += m[0].length;
        const w = m[1],
          n = m[2] != null ? +m[2] : null;
        if (SKIP.has(w)) {
          st.skip = 1;
          continue;
        }
        switch (w) {
          case 'par':
          case 'sect':
            endPara();
            break;
          case 'line':
            para += '<br>';
            break;
          case 'tab':
            run('\t');
            break;
          case 'page':
            endPara();
            html += '<div class="page-break" contenteditable="false"></div>';
            break;
          case 'b':
            st.b = n !== 0;
            break;
          case 'i':
            st.i = n !== 0;
            break;
          case 'ul':
            st.u = n !== 0;
            break;
          case 'ulnone':
            st.u = 0;
            break;
          case 'strike':
            st.s = n !== 0;
            break;
          case 'super':
            st.sup = 1;
            break;
          case 'sub':
            st.sub = 1;
            break;
          case 'nosupersub':
            st.sup = st.sub = 0;
            break;
          case 'plain':
            Object.assign(st, { b: 0, i: 0, u: 0, s: 0, cf: 0, fs: 0, sup: 0, sub: 0 });
            break;
          case 'cf':
            st.cf = n || 0;
            break;
          case 'fs':
            st.fs = n || 24;
            break;
          case 'pard':
            align = '';
            inTable = false;
            break;
          case 'qc':
            align = 'center';
            break;
          case 'qr':
            align = 'right';
            break;
          case 'qj':
            align = 'justify';
            break;
          case 'ql':
            align = '';
            break;
          case 'intbl':
            inTable = true;
            break;
          case 'cell':
            cells.push(para);
            para = '';
            break;
          case 'row':
            rows.push(cells);
            cells = [];
            inTable = false;
            break;
          case 'trowd':
            inTable = true;
            break;
          case 'u': {
            let cp = n < 0 ? n + 65536 : n;
            run(String.fromCharCode(cp));
            pendingSkip = st.uc;
            while (pendingSkip > 0 && i < L) {
              if (rtf[i] === '\\' && rtf[i + 1] === "'") {
                i += 4;
              } else if (rtf[i] === '\\' || rtf[i] === '{' || rtf[i] === '}') break;
              else i++;
              pendingSkip--;
            }
            pendingSkip = 0;
            break;
          }
          case 'uc':
            st.uc = n ?? 1;
            break;
          case 'emdash':
            run('—');
            break;
          case 'endash':
            run('–');
            break;
          case 'bullet':
            run('•');
            break;
          case 'lquote':
            run('‘');
            break;
          case 'rquote':
            run('’');
            break;
          case 'ldblquote':
            run('“');
            break;
          case 'rdblquote':
            run('”');
            break;
        }
        continue;
      }
      if (c === '\r' || c === '\n') {
        i++;
        continue;
      }
      let j = i;
      while (j < L && !'\\{}\r\n'.includes(rtf[j])) j++;
      run(rtf.slice(i, j));
      i = j;
    }
    if (para) endPara();
    flushTable();
    return html || '<p><br></p>';
  }

  /* --- EPUB → HTML --- */
  async function epubToHtml(buf) {
    const zip = await JSZip.loadAsync(buf);
    const cont = zip.file('META-INF/container.xml');
    if (!cont) throw new Error('this is not an EPUB file');
    const opfPath = xml(await cont.async('string'))
      .getElementsByTagName('rootfile')[0]
      .getAttribute('full-path');
    const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const opf = xml(await zip.file(opfPath).async('string'));
    const man = {};
    for (const it of opf.getElementsByTagName('item')) man[it.getAttribute('id')] = it.getAttribute('href');
    const title = opf.getElementsByTagName('dc:title')[0]?.textContent || '';
    const norm = (p) => {
      const out = [];
      for (const s of p.split('/')) {
        if (s === '..') out.pop();
        else if (s && s !== '.') out.push(s);
      }
      return out.join('/');
    };
    let html = title ? `<h1>${esc(title)}</h1>` : '';
    for (const ref of opf.getElementsByTagName('itemref')) {
      const href = man[ref.getAttribute('idref')];
      if (!href) continue;
      const path = norm(dir + decodeURIComponent(href.split('#')[0]));
      const f = zip.file(path);
      if (!f) continue;
      const d = new DOMParser().parseFromString(await f.async('string'), 'text/html');
      const base = path.slice(0, path.lastIndexOf('/') + 1);
      for (const im of d.querySelectorAll('img, image')) {
        const src = im.getAttribute('src') || im.getAttribute('xlink:href') || im.getAttribute('href');
        if (!src) continue;
        const data = await zipImage(zip, norm(base + decodeURIComponent(src)));
        if (data) {
          const n = d.createElement('img');
          n.src = data;
          n.alt = im.getAttribute('alt') || '';
          (im.tagName.toLowerCase() === 'image' ? im.closest('svg') || im : im).replaceWith(n);
        }
      }
      d.querySelectorAll('a[href]').forEach((a) => {
        if (!/^https?:/.test(a.getAttribute('href'))) a.removeAttribute('href');
      });
      html += (html ? '<div class="page-break" contenteditable="false"></div>' : '') + d.body.innerHTML;
    }
    return html;
  }

  /* --- iWork (.pages/.key/.numbers): embedded preview --- */
  async function iworkPreview(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const pdf = zip.file('QuickLook/Preview.pdf') || zip.file(/Preview\.pdf$/i)[0];
    if (pdf)
      return new File([await pdf.async('blob')], base(file.name) + '.pdf', { type: 'application/pdf' });
    const jpg =
      zip.file('preview.jpg') || zip.file('QuickLook/Thumbnail.jpg') || zip.file(/preview.*\.jpe?g$/i)[0];
    if (jpg) return new File([await jpg.async('blob')], base(file.name) + '.jpg', { type: 'image/jpeg' });
    throw new Error(
      'this Apple iWork file has no embedded preview. Export it from Pages, Keynote or Numbers as .docx, .pptx or .xlsx.',
    );
  }

  /* --- images the browser can't decode natively --- */
  async function decodeImage(file) {
    // → canvas or image element
    const e = ext(file.name);
    if (e === 'heic' || e === 'heif') {
      await loadScript('vendor/heic2any.min.js');
      let out = await window.heic2any({ blob: file, toType: 'image/png' });
      if (Array.isArray(out)) out = out[0];
      return loadImg(await blobToDataURL(out));
    }
    if (e === 'tif' || e === 'tiff') {
      await loadScript('vendor/pako.min.js');
      await loadScript('vendor/UTIF.js');
      const buf = await file.arrayBuffer();
      const ifds = UTIF.decode(buf);
      const page = ifds.find((f) => f.width && f.height) || ifds[0];
      UTIF.decodeImage(buf, page);
      const rgba = UTIF.toRGBA8(page);
      const c = el('canvas', { width: page.width, height: page.height });
      c.getContext('2d').putImageData(
        new ImageData(
          new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, page.width * page.height * 4),
          page.width,
          page.height,
        ),
        0,
        0,
      );
      return c;
    }
    if (e === 'svg' || file.type === 'image/svg+xml') {
      const txt = await readAs(file, 'text');
      const doc = xml(txt);
      const svg = doc.documentElement;
      let w = parseFloat(svg.getAttribute('width')),
        h = parseFloat(svg.getAttribute('height'));
      const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      if (!(w > 0 && h > 0) && vb.length === 4) {
        w = vb[2];
        h = vb[3];
      }
      if (!(w > 0 && h > 0)) {
        w = 1024;
        h = 1024;
      }
      const k = Math.max(1, 1600 / Math.max(w, h));
      svg.setAttribute('width', w * k);
      svg.setAttribute('height', h * k);
      const im = await loadImg(
        'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(doc)),
      );
      const c = el('canvas', { width: Math.round(w * k), height: Math.round(h * k) });
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      return c;
    }
    try {
      return await loadImg(await readAs(file, 'url'));
    } catch {
      throw new Error(`this browser cannot decode .${e} images`);
    }
  }

  /* --- HTML → OpenDocument text (.odt) --- */
  async function htmlToOdt(root, title) {
    const zip = new JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
    const auto = new Map();
    let imgN = 0;
    const pics = [];
    const x = (s) =>
      String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const tstyle = (f) => {
      const k = JSON.stringify(f);
      if (!auto.has(k)) auto.set(k, { name: 'T' + (auto.size + 1), f, fam: 'text' });
      return auto.get(k).name;
    };
    const pstyle = (a) => {
      const k = 'P' + a;
      if (!auto.has(k)) auto.set(k, { name: 'PA' + (auto.size + 1), align: a, fam: 'paragraph' });
      return auto.get(k).name;
    };
    function inl(n, f) {
      if (n.nodeType === 3) {
        const t = x(n.nodeValue.replace(/\s+/g, ' '));
        const has = Object.keys(f).length;
        return has ? `<text:span text:style-name="${tstyle(f)}">${t}</text:span>` : t;
      }
      if (n.nodeType !== 1) return '';
      const t = n.tagName;
      const g = { ...f };
      if (t === 'BR') return '<text:line-break/>';
      if (t === 'IMG') {
        const src = n.getAttribute('src') || '';
        const m = /^data:image\/(png|jpeg|gif);base64,/.exec(src);
        if (!m) return '';
        const name = `Pictures/img${++imgN}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
        pics.push([name, src.split(',')[1], 'image/' + m[1]]);
        const w = Math.min(n.offsetWidth || n.naturalWidth || 300, 620),
          h = (w * (n.naturalHeight || 200)) / (n.naturalWidth || 300);
        return `<draw:frame draw:name="img${imgN}" text:anchor-type="as-char" svg:width="${(w / 96).toFixed(3)}in" svg:height="${(h / 96).toFixed(3)}in"><draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`;
      }
      if (/^(B|STRONG|TH)$/.test(t)) g.b = 1;
      if (/^(I|EM)$/.test(t)) g.i = 1;
      if (t === 'U') g.u = 1;
      if (/^(S|DEL|STRIKE)$/.test(t)) g.s = 1;
      if (t === 'CODE') g.mono = 1;
      if (t === 'SUP') g.sup = 1;
      if (t === 'SUB') g.sub = 1;
      const st = n.style;
      if (st) {
        if (st.fontWeight === 'bold' || +st.fontWeight >= 600) g.b = 1;
        if (st.fontStyle === 'italic') g.i = 1;
        const c = toHex(st.color);
        if (c) g.c = c;
        const bg = toHex(st.backgroundColor);
        if (bg) g.bg = bg;
        if (st.fontSize && /px$/.test(st.fontSize)) g.sz = Math.round(parseFloat(st.fontSize) * 0.75);
      }
      if (t === 'FONT' && n.getAttribute('color')) {
        const c = toHex(n.getAttribute('color'));
        if (c) g.c = c;
      }
      const inner = [...n.childNodes].map((c) => inl(c, g)).join('');
      if (t === 'A' && n.getAttribute('href'))
        return `<text:a xlink:type="simple" xlink:href="${x(n.getAttribute('href'))}">${inner}</text:a>`;
      return inner;
    }
    const BL = /^(P|DIV|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|PRE|HR|NAV|SECTION|ARTICLE|FIGURE)$/;
    function blocks(parent) {
      let out = '',
        buf = [];
      const flush = () => {
        if (buf.length) {
          const s = buf.map((n) => inl(n, {})).join('');
          if (s.trim()) out += `<text:p>${s}</text:p>`;
          buf = [];
        }
      };
      for (const n of parent.childNodes) {
        if (n.nodeType === 1 && (BL.test(n.tagName) || n.classList.contains('page-break'))) {
          flush();
          out += block(n);
        } else if (n.nodeType === 3 && !n.nodeValue.trim() && !buf.length) continue;
        else buf.push(n);
      }
      flush();
      return out;
    }
    function block(n) {
      const t = n.tagName;
      const a = n.style && n.style.textAlign;
      const ps = a && a !== 'left' ? ` text:style-name="${pstyle(a)}"` : '';
      if (n.classList.contains('page-break')) return '<text:p text:style-name="PageBreak"/>';
      if (/^H[1-6]$/.test(t))
        return `<text:h text:style-name="Heading_20_${t[1]}" text:outline-level="${t[1]}">${inl(n, {})}</text:h>`;
      if (t === 'UL' || t === 'OL')
        return (
          `<text:list text:style-name="${t === 'OL' ? 'LNum' : 'LBul'}">` +
          [...n.children]
            .map((li) => {
              const sub = [...li.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
              const own = [...li.childNodes].filter((c) => !sub.includes(c));
              return `<text:list-item><text:p>${own.map((c) => inl(c, {})).join('')}</text:p>${sub.map(block).join('')}</text:list-item>`;
            })
            .join('') +
          '</text:list>'
        );
      if (t === 'TABLE') {
        const rows = [...n.querySelectorAll('tr')].filter((r) => r.closest('table') === n);
        const cols = Math.max(1, ...rows.map((r) => r.children.length));
        return (
          `<table:table table:style-name="Tbl"><table:table-column table:number-columns-repeated="${cols}"/>` +
          rows
            .map(
              (r) =>
                '<table:table-row>' +
                [...r.children]
                  .map(
                    (c) =>
                      `<table:table-cell table:style-name="Cell" office:value-type="string">${blocks(c) || '<text:p/>'}</table:table-cell>`,
                  )
                  .join('') +
                '</table:table-row>',
            )
            .join('') +
          '</table:table>'
        );
      }
      if (t === 'HR') return '<text:p text:style-name="HR"/>';
      if (t === 'PRE')
        return n.textContent
          .split('\n')
          .map((l) => `<text:p text:style-name="Code">${x(l).replace(/ {2}/g, ' <text:s/>')}</text:p>`)
          .join('');
      if (t === 'BLOCKQUOTE') return blocks(n).replace(/<text:p>/g, '<text:p text:style-name="Quote">');
      if ([...n.children].some((c) => BL.test(c.tagName))) return blocks(n);
      return `<text:p${ps}>${inl(n, {})}</text:p>`;
    }
    const body = blocks(root);
    const autoXml = [...auto.values()]
      .map((s) =>
        s.fam === 'text'
          ? `<style:style style:name="${s.name}" style:family="text"><style:text-properties${s.f.b ? ' fo:font-weight="bold"' : ''}${s.f.i ? ' fo:font-style="italic"' : ''}${s.f.u ? ' style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"' : ''}${s.f.s ? ' style:text-line-through-style="solid"' : ''}${s.f.c ? ` fo:color="#${s.f.c}"` : ''}${s.f.bg ? ` fo:background-color="#${s.f.bg}"` : ''}${s.f.sz ? ` fo:font-size="${s.f.sz}pt"` : ''}${s.f.mono ? ' style:font-name="Courier New"' : ''}${s.f.sup ? ' style:text-position="super 58%"' : s.f.sub ? ' style:text-position="sub 58%"' : ''}/></style:style>`
          : `<style:style style:name="${s.name}" style:family="paragraph"><style:paragraph-properties fo:text-align="${{ center: 'center', right: 'end', justify: 'justify' }[s.align] || 'start'}"/></style:style>`,
      )
      .join('');
    const NS =
      'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3"';
    const lists = `<text:list-style style:name="LBul">${[1, 2, 3, 4, 5].map((l) => `<text:list-level-style-bullet text:level="${l}" text:bullet-char="•"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.25in" fo:margin-left="${l * 0.35}in"/></style:list-level-properties></text:list-level-style-bullet>`).join('')}</text:list-style><text:list-style style:name="LNum">${[1, 2, 3, 4, 5].map((l) => `<text:list-level-style-number text:level="${l}" style:num-suffix="." style:num-format="${['1', 'a', 'i', '1', 'a'][l - 1]}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.25in" fo:margin-left="${l * 0.35}in"/></style:list-level-properties></text:list-level-style-number>`).join('')}</text:list-style>`;
    zip.file(
      'content.xml',
      `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}><office:automatic-styles>${autoXml}<style:style style:name="PageBreak" style:family="paragraph"><style:paragraph-properties fo:break-before="page"/></style:style><style:style style:name="HR" style:family="paragraph"><style:paragraph-properties fo:border-bottom="0.5pt solid #b5bdc5" fo:padding-bottom="2pt"/></style:style><style:style style:name="Tbl" style:family="table"><style:table-properties style:width="6.5in" table:align="margins"/></style:style><style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:padding="0.04in" fo:border="0.5pt solid #9aa4ae"/></style:style>${lists}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`,
    );
    const hd = [1, 2, 3, 4, 5, 6]
      .map(
        (l) =>
          `<style:style style:name="Heading_20_${l}" style:display-name="Heading ${l}" style:family="paragraph" style:parent-style-name="Standard" style:default-outline-level="${l}"><style:paragraph-properties fo:margin-top="0.17in" fo:margin-bottom="0.08in" fo:keep-with-next="always"/><style:text-properties style:font-name="Arial" fo:font-family="Arial" fo:font-size="${[22, 17, 14, 12, 11, 10][l - 1]}pt" fo:font-weight="bold"/></style:style>`,
      )
      .join('');
    zip.file(
      'styles.xml',
      `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS}><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.08in" fo:line-height="130%"/><style:text-properties style:font-name="Georgia" fo:font-family="Georgia" fo:font-size="12pt"/></style:default-style><style:style style:name="Standard" style:family="paragraph"/>${hd}<style:style style:name="Quote" style:family="paragraph"><style:paragraph-properties fo:margin-left="0.4in" fo:border-left="1.5pt solid #9aa4ae" fo:padding-left="0.1in"/><style:text-properties fo:color="#4a525a"/></style:style><style:style style:name="Code" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0in" fo:background-color="#f2f4f6"/><style:text-properties style:font-name="Courier New" fo:font-family="'Courier New'" fo:font-size="10pt"/></style:style></office:styles></office:document-styles>`,
    );
    zip.file(
      'meta.xml',
      `<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${NS}><office:meta><dc:title>${x(title)}</dc:title><meta:generator>Offline Office</meta:generator></office:meta></office:document-meta>`,
    );
    pics.forEach(([p, b64]) => zip.file(p, b64, { base64: true }));
    zip.file(
      'META-INF/manifest.xml',
      `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${pics.map(([p, , m]) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="${m}"/>`).join('')}</manifest:manifest>`,
    );
    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.oasis.opendocument.text',
      compression: 'DEFLATE',
    });
  }

  /* --- HTML → RTF --- */
  function htmlToRtf(root) {
    const colors = ['000000'];
    const ci = (h) => {
      let i = colors.indexOf(h);
      if (i < 0) {
        colors.push(h);
        i = colors.length - 1;
      }
      return i + 1;
    };
    const enc = (s) =>
      s
        .replace(/[\\{}]/g, (m) => '\\' + m)
        .replace(/[^\x00-\x7f]/g, (ch) => `\\u${((c) => (c > 32767 ? c - 65536 : c))(ch.charCodeAt(0))}?`)
        .replace(/\n/g, ' ');
    function inl(n) {
      if (n.nodeType === 3) return enc(n.nodeValue.replace(/\s+/g, ' '));
      if (n.nodeType !== 1) return '';
      const t = n.tagName,
        inner = () => [...n.childNodes].map(inl).join('');
      if (t === 'BR') return '\\line ';
      if (t === 'IMG') return '';
      let pre = '',
        post = '';
      if (/^(B|STRONG|TH)$/.test(t) || n.style?.fontWeight === 'bold' || +n.style?.fontWeight >= 600) {
        pre += '\\b ';
        post = '\\b0 ' + post;
      }
      if (/^(I|EM)$/.test(t) || n.style?.fontStyle === 'italic') {
        pre += '\\i ';
        post = '\\i0 ' + post;
      }
      if (t === 'U') {
        pre += '\\ul ';
        post = '\\ulnone ' + post;
      }
      if (/^(S|DEL|STRIKE)$/.test(t)) {
        pre += '\\strike ';
        post = '\\strike0 ' + post;
      }
      if (t === 'SUP') {
        pre += '\\super ';
        post = '\\nosupersub ' + post;
      }
      if (t === 'SUB') {
        pre += '\\sub ';
        post = '\\nosupersub ' + post;
      }
      const c = toHex(n.style?.color || (t === 'FONT' && n.getAttribute('color')));
      if (c) {
        pre += `\\cf${ci(c)} `;
        post = '\\cf0 ' + post;
      }
      const fs =
        n.style?.fontSize && /px$/.test(n.style.fontSize)
          ? Math.round(parseFloat(n.style.fontSize) * 1.5)
          : 0;
      if (fs) {
        pre += `\\fs${fs} `;
        post = '\\fs24 ' + post;
      }
      if (t === 'A' && n.getAttribute('href'))
        return `{\\field{\\*\\fldinst HYPERLINK "${enc(n.getAttribute('href'))}"}{\\fldrslt \\ul\\cf${ci('1F56B8')} ${inner()}\\ulnone\\cf0 }}`;
      return `{${pre}${inner()}${post}}`;
    }
    const BL = /^(P|DIV|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|PRE|HR|NAV|SECTION)$/;
    function blocks(parent, li = 0) {
      let out = '',
        buf = [];
      const flush = () => {
        if (buf.length) {
          const s = buf.map(inl).join('');
          if (s.trim()) out += `\\pard ${s}\\par\n`;
          buf = [];
        }
      };
      for (const n of parent.childNodes) {
        if (n.nodeType === 1 && (BL.test(n.tagName) || n.classList.contains('page-break'))) {
          flush();
          out += block(n, li);
        } else if (!(n.nodeType === 3 && !n.nodeValue.trim())) buf.push(n);
      }
      flush();
      return out;
    }
    function block(n, li) {
      const t = n.tagName,
        al = { center: '\\qc', right: '\\qr', justify: '\\qj' }[n.style?.textAlign] || '';
      if (n.classList.contains('page-break')) return '\\page\n';
      if (/^H[1-6]$/.test(t))
        return `\\pard${al}\\sb240\\sa120\\keepn{\\b\\fs${[44, 34, 28, 24, 22, 20][t[1] - 1]} ${[...n.childNodes].map(inl).join('')}}\\par\n`;
      if (t === 'UL' || t === 'OL') {
        let k = 0;
        return [...n.children]
          .map((c) => {
            const sub = [...c.children].filter((x) => x.tagName === 'UL' || x.tagName === 'OL');
            const own = [...c.childNodes].filter((x) => !sub.includes(x));
            return (
              `\\pard\\fi-360\\li${720 * (li + 1)}${t === 'OL' ? ` ${++k}.` : '\\bullet'}\\tab ${own.map(inl).join('')}\\par\n` +
              sub.map((s) => block(s, li + 1)).join('')
            );
          })
          .join('');
      }
      if (t === 'TABLE') {
        return (
          [...n.querySelectorAll('tr')]
            .filter((r) => r.closest('table') === n)
            .map((r) => {
              const cs = [...r.children];
              const w = Math.floor(9360 / Math.max(1, cs.length));
              return (
                '\\trowd\\trgaph108' +
                cs
                  .map(
                    (_, i) =>
                      `\\clbrdrt\\brdrs\\clbrdrl\\brdrs\\clbrdrb\\brdrs\\clbrdrr\\brdrs\\cellx${w * (i + 1)}`,
                  )
                  .join('') +
                '\n' +
                cs.map((c) => `\\pard\\intbl ${[...c.childNodes].map(inl).join('')}\\cell`).join('') +
                '\\row\n'
              );
            })
            .join('') + '\\pard\n'
        );
      }
      if (t === 'HR') return '\\pard\\brdrb\\brdrs\\brdrw10\\brsp20 \\par\n';
      if (t === 'PRE')
        return n.textContent
          .split('\n')
          .map((l) => `\\pard{\\f1\\fs20 ${enc(l)}}\\par\n`)
          .join('');
      if (t === 'BLOCKQUOTE') return blocks(n, li).replace(/\\pard /g, '\\pard\\li720\\i ');
      if ([...n.children].some((c) => BL.test(c.tagName))) return blocks(n, li);
      return `\\pard${al}\\sa120 ${[...n.childNodes].map(inl).join('')}\\par\n`;
    }
    const body = blocks(root);
    const ct =
      '{\\colortbl;' +
      colors
        .map(
          (h) =>
            `\\red${parseInt(h.slice(0, 2), 16)}\\green${parseInt(h.slice(2, 4), 16)}\\blue${parseInt(h.slice(4, 6), 16)};`,
        )
        .join('') +
      '}';
    return `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\froman Georgia;}{\\f1\\fmodern Courier New;}}${ct}\\fs24\n${body}}`;
  }

  /* --- OCR: Tesseract, loaded on first use --- */
  // A URL a worker can load: the embedded copy as a blob in the single-file build (the '#.js' tells
  // Tesseract it is a full script path), else the file next to index.html.
  const scriptUrl = async (p) =>
    embedded(p)
      ? URL.createObjectURL(new Blob([await asset(p)], { type: 'text/javascript' })) + '#.js'
      : new URL(p, location.href).href;
  let ocrWorker = null,
    ocrKey = '',
    ocrProgress = null,
    ocrFail = null;
  // tesseract.js reports some failures only to errorHandler and leaves the promise pending.
  const guard = (p) =>
    new Promise((res, rej) => {
      ocrFail = rej;
      p.then(res, rej);
    });
  // Reads the text in a canvas. langs: Tesseract codes, 'eng' built in, others from Your fonts and
  // languages. Returns { text, words: [{ text, x0, y0, x1, y1 }] } in canvas pixels.
  async function ocr(canvas, langs = ['eng'], onProgress) {
    await loadScript('vendor/tesseract.min.js');
    ocrProgress = onProgress;
    const key = langs.join('+');
    if (ocrKey !== key) {
      await ocrWorker?.terminate();
      ocrWorker = null;
      const data = await Promise.all(
        langs.map(async (code) => ({
          code,
          data: new Uint8Array(
            code === 'eng' ? await asset('vendor/eng.traineddata.gz') : await Mods.addons.ocrData(code),
          ),
        })),
      );
      // tesseract.js 5.1.1 names in-memory languages by their bytes instead of their code when it starts
      // the engine; fix that one expression in the worker source.
      const BUG = '"string"==typeof t?t:t.data})).join("+")';
      const src = new TextDecoder().decode(await asset('vendor/tesseract-worker.min.js'));
      if (!src.includes(BUG)) throw new Error('Unexpected OCR worker version');
      const workerPath = URL.createObjectURL(
        new Blob([src.replace(BUG, '"string"==typeof t?t:t.code})).join("+")')], { type: 'text/javascript' }),
      );
      ocrWorker = await guard(
        Tesseract.createWorker(data, 1, {
          workerPath,
          corePath: await scriptUrl('vendor/tesseract-core-simd-lstm.wasm.js'),
          workerBlobURL: false,
          cacheMethod: 'none',
          logger: (m) => m.status === 'recognizing text' && ocrProgress?.(m.progress),
          errorHandler: (e) => ocrFail?.(new Error('text recognition failed (' + e + ')')),
        }),
      ).catch((e) => {
        ocrKey = '';
        throw e;
      });
      ocrKey = key;
    }
    const { data } = await guard(ocrWorker.recognize(canvas));
    return { text: data.text, words: data.words.map((w) => ({ text: w.text, ...w.bbox })) };
  }

  /* --- fonts for writing text with pdf-lib --- */
  // The 14 standard PDF fonts only cover Western European characters (WinAnsi).
  const NOT_WINANSI = /[^\x20-\x7E\xA0-\xFF\n–—‘’“”•…€]/;
  const notoBytes = {};
  // One per output PDF. pick(text, standardFontName) returns a font that can draw the text, using
  // Noto Sans (Latin, Greek, Cyrillic) when needed; leftover characters become '?' and go in `replaced`.
  function pdfFonts(out) {
    const std = {},
      uni = {},
      replaced = new Set();
    const font = async (k) => std[k] || (std[k] = await out.embedFont(PDFLib.StandardFonts[k]));
    const uniFont = (bold) =>
      (uni[bold] ??= (async () => {
        try {
          await loadScript('vendor/fontkit.umd.min.js');
          notoBytes[bold] ??= await asset(`assets/NotoSans-${bold ? 'Bold' : 'Regular'}.ttf`);
          out.registerFontkit(window.fontkit);
          const f = await out.embedFont(notoBytes[bold], { subset: true });
          return { f, has: new Set(f.getCharacterSet()) };
        } catch (e) {
          console.warn('Unicode font unavailable', e);
          return null;
        }
      })());
    // A font the user added, embedded from its file; null if it cannot be (WOFF2, broken file).
    const own = {};
    const userFont = (fam) =>
      (own[fam] ??= (async () => {
        try {
          await loadScript('vendor/fontkit.umd.min.js');
          out.registerFontkit(window.fontkit);
          const f = await out.embedFont(await Mods.addons.fontData(fam), { subset: true });
          return { f, has: new Set(f.getCharacterSet()) };
        } catch (e) {
          console.warn('Could not embed ' + fam, e);
          return null;
        }
      })());
    async function pick(text, k) {
      if (k.startsWith('user:')) {
        const u = await userFont(k.slice(5));
        if (u && [...text].every((ch) => ch === '\n' || u.has.has(ch.codePointAt(0))))
          return { f: u.f, t: text };
        k = 'Helvetica';
      }
      if (!NOT_WINANSI.test(text)) return { f: await font(k), t: text };
      const u = await uniFont(/Bold/.test(k));
      const ok = (ch) => ch === '\n' || (u ? u.has.has(ch.codePointAt(0)) : !NOT_WINANSI.test(ch));
      const t = [...text].map((ch) => (ok(ch) ? ch : (replaced.add(ch), '?'))).join('');
      return { f: u ? u.f : await font(k), t };
    }
    return { pick, replaced };
  }

  /* --- laid-out HTML → PDF with real text --- */
  // The browser has already laid out `root` (it must be in the page, even off-screen). This reads where
  // every word, image, border and background sits and draws them with pdf-lib, so the PDF text can be
  // searched, copied and read aloud. Page breaks fall between lines; elements with class `pb` force one.
  // Sizes in points; returns { bytes, replaced }.
  async function domToPdf(root, { pageW, pageH, margin, title = '' }) {
    const { PDFDocument, rgb } = PDFLib;
    const out = await PDFDocument.create();
    if (title) out.setTitle(title);
    out.setProducer('Offline Office');
    const fonts = pdfFonts(out);
    const K = 0.75; // points per CSS pixel
    const box = root.getBoundingClientRect();
    const X = (x) => x - box.left,
      Y = (y) => y - box.top;
    const color = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c || '');
      if (!m) return null;
      const [r, g, b, a = 1] = m[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return a === 0 ? null : rgb(r / 255, g / 255, b / 255);
    };
    const fills = [], // { x, y0, w, y1, c } painted on every page they cross
      lines = [], // { x0, y0, x1, y1, wd, c }
      atoms = [], // text and images: { y0, y1, draw(page, toY) } kept whole on one page
      breaks = [],
      markers = new Map(); // list item -> its bullet, emitted just before the item's first word

    for (const el of [root, ...root.querySelectorAll('*')]) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (el.classList.contains('pb')) {
        breaks.push(Y(el.getBoundingClientRect().top));
        continue;
      }
      const bg = color(cs.backgroundColor);
      if (bg && el !== root)
        for (const r of el.getClientRects())
          fills.push({ x: X(r.left), y0: Y(r.top), w: r.width, y1: Y(r.bottom), c: bg });
      const r = el.getBoundingClientRect();
      for (const [side, x0, y0, x1, y1] of [
        ['Top', r.left, r.top, r.right, r.top],
        ['Bottom', r.left, r.bottom, r.right, r.bottom],
        ['Left', r.left, r.top, r.left, r.bottom],
        ['Right', r.right, r.top, r.right, r.bottom],
      ]) {
        const wd = parseFloat(cs[`border${side}Width`]),
          c = color(cs[`border${side}Color`]);
        if (wd > 0 && c && cs[`border${side}Style`] !== 'none')
          lines.push({ x0: X(x0), y0: Y(y0), x1: X(x1), y1: Y(y1), wd, c });
      }
      if (el.tagName === 'IMG' && r.width && r.height) {
        const x = X(r.left),
          y0 = Y(r.top),
          y1 = Y(r.bottom),
          src = el.currentSrc || el.src;
        atoms.push({
          y0,
          y1,
          draw: async (page, toY) => {
            const im = await embedImage(out, el, src);
            if (im)
              page.drawImage(im, { x: x * K + margin, y: toY(y1), width: r.width * K, height: r.height * K });
          },
        });
      }
      if (el.tagName === 'LI') listMarker(el, cs);
    }

    // List bullets and numbers are drawn by CSS (::marker), not text in the page, so add them here.
    function listMarker(li, cs) {
      const list = li.parentElement;
      const first = li.getClientRects()[0];
      if (!first || cs.listStyleType === 'none') return;
      const ordered = list && list.tagName === 'OL';
      const index =
        [...list.children].filter((x) => x.tagName === 'LI').indexOf(li) + (+list.getAttribute('start') || 1);
      const size = parseFloat(cs.fontSize);
      const text = ordered ? index + '.' : '•';
      // Sit on the same baseline as the item's first word.
      const tw = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, {
        acceptNode: (t) => (/\S/.test(t.data) ? 1 : 3),
      });
      const t0 = tw.nextNode();
      let wr = null;
      if (t0) {
        const rg = document.createRange();
        rg.selectNodeContents(t0);
        wr = rg.getClientRects()[0];
      }
      const y1 = Y(wr ? wr.bottom : first.top + size * 1.2),
        base = y1 - size * 0.21;
      markers.set(li, {
        y0: Y(wr ? wr.top : first.top),
        y1,
        draw: async (page, toY) => {
          const { f, t } = await fonts.pick(text, fontKey(cs));
          const w = f.widthOfTextAtSize(t, size * K);
          page.drawText(t, {
            x: X(first.left) * K + margin - w - size * K * 0.5,
            y: toY(base),
            size: size * K,
            font: f,
            color: color(cs.color) || rgb(0, 0, 0),
          });
        },
      });
    }

    // Text: one item per word, placed where the browser put it, so no drift from font width differences.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      const cs = getComputedStyle(parent);
      if (cs.display === 'none' || cs.visibility === 'hidden' || !/\S/.test(n.data)) continue;
      const size = parseFloat(cs.fontSize),
        c = color(cs.color) || rgb(0, 0, 0),
        key = fontKey(cs);
      let deco = '';
      for (let e = parent; e && e !== root.parentElement; e = e.parentElement) {
        deco += ' ' + getComputedStyle(e).textDecorationLine;
        if (/^(P|DIV|LI|H[1-6]|TD|TH|BLOCKQUOTE|PRE)$/.test(e.tagName)) break;
      }
      // Emit the bullet before the item's first word so copied or extracted text reads in order.
      const li = parent.closest('li');
      if (markers.has(li)) {
        atoms.push(markers.get(li));
        markers.delete(li);
      }
      for (const m of n.data.matchAll(/\S+(\s*)/g)) {
        const word = m[0].trimEnd();
        range.setStart(n, m.index);
        range.setEnd(n, m.index + word.length);
        const r = range.getClientRects()[0];
        if (!r || !r.width) continue;
        const x = X(r.left),
          y0 = Y(r.top),
          y1 = Y(r.bottom),
          base = y1 - size * 0.21; // descent of common text fonts
        // A trailing space keeps words apart when the PDF text is copied or extracted.
        const text = word + (m[1] ? ' ' : '');
        atoms.push({
          y0,
          y1,
          draw: async (page, toY) => {
            const { f, t } = await fonts.pick(text, key);
            // PDF fonts are a little wider or narrower than the screen font: scale each word to the
            // width the browser gave it, so spacing matches the editor.
            const squeeze = clamp((100 * r.width * K) / f.widthOfTextAtSize(t.trimEnd(), size * K), 60, 160);
            page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.setCharacterSqueeze(squeeze));
            page.drawText(t, { x: x * K + margin, y: toY(base), size: size * K, font: f, color: c });
            page.pushOperators(PDFLib.popGraphicsState());
            const line = (yy) =>
              page.drawLine({
                start: { x: x * K + margin, y: toY(yy) },
                end: { x: (x + r.width) * K + margin, y: toY(yy) },
                thickness: Math.max(0.5, size * K * 0.06),
                color: c,
              });
            if (deco.includes('underline')) line(base + size * 0.1);
            if (deco.includes('line-through')) line(base - size * 0.3);
          },
        });
      }
    }

    atoms.push(...markers.values()); // items with no text still get their bullet
    // Page breaks: fill each page, but never cut a word or image in half.
    const H = (pageH - 2 * margin) / K;
    const end = Math.max(0, ...atoms.map((a) => a.y1), ...fills.map((f) => f.y1));
    breaks.sort((a, b) => a - b);
    const starts = [0];
    for (let s = 0; ; ) {
      let b = breaks.find((f) => f > s + 1 && f < s + H);
      if (b === undefined) {
        if (s + H >= end) break;
        b = s + H;
        for (const a of atoms) if (a.y0 < b && a.y1 > b && a.y0 > s) b = Math.min(b, a.y0);
      }
      starts.push(b);
      s = b;
    }
    const pages = starts.map(() => out.addPage([pageW, pageH]));
    const pageOf = (y) => {
      let i = 0;
      while (i + 1 < starts.length && starts[i + 1] <= y) i++;
      return i;
    };
    const toYOn = (i) => (y) => pageH - margin - (y - starts[i]) * K;
    const span = (y0, y1, fn) => {
      for (let i = 0; i < pages.length; i++) {
        const a = Math.max(y0, starts[i]),
          b = Math.min(y1, starts[i + 1] ?? Infinity);
        if (b > a || (b === a && y0 === y1 && a >= starts[i] && a < (starts[i + 1] ?? Infinity)))
          fn(pages[i], toYOn(i), a, b);
      }
    };
    for (const f of fills)
      span(f.y0, f.y1, (page, toY, a, b) =>
        page.drawRectangle({
          x: f.x * K + margin,
          y: toY(b),
          width: f.w * K,
          height: (b - a) * K,
          color: f.c,
        }),
      );
    for (const l of lines)
      span(Math.min(l.y0, l.y1), Math.max(l.y0, l.y1), (page, toY, a, b) =>
        page.drawLine({
          start: { x: l.x0 * K + margin, y: toY(l.y0 === l.y1 ? l.y0 : a) },
          end: { x: l.x1 * K + margin, y: toY(l.y0 === l.y1 ? l.y1 : b) },
          thickness: l.wd * K,
          color: l.c,
        }),
      );
    for (const a of atoms) {
      const i = pageOf(a.y0);
      await a.draw(pages[i], toYOn(i));
    }
    return { bytes: await out.save(), replaced: fonts.replaced };
  }
  // Standard PDF font name for a CSS font: serif families map to Times, monospace to Courier, others to Helvetica.
  function fontKey(cs) {
    const first = cs.fontFamily
      .split(',')[0]
      .trim()
      .replace(/^["']|["']$/g, '');
    if (userFonts.includes(first)) return 'user:' + first;
    const fam = cs.fontFamily.toLowerCase();
    const bold = parseInt(cs.fontWeight) >= 600 || cs.fontWeight === 'bold',
      italic = cs.fontStyle === 'italic' || cs.fontStyle === 'oblique';
    if (/courier|mono|consolas|menlo/.test(fam))
      return 'Courier' + (bold ? 'Bold' : '') + (italic ? 'Oblique' : '');
    if (
      /georgia|times|garamond|cambria|palatino|serif/.test(fam.split(',')[0]) &&
      !/sans/.test(fam.split(',')[0])
    )
      return 'TimesRoman' + (bold ? 'Bold' : '') + (italic ? 'Italic' : '');
    return 'Helvetica' + (bold ? 'Bold' : '') + (italic ? 'Oblique' : '');
  }
  const imageCache = new WeakMap();
  async function embedImage(out, img, src) {
    if (!imageCache.has(out)) imageCache.set(out, new Map());
    const cache = imageCache.get(out);
    if (!cache.has(src))
      cache.set(
        src,
        (async () => {
          try {
            if (/^data:image\/jpe?g/.test(src)) return await out.embedJpg(dataURLtoBytes(src));
            if (/^data:image\/png/.test(src)) return await out.embedPng(dataURLtoBytes(src));
            const c = el('canvas', { width: img.naturalWidth, height: img.naturalHeight });
            c.getContext('2d').drawImage(img, 0, 0);
            return await out.embedPng(dataURLtoBytes(c.toDataURL('image/png')));
          } catch (e) {
            console.warn('image skipped', e);
            return null;
          }
        })(),
      );
    return cache.get(src);
  }

  return {
    ocr,
    pdfFonts,
    domToPdf,
    loadScript,
    docToHtml,
    pptToDeck,
    odtToHtml,
    odpToDeck,
    rtfToHtml,
    epubToHtml,
    iworkPreview,
    decodeImage,
    htmlToOdt,
    htmlToRtf,
  };
})();
