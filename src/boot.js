'use strict';
/* ============================== BOOT ============================== */
(() => {
  const missing = [
    ['pdfjsLib', 'PDF viewer'],
    ['PDFLib', 'PDF editor'],
    ['mammoth', 'Word import'],
    ['docx', 'Word export'],
    ['PptxGenJS', 'PowerPoint export'],
    ['XLSX', 'Spreadsheets'],
    ['JSZip', 'ZIP'],
    ['marked', 'Markdown'],
  ]
    .filter(([g]) => !window[g])
    .map(([, l]) => l);
  if (missing.length)
    UI.toast(
      'Some features could not load (' + missing.join(', ') + '). Check your connection and reload.',
      true,
    );
  const h = (location.hash || '').slice(1);
  if (Mods[h]) show(h);
})();
