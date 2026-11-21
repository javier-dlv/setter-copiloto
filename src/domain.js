// Reglas del dominio: etapas, embudo, validación y eventos de una lead.
import crypto from 'node:crypto';

export const STAGES = [
  { key: 'apertura', label: 'Apertura' },
  { key: 'calificando', label: 'Calificando' },
  { key: 'caso', label: 'Caso de éxito' },
  { key: 'propuesta', label: 'Propuesta de llamada' },
  { key: 'link', label: 'Link enviado' },
  { key: 'agendada', label: 'Agendada' },
  { key: 'no_show', label: 'No-show' },
  { key: 'seguimiento', label: 'En seguimiento' },
  { key: 'fria', label: 'Fría' },
  { key: 'perdida', label: 'Perdida' },
];
export const STAGE_KEYS = STAGES.map((s) => s.key);
export const FUNNEL = ['apertura', 'calificando', 'caso', 'propuesta', 'link', 'agendada'];
export const OBJECTIVES = ['peso', 'desinflamar', 'ambas', 'sin_dato'];
export const OBJECTIONS = ['ninguna', 'dinero', 'tiempo', 'lo_pienso', 'pareja', 'precio', 'desconfianza', 'otra'];
export const QUALIFICATIONS = ['alta', 'media', 'baja', 'sin_dato'];
export const APPROACHES = ['empatia', 'curiosidad', 'directo', 'prueba_social', 'reencuadre', 'liviano'];
export const MODES = ['respondio', 'no_responde', 'recien_entro', 'ya_agendo', 'no_se_presento', 'reactivar'];
export const LIBRARY_CATEGORIES = [
  'apertura', 'paso1', 'paso2', 'paso3', 'paso4', 'paso5', 'paso6', 'paso7', 'paso8',
  'objeciones', 'seguimientos', 'confirmacion', 'no_show', 'funciono',
];
// Etapas donde la lead ya no necesita que la persigamos desde "Hoy".
export const INACTIVE_STAGES = ['agendada', 'fria', 'perdida'];

const HOUR = 3600 * 1000;
export const IDLE_HOURS = 20;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(400, 'Identificador inválido.');
  return id;
}
export const newId = () => crypto.randomUUID();

export function str(v, max, field) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new HttpError(400, `El campo "${field}" tiene que ser texto.`);
  if (v.length > max) throw new HttpError(413, `El campo "${field}" es demasiado largo (máximo ${max} caracteres).`);
  return v;
}
export function oneOf(v, list, field) {
  if (!list.includes(v)) throw new HttpError(400, `Valor inválido para "${field}".`);
  return v;
}
export function intIn(v, min, max, field) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `"${field}" tiene que ser un número entre ${min} y ${max}.`);
  return n;
}
export function isoOrNull(v, field) {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  if (typeof v !== 'string' || Number.isNaN(d.getTime())) throw new HttpError(400, `Fecha inválida en "${field}".`);
  return d.toISOString();
}

export const LIMITS = {
  name: 120,
  conversation: 60000,
  notes: 5000,
  summary: 3000,
  message: 4000,
  title: 160,
  brain: 40000,
};

export function funnelIndex(stage) {
  return FUNNEL.indexOf(stage);
}

// Registra que la lead llegó (al menos) a esta etapa del embudo.
export function advanceFunnel(lead, stage, at) {
  const target = stage === 'no_show' ? 'agendada' : stage;
  const idx = funnelIndex(target);
  if (idx < 0) return;
  lead.reachedAt = lead.reachedAt || {};
  for (let i = 0; i <= idx; i++) {
    if (!lead.reachedAt[FUNNEL[i]]) lead.reachedAt[FUNNEL[i]] = at;
  }
  if (idx > funnelIndex(lead.maxFunnel)) lead.maxFunnel = FUNNEL[idx];
}

export function setStage(lead, stage, at, source = 'manual') {
  oneOf(stage, STAGE_KEYS, 'etapa');
  if (lead.stage === stage) return false;
  lead.events.push({ type: 'stage', from: lead.stage, to: stage, at, source });
  lead.stage = stage;
  lead.lastActivityAt = at;
  advanceFunnel(lead, stage, at);
  return true;
}

export function newLead({ name = '', conversation = '', stage = 'apertura' } = {}, at) {
  const lead = {
    name: str(name, LIMITS.name, 'nombre').trim() || 'Sin nombre',
    objective: 'sin_dato',
    stage: oneOf(stage, STAGE_KEYS, 'etapa'),
    objection: 'ninguna',
    temperature: 3,
    qualification: 'sin_dato',
    profile: { occupation: '', tried: '', stuck: 'sin_dato' },
    conversation: str(conversation, LIMITS.conversation, 'conversación'),
    notes: '',
    summary: '',
    lastAnalysis: null,
    events: [{ type: 'stage', from: null, to: stage, at, source: 'alta' }],
    followUpAt: null,
    maxFunnel: 'apertura',
    reachedAt: {},
    lastActivityAt: at,
  };
  advanceFunnel(lead, stage, at);
  return lead;
}

// Cambios manuales desde la interfaz.
export function applyPatch(lead, body, at) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Cuerpo inválido.');
  if ('name' in body) lead.name = str(body.name, LIMITS.name, 'nombre').trim() || 'Sin nombre';
  if ('objective' in body) lead.objective = oneOf(body.objective, OBJECTIVES, 'objetivo');
  if ('objection' in body) lead.objection = oneOf(body.objection, OBJECTIONS, 'objeción');
  if ('qualification' in body) lead.qualification = oneOf(body.qualification, QUALIFICATIONS, 'calificación');
  if ('temperature' in body) lead.temperature = intIn(body.temperature, 1, 5, 'temperatura');
  if ('conversation' in body) lead.conversation = str(body.conversation, LIMITS.conversation, 'conversación');
  if ('notes' in body) lead.notes = str(body.notes, LIMITS.notes, 'notas');
  if ('summary' in body) lead.summary = str(body.summary, LIMITS.summary, 'resumen');
  if ('followUpAt' in body) lead.followUpAt = isoOrNull(body.followUpAt, 'seguimiento');
  if ('stage' in body) setStage(lead, body.stage, at, 'manual');
  return lead;
}

const clampInt = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

// Vuelca lo que detectó Claude sobre la lead.
export function applyAnalysis(lead, a, at) {
  if (OBJECTIVES.includes(a.perfil?.objetivo) && a.perfil.objetivo !== 'sin_dato') lead.objective = a.perfil.objetivo;
  if (QUALIFICATIONS.includes(a.perfil?.calificacion) && a.perfil.calificacion !== 'sin_dato') lead.qualification = a.perfil.calificacion;
  if (OBJECTIONS.includes(a.objecion)) lead.objection = a.objecion;
  lead.temperature = clampInt(a.temperatura, 1, 5, lead.temperature);
  lead.profile = {
    occupation: String(a.perfil?.ocupacion || lead.profile?.occupation || '').slice(0, 300),
    tried: String(a.perfil?.que_intento || lead.profile?.tried || '').slice(0, 600),
    stuck: ['si', 'no', 'sin_dato'].includes(a.perfil?.estancada) ? a.perfil.estancada : 'sin_dato',
  };
  if (a.resumen) lead.summary = String(a.resumen).slice(0, LIMITS.summary);
  if (STAGE_KEYS.includes(a.etapa)) setStage(lead, a.etapa, at, 'copiloto');
  lead.lastActivityAt = at;
}

export function recordSent(lead, { text, approach, followUpHours }, at) {
  const t = str(text, LIMITS.message, 'mensaje').trim();
  if (!t) throw new HttpError(400, 'El mensaje está vacío.');
  const ap = APPROACHES.includes(approach) ? approach : 'directo';
  lead.events.push({ type: 'sent', text: t, approach: ap, stage: lead.stage, at });
  lead.lastActivityAt = at;
  if (followUpHours !== undefined && followUpHours !== null && followUpHours !== '') {
    const h = intIn(followUpHours, 1, 24 * 30, 'horas de seguimiento');
    lead.followUpAt = new Date(new Date(at).getTime() + h * HOUR).toISOString();
  }
}

export function todayList(leads, now) {
  const t = now.getTime();
  const out = [];
  for (const l of leads) {
    if (['fria', 'perdida'].includes(l.stage)) continue;
    const due = l.followUpAt && new Date(l.followUpAt).getTime() <= t;
    const last = new Date(l.lastActivityAt || l.updatedAt || l.createdAt).getTime();
    const idleH = (t - last) / HOUR;
    const idle = !INACTIVE_STAGES.includes(l.stage) && idleH > IDLE_HOURS && !(l.followUpAt && new Date(l.followUpAt).getTime() > t);
    if (due || idle) out.push({ id: l.id, name: l.name, stage: l.stage, temperature: l.temperature, followUpAt: l.followUpAt, idleHours: Math.round(idleH), reason: due ? 'seguimiento' : 'sin_movimiento' });
  }
  return out.sort((a, b) => (a.reason === b.reason ? b.idleHours - a.idleHours : a.reason === 'seguimiento' ? -1 : 1));
}

// Parte el texto de "Importar chats": cada bloque arranca con una línea "=== usuario".
export function splitChats(text) {
  const chats = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^===\s*(.*)$/);
    if (m) {
      if (cur) chats.push(cur);
      cur = { name: m[1].replace(/=+\s*$/, '').trim(), lines: [] };
    } else if (cur) cur.lines.push(line);
  }
  if (cur) chats.push(cur);
  return chats
    .map((c) => ({ name: c.name || 'Sin nombre', conversation: c.lines.join('\n').trim() }))
    .filter((c) => c.conversation);
}
