// Cliente de Claude. La API key vive solo en el servidor.
import Anthropic from '@anthropic-ai/sdk';
import { HttpError } from './domain.js';

// Modelos que aceptan el reintento automático en otro modelo cuando un filtro de seguridad frena la respuesta.
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-2', 'claude-fable-5-1']);

function mapError(e) {
  if (e instanceof HttpError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(502, 'La ANTHROPIC_API_KEY cargada no es válida o no tiene permisos. Revisala en las variables del servicio en Railway.');
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new HttpError(429, 'Llegaste al límite de consultas de Claude. Esperá un minuto y volvé a intentar.');
  }
  if (e instanceof Anthropic.NotFoundError) {
    return new HttpError(502, 'El modelo configurado en ANTHROPIC_MODEL no existe o tu cuenta no tiene acceso. Revisá esa variable.');
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new HttpError(400, `Claude rechazó la consulta: ${e.message}. Si el chat es muy largo, recortalo y reintentá.`);
  }
  if (e instanceof Anthropic.InternalServerError) {
    return new HttpError(503, 'Claude está saturado en este momento. Reintentá en unos segundos.');
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new HttpError(504, 'No se pudo conectar con Claude (tiempo agotado o red). Reintentá.');
  }
  if (e instanceof Anthropic.APIError) {
    return new HttpError(502, `Error de Claude (${e.status ?? 'sin código'}). Reintentá en un momento.`);
  }
  return e;
}

export function createLlm({ apiKey, model, effort = 'medium', baseURL }) {
  const client = apiKey ? new Anthropic({ apiKey, timeout: 180_000, maxRetries: 2, ...(baseURL ? { baseURL } : {}) }) : null;
  let useFallbacks = FALLBACK_MODELS.has(model) && process.env.CLAUDE_FALLBACKS !== 'off';

  async function call(params) {
    if (!client) {
      throw new HttpError(503, 'Falta la ANTHROPIC_API_KEY. Cargala en Railway (Variables del servicio) y redeployá.');
    }
    try {
      if (useFallbacks) {
        try {
          return await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
        } catch (e) {
          if (!(e instanceof Anthropic.BadRequestError && /fallback|beta/i.test(e.message))) throw e;
          console.warn('[llm] fallbacks no disponibles para este modelo; sigo sin ellos.');
          useFallbacks = false;
        }
      }
      return await client.messages.create(params);
    } catch (e) {
      throw mapError(e);
    }
  }

  function textOf(res) {
    if (res.stop_reason === 'refusal') {
      throw new HttpError(422, 'Claude no pudo procesar este texto (lo frenó un filtro de seguridad). Revisá que lo pegado sea solo la conversación y reintentá.');
    }
    if (res.stop_reason === 'max_tokens') {
      throw new HttpError(502, 'La respuesta de Claude quedó cortada. Reintentá; si se repite, recortá la conversación.');
    }
    return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  // system: [{ text, cache }] -> bloques; el último bloque estable lleva cache_control.
  const systemBlocks = (stable) => [{ type: 'text', text: stable, cache_control: { type: 'ephemeral' } }];

  return {
    configured: Boolean(client),
    model,
    async json({ stable, user, schema, maxTokens = 16000 }) {
      const res = await call({
        model,
        max_tokens: maxTokens,
        system: systemBlocks(stable),
        messages: [{ role: 'user', content: user }],
        output_config: { effort, format: { type: 'json_schema', schema } },
      });
      const text = textOf(res);
      try {
        return JSON.parse(text);
      } catch {
        throw new HttpError(502, 'Claude devolvió una respuesta que no se pudo leer. Reintentá.');
      }
    },
    async text({ stable, user, maxTokens = 8000 }) {
      const res = await call({
        model,
        max_tokens: maxTokens,
        system: systemBlocks(stable),
        messages: [{ role: 'user', content: user }],
        output_config: { effort },
      });
      return textOf(res).trim();
    },
  };
}
