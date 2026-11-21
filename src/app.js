// Servidor Express: API + archivos estáticos.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STAGES, FUNNEL, OBJECTIVES, OBJECTIONS, QUALIFICATIONS, APPROACHES, MODES, LIBRARY_CATEGORIES,
  HttpError, assertId, newId, str, oneOf, intIn, LIMITS,
  newLead, applyPatch, applyAnalysis, recordSent, advanceFunnel, todayList,
} from './domain.js';
import { createAuth, createLoginLimiter } from './auth.js';
import { learning, weekly, funnel, winners } from './stats.js';
import {
  DEFAULT_BRAIN, defaultLibrary, ANALYSIS_SCHEMA, CLASSIFY_SCHEMA,
  stableSystem, analysisUser, classifyUser, learningPrompt, weeklyPrompt,
} from './prompts.js';
import { ANALYSIS_FORMAT, CLASSIFY_FORMAT, extractJson, normalizeAnalysis, normalizeClassification, classifyManyUser } from './manual.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, '..', 'public');

export async function seed(store) {
  if ((await store.getKV('brain', null)) === null) await store.setKV('brain', DEFAULT_BRAIN);
  if ((await store.getKV('library', null)) === null) await store.setKV('library', defaultLibrary());
  if ((await store.getKV('cases', null)) === null) await store.setKV('cases', []);
}

function securityHeaders(production) {
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
      "connect-src 'self'", "font-src 'self'", "object-src 'none'", "base-uri 'none'",
      "frame-ancestors 'none'", "form-action 'self'",
    ].join('; '));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

// Categorías de la biblioteca que sirven como referencia según la situación.
function libraryFor(library, lead, mode) {
  const cats = new Set(['funciono']);
  const byStage = { apertura: ['paso1'], calificando: ['paso2', 'paso3', 'paso4', 'paso5'], caso: ['paso6'], propuesta: ['paso7'], link: ['paso8'] };
  ({ recien_entro: ['apertura'], no_responde: ['seguimientos'], reactivar: ['seguimientos'], ya_agendo: ['confirmacion'], no_se_presento: ['no_show'] }[mode] || []).forEach((c) => cats.add(c));
  (byStage[lead.stage] || []).forEach((c) => cats.add(c));
  if (lead.objection && lead.objection !== 'ninguna') cats.add('objeciones');
  return library.filter((m) => cats.has(m.category)).slice(0, 14);
}

function pickWinners(all, stage, n = 8) {
  const same = all.filter((w) => w.stage === stage);
  const rest = all.filter((w) => w.stage !== stage);
  return [...same, ...rest].slice(0, n);
}

export function createApp({ store, llm, password, sessionSecret, production = false, now = () => new Date() }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  const auth = createAuth({ password, secret: sessionSecret, secureCookie: process.env.COOKIE_INSECURE !== '1' });
  const limiter = createLoginLimiter();
  const nowIso = () => now().toISOString();

  app.use(securityHeaders(production));

  app.get('/healthz', async (req, res) => {
    try {
      await store.ping();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false, error: 'Sin conexión a la base de datos.' });
    }
  });

  // Cuerpos JSON: 6 MB solo para restaurar respaldos, 300 KB para el resto.
  app.use('/api/backup/restore', express.json({ limit: '6mb' }));
  app.use(['/api/prompt/classify', '/api/classify/manual'], express.json({ limit: '2mb' }));
  app.use('/api', express.json({ limit: '300kb' }));

  // Las escrituras exigen JSON: un formulario de otro sitio no puede mandarlo sin pasar por CORS.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      return next(new HttpError(415, 'Las solicitudes tienen que enviarse como JSON.'));
    }
    next();
  });

  app.post('/api/login', (req, res) => {
    const { allowed, retryMin } = limiter.hit(req.ip);
    if (!allowed) throw new HttpError(429, `Demasiados intentos de ingreso. Probá de nuevo en ${retryMin} minutos.`);
    if (!password) throw new HttpError(503, 'Falta configurar APP_PASSWORD en las variables del servicio.');
    if (!auth.checkPassword(req.body?.password)) throw new HttpError(401, 'Contraseña incorrecta.');
    auth.setCookie(res);
    res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => {
    auth.clearCookie(res);
    res.json({ ok: true });
  });
  app.get('/api/session', (req, res) => res.json({ authenticated: auth.isAuthed(req) }));

  app.use('/api', (req, res, next) => {
    if (!auth.isAuthed(req)) return next(new HttpError(401, 'Tu sesión venció o no ingresaste. Volvé a ingresar con la contraseña.'));
    next();
  });

  const loadLead = async (id) => {
    const lead = await store.getLead(assertId(id));
    if (!lead) throw new HttpError(404, 'No encontré esa lead. Puede que se haya borrado.');
    return lead;
  };
  const getLibrary = () => store.getKV('library', []);
  const getCases = () => store.getKV('cases', []);
  const getBrain = () => store.getKV('brain', DEFAULT_BRAIN);

  app.get('/api/state', async (req, res) => {
    const [leads, library, cases, brain] = await Promise.all([store.listLeads(), getLibrary(), getCases(), getBrain()]);
    res.json({
      meta: { stages: STAGES, funnel: FUNNEL, objectives: OBJECTIVES, objections: OBJECTIONS, qualifications: QUALIFICATIONS, approaches: APPROACHES, modes: MODES, categories: LIBRARY_CATEGORIES },
      claude: { configured: llm.configured, model: llm.model },
      leads, library, cases, brain,
    });
  });

  // ---- Leads
  app.post('/api/leads', async (req, res) => {
    const at = nowIso();
    const lead = newLead({ name: req.body?.name, conversation: req.body?.conversation }, at);
    res.status(201).json(await store.insertLead(newId(), lead, new Date(at)));
  });
  app.patch('/api/leads/:id', async (req, res) => {
    const lead = await loadLead(req.params.id);
    applyPatch(lead, req.body, nowIso());
    res.json(await store.updateLead(lead.id, lead));
  });
  app.delete('/api/leads/:id', async (req, res) => {
    if (!(await store.deleteLead(assertId(req.params.id)))) throw new HttpError(404, 'No encontré esa lead.');
    res.json({ ok: true });
  });
  app.post('/api/leads/:id/sent', async (req, res) => {
    const lead = await loadLead(req.params.id);
    recordSent(lead, { text: req.body?.text, approach: req.body?.approach, followUpHours: req.body?.followUpHours }, nowIso());
    res.json(await store.updateLead(lead.id, lead));
  });
  app.post('/api/leads/:id/snooze', async (req, res) => {
    const lead = await loadLead(req.params.id);
    const h = intIn(req.body?.hours, 1, 24 * 30, 'horas');
    lead.followUpAt = new Date(now().getTime() + h * 3600000).toISOString();
    res.json(await store.updateLead(lead.id, lead));
  });
  app.get('/api/today', async (req, res) => res.json(todayList(await store.listLeads(), now())));

  // ---- Copiloto
  // Arma las dos partes del prompt de análisis (y guarda la conversación pegada).
  async function analysisPrompt(body) {
    const lead = await loadLead(body?.leadId);
    const mode = oneOf(body?.mode, MODES, 'modo');
    if ('conversation' in (body || {})) lead.conversation = str(body.conversation, LIMITS.conversation, 'conversación');
    const [library, cases, brain, leads] = await Promise.all([getLibrary(), getCases(), getBrain(), store.listLeads()]);
    return {
      lead, mode,
      stable: stableSystem({ brain, cases }),
      user: analysisUser({ lead, mode, conversation: lead.conversation, winners: pickWinners(winners(leads), lead.stage), library: libraryFor(library, lead, mode) }),
    };
  }
  async function finishAnalysis(lead, mode, analysis, source) {
    const at = nowIso();
    analysis.mensajes = (analysis.mensajes || []).slice(0, 3);
    lead.lastAnalysis = { ...analysis, mode, at, source };
    applyAnalysis(lead, analysis, at);
    return { analysis: lead.lastAnalysis, lead: await store.updateLead(lead.id, lead) };
  }

  app.post('/api/analyze', async (req, res) => {
    const { lead, mode, stable, user } = await analysisPrompt(req.body);
    const analysis = await llm.json({ stable, user, schema: ANALYSIS_SCHEMA });
    res.json(await finishAnalysis(lead, mode, analysis, 'api'));
  });
  // Modo sin API: devuelve el prompt para pegar en claude.ai.
  app.post('/api/prompt/analyze', async (req, res) => {
    const { lead, stable, user } = await analysisPrompt(req.body);
    await store.updateLead(lead.id, lead);
    res.json({ prompt: `${stable}\n\n=== PEDIDO ===\n${user}\n\n${ANALYSIS_FORMAT}` });
  });
  // Modo sin API: lee la respuesta pegada desde claude.ai.
  app.post('/api/analyze/manual', async (req, res) => {
    const lead = await loadLead(req.body?.leadId);
    const mode = oneOf(req.body?.mode, MODES, 'modo');
    const analysis = normalizeAnalysis(extractJson(str(req.body?.response, 100000, 'respuesta'), 'object'));
    res.json(await finishAnalysis(lead, mode, analysis, 'claude.ai'));
  });

  async function createClassifiedLead(name, conversation, c) {
    const at = nowIso();
    const lead = newLead({ name, conversation }, at);
    lead.events[0].source = 'importado';
    advanceFunnel(lead, c.max_etapa, at);
    applyAnalysis(lead, { etapa: c.etapa, objecion: c.objecion, temperatura: c.temperatura, resumen: c.resumen, perfil: { objetivo: c.objetivo, calificacion: c.calificacion } }, at);
    return store.insertLead(newId(), lead, new Date(at));
  }
  const readChat = (c) => {
    const conversation = str(c?.conversation, LIMITS.conversation, 'conversación').trim();
    if (!conversation) throw new HttpError(400, 'Hay un chat vacío.');
    return { name: str(c?.name, LIMITS.name, 'nombre').trim() || 'Sin nombre', conversation };
  };
  const readChats = (arr) => {
    if (!Array.isArray(arr) || !arr.length) throw new HttpError(400, 'No llegaron chats para importar.');
    if (arr.length > 60) throw new HttpError(413, 'Son demasiados chats juntos: importalos de a 60 como máximo.');
    return arr.map(readChat);
  };

  app.post('/api/classify', async (req, res) => {
    const { name, conversation } = readChat(req.body);
    const [cases, brain] = await Promise.all([getCases(), getBrain()]);
    const c = await llm.json({ stable: stableSystem({ brain, cases }), user: classifyUser({ name, conversation }), schema: CLASSIFY_SCHEMA, maxTokens: 4000 });
    res.status(201).json(await createClassifiedLead(name, conversation, c));
  });
  app.post('/api/prompt/classify', async (req, res) => {
    const chats = readChats(req.body?.chats);
    const [cases, brain] = await Promise.all([getCases(), getBrain()]);
    res.json({ prompt: `${stableSystem({ brain, cases })}\n\n=== PEDIDO ===\n${classifyManyUser(chats)}\n\n${CLASSIFY_FORMAT}` });
  });
  app.post('/api/classify/manual', async (req, res) => {
    const chats = readChats(req.body?.chats);
    const items = extractJson(str(req.body?.response, 300000, 'respuesta'), 'array').map(normalizeClassification);
    if (!items.length) throw new HttpError(400, 'La respuesta pegada no trae ninguna clasificación.');
    const key = (s) => s.toLowerCase().replace(/^@/, '').trim();
    const created = [];
    const missing = [];
    for (const [i, chat] of chats.entries()) {
      const c = items.find((it) => it.usuario && key(it.usuario) === key(chat.name)) || (items.length === chats.length ? items[i] : null);
      if (!c) { missing.push(chat.name); continue; }
      created.push(await createClassifiedLead(chat.name, chat.conversation, c));
    }
    res.status(201).json({ created, missing });
  });

  // ---- Métricas
  app.get('/api/learning', async (req, res) => res.json(learning(await store.listLeads())));
  const learningUser = (stats) => {
    const { winners: w, ...rest } = stats;
    return learningPrompt({ ...rest, winners: w.slice(0, 15) });
  };
  app.post('/api/learning/read', async (req, res) => {
    const stats = learning(await store.listLeads());
    const text = await llm.text({ stable: stableSystem({ brain: await getBrain(), cases: [] }), user: learningUser(stats) });
    res.json({ text, stats });
  });
  app.get('/api/prompt/learning', async (req, res) => {
    const stats = learning(await store.listLeads());
    res.json({ prompt: `${stableSystem({ brain: await getBrain(), cases: [] })}\n\n=== PEDIDO ===\n${learningUser(stats)}` });
  });
  const weekParam = (q) => (q === undefined ? 0 : intIn(q, 0, 520, 'semana'));
  app.get('/api/report', async (req, res) => res.json(weekly(await store.listLeads(), now(), weekParam(req.query.week))));
  app.post('/api/report/read', async (req, res) => {
    const report = weekly(await store.listLeads(), now(), weekParam(req.query.week));
    const text = await llm.text({ stable: stableSystem({ brain: await getBrain(), cases: [] }), user: weeklyPrompt(report) });
    res.json({ text, report });
  });
  app.get('/api/prompt/report', async (req, res) => {
    const report = weekly(await store.listLeads(), now(), weekParam(req.query.week));
    res.json({ prompt: `${stableSystem({ brain: await getBrain(), cases: [] })}\n\n=== PEDIDO ===\n${weeklyPrompt(report)}` });
  });
  app.get('/api/funnel', async (req, res) => res.json(funnel(await store.listLeads())));

  // ---- Biblioteca
  const libItem = (b) => ({
    category: oneOf(b?.category, LIBRARY_CATEGORIES, 'categoría'),
    title: str(b?.title, LIMITS.title, 'título').trim(),
    text: (() => {
      const t = str(b?.text, LIMITS.message, 'texto').trim();
      if (!t) throw new HttpError(400, 'El mensaje no puede estar vacío.');
      return t;
    })(),
  });
  app.post('/api/library', async (req, res) => {
    const lib = await getLibrary();
    if (lib.length >= 500) throw new HttpError(413, 'La biblioteca llegó al máximo de 500 mensajes. Borrá alguno.');
    const item = { id: newId(), ...libItem(req.body) };
    lib.push(item);
    await store.setKV('library', lib);
    res.status(201).json(item);
  });
  app.put('/api/library/:id', async (req, res) => {
    const id = assertId(req.params.id);
    const lib = await getLibrary();
    const i = lib.findIndex((m) => m.id === id);
    if (i < 0) throw new HttpError(404, 'No encontré ese mensaje.');
    lib[i] = { id, ...libItem(req.body) };
    await store.setKV('library', lib);
    res.json(lib[i]);
  });
  app.delete('/api/library/:id', async (req, res) => {
    const id = assertId(req.params.id);
    const lib = await getLibrary();
    const next = lib.filter((m) => m.id !== id);
    if (next.length === lib.length) throw new HttpError(404, 'No encontré ese mensaje.');
    await store.setKV('library', next);
    res.json({ ok: true });
  });

  // ---- Casos de éxito
  const caseItem = (b) => {
    const c = {};
    for (const f of ['perfil', 'objetivo', 'probado', 'resultado', 'tiempo', 'frase']) c[f] = str(b?.[f], 1000, f).trim();
    if (!c.perfil || !c.resultado) throw new HttpError(400, 'Completá al menos el perfil y el resultado del caso.');
    return c;
  };
  app.post('/api/cases', async (req, res) => {
    const cases = await getCases();
    if (cases.length >= 200) throw new HttpError(413, 'Llegaste al máximo de 200 casos.');
    const item = { id: newId(), ...caseItem(req.body) };
    cases.push(item);
    await store.setKV('cases', cases);
    res.status(201).json(item);
  });
  app.put('/api/cases/:id', async (req, res) => {
    const id = assertId(req.params.id);
    const cases = await getCases();
    const i = cases.findIndex((c) => c.id === id);
    if (i < 0) throw new HttpError(404, 'No encontré ese caso.');
    cases[i] = { id, ...caseItem(req.body) };
    await store.setKV('cases', cases);
    res.json(cases[i]);
  });
  app.delete('/api/cases/:id', async (req, res) => {
    const id = assertId(req.params.id);
    const cases = await getCases();
    const next = cases.filter((c) => c.id !== id);
    if (next.length === cases.length) throw new HttpError(404, 'No encontré ese caso.');
    await store.setKV('cases', next);
    res.json({ ok: true });
  });

  // ---- Cerebro y respaldo
  app.put('/api/brain', async (req, res) => {
    const text = str(req.body?.text, LIMITS.brain, 'cerebro').trim();
    if (!text) throw new HttpError(400, 'El cerebro no puede quedar vacío. Usá "Restaurar original" si querés volver al texto base.');
    await store.setKV('brain', text);
    res.json({ text });
  });
  app.post('/api/brain/reset', async (req, res) => {
    await store.setKV('brain', DEFAULT_BRAIN);
    res.json({ text: DEFAULT_BRAIN });
  });
  app.get('/api/backup', async (req, res) => {
    const [kv, leads] = await Promise.all([store.allKV(), store.listLeads()]);
    res.setHeader('Content-Disposition', `attachment; filename="copiloto-respaldo-${nowIso().slice(0, 10)}.json"`);
    res.json({ app: 'copiloto-setteo', version: 1, exportedAt: nowIso(), kv, leads });
  });
  app.post('/api/backup/restore', async (req, res) => {
    const b = req.body;
    if (!b || b.app !== 'copiloto-setteo' || typeof b.kv !== 'object' || !Array.isArray(b.leads)) {
      throw new HttpError(400, 'Ese archivo no es un respaldo del Copiloto. Elegí un JSON descargado desde "Copia de respaldo".');
    }
    const kv = {};
    for (const k of ['brain', 'library', 'cases']) if (k in b.kv) kv[k] = b.kv[k];
    if (typeof kv.brain !== 'string' || !Array.isArray(kv.library) || !Array.isArray(kv.cases)) {
      throw new HttpError(400, 'El respaldo está incompleto: le faltan el cerebro, la biblioteca o los casos.');
    }
    for (const l of b.leads) {
      assertId(l?.id);
      if (!Array.isArray(l.events)) throw new HttpError(400, 'El respaldo tiene una lead con formato inválido.');
    }
    await store.replaceAll({ kv, leads: b.leads });
    res.json({ ok: true, leads: b.leads.length });
  });

  app.use('/api', (req, res, next) => next(new HttpError(404, 'Ruta de la API inexistente.')));

  // Sin caché larga: el navegador revalida (ETag) y siempre toma la última versión después de un despliegue.
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: 0, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Lo que enviaste es demasiado grande. Recortá el texto y reintentá.' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo de la solicitud no es JSON válido.' });
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error('[error]', err);
    res.status(status).json({ error: status === 500 ? 'Error interno del servidor. Reintentá; si sigue, revisá los logs en Railway.' : err.message });
  });

  return app;
}

