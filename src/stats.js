// Métricas: aprendizaje, reporte semanal y embudo acumulado.
import { FUNNEL, funnelIndex, INACTIVE_STAGES } from './domain.js';

const DAY = 24 * 3600 * 1000;
const ts = (v) => (v ? new Date(v).getTime() : NaN);
export const isBooked = (l) => funnelIndex(l.maxFunnel) >= funnelIndex('agendada');
const bookedAt = (l) => ts(l.reachedAt?.agendada);
const rate = (num, den) => (den ? num / den : null);

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function sentEvents(leads) {
  const out = [];
  for (const l of leads) for (const ev of l.events || []) if (ev.type === 'sent') out.push({ lead: l, ev });
  return out;
}

export function winners(leads, limit = 40) {
  const out = [];
  for (const { lead, ev } of sentEvents(leads)) {
    if (isBooked(lead) && ts(ev.at) <= bookedAt(lead)) {
      out.push({ text: ev.text, approach: ev.approach, stage: ev.stage, at: ev.at, leadName: lead.name, leadId: lead.id });
    }
  }
  return out.sort((a, b) => ts(b.at) - ts(a.at)).slice(0, limit);
}

export function learning(leads) {
  const sent = sentEvents(leads);
  const byApproach = new Map();
  for (const { lead, ev } of sent) {
    const key = `${ev.approach}|${ev.stage}`;
    const row = byApproach.get(key) || { approach: ev.approach, stage: ev.stage, sent: 0, booked: 0 };
    row.sent++;
    if (isBooked(lead) && bookedAt(lead) >= ts(ev.at)) row.booked++;
    byApproach.set(key, row);
  }
  const group = (field) => {
    const m = new Map();
    for (const l of leads) {
      const k = l[field] || 'sin_dato';
      const row = m.get(k) || { key: k, leads: 0, booked: 0 };
      row.leads++;
      if (isBooked(l)) row.booked++;
      m.set(k, row);
    }
    return [...m.values()].map((r) => ({ ...r, rate: rate(r.booked, r.leads) })).sort((a, b) => b.leads - a.leads);
  };
  const hours = leads.filter(isBooked).map((l) => (bookedAt(l) - ts(l.createdAt)) / 3600000).filter((h) => Number.isFinite(h) && h >= 0);
  const booked = leads.filter(isBooked).length;
  return {
    totals: { leads: leads.length, booked, sent: sent.length, rate: rate(booked, leads.length) },
    byApproachStage: [...byApproach.values()].map((r) => ({ ...r, rate: rate(r.booked, r.sent) })).sort((a, b) => b.sent - a.sent),
    byObjection: group('objection'),
    byQualification: group('qualification'),
    medianHoursToBook: median(hours),
    winners: winners(leads),
    lowData: booked < 5 || sent.length < 20,
  };
}

export function funnel(leads) {
  const counts = FUNNEL.map((_, i) => leads.filter((l) => funnelIndex(l.maxFunnel) >= i).length);
  return withDrops(counts);
}

function withDrops(counts) {
  const steps = FUNNEL.map((stage, i) => ({ stage, count: counts[i] }));
  let biggest = null;
  for (let i = 0; i < steps.length - 1; i++) {
    const from = counts[i];
    const lost = from - counts[i + 1];
    const drop = from ? lost / from : 0;
    steps[i].dropToNext = from ? drop : null;
    if (from && (!biggest || drop > biggest.drop)) biggest = { from: FUNNEL[i], to: FUNNEL[i + 1], drop, lost };
  }
  return { steps, biggest };
}

function summarize(leads, start, end, now) {
  const inWin = (v) => {
    const t = ts(v);
    return t >= start && t < end;
  };
  const cohort = leads.filter((l) => inWin(l.createdAt));
  const reachedProposal = leads.filter((l) => inWin(l.reachedAt?.propuesta));
  const booked = leads.filter((l) => inWin(l.reachedAt?.agendada));
  let sent = 0;
  let noShows = 0;
  const active = new Set(cohort);
  for (const l of leads) {
    for (const ev of l.events || []) {
      if (!inWin(ev.at)) continue;
      active.add(l);
      if (ev.type === 'sent') sent++;
      if (ev.type === 'stage' && ev.to === 'no_show') noShows++;
    }
  }
  const objections = {};
  for (const l of active) if (l.objection && l.objection !== 'ninguna') objections[l.objection] = (objections[l.objection] || 0) + 1;
  const cohortFunnel = withDrops(FUNNEL.map((_, i) => cohort.filter((l) => funnelIndex(l.maxFunnel) >= i).length));
  return {
    newLeads: cohort.length,
    reachedProposal: reachedProposal.length,
    booked: booked.length,
    sent,
    leadToBook: rate(cohort.filter(isBooked).length, cohort.length),
    proposalToBook: rate(reachedProposal.filter(isBooked).length, reachedProposal.length),
    noShows,
    biggestDrop: cohortFunnel.biggest,
    objections,
    withoutFollowUp: now ? leads.filter((l) => !INACTIVE_STAGES.includes(l.stage) && (!l.followUpAt || ts(l.followUpAt) < end)).length : null,
  };
}

export function weekly(leads, now, offset = 0) {
  const end = now.getTime() - offset * 7 * DAY;
  const start = end - 7 * DAY;
  return {
    offset,
    range: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    current: summarize(leads, start, end, offset === 0 ? now : null),
    previous: summarize(leads, start - 7 * DAY, start, null),
  };
}
