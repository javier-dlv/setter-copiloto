// Servidor local sin Postgres ni API key: base en memoria y Claude simulado. Uso: npm run dev
import { newDb } from 'pg-mem';
import { createApp, seed } from '../src/app.js';
import { migrate, makeStore } from '../src/db.js';
import { ANALYSIS_SCHEMA } from '../src/prompts.js';

process.env.COOKIE_INSECURE = '1';
const { Pool } = newDb().adapters.createPg();
const pool = new Pool();
await migrate(pool);
const store = makeStore(pool);
await seed(store);

const llm = {
  configured: true,
  model: 'simulado',
  async json({ schema }) {
    if (schema === ANALYSIS_SCHEMA) {
      return {
        etapa: 'calificando', paso: 3, resumen: 'Respuesta simulada: quiere desinflamar, trabaja como contadora.',
        perfil: { objetivo: 'desinflamar', ocupacion: 'Contadora', calificacion: 'media', que_intento: 'Sin dato', estancada: 'sin_dato' },
        objecion: 'ninguna', temperatura: 3, siguiente_paso: 'Preguntar qué probó hasta ahora.',
        mensajes: [
          { enfoque: 'empatia', titulo: 'Empática', texto: 'Qué bueno que te lo tomes en serio. ¿Qué probaste hasta ahora para desinflamarte?' },
          { enfoque: 'curiosidad', titulo: 'Curiosa', texto: '¿Y venís haciendo algo para eso o arrancarías de cero?' },
        ],
        evitar: ['Hablar de precio'], seguimiento: { texto: '¿Cómo venís con eso?', horas: 20 }, faltan_confirmar: ['Qué intentó'],
      };
    }
    return { etapa: 'calificando', max_etapa: 'calificando', objetivo: 'peso', objecion: 'ninguna', temperatura: 3, calificacion: 'sin_dato', resumen: 'Simulado.' };
  },
  async text() { return 'Lectura simulada.'; },
};

const port = Number(process.env.PORT || 3000);
createApp({ store, llm, password: process.env.APP_PASSWORD || 'dev', sessionSecret: 'dev' })
  .listen(port, () => console.log(`Dev en http://localhost:${port} (contraseña: ${process.env.APP_PASSWORD ? '(APP_PASSWORD)' : 'dev'})`));
