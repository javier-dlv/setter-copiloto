// Acceso a Postgres: tabla kv (contexto, biblioteca, casos) y tabla leads.
export async function migrate(pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS kv (key text PRIMARY KEY, value jsonb NOT NULL)');
  await pool.query(`CREATE TABLE IF NOT EXISTS leads (
    id text PRIMARY KEY,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}

const iso = (v) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const rowToLead = (r) => ({ ...r.data, id: r.id, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) });
const strip = ({ id, createdAt, updatedAt, ...data }) => data;

export function makeStore(pool) {
  return {
    async ping() {
      await pool.query('SELECT 1');
    },
    async getKV(key, fallback) {
      const r = await pool.query('SELECT value FROM kv WHERE key = $1', [key]);
      return r.rows.length ? r.rows[0].value : fallback;
    },
    async setKV(key, value) {
      await pool.query(
        'INSERT INTO kv (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [key, JSON.stringify(value)],
      );
    },
    async allKV() {
      const r = await pool.query('SELECT key, value FROM kv');
      return Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
    },
    async listLeads() {
      const r = await pool.query('SELECT id, data, created_at, updated_at FROM leads ORDER BY updated_at DESC');
      return r.rows.map(rowToLead);
    },
    async getLead(id) {
      const r = await pool.query('SELECT id, data, created_at, updated_at FROM leads WHERE id = $1', [id]);
      return r.rows.length ? rowToLead(r.rows[0]) : null;
    },
    async insertLead(id, lead, createdAt = new Date()) {
      const r = await pool.query(
        'INSERT INTO leads (id, data, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $3) RETURNING id, data, created_at, updated_at',
        [id, JSON.stringify(strip(lead)), createdAt],
      );
      return rowToLead(r.rows[0]);
    },
    async updateLead(id, lead) {
      const r = await pool.query(
        'UPDATE leads SET data = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING id, data, created_at, updated_at',
        [id, JSON.stringify(strip(lead))],
      );
      return r.rows.length ? rowToLead(r.rows[0]) : null;
    },
    async deleteLead(id) {
      const r = await pool.query('DELETE FROM leads WHERE id = $1', [id]);
      return r.rowCount > 0;
    },
    async replaceAll({ kv, leads }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM kv');
        await client.query('DELETE FROM leads');
        for (const [key, value] of Object.entries(kv)) {
          await client.query('INSERT INTO kv (key, value) VALUES ($1, $2::jsonb)', [key, JSON.stringify(value)]);
        }
        for (const l of leads) {
          await client.query('INSERT INTO leads (id, data, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4)', [
            l.id, JSON.stringify(strip(l)), new Date(l.createdAt || Date.now()), new Date(l.updatedAt || l.createdAt || Date.now()),
          ]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}
