/* Lectura de planillas de movimientos ICBC (.xlsx) con ExcelJS.
   Toma solo las 11 columnas definidas y marca como identificado
   el registro cuya celda de Débito o Crédito está pintada de verde. */
(function (root) {
  const COLUMNAS = {
    'fecha contable': 'fecha', 'concepto': 'concepto', 'datos': 'datos',
    'debito en $': 'debito', 'credito en $': 'credito',
    'informacion complementaria': 'info', 'nro de cheque': 'cheque',
    'sucursal origen': 'suc', 'canal': 'canal', 'banco': 'banco', 'nombre': 'nombre',
  };
  const RE_CUENTA = /\d{4}\/\d{8}\/\d{2}/;

  const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();

  function valorCelda(v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v;
    if (typeof v === 'object') {
      if ('result' in v) return valorCelda(v.result);
      if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
      if ('text' in v) return v.text;
      if ('error' in v) return null;
      return null;
    }
    return v;
  }
  function texto(v) {
    v = valorCelda(v);
    if (v === null) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    return s === '' ? null : s;
  }
  function numero(v) {
    v = valorCelda(v);
    if (v === null || v === '') return 0;
    if (typeof v === 'number') return v;
    const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  function fechaISO(v) {
    v = valorCelda(v);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.round(v * 864e5)).toISOString().slice(0, 10);
    const m = String(v ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  }

  // ---------- color verde ----------
  function coloresTema(wb) {
    const xml = Object.values(wb._themes || {})[0] || '';
    const tema = {};
    ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].forEach((n, i) => {
      const m = xml.match(new RegExp(`<a:${n}>[\\s\\S]*?(?:val|lastClr)="([0-9A-Fa-f]{6})"`));
      if (m) tema[i] = m[1];
    });
    return tema;
  }
  function esVerde(celda, tema) {
    const f = celda && celda.fill;
    if (!f || f.type !== 'pattern' || f.pattern !== 'solid' || !f.fgColor) return false;
    let hex = null;
    if (f.fgColor.argb) hex = f.fgColor.argb.slice(-6);
    else if (f.fgColor.theme !== undefined) hex = tema[f.fgColor.theme];
    if (!hex) return false;
    let r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (d === 0) return false;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return h >= 75 && h <= 165 && s > 0.2;
  }

  // ---------- lectura ----------
  function leerLibro(wb, archivo) {
    const tema = coloresTema(wb);
    const filas = [], hojas = [], avisos = [];
    let cuentaArchivo = null;
    wb.eachSheet((ws) => {
      const nombreHoja = ws.name.trim();
      let filaEnc = null, cuenta = null;
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const row = ws.getRow(r);
        row.eachCell((c) => { const m = String(valorCelda(c.value) ?? '').match(RE_CUENTA); if (m && !cuenta) cuenta = m[0]; });
        if (normalizar(valorCelda(row.getCell(1).value)) === 'fecha contable') { filaEnc = r; break; }
      }
      if (!filaEnc) return; // hojas auxiliares (por ejemplo, Hoja1) o vacías
      if (cuenta) cuentaArchivo = cuentaArchivo || cuenta;
      const col = {};
      ws.getRow(filaEnc).eachCell((c, n) => { const k = COLUMNAS[normalizar(valorCelda(c.value))]; if (k && !col[k]) col[k] = n; });
      const faltan = ['fecha', 'concepto', 'debito', 'credito'].filter((k) => !col[k]);
      if (faltan.length) { avisos.push(`La hoja "${nombreHoja}" no tiene las columnas: ${faltan.join(', ')}.`); return; }
      let cant = 0, ident = 0;
      for (let r = filaEnc + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const cel = (k) => (col[k] ? row.getCell(col[k]) : null);
        const fecha = fechaISO(cel('fecha')?.value);
        if (!fecha) continue;
        const deb = numero(cel('debito').value), cred = numero(cel('credito').value);
        const importe = Math.round((cred - Math.abs(deb)) * 100) / 100;
        const identificado = esVerde(cel('debito'), tema) || esVerde(cel('credito'), tema);
        const suc = texto(cel('suc')?.value);
        filas.push({
          hoja: nombreHoja, fila: r, fecha,
          concepto: texto(cel('concepto').value) || '',
          datos: texto(cel('datos')?.value), importe,
          info: texto(cel('info')?.value), cheque: texto(cel('cheque')?.value),
          suc: suc && /^\d+$/.test(suc) ? suc : null,
          canal: texto(cel('canal')?.value), banco: texto(cel('banco')?.value),
          nombre: texto(cel('nombre')?.value), identificado,
        });
        cant++; if (identificado) ident++;
      }
      hojas.push({ nombre: nombreHoja, filas: cant, identificadas: ident, cuenta });
    });
    const fechas = filas.map((f) => f.fecha).sort();
    return {
      archivo, cuenta: cuentaArchivo, hojas, filas, avisos,
      identificadas: filas.filter((f) => f.identificado).length,
      desde: fechas[0] || null, hasta: fechas[fechas.length - 1] || null,
    };
  }

  async function leerArchivo(file, ExcelJSlib) {
    const wb = new ExcelJSlib.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    return leerLibro(wb, file.name);
  }

  const api = { leerLibro, leerArchivo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Importador = api;
})(typeof window !== 'undefined' ? window : globalThis);
