// Textos base: cerebro del negocio, instrucciones fijas, biblioteca inicial y esquemas JSON.
import { STAGE_KEYS, FUNNEL, OBJECTIVES, OBJECTIONS, QUALIFICATIONS, APPROACHES, newId } from './domain.js';

export const DEFAULT_BRAIN = `NEGOCIO
Noepaz.vegan (Instagram) vende un programa para desinflamar y bajar de peso pensado para mujeres de más de 35 años, con alimentación basada en plantas. No obliga a dejar la carne: suma alimentación vegetal.
Hay dos formas de trabajar (tickets distintos). En el setteo NUNCA se habla de precio.

CLIENTE IDEAL
Mujeres +35, profesionales o dueñas de negocio, que quieren desinflamar, bajar de peso o ambas cosas.

CÓMO ENTRA LA LEAD
Comenta o responde un CTA de reels, historias o carruseles que ofrece un recurso. El recurso es la excusa para abrir la conversación: el objetivo del chat es conocerla y que agende una llamada con la experta. El setter llega hasta que la lead agenda; después se encarga la experta.

DÓNDE SE CAEN
Donde más se caen las leads es en la propuesta de llamada. Objeciones más comunes: dinero y falta de tiempo.

TONO
Rioplatense (vos), cálido, cercano, mensajes cortos. Una sola pregunta por mensaje. Reflejar con sus palabras lo que ella dijo antes de preguntar lo siguiente. Nada de tono vendedor ni de presión.

ESTRUCTURA DEL CHAT (8 PASOS)
1. Objetivo: perder peso, desinflamar o ambas.
2. A qué se dedica (en realidad sirve para ver si tiene capacidad económica).
3. Qué hizo o hace para perder peso o desinflamar (nutricionista, dietas, medicación).
4. Qué resultados tuvo, o si está estancada.
5. Cuánto le gustaría bajar para sentirse plena (solo si busca perder peso).
6. Caso de éxito parecido al suyo y preguntarle si le gustaría lograr algo así.
7. Propuesta de llamada con la experta.
8. Link de agenda.

REGLAS QUE NUNCA SE ROMPEN
- Nunca mencionar precio, rangos ni "inversión". Si pregunta, el valor lo ve la experta en la llamada porque hay distintas formas de trabajar.
- No inventar resultados ni casos de éxito. Solo usar casos cargados.
- No prometer nada del recurso ni del programa que no esté confirmado.
- Sin escasez falsa ni presión ("quedan pocos lugares", "solo hoy", etc.).`;

export const SYSTEM_RULES = `Sos el copiloto de una appointment setter que trabaja por Instagram (ManyChat) para Noepaz.vegan. Tu trabajo: leer la conversación con la lead, entender en qué punto está y proponer el próximo mensaje para acercarla a agendar una llamada con la experta.

Cómo escribís los mensajes sugeridos:
- En español rioplatense (vos), cálido, como escribe una persona por DM. Cortos: 1 a 3 oraciones.
- Una sola pregunta por mensaje, como máximo.
- Reflejá lo que ella dijo con sus palabras antes de avanzar.
- Sin emojis en exceso (uno ocasional está bien si el chat ya los usa), sin mayúsculas de énfasis, sin listas.
- Seguí la estructura de 8 pasos del negocio. No te saltees pasos salvo que ella ya haya dado esa información.

Reglas que tenés que respetar siempre (son del negocio y no se negocian):
- Nunca menciones precio, montos, rangos, cuotas ni la palabra "inversión". Si pregunta el precio, respondé que el valor lo ve la experta en la llamada porque hay distintas formas de trabajar, y volvé a la conversación.
- No inventes resultados, testimonios ni casos de éxito. Solo podés usar los casos de éxito cargados más abajo, tal cual. Si hace falta un caso y no hay uno cargado que encaje, escribí literalmente el marcador [CASO DE ÉXITO: cargá uno parecido en la pestaña Casos] en el lugar donde iría.
- No prometas nada del recurso ni del programa que no esté confirmado en el contexto del negocio. El recurso del CTA no se entrega: no digas que lo vas a mandar.
- Nada de escasez falsa, urgencia ni presión.

Enfoques posibles para cada mensaje (usá el código exacto): empatia, curiosidad, directo, prueba_social, reencuadre, liviano. Proponé 2 o 3 mensajes con enfoques distintos entre sí.

Etapas (código exacto): apertura, calificando, caso, propuesta, link, agendada, no_show, seguimiento, fria, perdida.
Objeciones (código exacto): ninguna, dinero, tiempo, lo_pienso, pareja, precio (pregunta directa por el precio), desconfianza, otra.
Calificación (capacidad económica según a qué se dedica y cómo habla): alta, media, baja, sin_dato.
Temperatura: 1 (fría, no engancha) a 5 (lista para agendar).

Si la información no está en el chat, no la supongas: usá "sin_dato" o dejala en "datos que faltan confirmar".`;

export const MODE_LABELS = {
  respondio: 'Me respondió: necesito el próximo mensaje.',
  no_responde: 'No responde: necesito un mensaje para retomar sin presionar.',
  recien_entro: 'Recién entró por el CTA: necesito el mensaje de apertura.',
  ya_agendo: 'Ya agendó: necesito confirmar la llamada y recordatorios para que se presente.',
  no_se_presento: 'No se presentó a la llamada: necesito retomar con calidez y reagendar.',
  reactivar: 'Lead fría o vieja: necesito reactivar la conversación.',
};

const L = (category, title, text) => ({ id: newId(), category, title, text });

export function defaultLibrary() {
  return [
    L('apertura', 'Apertura desde el CTA', '¡Hola! Gracias por escribirme. Antes de seguir, contame un poquito de vos así te oriento mejor: ¿qué te gustaría lograr hoy, bajar de peso, desinflamarte o las dos cosas?'),
    L('paso1', 'Objetivo', 'Te entiendo un montón. ¿Qué es lo que más te gustaría cambiar ahora: bajar de peso, desinflamarte o las dos cosas?'),
    L('paso2', 'A qué se dedica', 'Buenísimo. Y para conocerte un poco más, ¿a qué te dedicás?'),
    L('paso3', 'Qué intentó', 'Qué bueno. ¿Y qué venís haciendo o probaste hasta ahora para desinflamarte o bajar de peso? Nutricionista, alguna dieta, medicación...'),
    L('paso4', 'Resultados', '¿Y cómo te fue con eso? ¿Tuviste resultados o sentís que te quedaste estancada?'),
    L('paso5', 'Cuánto quiere bajar', 'Te entiendo, es súper frustrante poner esfuerzo y no ver cambios. ¿Cuántos kilos te gustaría bajar para sentirte plena con tu cuerpo?'),
    L('paso6', 'Caso de éxito', 'Te cuento algo: [CASO DE ÉXITO: cargá uno parecido en la pestaña Casos]. ¿Te gustaría lograr algo así?'),
    L('paso7', 'Propuesta de llamada', 'Por lo que me contás, creo que te puede servir mucho hablar con la experta. Es una llamada para conocer tu caso y ver cómo podrías lograrlo. ¿Te gustaría agendarla?'),
    L('paso8', 'Link de agenda', '¡Genial! Te paso el link para que elijas el día y horario que mejor te quede: [LINK DE AGENDA]. Cuando agendes avisame así te confirmo.'),
    L('objeciones', 'Dinero', 'Te entiendo totalmente. La llamada no tiene costo y no te compromete a nada: es para conocer tu caso y que la experta te diga qué opciones tenés. Después decidís con toda la info. ¿Te parece si la agendamos?'),
    L('objeciones', 'Tiempo', 'Te re entiendo, con todo lo que tenés encima. Justamente por eso está bueno verlo con la experta: la idea es que se adapte a tu rutina, no al revés. La llamada es cortita, ¿qué día te queda más cómodo?'),
    L('objeciones', '"Lo pienso"', 'Obvio, tomate tu tiempo. Para ayudarte a pensarlo, ¿qué es lo que te genera más duda hoy?'),
    L('objeciones', 'Pareja', '¡Me parece perfecto que lo hables! Si querés, puede sumarse a la llamada así escuchan todo juntos y deciden con la misma información. ¿Te sirve así?'),
    L('objeciones', 'Precio directo', 'Buena pregunta. El valor lo ve la experta en la llamada, porque hay distintas formas de trabajar según lo que necesite cada una. Para que te pueda orientar bien, contame: ¿qué te gustaría lograr?'),
    L('seguimientos', 'Retomar sin presión', 'Hola, ¿cómo va todo? Me quedé pensando en lo que me contaste. ¿Seguís con ganas de desinflamarte?'),
    L('seguimientos', 'Segundo seguimiento', 'Te escribo cortito por si se te pasó el mensaje. Si ahora no es buen momento no pasa nada, avisame y lo retomamos cuando quieras.'),
    L('confirmacion', 'Confirmación de agenda', '¡Listo, quedó agendada! La experta va a estar esperándote. Cualquier cosa que necesites antes, escribime por acá.'),
    L('confirmacion', 'Recordatorio el día de la llamada', '¡Hola! Te recuerdo que hoy tenés la llamada con la experta. ¿Seguís pudiendo en ese horario?'),
    L('no_show', 'No se presentó', 'Hola, hoy te estuvimos esperando para la llamada. Me imagino que se te complicó, pasa un montón. ¿Querés que busquemos otro horario que te quede mejor?'),
  ];
}

const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

export const ANALYSIS_SCHEMA = obj({
  etapa: { type: 'string', enum: STAGE_KEYS },
  paso: { type: 'integer', description: 'Paso de la estructura de 8 pasos (1 a 8) en el que está la conversación.' },
  resumen: { type: 'string' },
  perfil: obj({
    objetivo: { type: 'string', enum: OBJECTIVES },
    ocupacion: { type: 'string' },
    calificacion: { type: 'string', enum: QUALIFICATIONS },
    que_intento: { type: 'string' },
    estancada: { type: 'string', enum: ['si', 'no', 'sin_dato'] },
  }),
  objecion: { type: 'string', enum: OBJECTIONS },
  temperatura: { type: 'integer', description: '1 a 5' },
  siguiente_paso: { type: 'string' },
  mensajes: {
    type: 'array',
    description: '2 o 3 mensajes con enfoques distintos',
    items: obj({ enfoque: { type: 'string', enum: APPROACHES }, titulo: { type: 'string' }, texto: { type: 'string' } }),
  },
  evitar: { type: 'array', items: { type: 'string' } },
  seguimiento: obj({ texto: { type: 'string' }, horas: { type: 'integer' } }),
  faltan_confirmar: { type: 'array', items: { type: 'string' } },
});

export const CLASSIFY_SCHEMA = obj({
  etapa: { type: 'string', enum: STAGE_KEYS },
  max_etapa: { type: 'string', enum: FUNNEL, description: 'Etapa más avanzada del embudo a la que llegó la conversación.' },
  objetivo: { type: 'string', enum: OBJECTIVES },
  objecion: { type: 'string', enum: OBJECTIONS },
  temperatura: { type: 'integer', description: '1 a 5' },
  calificacion: { type: 'string', enum: QUALIFICATIONS },
  resumen: { type: 'string' },
});

function casesBlock(cases) {
  if (!cases.length) return 'CASOS DE ÉXITO CARGADOS: ninguno. Si un mensaje necesita un caso, usá el marcador [CASO DE ÉXITO: cargá uno parecido en la pestaña Casos].';
  return 'CASOS DE ÉXITO CARGADOS (los únicos que podés usar, sin modificar los resultados):\n' + cases
    .map((c, i) => `${i + 1}. Perfil: ${c.perfil} | Objetivo: ${c.objetivo} | Había probado: ${c.probado} | Resultado: ${c.resultado} | Tiempo: ${c.tiempo}${c.frase ? ` | Frase: "${c.frase}"` : ''}`)
    .join('\n');
}

// Parte estable del prompt: va primero y con cache_control para aprovechar el caché.
export function stableSystem({ brain, cases }) {
  return `${SYSTEM_RULES}\n\n=== CONTEXTO DEL NEGOCIO (cerebro) ===\n${brain}\n\n=== ${casesBlock(cases)}`;
}


export function analysisUser({ lead, mode, conversation, winners, library }) {
  const sent = (lead.events || []).filter((e) => e.type === 'sent').slice(-5);
  const parts = [];
  parts.push(`QUÉ NECESITO: ${MODE_LABELS[mode]}`);
  parts.push(`DATOS QUE YA TENGO DE LA LEAD: nombre ${lead.name}; etapa ${lead.stage}; objetivo ${lead.objective}; calificación ${lead.qualification}; objeción ${lead.objection}; temperatura ${lead.temperature}.${lead.notes ? ` Notas: ${lead.notes}` : ''}`);
  if (sent.length) parts.push('ÚLTIMOS MENSAJES QUE YA LE ENVIÉ (no los repitas):\n' + sent.map((e) => `- [${e.stage}/${e.approach}] ${e.text}`).join('\n'));
  if (winners.length) {
    parts.push('MENSAJES QUE FUNCIONARON (enviados a leads que después agendaron; usalos como referencia de estilo, no los copies literal):\n' + winners.map((w) => `- [${w.stage}/${w.approach}] ${w.text}`).join('\n'));
  }
  if (library.length) parts.push('MENSAJES APROBADOS DE LA BIBLIOTECA PARA ESTA SITUACIÓN:\n' + library.map((m) => `- [${m.category}] ${m.text}`).join('\n'));
  parts.push(`CONVERSACIÓN PEGADA:\n"""\n${conversation || '(vacía: es una lead nueva sin conversación todavía)'}\n"""`);
  parts.push('Devolvé el análisis: etapa y paso, resumen breve, perfil, objeción, temperatura, siguiente paso concreto, 2 o 3 mensajes listos para copiar con enfoques distintos, qué evitar, un mensaje de seguimiento con en cuántas horas mandarlo si no responde, y los datos que faltan confirmar.');
  return parts.join('\n\n');
}

export function classifyUser({ name, conversation }) {
  return `Clasificá esta conversación de setteo de Instagram (usuario: ${name}). Indicá la etapa actual, la etapa más avanzada del embudo a la que llegó (apertura, calificando, caso, propuesta, link, agendada), objetivo, objeción principal, temperatura 1-5, calificación económica y un resumen de 2 oraciones.\n\nCONVERSACIÓN:\n"""\n${conversation}\n"""`;
}

export function learningPrompt(stats) {
  return `Estos son los datos de setteo acumulados (JSON). Escribí una lectura breve en español rioplatense para la setter, con tres secciones con estos títulos exactos: "Qué funciona", "Dónde se cae", "Qué probar". Viñetas cortas, concretas y basadas solo en los números. ${stats.lowData ? 'IMPORTANTE: hay pocos datos todavía; aclaralo al principio y tratá todo como hipótesis.' : ''} No inventes cifras ni recomiendes hablar de precio ni presionar.\n\n${JSON.stringify(stats)}`;
}

export function weeklyPrompt(report) {
  return `Este es el reporte semanal de setteo (semana actual vs. anterior, JSON). Escribí una lectura breve en español rioplatense para la setter: cómo le fue, qué cambió respecto de la semana anterior, dónde está la mayor caída y 2 o 3 acciones concretas para la próxima semana. Basate solo en los números y si son pocos datos, decilo. No recomiendes hablar de precio ni presionar.\n\n${JSON.stringify(report)}`;
}
