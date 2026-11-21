import pg from 'pg';
import { createApp, seed } from './app.js';
import { migrate, makeStore } from './db.js';
import { createLlm } from './llm.js';

const {
  DATABASE_URL, PORT = '3000', APP_PASSWORD, SESSION_SECRET, ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL = 'claude-sonnet-5-5', ANTHROPIC_EFFORT = 'medium', PGSSL, NODE_ENV,
} = process.env;

if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL. En Railway, referenciá la variable de la base Postgres: ${{Postgres.DATABASE_URL}}.');
  process.exit(1);
}
if (!APP_PASSWORD) console.warn('Atención: falta APP_PASSWORD. Nadie va a poder ingresar hasta que la cargues.');
if (!ANTHROPIC_API_KEY) console.warn('Atención: falta ANTHROPIC_API_KEY. Las funciones con Claude van a avisar el error.');

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5, ssl: PGSSL === '1' ? { rejectUnauthorized: false } : undefined });
pool.on('error', (e) => console.error('[pg]', e.message));

const store = makeStore(pool);
await migrate(pool);
await seed(store);

const app = createApp({
  store,
  llm: createLlm({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL, effort: ANTHROPIC_EFFORT }),
  password: APP_PASSWORD,
  sessionSecret: SESSION_SECRET,
  production: NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT),
});

const server = app.listen(Number(PORT), '0.0.0.0', () => console.log(`Copiloto escuchando en el puerto ${PORT} (modelo ${ANTHROPIC_MODEL})`));
const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
