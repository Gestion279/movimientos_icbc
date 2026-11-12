/* Movimientos ICBC – Fábrica SRL
   App estática (sin compilación) sobre Supabase. */
(() => {
  'use strict';
  const { supabaseUrl, supabaseAnonKey } = window.APP_CONFIG;
  const sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'bco-sesion' },
  });

  // ---------------- estado ----------------
  const E = {
    yo: null, usuarios: [], cuentas: [], resumen: [], mes: null, movs: [],
    filtro: { texto: '', ident: '', concil: '', resp: '', tipo: '' },
    abierto: null, canal: null,
  };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ---------------- utilidades ----------------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NUM = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const plata = (n) => (n === null || n === undefined ? '' : NUM.format(n));
  const fecha = (iso) => { if (!iso) return ''; const [a, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${a.slice(2)}`; };
  const fechaHora = (ts) => new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const nombreMes = (ym) => { const [a, m] = ym.split('-'); return `${MESES[+m - 1]} ${a}`; };
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const nombreUsuario = (id) => { const u = E.usuarios.find((x) => x.id === id); return u ? `${u.nombre} ${u.apellido}` : '—'; };
  const puedeEditar = () => E.yo && ['admin', 'editor'].includes(E.yo.rol);
  const esAdmin = () => E.yo && E.yo.rol === 'admin';

  let avisoT;
  function aviso(msg, error = false) {
    const a = $('#aviso'); a.textContent = msg; a.className = 'aviso' + (error ? ' aviso--error' : ''); a.hidden = false;
    clearTimeout(avisoT); avisoT = setTimeout(() => { a.hidden = true; }, error ? 6000 : 2800);
  }

  // ---------------- ingreso ----------------
  async function ingresar(ev) {
    ev.preventDefault();
    const email = $('#ingreso-email').value.trim().toLowerCase();
    const err = $('#ingreso-error'); const btn = $('#ingreso-boton');
    err.textContent = '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Escribí tu correo completo, por ejemplo nombre@fabricasrl.com.ar.'; return; }
    btn.disabled = true; btn.textContent = 'Ingresando…';
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/bco-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
        body: JSON.stringify({ email }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo ingresar.');
      const { error } = await sb.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token });
      if (error) throw error;
      try { localStorage.setItem('bco-ultimo-correo', email); } catch (_) {}
      await iniciar();
    } catch (e) {
      err.textContent = e.message || 'No se pudo ingresar. Revisá tu conexión.';
    } finally {
      btn.disabled = false; btn.textContent = 'Ingresar';
    }
  }

  function mostrarIngreso(msg = '') {
    $('#app').hidden = true; $('#pantalla-ingreso').hidden = false;
    $('#ingreso-error').textContent = msg;
    try { $('#ingreso-email').value = localStorage.getItem('bco-ultimo-correo') || ''; } catch (_) {}
    $('#ingreso-email').focus();
  }

  async function salir() {
    if (E.canal) { sb.removeChannel(E.canal); E.canal = null; }
    await sb.auth.signOut();
    E.yo = null; E.movs = [];
    mostrarIngreso();
  }

  // ---------------- arranque ----------------
  async function iniciar() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return mostrarIngreso();
    const { data: yo, error } = await sb.from('bco_usuarios').select('*').eq('user_id', session.user.id).maybeSingle();
    if (error || !yo || !yo.activo) { await sb.auth.signOut(); return mostrarIngreso('Tu usuario no tiene acceso. Consultá con el administrador.'); }
    E.yo = yo;
    // Registrar el ingreso (fecha y hora del último ingreso). Si falla, la app sigue igual.
    try { await sb.rpc('bco_registrar_ingreso'); } catch (_) {}
    $('#pantalla-ingreso').hidden = true; $('#app').hidden = false;
    $('#barra-usuario').textContent = `${yo.nombre} ${yo.apellido}`;
    $$('[data-requiere]').forEach((b) => { b.hidden = b.dataset.requiere === 'admin' ? !esAdmin() : !puedeEditar(); });
    await Promise.all([cargarUsuarios(), cargarCuentas(), cargarResumen()]);
    if (!E.mes || !E.resumen.find((r) => r.mes === E.mes)) E.mes = E.resumen[0]?.mes || null;
    pintarMeses();
    await cargarMes();
    suscribir();
  }

  async function cargarUsuarios() {
    const { data, error } = await sb.from('bco_usuarios').select('*').order('nombre');
    if (error) return aviso('No se pudo leer la lista de usuarios.', true);
    E.usuarios = data;
    const sel = $('#f-resp');
    sel.innerHTML = '<option value="">Responsable: todos</option><option value="__sin">Sin responsable</option>' +
      data.filter((u) => u.activo).map((u) => `<option value="${esc(u.id)}">${esc(u.nombre)} ${esc(u.apellido)}</option>`).join('');
    sel.value = E.filtro.resp;
  }
  async function cargarCuentas() {
    const { data } = await sb.from('bco_cuentas').select('*').order('id');
    E.cuentas = data || [];
    $('#barra-cuenta').textContent = E.cuentas.length === 1 ? `${E.cuentas[0].banco} CC $ ${E.cuentas[0].numero}` : '';
  }
  async function cargarResumen() {
    const { data, error } = await sb.from('bco_v_resumen_mensual').select('*').order('mes', { ascending: false });
    if (error) return aviso('No se pudo leer el resumen mensual.', true);
    E.resumen = data;
  }

  // ---------------- meses ----------------
  function pintarMeses() {
    const cont = $('#meses');
    if (!E.resumen.length) { cont.innerHTML = ''; return; }
    cont.innerHTML = [...E.resumen].reverse().map((r) =>
      `<button class="mes" role="tab" aria-selected="${r.mes === E.mes}" data-mes="${esc(r.mes)}">${esc(nombreMes(r.mes))}<small>${r.movimientos}</small></button>`).join('');
  }

  async function cargarMes() {
    const cuerpo = $('#tabla-cuerpo');
    if (!E.mes) { E.movs = []; pintarTabla(); return; }
    cuerpo.innerHTML = '<tr><td colspan="16" class="vacio">Cargando movimientos…</td></tr>';
    const filas = []; const paso = 1000;
    for (let i = 0; ; i += paso) {
      const { data, error } = await sb.from('bco_v_movimientos').select('*').eq('mes', E.mes)
        .order('fecha').order('id').range(i, i + paso - 1);
      if (error) { aviso('No se pudieron leer los movimientos.', true); break; }
      filas.push(...data);
      if (data.length < paso) break;
    }
    E.movs = filas;
    pintarTabla();
  }

  // ---------------- filtros y tabla ----------------
  function filtrados() {
    const f = E.filtro; const t = norm(f.texto);
    return E.movs.filter((m) => {
      if (f.ident === 'si' && !m.identificado) return false;
      if (f.ident === 'no' && m.identificado) return false;
      if (f.concil === 'si' && !m.conciliado) return false;
      if (f.concil === 'no' && m.conciliado) return false;
      if (f.resp === '__sin' && m.responsable_id) return false;
      if (f.resp && f.resp !== '__sin' && m.responsable_id !== f.resp) return false;
      if (f.tipo === 'debito' && !m.debito) return false;
      if (f.tipo === 'credito' && !m.credito) return false;
      if (t) {
        const hay = norm([m.concepto, m.datos, m.nombre, m.banco, m.info_complementaria, m.nro_cheque, m.canal, m.responsable].join(' '));
        if (!t.split(/\s+/).every((p) => hay.includes(p))) return false;
      }
      return true;
    });
  }

  function opcionesResp(sel) {
    return '<option value="">Sin asignar</option>' + E.usuarios.filter((u) => u.activo || u.id === sel)
      .map((u) => `<option value="${esc(u.id)}"${u.id === sel ? ' selected' : ''}>${esc(u.nombre)} ${esc(u.apellido)}</option>`).join('');
  }

  function filaHTML(m) {
    const dis = puedeEditar() ? '' : ' disabled';
    const cls = [m.identificado ? 'ident' : '', m.conciliado ? 'concil' : ''].join(' ');
    const resp = `<select data-acc="resp" data-id="${m.id}" aria-label="Responsable" class="${m.responsable_id ? '' : 'vacio-resp'}"${dis}>${opcionesResp(m.responsable_id)}</select>`;
    const ident = `<input type="checkbox" class="chk chk--verde" data-acc="ident" data-id="${m.id}" aria-label="Identificado"${m.identificado ? ' checked' : ''}${dis}>`;
    const concil = `<input type="checkbox" class="chk" data-acc="concil" data-id="${m.id}" aria-label="Conciliado"${m.conciliado ? ' checked' : ''}${dis}>`;
    const bej = `<input type="checkbox" class="chk" data-acc="bej" data-id="${m.id}" aria-label="Registrado en Bejerman"${m.registrado_bejerman ? ' checked' : ''}${dis}>`;
    const coment = `<button class="btn-coment${m.comentarios ? ' tiene' : ''}" data-acc="abrir" data-id="${m.id}" title="${esc(m.comentarios ? 'Ver comentarios' : 'Agregar comentario')}">${m.comentarios || '+'}</button>`;
    return `<tr data-id="${m.id}" class="${cls}">
      <td class="fecha m-ver">${fecha(m.fecha)}</td>
      <td class="concepto m-ver" title="${esc(m.concepto)}">${esc(m.concepto)}</td>
      <td class="datos">${esc(m.datos)}</td>
      <td class="num dc debito${m.debito ? ' m-ver' : ''}">${m.debito ? '-' + plata(m.debito) : ''}</td>
      <td class="num dc credito${m.credito ? ' m-ver' : ''}">${plata(m.credito)}</td>
      <td class="info" title="${esc(m.info_complementaria)}">${esc(m.info_complementaria)}</td>
      <td>${esc(m.nro_cheque)}</td>
      <td class="num">${esc(m.sucursal_origen)}</td>
      <td>${esc(m.canal)}</td>
      <td>${esc(m.banco)}</td>
      <td class="nombre${m.nombre ? ' m-ver' : ''}" title="${esc(m.nombre)}">${esc(m.nombre)}</td>
      <td class="g g-ident">${ident}</td>
      <td class="g g-resp">${resp}</td>
      <td class="g g-bej">${bej}</td>
      <td class="g g-coment">${coment}</td>
      <td class="g g-concil">${concil}</td>
      <td class="gestion-movil">
        <label>${ident.replace('aria-label="Identificado"', 'aria-label="Identificado (celular)"')} Identif.</label>
        ${resp}
        <label>${bej.replace('aria-label="Registrado en Bejerman"', 'aria-label="Registrado en Bejerman (celular)"')} Bejerman</label>
        ${coment}
        <label>${concil.replace('aria-label="Conciliado"', 'aria-label="Conciliado (celular)"')} Concil.</label>
      </td>
    </tr>`;
  }

  function pintarTabla() {
    const lista = filtrados();
    $('#tabla-cuerpo').innerHTML = lista.map(filaHTML).join('');
    const vacio = $('#tabla-vacia');
    if (!E.mes) { vacio.textContent = 'Todavía no hay movimientos cargados. Importá una planilla desde la sección Importar.'; vacio.hidden = false; }
    else if (!lista.length) { vacio.textContent = 'Ningún movimiento coincide con los filtros. Probá con otra búsqueda o quitá algún filtro.'; vacio.hidden = false; }
    else vacio.hidden = true;
    pintarResumen(lista);
  }

  function pintarResumen(lista) {
    const deb = lista.reduce((s, m) => s + (m.debito || 0), 0);
    const cred = lista.reduce((s, m) => s + (m.credito || 0), 0);
    const ident = lista.filter((m) => m.identificado).length;
    const concil = lista.filter((m) => m.conciliado).length;
    const sinResp = lista.filter((m) => !m.responsable_id).length;
    const pct = (n) => (lista.length ? Math.round((n / lista.length) * 100) : 0);
    $('#resumen').innerHTML = `
      <div><span>Movimientos</span><b>${lista.length}</b></div>
      <div><span>Débitos $</span><b>${plata(deb)}</b></div>
      <div><span>Créditos $</span><b>${plata(cred)}</b></div>
      <div class="medidor"><span>Identificados</span><b>${ident} de ${lista.length} (${pct(ident)} %)</b><div class="medidor__barra"><i style="width:${pct(ident)}%"></i></div></div>
      <div class="medidor medidor--concil"><span>Conciliados</span><b>${concil} de ${lista.length} (${pct(concil)} %)</b><div class="medidor__barra"><i style="width:${pct(concil)}%"></i></div></div>
      <div><span>Sin responsable</span><b>${sinResp}</b></div>`;
  }

  function repintarFila(id) {
    const m = E.movs.find((x) => x.id === id); if (!m) return;
    const tr = $(`#tabla-cuerpo tr[data-id="${id}"]`);
    if (tr) { const tmp = document.createElement('tbody'); tmp.innerHTML = filaHTML(m); tr.replaceWith(tmp.firstElementChild); }
    pintarResumen(filtrados());
    if (E.abierto === id) pintarDetalle();
  }

  async function refrescarFila(id) {
    const { data } = await sb.from('bco_v_movimientos').select('*').eq('id', id).maybeSingle();
    if (!data) return;
    const i = E.movs.findIndex((x) => x.id === id);
    if (i >= 0) { E.movs[i] = data; repintarFila(id); }
  }

  // ---------------- cambios de gestión ----------------
  async function actualizar(id, cambios) {
    const m = E.movs.find((x) => x.id === id); if (!m) return;
    const antes = { ...m };
    Object.assign(m, cambios);
    if ('responsable_id' in cambios) m.responsable = cambios.responsable_id ? nombreUsuario(cambios.responsable_id) : null;
    repintarFila(id);
    const { error } = await sb.from('bco_movimientos').update(cambios).eq('id', id);
    if (error) {
      Object.assign(m, antes); repintarFila(id);
      return aviso('No se pudo guardar el cambio. Revisá tu conexión y probá de nuevo.', true);
    }
    await refrescarFila(id);
    programarResumen();
  }

  let resumenT;
  function programarResumen() {
    clearTimeout(resumenT);
    resumenT = setTimeout(async () => { await cargarResumen(); pintarMeses(); }, 1500);
  }

  // ---------------- detalle, comentarios e historial ----------------
  async function abrirDetalle(id) {
    E.abierto = id;
    $('#velo').hidden = false; $('#detalle').hidden = false;
    document.body.style.overflow = 'hidden';
    pintarDetalle();
  }
  function cerrarDetalle() {
    E.abierto = null; $('#velo').hidden = true; $('#detalle').hidden = true; document.body.style.overflow = '';
  }

  async function pintarDetalle() {
    const id = E.abierto; const m = E.movs.find((x) => x.id === id); if (!m) return;
    const dis = puedeEditar() ? '' : ' disabled';
    const campo = (k, v) => (v === null || v === undefined || v === '' ? '' : `<dt>${k}</dt><dd>${esc(v)}</dd>`);
    $('#detalle-cuerpo').innerHTML = `
      <div class="det">
        <div class="det__importe ${m.debito ? 'debito' : 'credito'}">${m.debito ? '-' + plata(m.debito) : plata(m.credito)}</div>
        <div class="det__concepto" id="detalle-titulo">${esc(m.concepto)}</div>
        <div class="det__fecha">${fecha(m.fecha)}</div>
        <span class="det__estado ${m.identificado ? 'det__estado--ident' : 'det__estado--sin'}">${m.identificado ? 'Identificado' : 'Sin identificar'}</span>
        ${m.conciliado ? '<span class="det__estado det__estado--concil">Conciliado</span>' : ''}
        <dl class="campos">
          ${campo('Datos', m.datos)}${campo('Información complementaria', m.info_complementaria)}
          ${campo('Nro. de cheque', m.nro_cheque)}${campo('Sucursal origen', m.sucursal_origen)}
          ${campo('Canal', m.canal)}${campo('Banco', m.banco)}${campo('Nombre', m.nombre)}
          ${campo('Origen', m.origen_hoja ? `Hoja ${m.origen_hoja}, fila ${m.origen_fila}` : '')}
        </dl>
        <div class="gestion">
          <label><input type="checkbox" class="chk chk--verde" data-acc="ident" data-id="${m.id}"${m.identificado ? ' checked' : ''}${dis}> Identificado</label>
          <label>Responsable <select data-acc="resp" data-id="${m.id}"${dis}>${opcionesResp(m.responsable_id)}</select></label>
          <label><input type="checkbox" class="chk" data-acc="bej" data-id="${m.id}"${m.registrado_bejerman ? ' checked' : ''}${dis}> Registrado en Bejerman</label>
          <label><input type="checkbox" class="chk" data-acc="concil" data-id="${m.id}"${m.conciliado ? ' checked' : ''}${dis}>
            <span>Conciliado${m.conciliado && m.conciliado_por_nombre ? `<small>Por ${esc(m.conciliado_por_nombre)} el ${fechaHora(m.conciliado_en)}</small>` : ''}</span></label>
        </div>
        <h3>Comentarios</h3>
        <ul class="hilo" id="hilo"><li>Cargando…</li></ul>
        ${puedeEditar() ? `<form class="nuevo-coment" id="form-coment">
          <textarea id="coment-texto" maxlength="2000" placeholder="Escribí un comentario para el equipo…" aria-label="Nuevo comentario"></textarea>
          <div class="acciones"><span>Los comentarios quedan en el historial y no se pueden editar.</span>
          <button class="btn btn--primario">Agregar comentario</button></div></form>` : ''}
        <h3>Historial de cambios</h3>
        <ul class="cambios" id="cambios"><li>Cargando…</li></ul>
      </div>`;
    const [{ data: com }, { data: cam }] = await Promise.all([
      sb.from('bco_comentarios').select('*').eq('movimiento_id', id).order('creado_en'),
      sb.from('bco_movimientos_cambios').select('*').eq('movimiento_id', id).order('cambiado_en', { ascending: false }),
    ]);
    if (E.abierto !== id) return;
    $('#hilo').innerHTML = (com || []).length
      ? com.map((c) => `<li><span class="quien">${esc(nombreUsuario(c.autor_id))}</span><span class="cuando">${fechaHora(c.creado_en)}</span><p>${esc(c.texto)}</p></li>`).join('')
      : '<li>Todavía no hay comentarios en este registro.</li>';
    $('#cambios').innerHTML = (cam || []).length
      ? cam.map((c) => `<li><b>${esc(nombreUsuario(c.cambiado_por))}</b> cambió <b>${esc(c.campo.toLowerCase())}</b> de “${esc(c.valor_anterior ?? 'sin asignar')}” a “${esc(c.valor_nuevo ?? 'sin asignar')}” el ${fechaHora(c.cambiado_en)}</li>`).join('')
      : '<li>Sin cambios desde la importación.</li>';
  }

  async function comentar(ev) {
    ev.preventDefault();
    const ta = $('#coment-texto'); const texto = ta.value.trim(); if (!texto) return ta.focus();
    const btn = ev.target.querySelector('button'); btn.disabled = true;
    const { error } = await sb.from('bco_comentarios').insert({ movimiento_id: E.abierto, texto });
    btn.disabled = false;
    if (error) return aviso('No se pudo guardar el comentario.', true);
    ta.value = '';
    await refrescarFila(E.abierto);
    aviso('Comentario agregado');
  }

  // ---------------- tiempo real ----------------
  function suscribir() {
    if (E.canal) return;
    E.canal = sb.channel('bco-cambios')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bco_movimientos' }, (p) => {
        if (E.movs.some((m) => m.id === p.new.id)) refrescarFila(p.new.id);
        programarResumen();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bco_comentarios' }, (p) => {
        if (E.movs.some((m) => m.id === p.new.movimiento_id)) refrescarFila(p.new.movimiento_id);
      })
      .subscribe();
  }

  // ---------------- importar ----------------
  let lecturas = [];
  async function esperarExcel() {
    for (let i = 0; i < 50 && !window.ExcelJS; i++) await new Promise((r) => setTimeout(r, 100));
    if (!window.ExcelJS) throw new Error('No se pudo cargar el lector de Excel. Recargá la página.');
  }
  async function leerArchivos(files) {
    const prev = $('#import-previa'); $('#import-resultado').innerHTML = '';
    files = [...files].filter((f) => /\.xlsx$/i.test(f.name));
    if (!files.length) { prev.innerHTML = '<p class="archivo error">Elegí archivos con extensión .xlsx.</p>'; return; }
    prev.innerHTML = '<p>Leyendo archivos…</p>';
    await esperarExcel();
    lecturas = [];
    for (const f of files) {
      try {
        const r = await window.Importador.leerArchivo(f, window.ExcelJS);
        if (!r.cuenta && E.cuentas.length === 1) r.cuenta = E.cuentas[0].numero;
        lecturas.push(r);
      } catch (e) { lecturas.push({ archivo: f.name, error: 'No se pudo leer el archivo. Verificá que sea un Excel .xlsx válido.' }); }
    }
    prev.innerHTML = lecturas.map((r) => r.error
      ? `<div class="archivo"><b>${esc(r.archivo)}</b><span class="error">${esc(r.error)}</span></div>`
      : `<div class="archivo"><b>${esc(r.archivo)}</b>
          <span class="meta">Cuenta ${esc(r.cuenta || 'no encontrada')}, del ${fecha(r.desde)} al ${fecha(r.hasta)}: ${r.filas.length} filas en ${r.hojas.length} hojas, ${r.identificadas} identificadas en verde.</span>
          ${!r.cuenta ? '<span class="error">No se encontró el número de cuenta en el archivo.</span>' : ''}
          ${!r.filas.length ? '<span class="error">No se encontraron movimientos en este archivo.</span>' : ''}
          ${r.avisos.map((a) => `<span class="error">${esc(a)}</span>`).join('<br>')}</div>`).join('');
    const validos = lecturas.filter((r) => !r.error && r.cuenta && r.filas.length);
    const btn = $('#btn-importar');
    btn.hidden = !validos.length;
    btn.textContent = validos.length === 1 ? 'Importar 1 archivo' : `Importar ${validos.length} archivos`;
  }

  async function importar() {
    const btn = $('#btn-importar'); btn.disabled = true;
    const res = $('#import-resultado'); res.innerHTML = '';
    for (const r of lecturas.filter((x) => !x.error && x.cuenta && x.filas.length)) {
      const { data, error } = await sb.rpc('bco_importar', { p_cuenta: r.cuenta, p_archivo: r.archivo, p_filas: r.filas });
      res.insertAdjacentHTML('beforeend', error
        ? `<div class="archivo"><b>${esc(r.archivo)}</b><span class="error">No se pudo importar: ${esc(error.message)}</span></div>`
        : `<div class="archivo"><b>${esc(r.archivo)}</b><span class="ok">Importado: ${data.nuevas} movimientos nuevos, ${data.duplicadas} ya estaban cargados.</span></div>`);
    }
    btn.disabled = false; btn.hidden = true; lecturas = []; $('#import-previa').innerHTML = ''; $('#archivos').value = '';
    await cargarResumen();
    if (!E.mes) E.mes = E.resumen[0]?.mes || null;
    pintarMeses(); await cargarMes(); cargarHistorialImport();
  }

  async function cargarHistorialImport() {
    const { data } = await sb.from('bco_importaciones').select('*').order('cargado_en', { ascending: false }).limit(15);
    $('#import-historial').innerHTML = (data || []).length
      ? (data).map((i) => `<div class="archivo"><b>${esc(i.archivo)}</b><span class="meta">${fechaHora(i.cargado_en)}: ${i.filas_nuevas} nuevos, ${i.filas_duplicadas} repetidos${i.fecha_desde ? `, movimientos del ${fecha(i.fecha_desde)} al ${fecha(i.fecha_hasta)}` : ''}.</span></div>`).join('')
      : '<p>Todavía no se importó ningún archivo.</p>';
  }

  // ---------------- usuarios ----------------
  function pintarUsuarios() {
    $('#usuarios-cuerpo').innerHTML = E.usuarios.map((u) => {
      const propio = u.id === E.yo.id ? ' disabled title="No podés cambiar tu propio rol ni desactivarte"' : '';
      return `<tr>
        <td>${esc(u.nombre)} ${esc(u.apellido)}</td><td>${esc(u.email)}</td>
        <td><select data-uacc="rol" data-uid="${esc(u.id)}"${propio}>
          <option value="admin"${u.rol === 'admin' ? ' selected' : ''}>Administrador</option>
          <option value="editor"${u.rol === 'editor' ? ' selected' : ''}>Editor</option>
          <option value="lector"${u.rol === 'lector' ? ' selected' : ''}>Solo lectura</option></select></td>
        <td><input type="checkbox" class="chk" data-uacc="activo" data-uid="${esc(u.id)}"${u.activo ? ' checked' : ''}${propio}></td>
        <td>${u.user_id ? 'Sí' : 'Todavía no'}</td>
        <td>${u.ultimo_ingreso ? fechaHora(u.ultimo_ingreso) : '—'}</td></tr>`;
    }).join('');
  }
  async function cambiarUsuario(id, cambios) {
    const { error } = await sb.from('bco_usuarios').update(cambios).eq('id', id);
    if (error) aviso('No se pudo actualizar el usuario.', true); else aviso('Usuario actualizado');
    await cargarUsuarios(); pintarUsuarios();
  }
  async function agregarUsuario(ev) {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const nuevo = { nombre: f.get('nombre').trim(), apellido: f.get('apellido').trim(), email: f.get('email').trim().toLowerCase(), rol: f.get('rol') };
    const { error } = await sb.from('bco_usuarios').insert(nuevo);
    if (error) return aviso(error.code === '23505' ? 'Ese correo ya está registrado.' : 'No se pudo agregar el usuario.', true);
    ev.target.reset(); aviso(`${nuevo.nombre} ya puede ingresar con su correo.`);
    await cargarUsuarios(); pintarUsuarios();
  }

  // ---------------- navegación ----------------
  function irA(vista) {
    $$('.nav-btn').forEach((b) => b.classList.toggle('activo', b.dataset.vista === vista));
    $$('.vista').forEach((v) => { v.hidden = v.id !== `vista-${vista}`; });
    if (vista === 'importar') cargarHistorialImport();
    if (vista === 'usuarios') pintarUsuarios();
  }

  // ---------------- eventos ----------------
  function conectar() {
    $('#form-ingreso').addEventListener('submit', ingresar);
    $('#btn-salir').addEventListener('click', salir);
    $$('.nav-btn').forEach((b) => b.addEventListener('click', () => irA(b.dataset.vista)));

    $('#meses').addEventListener('click', async (e) => {
      const b = e.target.closest('.mes'); if (!b || b.dataset.mes === E.mes) return;
      E.mes = b.dataset.mes; pintarMeses(); await cargarMes();
    });

    let tBusq;
    $('#f-texto').addEventListener('input', (e) => { clearTimeout(tBusq); tBusq = setTimeout(() => { E.filtro.texto = e.target.value; pintarTabla(); }, 180); });
    [['#f-ident', 'ident'], ['#f-concil', 'concil'], ['#f-resp', 'resp'], ['#f-tipo', 'tipo']].forEach(([s, k]) =>
      $(s).addEventListener('change', (e) => { E.filtro[k] = e.target.value; pintarTabla(); }));

    // gestión dentro de la tabla y del detalle
    const gestionar = (e) => {
      const el = e.target.closest('[data-acc]'); if (!el) return false;
      const id = Number(el.dataset.id);
      if (el.dataset.acc === 'abrir') { abrirDetalle(id); return true; }
      if (e.type !== 'change') return true;
      if (el.dataset.acc === 'ident') actualizar(id, { identificado: el.checked });
      if (el.dataset.acc === 'concil') actualizar(id, { conciliado: el.checked });
      if (el.dataset.acc === 'bej') actualizar(id, { registrado_bejerman: el.checked });
      if (el.dataset.acc === 'resp') actualizar(id, { responsable_id: el.value || null });
      return true;
    };
    $('#tabla-cuerpo').addEventListener('change', gestionar);
    $('#tabla-cuerpo').addEventListener('click', (e) => {
      if (gestionar(e)) return;
      if (e.target.closest('select, input, label, button')) return;
      const tr = e.target.closest('tr[data-id]'); if (tr) abrirDetalle(Number(tr.dataset.id));
    });
    $('#detalle-cuerpo').addEventListener('change', gestionar);
    $('#detalle-cuerpo').addEventListener('submit', (e) => { if (e.target.id === 'form-coment') comentar(e); });
    $('#detalle-cuerpo').addEventListener('keydown', (e) => {
      if (e.target.id === 'coment-texto' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#form-coment').requestSubmit();
    });
    $('#detalle-cerrar').addEventListener('click', cerrarDetalle);
    $('#velo').addEventListener('click', cerrarDetalle);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && E.abierto) cerrarDetalle(); });

    // importar
    $('#archivos').addEventListener('change', (e) => leerArchivos(e.target.files));
    const zona = $('#soltar');
    ['dragenter', 'dragover'].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.add('encima'); }));
    ['dragleave', 'drop'].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.remove('encima'); }));
    zona.addEventListener('drop', (e) => leerArchivos(e.dataTransfer.files));
    $('#btn-importar').addEventListener('click', importar);

    // usuarios
    $('#usuarios-cuerpo').addEventListener('change', (e) => {
      const el = e.target.closest('[data-uacc]'); if (!el) return;
      cambiarUsuario(el.dataset.uid, el.dataset.uacc === 'rol' ? { rol: el.value } : { activo: el.checked });
    });
    $('#form-usuario').addEventListener('submit', agregarUsuario);

    sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && E.yo) { E.yo = null; mostrarIngreso(); } });
  }

  // ---------------- PWA ----------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  conectar();
  iniciar().catch(() => mostrarIngreso('No se pudo conectar. Revisá tu conexión e intentá de nuevo.'));
})();
