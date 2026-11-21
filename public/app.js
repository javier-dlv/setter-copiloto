'use strict';
/* Copiloto de setteo — frontend sin framework. Todo el DOM se arma con h(), nunca con HTML del usuario. */

const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const LABELS = {
  stage: { apertura: 'Apertura', calificando: 'Calificando', caso: 'Caso de éxito', propuesta: 'Propuesta de llamada', link: 'Link enviado', agendada: 'Agendada', no_show: 'No-show', seguimiento: 'En seguimiento', fria: 'Fría', perdida: 'Perdida' },
  objective: { peso: 'Bajar de peso', desinflamar: 'Desinflamar', ambas: 'Ambas', sin_dato: 'Sin dato' },
  objection: { ninguna: 'Ninguna', dinero: 'Dinero', tiempo: 'Tiempo', lo_pienso: 'Lo pienso', pareja: 'Pareja', precio: 'Precio directo', desconfianza: 'Desconfianza', otra: 'Otra' },
  qualification: { alta: 'Alta', media: 'Media', baja: 'Baja', sin_dato: 'Sin dato' },
  approach: { empatia: 'Empatía', curiosidad: 'Curiosidad', directo: 'Directo', prueba_social: 'Prueba social', reencuadre: 'Reencuadre', liviano: 'Liviano' },
  mode: { respondio: 'Me respondió', no_responde: 'No responde', recien_entro: 'Recién entró', ya_agendo: 'Ya agendó', no_se_presento: 'No se presentó', reactivar: 'Reactivar' },
  category: { apertura: 'Apertura', paso1: 'Paso 1 · Objetivo', paso2: 'Paso 2 · A qué se dedica', paso3: 'Paso 3 · Qué intentó', paso4: 'Paso 4 · Resultados', paso5: 'Paso 5 · Cuánto bajar', paso6: 'Paso 6 · Caso de éxito', paso7: 'Paso 7 · Propuesta', paso8: 'Paso 8 · Link', objeciones: 'Objeciones', seguimientos: 'Seguimientos', confirmacion: 'Confirmación y recordatorios', no_show: 'No-show', funciono: 'Lo que funcionó' },
  stuck: { si: 'Sí', no: 'No', sin_dato: 'Sin dato' },
};
const lbl = (group, key) => LABELS[group]?.[key] ?? key ?? '—';
const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDay = (iso) => new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });

const TABS = [
  ['copiloto', 'Copiloto'], ['hoy', 'Hoy'], ['leads', 'Leads'], ['importar', 'Importar chats'], ['biblioteca', 'Biblioteca'],
  ['casos', 'Casos de éxito'], ['aprendizaje', 'Aprendizaje'], ['reporte', 'Reporte semanal'], ['embudo', 'Embudo'], ['cerebro', 'Cerebro'],
];

const S = { state: null, leadId: null, mode: 'respondio', analysis: null, week: 0, leadFilter: { q: '', stage: '', objective: '' } };

// ---------- API
class ApiError extends Error {}
async function api(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError('No hay conexión con el servidor. Revisá tu internet y reintentá.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (res.status === 401 && !url.endsWith('/login')) {
    showLogin('Tu sesión venció. Volvé a ingresar.');
    throw new ApiError('Tu sesión venció. Volvé a ingresar.');
  }
  if (!res.ok) throw new ApiError(data?.error || `Error ${res.status}. Reintentá.`);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}
function errorBox(err) {
  return h('div', { class: 'error', role: 'alert' }, err.message || String(err));
}
// Ejecuta una acción con el botón deshabilitado y un indicador de carga.
async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), label);
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado');
    return true;
  } catch {
    toast('No pude copiar: seleccioná el texto y copialo a mano.');
    return false;
  }
}

// ---------- Modo sin API (claude.ai)
const hasApi = () => Boolean(S.state?.claude?.configured);
const CLAUDE_AI = 'https://claude.ai/new';
// Pide el prompt al servidor, lo copia y, si el portapapeles falla, lo muestra para copiar a mano.
async function copyPrompt(btn, fetcher, fallbackBox) {
  try {
    const { prompt } = await busy(btn, 'Armando el prompt…', fetcher);
    const ok = await copy(prompt);
    if (ok) toast('Prompt copiado. Pegalo en Claude.ai y enviá.');
    if (fallbackBox) {
      fallbackBox.replaceChildren();
      if (!ok) {
        const ta = h('textarea', { class: 'tall', readonly: true, 'aria-label': 'Prompt para copiar' });
        ta.value = prompt;
        fallbackBox.append(h('p', { class: 'small' }, 'Seleccioná todo este texto y copialo:'), ta);
        ta.select();
      }
    }
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}
// Después de copiar: aviso visible y desplazamiento hasta el recuadro donde va la respuesta.
function showPasteHint(container) {
  const box = container.querySelector('[data-paste]');
  if (!box) return;
  box.querySelector('.notice')?.remove();
  box.prepend(h('div', { class: 'notice', role: 'status' }, 'Prompt copiado. Ahora seguí los pasos de abajo: pegalo en Claude.ai, enviá, y traé su respuesta a este recuadro.'));
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function claudeLink(label = 'Abrir Claude.ai') {
  return h('a', { class: 'btn secondary', href: CLAUDE_AI, target: '_blank', rel: 'noopener noreferrer' }, label);
}
// Bloque "pegá la respuesta de Claude": pasos + área de texto + botón de carga.
function pasteBox({ id, intro, onLoad }) {
  const ta = h('textarea', { id, class: 'tall', placeholder: 'Pegá acá la respuesta completa de Claude' });
  const err = h('div');
  const btn = h('button', { type: 'button', onclick: async () => {
    err.replaceChildren();
    try { await busy(btn, 'Cargando…', () => onLoad(ta.value)); } catch (e) { err.replaceChildren(errorBox(e)); }
  } }, 'Cargar respuesta');
  return h('div', { class: 'msgcard stack', 'data-paste': '' },
    h('h3', {}, 'Respuesta de Claude.ai'),
    h('ol', { class: 'plain small' },
      h('li', {}, intro),
      h('li', {}, 'Abrí Claude.ai en un chat nuevo y pegá (Ctrl + V). Como el texto es largo, Claude lo muestra como un archivo adjunto: es normal.'),
      h('li', {}, 'En el cuadro de mensaje escribí "Seguí las instrucciones" y enviá.'),
      h('li', {}, 'Cuando termine de responder, tocá el botón "Copiar" que aparece debajo de su respuesta.'),
      h('li', {}, 'Volvé acá, pegá en este recuadro y tocá "Cargar respuesta".')),
    h('div', {}, h('label', { for: id }, 'Respuesta'), ta), err,
    h('div', { class: 'row' }, btn, claudeLink()));
}

// ---------- Tema
function applyTheme() {
  let t = 'auto';
  try { t = localStorage.getItem('theme') || 'auto'; } catch { /* sin storage */ }
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  $('#themeBtn').textContent = `Tema: ${{ auto: 'auto', light: 'claro', dark: 'oscuro' }[t]}`;
}
$('#themeBtn').addEventListener('click', () => {
  let t = 'auto';
  try { t = localStorage.getItem('theme') || 'auto'; } catch { /* */ }
  const next = { auto: 'light', light: 'dark', dark: 'auto' }[t];
  try { localStorage.setItem('theme', next); } catch { /* */ }
  applyTheme();
});
applyTheme();

// ---------- Login
function showLogin(msg) {
  S.state = null;
  $('#topbar').hidden = true;
  $('#banner').hidden = true;
  const err = h('div');
  if (msg) err.append(h('div', { class: 'notice' }, msg));
  const input = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true });
  const btn = h('button', { type: 'submit' }, 'Ingresar');
  const form = h('form', { class: 'card login stack', onsubmit: async (e) => {
    e.preventDefault();
    err.replaceChildren();
    try {
      await busy(btn, 'Ingresando…', () => api('POST', '/api/login', { password: input.value }));
      await boot();
    } catch (ex) { err.replaceChildren(errorBox(ex)); }
  } },
  h('h1', {}, 'Copiloto de setteo'),
  h('p', { class: 'muted' }, 'Ingresá con la contraseña de la app.'),
  h('div', {}, h('label', { for: 'pw' }, 'Contraseña'), input), err, btn);
  $('#main').replaceChildren(form);
  input.focus();
}
$('#logoutBtn').addEventListener('click', async () => {
  try { await api('POST', '/api/logout', {}); } catch { /* */ }
  showLogin();
});

// ---------- Arranque y navegación
async function loadState() {
  S.state = await api('GET', '/api/state');
  const c = S.state.claude;
  const b = $('#banner');
  b.hidden = c.configured;
  b.textContent = c.configured ? '' : 'Modo sin costo: la app arma el pedido, vos lo pegás en Claude.ai y traés la respuesta de vuelta. No usa la API de Anthropic.';
}
async function boot() {
  const s = await api('GET', '/api/session');
  if (!s.authenticated) return showLogin();
  await loadState();
  $('#topbar').hidden = false;
  route();
}
function currentTab() {
  const t = location.hash.replace('#', '');
  return TABS.some(([k]) => k === t) ? t : 'copiloto';
}
function renderTabs() {
  const tab = currentTab();
  const today = S.state ? todayCount() : 0;
  $('#tabs').replaceChildren(...TABS.map(([k, name]) => h('a', { href: `#${k}`, 'aria-current': k === tab ? 'page' : null }, name, k === 'hoy' && today ? h('span', { class: 'count', 'aria-label': `${today} pendientes` }, today) : null)));
}
function todayCount() {
  const now = Date.now();
  return S.state.leads.filter((l) => {
    if (['fria', 'perdida'].includes(l.stage)) return false;
    const due = l.followUpAt && new Date(l.followUpAt).getTime() <= now;
    const future = l.followUpAt && new Date(l.followUpAt).getTime() > now;
    const idle = l.stage !== 'agendada' && !future && (now - new Date(l.lastActivityAt || l.updatedAt).getTime()) / 3600000 > 20;
    return due || idle;
  }).length;
}
async function route() {
  if (!S.state) return;
  renderTabs();
  const tab = currentTab();
  const main = $('#main');
  main.replaceChildren(h('p', { class: 'muted' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Cargando…'));
  try {
    const view = VIEWS[tab];
    main.replaceChildren(await view());
  } catch (e) {
    if (!(e instanceof ApiError && /sesión/.test(e.message))) main.replaceChildren(errorBox(e));
  }
}
window.addEventListener('hashchange', () => { route(); $('#main').focus({ preventScroll: true }); });

const leadById = (id) => S.state.leads.find((l) => l.id === id);
function upsertLead(lead) {
  const i = S.state.leads.findIndex((l) => l.id === lead.id);
  if (i >= 0) S.state.leads[i] = lead; else S.state.leads.unshift(lead);
  renderTabs();
}
function openInCopilot(id) {
  S.leadId = id;
  S.analysis = leadById(id)?.lastAnalysis || null;
  if (location.hash === '#copiloto') route(); else location.hash = '#copiloto';
}
function select(id, options, value, labelGroup) {
  return h('select', { id }, options.map((o) => h('option', { value: o, selected: o === value }, labelGroup ? lbl(labelGroup, o) : o)));
}

// ---------- 1. Copiloto
function guessCategory(a, mode) {
  const byMode = { recien_entro: 'apertura', no_responde: 'seguimientos', reactivar: 'seguimientos', ya_agendo: 'confirmacion', no_se_presento: 'no_show' };
  if (byMode[mode]) return byMode[mode];
  if (a.objecion && a.objecion !== 'ninguna') return 'objeciones';
  const p = Number(a.paso);
  return p >= 1 && p <= 8 ? `paso${p}` : 'funciono';
}

function analysisView(a, lead) {
  const followH = Number(a.seguimiento?.horas) || 24;
  const msgCard = (m, i) => {
    const ta = h('textarea', { class: 'msg', id: `msg${i}`, 'aria-label': `Mensaje ${i + 1}` });
    ta.value = m.texto;
    const sendBtn = h('button', { type: 'button', class: 'sm secondary', onclick: async () => {
      try {
        const updated = await busy(sendBtn, 'Registrando…', () => api('POST', `/api/leads/${lead.id}/sent`, { text: ta.value, approach: m.enfoque, followUpHours: followH }));
        upsertLead(updated);
        toast(`Registrado. Recordatorio en ${followH} h.`);
      } catch (e) { toast(e.message); }
    } }, 'La envié');
    const saveBtn = h('button', { type: 'button', class: 'sm secondary', onclick: async () => {
      const category = guessCategory(a, a.mode);
      try {
        const item = await busy(saveBtn, 'Guardando…', () => api('POST', '/api/library', { category, title: m.titulo || lbl('approach', m.enfoque), text: ta.value }));
        S.state.library.push(item);
        toast(`Guardado en Biblioteca › ${lbl('category', category)}`);
      } catch (e) { toast(e.message); }
    } }, 'Guardar en biblioteca');
    return h('div', { class: 'msgcard' },
      h('div', { class: 'row' }, h('strong', {}, m.titulo || `Opción ${i + 1}`), h('span', { class: 'tag' }, lbl('approach', m.enfoque))),
      ta,
      h('div', { class: 'row actions' }, h('button', { type: 'button', class: 'sm', onclick: () => copy(ta.value) }, 'Copiar'), sendBtn, saveBtn));
  };
  const fu = h('textarea', { class: 'msg', 'aria-label': 'Mensaje de seguimiento' });
  fu.value = a.seguimiento?.texto || '';
  const list = (arr) => (arr?.length ? h('ul', { class: 'plain' }, arr.map((x) => h('li', {}, x))) : h('p', { class: 'muted' }, 'Nada para marcar.'));
  return h('div', {},
    h('section', { class: 'card' },
      h('h2', {}, 'Lectura del chat'),
      h('div', { class: 'row' },
        h('span', { class: 'tag hot' }, `Etapa: ${lbl('stage', a.etapa)}`), h('span', { class: 'tag' }, `Paso ${a.paso} de 8`),
        h('span', { class: 'tag' }, `Temperatura ${a.temperatura}/5`), h('span', { class: 'tag' }, `Objeción: ${lbl('objection', a.objecion)}`)),
      h('p', {}, a.resumen),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Objetivo'), h('dd', {}, lbl('objective', a.perfil?.objetivo)),
        h('dt', {}, 'Ocupación'), h('dd', {}, a.perfil?.ocupacion || 'Sin dato'),
        h('dt', {}, 'Calificación'), h('dd', {}, lbl('qualification', a.perfil?.calificacion)),
        h('dt', {}, 'Qué intentó'), h('dd', {}, a.perfil?.que_intento || 'Sin dato'),
        h('dt', {}, 'Estancada'), h('dd', {}, lbl('stuck', a.perfil?.estancada))),
      h('h3', {}, 'Siguiente paso'), h('p', {}, a.siguiente_paso)),
    h('section', { class: 'card' }, h('h2', {}, 'Mensajes para enviar'), (a.mensajes || []).map(msgCard)),
    h('section', { class: 'card' },
      h('h2', {}, 'Si no responde'),
      h('p', { class: 'muted small' }, `Enviar en ${followH} horas.`),
      fu,
      h('div', { class: 'row actions' }, h('button', { type: 'button', class: 'sm', onclick: () => copy(fu.value) }, 'Copiar'))),
    h('section', { class: 'card grid2' },
      h('div', {}, h('h2', {}, 'Qué evitar'), list(a.evitar)),
      h('div', {}, h('h2', {}, 'Datos que faltan confirmar'), list(a.faltan_confirmar))),
  );
}

async function viewCopiloto() {
  const leads = S.state.leads;
  if (S.leadId && !leadById(S.leadId)) S.leadId = null;
  const lead = S.leadId ? leadById(S.leadId) : null;
  const sel = h('select', { id: 'leadSel', onchange: () => { S.leadId = sel.value || null; S.analysis = S.leadId ? leadById(S.leadId)?.lastAnalysis || null : null; route(); } },
    h('option', { value: '' }, leads.length ? 'Elegí una lead…' : 'Todavía no hay leads'),
    leads.map((l) => h('option', { value: l.id, selected: l.id === S.leadId }, `${l.name} · ${lbl('stage', l.stage)}`)));
  const newName = h('input', { id: 'newName', placeholder: '@usuario o nombre', maxlength: 120 });
  const createBtn = h('button', { type: 'button', class: 'secondary', onclick: async () => {
    if (!newName.value.trim()) { newName.focus(); return toast('Escribí el nombre o usuario de la lead.'); }
    try {
      const l = await busy(createBtn, 'Creando…', () => api('POST', '/api/leads', { name: newName.value }));
      upsertLead(l);
      S.leadId = l.id;
      S.analysis = null;
      route();
    } catch (e) { toast(e.message); }
  } }, 'Crear lead');

  const top = h('section', { class: 'card stack' },
    h('h1', {}, 'Copiloto'),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', { for: 'leadSel' }, 'Lead'), sel),
      h('div', {}, h('label', { for: 'newName' }, 'O creá una nueva'), h('div', { class: 'row' }, h('div', { class: 'grow' }, newName), createBtn))));
  if (!lead) return h('div', {}, top);

  const conv = h('textarea', { id: 'conv', class: 'tall', placeholder: 'Pegá acá la conversación completa de Instagram / ManyChat', maxlength: 60000 });
  conv.value = lead.conversation || '';
  const modes = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Qué necesitás' },
    S.state.meta.modes.map((m) => h('label', { class: 'chip' },
      h('input', { type: 'radio', name: 'mode', value: m, checked: m === S.mode, onchange: () => { S.mode = m; } }), h('span', {}, lbl('mode', m)))));
  const out = h('div');
  const done = async (r) => {
    upsertLead(r.lead);
    S.analysis = r.lead.lastAnalysis;
    await route();
    toast('Lead actualizada con lo detectado');
  };
  const btn = h('button', { type: 'button', onclick: async () => {
    out.replaceChildren();
    try {
      await done(await busy(btn, 'Analizando con Claude…', () => api('POST', '/api/analyze', { leadId: lead.id, mode: S.mode, conversation: conv.value })));
    } catch (e) { out.replaceChildren(errorBox(e)); }
  } }, 'Analizar');
  const manual = h('div');
  const fallback = h('div');
  const paste = () => pasteBox({
    id: 'pasteAnalysis',
    intro: 'Tocá "Copiar prompt para Claude.ai" (arriba).',
    onLoad: async (text) => done(await api('POST', '/api/analyze/manual', { leadId: lead.id, mode: S.mode, response: text })),
  });
  const copyBtn = h('button', { type: 'button', class: hasApi() ? 'secondary' : null, onclick: async () => {
    const ok = await copyPrompt(copyBtn, () => api('POST', '/api/prompt/analyze', { leadId: lead.id, mode: S.mode, conversation: conv.value }), fallback);
    if (ok && !manual.childElementCount) manual.append(paste());
    if (ok) showPasteHint(manual);
  } }, 'Copiar prompt para Claude.ai');
  if (!hasApi()) manual.append(paste());
  top.append(
    h('div', { class: 'row small muted' }, `Etapa: ${lbl('stage', lead.stage)} · Objetivo: ${lbl('objective', lead.objective)} · Temperatura ${lead.temperature}/5 · Seguimiento: ${fmtDate(lead.followUpAt)}`),
    h('div', {}, h('label', { for: 'conv' }, 'Conversación'), conv),
    h('div', {}, h('span', { class: 'small', id: 'modeLbl' }, h('strong', {}, '¿Qué necesitás?')), modes),
    h('div', { class: 'row' }, hasApi() ? btn : null, copyBtn, h('button', { type: 'button', class: 'secondary', onclick: () => openLead(lead.id) }, 'Ver ficha de la lead')),
    fallback, manual);
  if (S.analysis && S.analysis === lead.lastAnalysis) {
    out.append(h('p', { class: 'muted small' }, `Último análisis: ${fmtDate(S.analysis.at)} (${lbl('mode', S.analysis.mode)})`), analysisView(S.analysis, lead));
  }
  return h('div', {}, top, out);
}

// ---------- Ficha de lead (diálogo)
function openLead(id) {
  const lead = leadById(id);
  if (!lead) return;
  const dlg = $('#dialog');
  const name = h('input', { id: 'f_name', value: lead.name, maxlength: 120 });
  const stage = select('f_stage', S.state.meta.stages.map((s) => s.key), lead.stage, 'stage');
  const objective = select('f_obj', S.state.meta.objectives, lead.objective, 'objective');
  const objection = select('f_objc', S.state.meta.objections, lead.objection, 'objection');
  const qual = select('f_qual', S.state.meta.qualifications, lead.qualification, 'qualification');
  const temp = select('f_temp', ['1', '2', '3', '4', '5'], String(lead.temperature));
  const fu = h('input', { id: 'f_fu', type: 'datetime-local' });
  if (lead.followUpAt) {
    const d = new Date(lead.followUpAt);
    fu.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  const notes = h('textarea', { id: 'f_notes', maxlength: 5000 });
  notes.value = lead.notes || '';
  const err = h('div');
  const events = (lead.events || []).slice().reverse().slice(0, 30).map((e) => h('li', { class: 'small' },
    h('span', { class: 'muted' }, fmtDate(e.at), ' · '),
    e.type === 'stage' ? `Etapa: ${e.from ? lbl('stage', e.from) + ' → ' : ''}${lbl('stage', e.to)} (${e.source || 'manual'})` : `Mensaje enviado [${lbl('stage', e.stage)} · ${lbl('approach', e.approach)}]: ${e.text}`));
  const saveBtn = h('button', { type: 'submit' }, 'Guardar');
  const form = h('form', { method: 'dialog', class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const body = { name: name.value, stage: stage.value, objective: objective.value, objection: objection.value, qualification: qual.value, temperature: Number(temp.value), notes: notes.value, followUpAt: fu.value ? new Date(fu.value).toISOString() : null };
      const updated = await busy(saveBtn, 'Guardando…', () => api('PATCH', `/api/leads/${id}`, body));
      upsertLead(updated);
      dlg.close();
      toast('Lead guardada');
      route();
    } catch (ex) { err.replaceChildren(errorBox(ex)); }
  } },
  h('h2', { id: 'dialogTitle' }, 'Ficha de la lead'),
  h('div', { class: 'grid2' },
    h('div', {}, h('label', { for: 'f_name' }, 'Nombre'), name),
    h('div', {}, h('label', { for: 'f_stage' }, 'Etapa'), stage),
    h('div', {}, h('label', { for: 'f_obj' }, 'Objetivo'), objective),
    h('div', {}, h('label', { for: 'f_objc' }, 'Objeción'), objection),
    h('div', {}, h('label', { for: 'f_qual' }, 'Calificación'), qual),
    h('div', {}, h('label', { for: 'f_temp' }, 'Temperatura (1 a 5)'), temp),
    h('div', {}, h('label', { for: 'f_fu' }, 'Próximo seguimiento'), fu)),
  lead.summary ? h('p', {}, h('strong', {}, 'Resumen: '), lead.summary) : null,
  lead.profile?.occupation ? h('p', { class: 'small' }, h('strong', {}, 'Ocupación: '), lead.profile.occupation) : null,
  h('div', {}, h('label', { for: 'f_notes' }, 'Notas'), notes),
  h('p', { class: 'small muted' }, `Etapa más avanzada del embudo: ${lbl('stage', lead.maxFunnel)} · Alta: ${fmtDate(lead.createdAt)}`),
  err,
  h('div', { class: 'row' }, saveBtn,
    h('button', { type: 'button', class: 'secondary', onclick: () => { dlg.close(); openInCopilot(id); } }, 'Abrir en copiloto'),
    h('button', { type: 'button', class: 'secondary', onclick: () => dlg.close() }, 'Cerrar'),
    h('button', { type: 'button', class: 'danger', onclick: async () => {
      if (!confirm(`¿Borrar a ${lead.name}? No se puede deshacer.`)) return;
      try {
        await api('DELETE', `/api/leads/${id}`);
        S.state.leads = S.state.leads.filter((l) => l.id !== id);
        dlg.close();
        toast('Lead borrada');
        route();
      } catch (ex) { err.replaceChildren(errorBox(ex)); }
    } }, 'Borrar')),
  h('h3', {}, 'Historial'),
  events.length ? h('ul', { class: 'list' }, events) : h('p', { class: 'muted' }, 'Sin eventos.'));
  dlg.replaceChildren(form);
  dlg.showModal();
}

// ---------- 2. Hoy
async function viewHoy() {
  const items = await api('GET', '/api/today');
  const wrap = h('section', { class: 'card' }, h('h1', {}, 'Hoy'), h('p', { class: 'muted' }, 'Leads con seguimiento vencido o sin movimiento hace más de 20 horas.'));
  if (!items.length) {
    wrap.append(h('p', {}, 'No hay nada pendiente. Buen momento para importar chats o revisar el aprendizaje.'));
    return wrap;
  }
  wrap.append(h('ul', { class: 'list' }, items.map((it) => {
    const snooze = (hours, label) => h('button', { type: 'button', class: 'sm secondary', onclick: async (e) => {
      try {
        const l = await busy(e.currentTarget, '…', () => api('POST', `/api/leads/${it.id}/snooze`, { hours }));
        upsertLead(l);
        toast(`Pospuesta ${label}`);
        route();
      } catch (ex) { toast(ex.message); }
    } }, label);
    return h('li', {},
      h('div', { class: 'row' }, h('strong', { class: 'grow' }, it.name), h('span', { class: 'tag' }, lbl('stage', it.stage)), h('span', { class: 'tag' }, `${it.temperature}/5`)),
      h('p', { class: 'small muted' }, it.reason === 'seguimiento' ? `Seguimiento vencido (${fmtDate(it.followUpAt)})` : `Sin movimiento hace ${it.idleHours} h`),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'sm', onclick: () => openInCopilot(it.id) }, 'Abrir en copiloto'),
        h('span', { class: 'small muted' }, 'Posponer:'), snooze(3, '3 h'), snooze(24, '1 día'), snooze(72, '3 días')));
  })));
  return wrap;
}

// ---------- 3. Leads
async function viewLeads() {
  const f = S.leadFilter;
  const q = h('input', { id: 'q', type: 'search', placeholder: 'Buscar por nombre, resumen o notas', value: f.q });
  const st = h('select', { id: 'fs' }, h('option', { value: '' }, 'Todas las etapas'), S.state.meta.stages.map((s) => h('option', { value: s.key, selected: s.key === f.stage }, s.label)));
  const ob = h('select', { id: 'fo' }, h('option', { value: '' }, 'Todos los objetivos'), S.state.meta.objectives.map((o) => h('option', { value: o, selected: o === f.objective }, lbl('objective', o))));
  const list = h('div');
  const draw = () => {
    f.q = q.value; f.stage = st.value; f.objective = ob.value;
    const needle = f.q.trim().toLowerCase();
    const leads = S.state.leads.filter((l) => (!f.stage || l.stage === f.stage) && (!f.objective || l.objective === f.objective)
      && (!needle || `${l.name} ${l.summary} ${l.notes}`.toLowerCase().includes(needle)));
    const groups = S.state.meta.stages.map((s) => [s, leads.filter((l) => l.stage === s.key)]).filter(([, ls]) => ls.length);
    list.replaceChildren(...(groups.length ? groups.map(([s, ls]) => h('section', { class: 'card' },
      h('h2', {}, `${s.label} (${ls.length})`),
      h('ul', { class: 'list' }, ls.map((l) => h('li', {}, h('button', { type: 'button', class: 'leadbtn', onclick: () => openLead(l.id) },
        h('div', { class: 'row' }, h('strong', { class: 'grow' }, l.name), h('span', { class: 'tag' }, lbl('objective', l.objective)), h('span', { class: 'tag' }, `${l.temperature}/5`),
          l.objection !== 'ninguna' ? h('span', { class: 'tag' }, lbl('objection', l.objection)) : null),
        l.summary ? h('div', { class: 'small muted' }, l.summary) : null)))))) : [h('p', { class: 'card muted' }, S.state.leads.length ? 'Ninguna lead coincide con el filtro.' : 'Todavía no hay leads. Creá una en Copiloto o importá chats.')]));
  };
  [q, st, ob].forEach((el) => el.addEventListener('input', draw));
  draw();
  return h('div', {},
    h('section', { class: 'card' }, h('h1', {}, 'Leads'),
      h('div', { class: 'grid2' },
        h('div', {}, h('label', { for: 'q' }, 'Buscar'), q),
        h('div', {}, h('label', { for: 'fs' }, 'Etapa'), st),
        h('div', {}, h('label', { for: 'fo' }, 'Objetivo'), ob))),
    list);
}

// ---------- 4. Importar chats
function splitChats(text) {
  const chats = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^===\s*(.*)$/);
    if (m) { if (cur) chats.push(cur); cur = { name: m[1].replace(/=+\s*$/, '').trim() || 'Sin nombre', lines: [] }; } else if (cur) cur.lines.push(line);
  }
  if (cur) chats.push(cur);
  return chats.map((c) => ({ name: c.name, conversation: c.lines.join('\n').trim() })).filter((c) => c.conversation);
}
async function viewImportar() {
  const ta = h('textarea', { id: 'imp', class: 'tall', placeholder: '=== @usuaria1\n(chat completo)\n\n=== @usuaria2\n(chat completo)' });
  const log = h('ul', { class: 'list' });
  const progress = h('p', { class: 'small muted', 'aria-live': 'polite' });
  const btn = h('button', { type: 'button', onclick: async () => {
    const chats = splitChats(ta.value);
    if (!chats.length) return toast('No encontré chats. Cada uno tiene que empezar con una línea "=== usuario".');
    log.replaceChildren();
    let done = 0;
    let ok = 0;
    await busy(btn, 'Importando…', async () => {
      const queue = [...chats];
      const worker = async () => {
        while (queue.length) {
          const c = queue.shift();
          try {
            const l = await api('POST', '/api/classify', c);
            upsertLead(l);
            ok++;
            log.append(h('li', {}, h('strong', {}, l.name), ' — ', `${lbl('stage', l.stage)} · llegó a ${lbl('stage', l.maxFunnel)} · ${lbl('objective', l.objective)} · ${l.temperature}/5`, h('div', { class: 'small muted' }, l.summary)));
          } catch (e) {
            log.append(h('li', {}, h('strong', {}, c.name), h('div', { class: 'error' }, e.message)));
            if (/sesión/.test(e.message)) queue.length = 0;
          }
          done++;
          progress.textContent = `${done} de ${chats.length} procesados`;
        }
      };
      await Promise.all([worker(), worker()]);
    });
    toast(`Importadas ${ok} de ${chats.length}`);
  } }, 'Clasificar e importar');
  const fallback = h('div');
  const readChats = () => {
    const chats = splitChats(ta.value);
    if (!chats.length) throw new Error('No encontré chats. Cada uno tiene que empezar con una línea "=== usuario".');
    return chats;
  };
  const copyBtn = h('button', { type: 'button', class: hasApi() ? 'secondary' : null, onclick: async () => {
    let chats;
    try { chats = readChats(); } catch (e) { return toast(e.message); }
    if (await copyPrompt(copyBtn, () => api('POST', '/api/prompt/classify', { chats }), fallback)) showPasteHint(copyBtn.closest('section'));
  } }, 'Copiar prompt para Claude.ai');
  const paste = pasteBox({
    id: 'pasteImport',
    intro: 'Pegá los chats arriba y tocá "Copiar prompt para Claude.ai". No borres los chats hasta cargar la respuesta.',
    onLoad: async (text) => {
      const r = await api('POST', '/api/classify/manual', { chats: readChats(), response: text });
      r.created.forEach(upsertLead);
      log.replaceChildren(...r.created.map((l) => h('li', {}, h('strong', {}, l.name), ' — ', `${lbl('stage', l.stage)} · llegó a ${lbl('stage', l.maxFunnel)} · ${lbl('objective', l.objective)} · ${l.temperature}/5`, h('div', { class: 'small muted' }, l.summary))),
        ...r.missing.map((n) => h('li', {}, h('strong', {}, n), h('div', { class: 'error' }, 'Claude no devolvió este chat en la respuesta; volvé a importarlo solo.'))));
      toast(`Importadas ${r.created.length} leads`);
    },
  });
  return h('section', { class: 'card stack' },
    h('h1', {}, 'Importar chats'),
    h('p', { class: 'muted' }, hasApi()
      ? 'Pegá varios chats. Cada uno empieza con una línea que arranca con "===" seguida del usuario. Claude clasifica cada chat y lo carga como lead (de a dos en paralelo).'
      : 'Pegá varios chats. Cada uno empieza con una línea que arranca con "===" seguida del usuario. Copiá el prompt, pegalo en Claude.ai y traé la respuesta: cada chat se carga como lead. Hasta 60 chats por vez.'),
    h('div', {}, h('label', { for: 'imp' }, 'Chats'), ta), h('div', { class: 'row' }, hasApi() ? btn : null, copyBtn), fallback,
    hasApi() ? null : paste, progress, log);
}

// ---------- 5. Biblioteca
async function viewBiblioteca() {
  const cats = S.state.meta.categories;
  const filter = h('select', { id: 'libcat' }, h('option', { value: '' }, 'Todas las categorías'), cats.map((c) => h('option', { value: c }, lbl('category', c))));
  const list = h('div');
  const itemForm = (item, onDone) => {
    const cat = select(`c_${item.id || 'new'}`, cats, item.category || 'apertura', 'category');
    const title = h('input', { value: item.title || '', placeholder: 'Título corto', 'aria-label': 'Título', maxlength: 160 });
    const text = h('textarea', { class: 'msg', 'aria-label': 'Texto del mensaje', maxlength: 4000 });
    text.value = item.text || '';
    const saveBtn = h('button', { type: 'button', class: 'sm' }, item.id ? 'Guardar' : 'Agregar');
    saveBtn.addEventListener('click', async () => {
      try {
        const body = { category: cat.value, title: title.value, text: text.value };
        const saved = await busy(saveBtn, 'Guardando…', () => (item.id ? api('PUT', `/api/library/${item.id}`, body) : api('POST', '/api/library', body)));
        if (item.id) S.state.library = S.state.library.map((m) => (m.id === saved.id ? saved : m)); else S.state.library.push(saved);
        toast('Guardado');
        onDone();
      } catch (e) { toast(e.message); }
    });
    const del = item.id ? h('button', { type: 'button', class: 'sm danger', onclick: async () => {
      if (!confirm('¿Borrar este mensaje de la biblioteca?')) return;
      try {
        await api('DELETE', `/api/library/${item.id}`);
        S.state.library = S.state.library.filter((m) => m.id !== item.id);
        toast('Borrado');
        onDone();
      } catch (e) { toast(e.message); }
    } }, 'Borrar') : null;
    return h('div', { class: 'msgcard stack' }, h('div', { class: 'grid2' }, h('div', {}, h('label', { for: cat.id }, 'Categoría'), cat), h('div', {}, h('label', {}, 'Título', title))), text,
      h('div', { class: 'row' }, item.id ? h('button', { type: 'button', class: 'sm secondary', onclick: () => copy(text.value) }, 'Copiar') : null, saveBtn, del));
  };
  const draw = () => {
    const shown = cats.filter((c) => !filter.value || c === filter.value);
    list.replaceChildren(...shown.map((c) => {
      const items = S.state.library.filter((m) => m.category === c);
      if (!items.length && filter.value !== c) return null;
      return h('section', { class: 'card' }, h('h2', {}, `${lbl('category', c)} (${items.length})`), items.length ? items.map((m) => itemForm(m, draw)) : h('p', { class: 'muted' }, 'Sin mensajes en esta categoría.'));
    }).filter(Boolean));
  };
  filter.addEventListener('change', draw);
  draw();
  const addWrap = h('div');
  const addBtn = h('button', { type: 'button', class: 'secondary', onclick: () => {
    addWrap.replaceChildren(itemForm({ category: filter.value || 'apertura' }, () => { addWrap.replaceChildren(); draw(); }));
  } }, 'Nuevo mensaje');
  return h('div', {},
    h('section', { class: 'card stack' }, h('h1', {}, 'Biblioteca'), h('p', { class: 'muted' }, 'Mensajes aprobados. El copiloto los usa como referencia según la situación.'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', { for: 'libcat' }, 'Categoría'), filter), addBtn), addWrap),
    list);
}

// ---------- 6. Casos de éxito
async function viewCasos() {
  const fields = [['perfil', 'Perfil (edad, ocupación, situación)'], ['objetivo', 'Objetivo'], ['probado', 'Qué había probado'], ['resultado', 'Resultado'], ['tiempo', 'En cuánto tiempo'], ['frase', 'Frase de ella (opcional)']];
  const list = h('div');
  const caseForm = (c, onDone) => {
    const inputs = Object.fromEntries(fields.map(([k]) => [k, h('textarea', { id: `${k}_${c.id || 'new'}`, class: 'msg', maxlength: 1000 })]));
    for (const [k] of fields) inputs[k].value = c[k] || '';
    const saveBtn = h('button', { type: 'button', class: 'sm' }, c.id ? 'Guardar' : 'Agregar caso');
    saveBtn.addEventListener('click', async () => {
      const body = Object.fromEntries(fields.map(([k]) => [k, inputs[k].value]));
      try {
        const saved = await busy(saveBtn, 'Guardando…', () => (c.id ? api('PUT', `/api/cases/${c.id}`, body) : api('POST', '/api/cases', body)));
        if (c.id) S.state.cases = S.state.cases.map((x) => (x.id === saved.id ? saved : x)); else S.state.cases.push(saved);
        toast('Caso guardado');
        onDone();
      } catch (e) { toast(e.message); }
    });
    const del = c.id ? h('button', { type: 'button', class: 'sm danger', onclick: async () => {
      if (!confirm('¿Borrar este caso de éxito?')) return;
      try {
        await api('DELETE', `/api/cases/${c.id}`);
        S.state.cases = S.state.cases.filter((x) => x.id !== c.id);
        onDone();
      } catch (e) { toast(e.message); }
    } }, 'Borrar') : null;
    return h('div', { class: 'card stack' }, h('div', { class: 'grid2' }, fields.map(([k, label]) => h('div', {}, h('label', { for: inputs[k].id }, label), inputs[k]))), h('div', { class: 'row' }, saveBtn, del));
  };
  const draw = () => list.replaceChildren(...(S.state.cases.length ? S.state.cases.map((c) => caseForm(c, draw)) : [h('p', { class: 'card notice' }, 'No hay casos cargados. Mientras no cargues ninguno, el copiloto deja un marcador [CASO DE ÉXITO] en lugar de inventar uno.')]));
  draw();
  const addWrap = h('div');
  return h('div', {},
    h('section', { class: 'card stack' }, h('h1', {}, 'Casos de éxito'), h('p', { class: 'muted' }, 'Solo casos reales y confirmados. El copiloto únicamente usa los que cargues acá.'),
      h('button', { type: 'button', class: 'secondary', onclick: () => addWrap.replaceChildren(caseForm({}, () => { addWrap.replaceChildren(); draw(); })) }, 'Nuevo caso'), addWrap),
    list);
}

// ---------- 7. Aprendizaje
function rateTable(headers, rows) {
  return h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, headers.map(([t, num]) => h('th', { class: num ? 'num' : null, scope: 'col' }, t)))),
    h('tbody', {}, rows.length ? rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: headers[i][1] ? 'num' : null }, c)))) : h('tr', {}, h('td', { colspan: headers.length, class: 'muted' }, 'Sin datos todavía.')))));
}
async function viewAprendizaje() {
  const L = await api('GET', '/api/learning');
  const read = h('div', { class: 'readout' });
  const btn = h('button', { type: 'button', onclick: async () => {
    try {
      const r = await busy(btn, 'Leyendo con Claude…', () => api('POST', '/api/learning/read', {}));
      read.replaceChildren(r.text);
    } catch (e) { read.replaceChildren(errorBox(e)); }
  } }, 'Lectura con Claude');
  const lfb = h('div');
  const lcopy = h('button', { type: 'button', class: hasApi() ? 'secondary' : null, onclick: () => copyPrompt(lcopy, () => api('GET', '/api/prompt/learning'), lfb) }, 'Copiar prompt para Claude.ai');
  const readCard = h('section', { class: 'card stack' }, h('h2', {}, 'Lectura con Claude'), h('p', { class: 'muted small' }, hasApi() ? 'Qué funciona, dónde se cae y qué probar.' : 'Copiá el prompt y pegalo en Claude.ai: te responde qué funciona, dónde se cae y qué probar.'),
    h('div', { class: 'row' }, hasApi() ? btn : null, lcopy, hasApi() ? null : claudeLink()), lfb, read);
  return h('div', {},
    h('section', { class: 'card' }, h('h1', {}, 'Aprendizaje'),
      L.lowData ? h('div', { class: 'notice' }, `Pocos datos todavía (${L.totals.booked} agendadas, ${L.totals.sent} mensajes registrados). Tomá estas tasas como pistas, no como conclusiones. Se vuelven confiables con al menos 5 agendas y 20 mensajes marcados con "La envié".`) : null,
      h('dl', { class: 'kv' },
        h('dt', {}, 'Leads'), h('dd', {}, L.totals.leads), h('dt', {}, 'Agendadas'), h('dd', {}, `${L.totals.booked} (${pct(L.totals.rate)})`),
        h('dt', {}, 'Mensajes registrados'), h('dd', {}, L.totals.sent),
        h('dt', {}, 'Tiempo mediano hasta agendar'), h('dd', {}, L.medianHoursToBook === null ? '—' : L.medianHoursToBook < 48 ? `${Math.round(L.medianHoursToBook)} h` : `${(L.medianHoursToBook / 24).toFixed(1)} días`))),
    readCard,
    h('section', { class: 'card' }, h('h2', {}, 'Tasa de agenda por enfoque y etapa'),
      rateTable([['Enfoque'], ['Etapa'], ['Enviados', 1], ['Agendaron', 1], ['Tasa', 1]], L.byApproachStage.map((r) => [lbl('approach', r.approach), lbl('stage', r.stage), r.sent, r.booked, pct(r.rate)]))),
    h('section', { class: 'card grid2' },
      h('div', {}, h('h2', {}, 'Por objeción'), rateTable([['Objeción'], ['Leads', 1], ['Tasa', 1]], L.byObjection.map((r) => [lbl('objection', r.key), r.leads, pct(r.rate)]))),
      h('div', {}, h('h2', {}, 'Por calificación'), rateTable([['Calificación'], ['Leads', 1], ['Tasa', 1]], L.byQualification.map((r) => [lbl('qualification', r.key), r.leads, pct(r.rate)])))),
    h('section', { class: 'card' }, h('h2', {}, 'Mensajes enviados en leads que agendaron'),
      h('p', { class: 'muted small' }, 'Estos se pasan como ejemplos en cada análisis del copiloto.'),
      L.winners.length ? h('ul', { class: 'list' }, L.winners.map((w) => h('li', {}, h('div', { class: 'row' }, h('span', { class: 'tag' }, lbl('stage', w.stage)), h('span', { class: 'tag' }, lbl('approach', w.approach)), h('span', { class: 'small muted' }, `${w.leadName} · ${fmtDate(w.at)}`)), h('div', {}, w.text))))
        : h('p', { class: 'muted' }, 'Todavía no hay. Marcá "La envié" en los mensajes que mandes y pasá las leads a "Agendada" cuando agenden.')));
}

// ---------- 8. Reporte semanal
async function viewReporte() {
  const R = await api('GET', `/api/report?week=${S.week}`);
  const c = R.current;
  const p = R.previous;
  const delta = (a, b, isRate) => {
    if (a === null || b === null || a === undefined || b === undefined) return '';
    const d = a - b;
    if (!d) return h('span', { class: 'muted' }, '=');
    return h('span', { class: d > 0 ? 'up' : 'down' }, `${d > 0 ? '+' : ''}${isRate ? Math.round(d * 100) + ' pts' : d}`);
  };
  const row = (label, k, isRate) => [label, isRate ? pct(c[k]) : c[k], isRate ? pct(p[k]) : p[k], delta(c[k], p[k], isRate)];
  const rows = [row('Leads nuevas', 'newLeads'), row('Llegaron a propuesta', 'reachedProposal'), row('Agendadas', 'booked'), row('Mensajes enviados', 'sent'),
    row('Conversión lead → agenda', 'leadToBook', true), row('Conversión propuesta → agenda', 'proposalToBook', true), row('No-shows', 'noShows')];
  const objs = Object.entries(c.objections).sort((a, b) => b[1] - a[1]);
  const read = h('div', { class: 'readout' });
  const btn = h('button', { type: 'button', onclick: async () => {
    try {
      const r = await busy(btn, 'Leyendo con Claude…', () => api('POST', `/api/report/read?week=${S.week}`, {}));
      read.replaceChildren(r.text);
    } catch (e) { read.replaceChildren(errorBox(e)); }
  } }, 'Lectura con Claude');
  const nav = h('div', { class: 'row' },
    h('button', { type: 'button', class: 'secondary sm', onclick: () => { S.week++; route(); } }, '← Semana anterior'),
    h('button', { type: 'button', class: 'secondary sm', disabled: S.week === 0, onclick: () => { S.week = Math.max(0, S.week - 1); route(); } }, 'Semana siguiente →'));
  const drop = c.biggestDrop;
  return h('div', {},
    h('section', { class: 'card stack' }, h('h1', {}, 'Reporte semanal'),
      h('p', { class: 'muted' }, `Del ${fmtDay(R.range.start)} al ${fmtDay(R.range.end)}${S.week === 0 ? ' (últimos 7 días)' : ''}, comparado con los 7 días anteriores.`), nav,
      rateTable([['Métrica'], ['Esta semana', 1], ['Anterior', 1], ['Cambio', 1]], rows),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Mayor caída del embudo'), h('dd', {}, drop && drop.lost ? `${lbl('stage', drop.from)} → ${lbl('stage', drop.to)}: se perdió el ${pct(drop.drop)} (${drop.lost} leads)` : 'Sin datos suficientes'),
        h('dt', {}, 'Objeciones'), h('dd', {}, objs.length ? objs.map(([k, n]) => `${lbl('objection', k)}: ${n}`).join(' · ') : 'Ninguna registrada'),
        c.withoutFollowUp !== null ? h('dt', {}, 'Leads sin seguimiento') : null,
        c.withoutFollowUp !== null ? h('dd', {}, `${c.withoutFollowUp} activas sin fecha de seguimiento o con seguimiento vencido`) : null)),
    (() => {
      const fb = h('div');
      const cp = h('button', { type: 'button', class: hasApi() ? 'secondary' : null, onclick: () => copyPrompt(cp, () => api('GET', `/api/prompt/report?week=${S.week}`), fb) }, 'Copiar prompt para Claude.ai');
      return h('section', { class: 'card stack' }, h('h2', {}, 'Lectura con Claude'),
        hasApi() ? null : h('p', { class: 'muted small' }, 'Copiá el prompt y pegalo en Claude.ai para que te escriba la lectura de la semana.'),
        h('div', { class: 'row' }, hasApi() ? btn : null, cp, hasApi() ? null : claudeLink()), fb, read);
    })());
}

// ---------- 9. Embudo
async function viewEmbudo() {
  const F = await api('GET', '/api/funnel');
  const max = Math.max(1, F.steps[0].count);
  const rows = [];
  F.steps.forEach((s, i) => {
    const fill = h('div', { class: 'fill' });
    fill.style.width = `${(s.count / max) * 100}%`;
    rows.push(h('div', { class: 'bar' }, h('span', {}, lbl('stage', s.stage)), h('div', { class: 'track', role: 'img', 'aria-label': `${lbl('stage', s.stage)}: ${s.count} leads` }, fill), h('span', { class: 'num' }, s.count)));
    if (i < F.steps.length - 1 && s.dropToNext !== null) {
      const worst = F.biggest && F.biggest.from === s.stage && F.biggest.lost > 0;
      rows.push(h('p', { class: `drop${worst ? ' worst' : ''}` }, `↓ se pierde el ${pct(s.dropToNext)}${worst ? ' · mayor caída' : ''}`));
    }
  });
  return h('section', { class: 'card' }, h('h1', {}, 'Embudo acumulado'),
    h('p', { class: 'muted' }, 'Cuántas leads llegaron al menos a cada etapa, desde el principio.'),
    F.steps[0].count ? rows : h('p', {}, 'Todavía no hay leads.'));
}

// ---------- 10. Cerebro
async function viewCerebro() {
  const ta = h('textarea', { id: 'brain', class: 'tall', maxlength: 40000 });
  ta.value = S.state.brain;
  const saveBtn = h('button', { type: 'button', onclick: async () => {
    try {
      const r = await busy(saveBtn, 'Guardando…', () => api('PUT', '/api/brain', { text: ta.value }));
      S.state.brain = r.text;
      toast('Cerebro guardado');
    } catch (e) { toast(e.message); }
  } }, 'Guardar');
  const resetBtn = h('button', { type: 'button', class: 'secondary', onclick: async () => {
    if (!confirm('¿Reemplazar el texto por el original? Se pierden tus cambios.')) return;
    try {
      const r = await api('POST', '/api/brain/reset', {});
      S.state.brain = r.text;
      ta.value = r.text;
      toast('Restaurado el original');
    } catch (e) { toast(e.message); }
  } }, 'Restaurar original');
  const file = h('input', { type: 'file', id: 'restoreFile', accept: 'application/json,.json' });
  const restoreBtn = h('button', { type: 'button', class: 'danger', onclick: async () => {
    const f = file.files[0];
    if (!f) return toast('Elegí primero el archivo de respaldo.');
    let data;
    try { data = JSON.parse(await f.text()); } catch { return toast('Ese archivo no es un JSON válido.'); }
    if (!confirm(`Esto reemplaza TODO (leads, biblioteca, casos y cerebro) por el respaldo con ${data?.leads?.length ?? 0} leads. ¿Seguro?`)) return;
    try {
      await busy(restoreBtn, 'Restaurando…', () => api('POST', '/api/backup/restore', data));
      await loadState();
      toast('Respaldo restaurado');
      route();
    } catch (e) { toast(e.message); }
  } }, 'Restaurar respaldo');
  return h('div', {},
    h('section', { class: 'card stack' }, h('h1', {}, 'Cerebro del negocio'),
      h('p', { class: 'muted' }, 'Todo el contexto que Claude lee en cada consulta. Las reglas de precio, casos y presión se aplican siempre, aunque las borres de acá.'),
      h('div', {}, h('label', { for: 'brain' }, 'Contexto'), ta), h('div', { class: 'row' }, saveBtn, resetBtn)),
    h('section', { class: 'card stack' }, h('h2', {}, 'Copia de respaldo'),
      h('p', { class: 'muted' }, 'Descargá todo en un JSON (leads, biblioteca, casos y cerebro) o restaurá uno anterior.'),
      h('div', { class: 'row' }, h('a', { class: 'btn secondary', href: '/api/backup', download: '' }, 'Descargar respaldo')),
      h('div', {}, h('label', { for: 'restoreFile' }, 'Archivo de respaldo'), file), h('div', { class: 'row' }, restoreBtn)));
}

const VIEWS = { copiloto: viewCopiloto, hoy: viewHoy, leads: viewLeads, importar: viewImportar, biblioteca: viewBiblioteca, casos: viewCasos, aprendizaje: viewAprendizaje, reporte: viewReporte, embudo: viewEmbudo, cerebro: viewCerebro };

boot().catch((e) => $('#main').replaceChildren(errorBox(e)));
