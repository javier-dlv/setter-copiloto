// Prueba de humo: levanta el servidor con Postgres en memoria (pg-mem) y Claude simulado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { newDb } from 'pg-mem';
import { createApp, seed } from '../src/app.js';
import { migrate, makeStore } from '../src/db.js';
import { createLlm } from '../src/llm.js';
import { splitChats } from '../src/domain.js';
import { ANALYSIS_SCHEMA } from '../src/prompts.js';

const PASSWORD = 'clave-de-prueba';
let server;
let base;
let cookie = '';
const llmCalls = [];

const fakeLlm = {
  configured: true,
  model: 'claude-simulado',
  async json({ stable, user, schema }) {
    llmCalls.push({ stable, user });
    if (schema === ANALYSIS_SCHEMA) {
      return {
        etapa: 'propuesta', paso: 7, resumen: 'Quiere desinflamar y bajar 8 kilos. Es abogada.',
        perfil: { objetivo: 'ambas', ocupacion: 'Abogada', calificacion: 'alta', que_intento: 'Nutricionista', estancada: 'si' },
        objecion: 'tiempo', temperatura: 4, siguiente_paso: 'Proponer la llamada.',
        mensajes: [
          { enfoque: 'empatia', titulo: 'Empática', texto: 'Te entiendo. ¿Te gustaría verlo con la experta?' },
          { enfoque: 'directo', titulo: 'Directa', texto: '¿Agendamos una llamada con la experta?' },
          { enfoque: 'curiosidad', titulo: 'Curiosa', texto: '¿Qué te frena hoy?' },
        ],
        evitar: ['Hablar de precio'], seguimiento: { texto: '¿Pudiste pensarlo?', horas: 24 }, faltan_confirmar: ['Edad'],
      };
    }
    return { etapa: 'link', max_etapa: 'link', objetivo: 'peso', objecion: 'dinero', temperatura: 3, calificacion: 'media', resumen: 'Recibió el link y no agendó.' };
  },
  async text() {
    return 'Qué funciona: ...\nDónde se cae: ...\nQué probar: ...';
  },
};

async function call(method, path, body, { raw = false, headers = {} } = {}) {
  const opts = { method, headers: { cookie, ...headers } };
  if (body !== undefined) {
    opts.headers['content-type'] = opts.headers['content-type'] || 'application/json';
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(base + path, opts);
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return raw ? res : { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

before(async () => {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  const store = makeStore(pool);
  await seed(store);
  const app = createApp({ store, llm: fakeLlm, password: PASSWORD, sessionSecret: 'secreto-test' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

test('healthz y cabeceras de seguridad', async () => {
  const r = await call('GET', '/healthz');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const page = await call('GET', '/', undefined, { raw: true });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  assert.match(await page.text(), /Copiloto de setteo/);
});

test('sin sesión la API responde 401', async () => {
  const r = await call('GET', '/api/state');
  assert.equal(r.status, 401);
  assert.match(r.body.error, /sesión/);
  const s = await call('GET', '/api/session');
  assert.equal(s.body.authenticated, false);
});

test('login: contraseña incorrecta, correcta y cookie segura', async () => {
  const bad = await call('POST', '/api/login', { password: 'nop' });
  assert.equal(bad.status, 401);
  const ok = await call('POST', '/api/login', { password: PASSWORD }, { raw: true });
  assert.equal(ok.status, 200);
  const sc = ok.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Lax/);
  assert.match(sc, /Secure/);
  cookie = sc.split(';')[0];
  const s = await call('GET', '/api/session');
  assert.equal(s.body.authenticated, true);
});

test('estado inicial con biblioteca sembrada', async () => {
  const r = await call('GET', '/api/state');
  assert.equal(r.status, 200);
  assert.ok(r.body.library.length >= 15);
  assert.ok(r.body.library.some((m) => m.category === 'objeciones' && /experta/.test(m.text)));
  assert.match(r.body.brain, /Noepaz/);
  assert.deepEqual(r.body.cases, []);
  assert.equal(r.body.claude.configured, true);
});

let leadId;
test('guardado de leads y validaciones', async () => {
  const c = await call('POST', '/api/leads', { name: '@maria' });
  assert.equal(c.status, 201);
  leadId = c.body.id;
  assert.equal(c.body.stage, 'apertura');
  const p = await call('PATCH', `/api/leads/${leadId}`, { stage: 'calificando', notes: 'Viene de un reel', temperature: 3 });
  assert.equal(p.status, 200);
  assert.equal(p.body.stage, 'calificando');
  assert.equal(p.body.maxFunnel, 'calificando');
  assert.equal((await call('PATCH', `/api/leads/${leadId}`, { stage: 'cualquiera' })).status, 400);
  assert.equal((await call('PATCH', '/api/leads/no-es-un-id', { notes: 'x' })).status, 400);
  assert.equal((await call('PATCH', `/api/leads/${leadId}`, { notes: 'x'.repeat(6000) })).status, 413);
  assert.equal((await call('POST', '/api/leads', 'name=x', { headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 415);
});

test('análisis del copiloto actualiza la lead', async () => {
  const r = await call('POST', '/api/analyze', { leadId, mode: 'respondio', conversation: 'Hola! Quiero desinflamarme, soy abogada...' });
  assert.equal(r.status, 200);
  assert.equal(r.body.analysis.mensajes.length, 3);
  assert.equal(r.body.lead.stage, 'propuesta');
  assert.equal(r.body.lead.objective, 'ambas');
  assert.equal(r.body.lead.qualification, 'alta');
  assert.equal(r.body.lead.objection, 'tiempo');
  assert.equal(r.body.lead.maxFunnel, 'propuesta');
  assert.ok(r.body.lead.lastAnalysis.at);
  const last = llmCalls.at(-1);
  assert.match(last.stable, /Nunca menciones precio/);
  assert.match(last.stable, /ninguno/); // sin casos cargados -> marcador
  assert.match(last.user, /abogada/);
  assert.equal((await call('POST', '/api/analyze', { leadId, mode: 'otro' })).status, 400);
});

test('"la envié" registra el mensaje y el recordatorio; agendar alimenta el aprendizaje', async () => {
  const s = await call('POST', `/api/leads/${leadId}/sent`, { text: '¿Agendamos una llamada con la experta?', approach: 'directo', followUpHours: 24 });
  assert.equal(s.status, 200);
  const ev = s.body.events.at(-1);
  assert.equal(ev.type, 'sent');
  assert.equal(ev.stage, 'propuesta');
  assert.ok(new Date(s.body.followUpAt) > new Date());
  await call('PATCH', `/api/leads/${leadId}`, { stage: 'agendada' });
  const L = await call('GET', '/api/learning');
  assert.equal(L.status, 200);
  assert.equal(L.body.totals.booked, 1);
  assert.equal(L.body.lowData, true);
  assert.equal(L.body.winners.length, 1);
  assert.equal(L.body.byApproachStage[0].rate, 1);
  const read = await call('POST', '/api/learning/read', {});
  assert.match(read.body.text, /Qué funciona/);
  // Los mensajes ganadores se inyectan en el próximo análisis.
  const other = await call('POST', '/api/leads', { name: '@ana' });
  await call('POST', '/api/analyze', { leadId: other.body.id, mode: 'recien_entro', conversation: '' });
  assert.match(llmCalls.at(-1).user, /MENSAJES QUE FUNCIONARON[\s\S]*Agendamos una llamada/);
});

test('clasificación de chats importados', async () => {
  const chats = splitChats('=== @lucia\nHola, quiero bajar de peso\n\n=== @sofi ===\nMe pasás info?\n=== vacio\n');
  assert.deepEqual(chats.map((c) => c.name), ['@lucia', '@sofi']);
  const r = await call('POST', '/api/classify', chats[0]);
  assert.equal(r.status, 201);
  assert.equal(r.body.name, '@lucia');
  assert.equal(r.body.stage, 'link');
  assert.equal(r.body.maxFunnel, 'link');
  assert.equal(r.body.objection, 'dinero');
  assert.equal((await call('POST', '/api/classify', { name: 'x', conversation: '' })).status, 400);
});

test('reporte semanal, embudo y hoy', async () => {
  const r = await call('GET', '/api/report?week=0');
  assert.equal(r.status, 200);
  assert.equal(r.body.current.newLeads, 3);
  assert.equal(r.body.current.booked, 1);
  assert.equal(r.body.current.sent, 1);
  assert.equal(r.body.previous.newLeads, 0);
  assert.ok(r.body.current.biggestDrop);
  assert.equal((await call('GET', '/api/report?week=1')).body.current.newLeads, 0);
  assert.equal((await call('GET', '/api/report?week=-1')).status, 400);
  const read = await call('POST', '/api/report/read?week=0', {});
  assert.equal(read.status, 200);
  const f = await call('GET', '/api/funnel');
  assert.deepEqual(f.body.steps.map((s) => s.count), [3, 3, 3, 3, 2, 1]);
  assert.ok(f.body.biggest);
  const t = await call('GET', '/api/today');
  assert.equal(t.status, 200);
  assert.ok(Array.isArray(t.body));
});

test('biblioteca, casos, cerebro y respaldo', async () => {
  const add = await call('POST', '/api/library', { category: 'funciono', title: 'Prueba', text: 'Hola' });
  assert.equal(add.status, 201);
  assert.equal((await call('PUT', `/api/library/${add.body.id}`, { category: 'apertura', title: 'Editado', text: 'Hola!' })).body.title, 'Editado');
  assert.equal((await call('POST', '/api/library', { category: 'inventada', text: 'x' })).status, 400);
  assert.equal((await call('DELETE', `/api/library/${add.body.id}`)).status, 200);

  const c = await call('POST', '/api/cases', { perfil: 'Contadora de 42', objetivo: 'Desinflamar', probado: 'Dietas', resultado: 'Bajó 6 kg', tiempo: '3 meses', frase: '' });
  assert.equal(c.status, 201);
  const other = (await call('GET', '/api/state')).body.leads[0];
  await call('POST', '/api/analyze', { leadId: other.id, mode: 'respondio' });
  assert.match(llmCalls.at(-1).stable, /Contadora de 42/);

  assert.equal((await call('PUT', '/api/brain', { text: 'Cerebro editado' })).body.text, 'Cerebro editado');
  assert.match((await call('POST', '/api/brain/reset', {})).body.text, /Noepaz/);

  const backup = await call('GET', '/api/backup');
  assert.equal(backup.body.app, 'copiloto-setteo');
  assert.equal(backup.body.leads.length, 3);
  await call('POST', '/api/leads', { name: '@temporal' });
  const restore = await call('POST', '/api/backup/restore', backup.body);
  assert.equal(restore.status, 200);
  assert.equal((await call('GET', '/api/state')).body.leads.length, 3);
  assert.equal((await call('POST', '/api/backup/restore', { foo: 1 })).status, 400);
});

test('modo sin API: prompt para claude.ai y respuesta pegada en el copiloto', async () => {
  const lead = (await call('POST', '/api/leads', { name: '@carla' })).body;
  const p = await call('POST', '/api/prompt/analyze', { leadId: lead.id, mode: 'respondio', conversation: 'Hola, soy docente y quiero desinflamarme' });
  assert.equal(p.status, 200);
  assert.match(p.body.prompt, /^INSTRUCCIONES PARA CLAUDE/);
  assert.match(p.body.prompt, /Nunca menciones precio/);
  assert.match(p.body.prompt, /soy docente/);
  assert.match(p.body.prompt, /FORMATO DE RESPUESTA/);
  // La conversación quedó guardada en la lead.
  assert.match((await call('GET', '/api/state')).body.leads.find((l) => l.id === lead.id).conversation, /docente/);

  const pasted = `¡Claro! Acá va el análisis:\n\`\`\`json\n${JSON.stringify({
    etapa: 'calificando', paso: '3', resumen: 'Docente que quiere desinflamar.',
    perfil: { objetivo: 'Desinflamar', ocupacion: 'Docente', calificacion: 'media', que_intento: '', estancada: 'Sí' },
    objecion: 'ninguna', temperatura: 9, siguiente_paso: 'Preguntar qué probó.',
    mensajes: [{ enfoque: 'Empatía', titulo: 'Empática', texto: '¿Qué venís probando hasta ahora?' }, { enfoque: 'inventado', texto: 'Contame más' }, { texto: '' }],
    evitar: ['Precio'], seguimiento: { texto: '¿Cómo vas?', horas: 30 }, faltan_confirmar: [],
  }, null, 2)}\n\`\`\`\nAvisame si querés otra versión.`;
  const m = await call('POST', '/api/analyze/manual', { leadId: lead.id, mode: 'respondio', response: pasted });
  assert.equal(m.status, 200);
  assert.equal(m.body.lead.stage, 'calificando');
  assert.equal(m.body.lead.objective, 'desinflamar');
  assert.equal(m.body.lead.temperature, 5);
  assert.equal(m.body.lead.profile.stuck, 'si');
  assert.equal(m.body.analysis.mensajes.length, 2);
  assert.equal(m.body.analysis.mensajes[0].enfoque, 'empatia');
  assert.equal(m.body.analysis.mensajes[1].enfoque, 'directo');
  assert.equal(m.body.analysis.source, 'claude.ai');
  const bad = await call('POST', '/api/analyze/manual', { leadId: lead.id, mode: 'respondio', response: 'No puedo ayudarte con eso.' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /JSON/);
  await call('DELETE', `/api/leads/${lead.id}`);
});

test('modo sin API: importar chats y lecturas por prompt', async () => {
  const chats = [{ name: '@vale', conversation: 'Hola quiero bajar 10 kilos' }, { name: 'rocio', conversation: 'Me pasás el precio?' }];
  const p = await call('POST', '/api/prompt/classify', { chats });
  assert.equal(p.status, 200);
  assert.match(p.body.prompt, /=== @vale[\s\S]*=== rocio/);
  const response = JSON.stringify([
    { usuario: '@rocio', etapa: 'calificando', max_etapa: 'calificando', objetivo: 'sin_dato', objecion: 'precio', temperatura: 2, calificacion: 'sin_dato', resumen: 'Preguntó el precio.' },
    { usuario: 'vale', etapa: 'propuesta', max_etapa: 'propuesta', objetivo: 'peso', objecion: 'ninguna', temperatura: 4, calificacion: 'alta', resumen: 'Quiere bajar 10 kilos.' },
  ]);
  const r = await call('POST', '/api/classify/manual', { chats, response });
  assert.equal(r.status, 201);
  assert.equal(r.body.created.length, 2);
  assert.deepEqual(r.body.missing, []);
  const vale = r.body.created.find((l) => l.name === '@vale');
  assert.equal(vale.stage, 'propuesta');
  assert.equal(vale.maxFunnel, 'propuesta');
  assert.equal(r.body.created.find((l) => l.name === 'rocio').objection, 'precio');
  const partial = await call('POST', '/api/classify/manual', { chats, response: JSON.stringify([{ usuario: 'vale', etapa: 'apertura' }]) });
  assert.deepEqual(partial.body.missing, ['rocio']);
  for (const l of [...r.body.created, ...partial.body.created]) await call('DELETE', `/api/leads/${l.id}`);

  const lp = await call('GET', '/api/prompt/learning');
  assert.match(lp.body.prompt, /Qué funciona/);
  const rp = await call('GET', '/api/prompt/report?week=0');
  assert.match(rp.body.prompt, /reporte semanal/);
});

test('sin API key el error dice cómo arreglarlo', async () => {
  const llm = createLlm({ apiKey: '', model: 'claude-sonnet-5-5' });
  await assert.rejects(llm.json({ stable: 'x', user: 'y', schema: ANALYSIS_SCHEMA }), (e) => e.status === 503 && /ANTHROPIC_API_KEY/.test(e.message));
});

test('forma de la solicitud a Claude (servidor simulado): caché, effort, formato y fallbacks', async () => {
  const seen = [];
  const mock = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      const body = JSON.parse(data);
      seen.push({ url: req.url, beta: req.headers['anthropic-beta'], body });
      if (seen.length === 3) {
        res.writeHead(429, { 'content-type': 'application/json', 'x-should-retry': 'false' });
        return res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: body.output_config?.format ? '{"ok":true}' : 'texto' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  try {
    const llm = createLlm({ apiKey: 'sk-test', model: 'claude-sonnet-5-5', baseURL: `http://127.0.0.1:${mock.address().port}` });
    assert.deepEqual(await llm.json({ stable: 'estable', user: 'hola', schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } } }), { ok: true });
    const first = seen[0];
    assert.equal(first.body.model, 'claude-sonnet-5-5');
    assert.deepEqual(first.body.system[0].cache_control, { type: 'ephemeral' });
    assert.equal(first.body.output_config.effort, 'medium');
    assert.equal(first.body.output_config.format.type, 'json_schema');
    assert.equal(first.body.fallbacks, 'default');
    assert.match(first.beta, /server-side-fallback-2026-07-01/);
    assert.equal(await llm.text({ stable: 'estable', user: 'hola' }), 'texto');
    await assert.rejects(llm.text({ stable: 'e', user: 'u' }), (e) => e.status === 429 && /límite de consultas/.test(e.message));
  } finally {
    mock.close();
  }
});

test('límite de 10 intentos de login cada 15 minutos', async () => {
  // Ya hubo 2 intentos en esta prueba; completamos hasta 10 y el siguiente se bloquea.
  for (let i = 0; i < 8; i++) await call('POST', '/api/login', { password: 'mal' });
  const blocked = await call('POST', '/api/login', { password: PASSWORD });
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /Demasiados intentos/);
});
