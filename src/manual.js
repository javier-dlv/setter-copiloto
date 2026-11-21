// Modo sin API: la app arma el prompt para pegar en claude.ai y lee la respuesta pegada de vuelta.
import { HttpError, STAGE_KEYS, FUNNEL, OBJECTIVES, OBJECTIONS, QUALIFICATIONS, APPROACHES } from './domain.js';

const list = (arr) => arr.join(' | ');

export const ANALYSIS_FORMAT = `FORMATO DE RESPUESTA
Respondé ÚNICAMENTE con un bloque de código JSON (sin texto antes ni después) con exactamente esta forma:
\`\`\`json
{
  "etapa": "${list(STAGE_KEYS)}",
  "paso": 1,
  "resumen": "2 o 3 oraciones",
  "perfil": {
    "objetivo": "${list(OBJECTIVES)}",
    "ocupacion": "texto o vacío",
    "calificacion": "${list(QUALIFICATIONS)}",
    "que_intento": "texto o vacío",
    "estancada": "si | no | sin_dato"
  },
  "objecion": "${list(OBJECTIONS)}",
  "temperatura": 3,
  "siguiente_paso": "texto",
  "mensajes": [
    { "enfoque": "${list(APPROACHES)}", "titulo": "texto corto", "texto": "mensaje listo para copiar" }
  ],
  "evitar": ["texto"],
  "seguimiento": { "texto": "mensaje por si no responde", "horas": 24 },
  "faltan_confirmar": ["texto"]
}
\`\`\`
Donde hay opciones separadas por " | ", elegí UNA y escribila tal cual. "paso" va de 1 a 8, "temperatura" de 1 a 5. Poné 2 o 3 mensajes con enfoques distintos.`;

export const CLASSIFY_FORMAT = `FORMATO DE RESPUESTA
Respondé ÚNICAMENTE con un bloque de código JSON (sin texto antes ni después): una lista con un objeto por chat, en el mismo orden:
\`\`\`json
[
  {
    "usuario": "el usuario tal como aparece después de ===",
    "etapa": "${list(STAGE_KEYS)}",
    "max_etapa": "${list(FUNNEL)}",
    "objetivo": "${list(OBJECTIVES)}",
    "objecion": "${list(OBJECTIONS)}",
    "temperatura": 3,
    "calificacion": "${list(QUALIFICATIONS)}",
    "resumen": "2 oraciones"
  }
]
\`\`\`
Donde hay opciones separadas por " | ", elegí UNA y escribila tal cual. "max_etapa" es la etapa más avanzada del embudo a la que llegó el chat. "temperatura" va de 1 a 5.`;

const NOT_FOUND = 'No encontré la respuesta en formato JSON en lo que pegaste. Copiá la respuesta completa de Claude (con el botón "Copiar" de claude.ai) y volvé a pegarla.';

// Saca el JSON de la respuesta pegada: acepta bloque ```json, texto alrededor o JSON pelado.
export function extractJson(text, want = 'object') {
  const s = String(text || '').trim();
  if (!s) throw new HttpError(400, 'Pegá la respuesta de Claude antes de cargarla.');
  const candidates = [];
  for (const m of s.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(m[1]);
  const open = want === 'array' ? '[' : '{';
  const close = want === 'array' ? ']' : '}';
  const a = s.indexOf(open);
  const b = s.lastIndexOf(close);
  if (a >= 0 && b > a) candidates.push(s.slice(a, b + 1));
  candidates.push(s);
  for (const c of candidates) {
    try {
      const v = JSON.parse(c.trim());
      if (want === 'array' && Array.isArray(v)) return v;
      if (want === 'array' && v && Array.isArray(v.chats)) return v.chats;
      if (want === 'object' && v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch { /* probamos el siguiente */ }
  }
  throw new HttpError(400, NOT_FOUND);
}

const txt = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pick = (v, allowed, def) => {
  const k = typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_').normalize('NFD').replace(/[̀-ͯ]/g, '') : '';
  return allowed.includes(k) ? k : def;
};
const num = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const strList = (v) => (Array.isArray(v) ? v.map((x) => txt(x, 500)).filter(Boolean).slice(0, 10) : []);

export function normalizeAnalysis(raw) {
  const p = raw.perfil && typeof raw.perfil === 'object' ? raw.perfil : {};
  const mensajes = (Array.isArray(raw.mensajes) ? raw.mensajes : [])
    .map((m) => ({ enfoque: pick(m?.enfoque, APPROACHES, 'directo'), titulo: txt(m?.titulo, 160), texto: txt(m?.texto) }))
    .filter((m) => m.texto)
    .slice(0, 3);
  if (!mensajes.length) throw new HttpError(400, 'La respuesta pegada no trae mensajes sugeridos. Pedile a Claude que responda con el formato JSON completo y volvé a pegarla.');
  return {
    etapa: pick(raw.etapa, STAGE_KEYS, null),
    paso: num(raw.paso, 1, 8, 1),
    resumen: txt(raw.resumen, 3000),
    perfil: {
      objetivo: pick(p.objetivo, OBJECTIVES, 'sin_dato'),
      ocupacion: txt(p.ocupacion, 300),
      calificacion: pick(p.calificacion, QUALIFICATIONS, 'sin_dato'),
      que_intento: txt(p.que_intento, 600),
      estancada: pick(p.estancada, ['si', 'no', 'sin_dato'], 'sin_dato'),
    },
    objecion: pick(raw.objecion, OBJECTIONS, 'ninguna'),
    temperatura: num(raw.temperatura, 1, 5, 3),
    siguiente_paso: txt(raw.siguiente_paso, 1000),
    mensajes,
    evitar: strList(raw.evitar),
    seguimiento: { texto: txt(raw.seguimiento?.texto), horas: num(raw.seguimiento?.horas, 1, 24 * 30, 24) },
    faltan_confirmar: strList(raw.faltan_confirmar),
  };
}

export function normalizeClassification(raw) {
  return {
    usuario: txt(raw?.usuario, 120),
    etapa: pick(raw?.etapa, STAGE_KEYS, 'apertura'),
    max_etapa: pick(raw?.max_etapa, FUNNEL, 'apertura'),
    objetivo: pick(raw?.objetivo, OBJECTIVES, 'sin_dato'),
    objecion: pick(raw?.objecion, OBJECTIONS, 'ninguna'),
    temperatura: num(raw?.temperatura, 1, 5, 3),
    calificacion: pick(raw?.calificacion, QUALIFICATIONS, 'sin_dato'),
    resumen: txt(raw?.resumen, 3000),
  };
}

export function classifyManyUser(chats) {
  return `Clasificá cada una de estas ${chats.length} conversaciones de setteo de Instagram. Cada chat empieza con una línea "=== usuario". Para cada una indicá la etapa actual, la etapa más avanzada del embudo a la que llegó, objetivo, objeción principal, temperatura 1-5, calificación económica y un resumen de 2 oraciones.\n\n${chats.map((c) => `=== ${c.name}\n${c.conversation}`).join('\n\n')}`;
}
