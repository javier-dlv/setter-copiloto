# Copiloto de setteo · Noepaz.vegan

App web para la appointment setter de Noepaz.vegan. Pegás el chat de Instagram/ManyChat y Claude detecta la etapa, arma el perfil de la lead y propone 2 o 3 mensajes listos para copiar, siempre respetando las reglas del negocio (nunca se habla de precio, no se inventan casos, sin presión).

Pantallas: Copiloto, Hoy, Leads, Importar chats, Biblioteca, Casos de éxito, Aprendizaje, Reporte semanal, Embudo y Cerebro del negocio.

## Stack

- Node 20+ y Express 5, Postgres (`pg`), SDK `@anthropic-ai/sdk`.
- Frontend en HTML, CSS y JavaScript sin framework, servido por el mismo servidor (`public/`).
- Healthcheck en `GET /healthz`.

## Variables de entorno

| Variable | Obligatoria | Para qué |
|---|---|---|
| `APP_PASSWORD` | Sí | Contraseña única para entrar a la app. |
| `ANTHROPIC_API_KEY` | Sí | Clave de la API de Claude. Vive solo en el servidor. |
| `DATABASE_URL` | Sí | Conexión a Postgres. En Railway: `${{Postgres.DATABASE_URL}}`. |
| `ANTHROPIC_MODEL` | No | Modelo de Claude. Por defecto `claude-sonnet-5-5`. |
| `ANTHROPIC_EFFORT` | No | Profundidad de razonamiento: `low`, `medium` (defecto) o `high`. |
| `SESSION_SECRET` | No | Clave para firmar la cookie de sesión. Si no está, se deriva de `APP_PASSWORD` (cambiar la contraseña cierra todas las sesiones). |
| `PGSSL` | No | `1` para conectar a Postgres con SSL (bases externas). En Railway no hace falta. |
| `CLAUDE_FALLBACKS` | No | `off` desactiva el reintento automático en otro modelo cuando un filtro de seguridad frena una respuesta. |
| `PORT` | No | Lo pone Railway solo. Local: 3000. |

## Correrlo local

```bash
npm install
npm test        # prueba de humo: Postgres en memoria y Claude simulado
npm run dev     # app en http://localhost:3000 con base en memoria y Claude simulado (contraseña: dev)
```

Con Postgres real y Claude de verdad:

```bash
DATABASE_URL=postgres://usuario:clave@localhost:5432/copiloto \
APP_PASSWORD=una-clave \
ANTHROPIC_API_KEY=sk-ant-... \
COOKIE_INSECURE=1 \
npm start
```

`COOKIE_INSECURE=1` solo sirve para probar por `http://` fuera de `localhost`; en producción no se usa.

Las tablas (`kv` y `leads`) se crean solas al arrancar, y la biblioteca se siembra con los mensajes base.

## Desplegar en Railway

1. Crear un proyecto en Railway con un servicio desde este repo de GitHub y una base **Postgres** en el mismo proyecto.
2. En el servicio de la app, cargar las variables:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `APP_PASSWORD` = tu contraseña
   - `ANTHROPIC_API_KEY` = tu clave de Anthropic
3. Healthcheck: `/healthz` (ya está configurado en `railway.json`).
4. En Settings → Networking, generar un dominio público.

Cada push a `main` vuelve a desplegar.

## Seguridad

- Una sola contraseña, cookie de sesión firmada (HttpOnly, SameSite=Lax, Secure), comparación en tiempo constante.
- Máximo 10 intentos de login cada 15 minutos por IP.
- Todo `/api` exige sesión salvo `login`, `logout`, `session` y `/healthz`.
- CSP estricta (sin scripts ni estilos en línea), cabeceras de seguridad, validación de ids y límite de tamaño de los cuerpos.
- Las escrituras solo aceptan JSON.

## Cómo usa Claude

- La parte estable del prompt (reglas fijas + cerebro del negocio + casos de éxito) va primero y con prompt caching.
- En cada análisis se inyectan como ejemplo los mensajes enviados en leads que después agendaron (pantalla Aprendizaje).
- Las respuestas vienen en JSON validado por esquema (salidas estructuradas).
- Si Claude no tiene casos cargados, deja el marcador `[CASO DE ÉXITO: ...]` en lugar de inventar uno.

## Respaldo

En **Cerebro → Copia de respaldo** se descarga un JSON con leads, biblioteca, casos y cerebro, y se puede restaurar (reemplaza todo).
