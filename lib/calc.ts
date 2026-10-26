import type { AppState, EarningEvent } from './types'
export type MemberTotal = { id: string; name: string; value: number; removed: boolean }
export function computeTotals(state: AppState) { const totals = new Map<string, MemberTotal>(); state.members.forEach(m => totals.set(m.id, { id: m.id, name: m.name, value: 0, removed: m.removed })); let gross = 0, fund = 0
 for (const event of state.events) if (event.type === 'earning') { gross += event.amount; fund += event.amount * event.fundPercent; const count = event.presentIds.length; if (!count) continue; const net = event.amount * (1 - event.fundPercent); for (const id of event.presentIds) { const t = totals.get(id); if (t) { t.value += net / count } } }
 return { members: [...totals.values()].sort((a,b) => b.value-a.value), gross, fund, distributed: gross-fund }
}

/** Lançamentos com menos que isso de diferença são o mesmo desmanche (ex.: clicou "1 carro" duas vezes). */
const BURST_MS = 20_000
export type Pace = { perHour: number | null; avgGapMs: number | null; lastTs: number | null; intervals: number }
export type SessionClock = { pausedAt: number | null; lastResume: number | null }
/** Estado da pausa manual: pausado desde quando e última retomada. */
export function sessionClock(state: AppState): SessionClock {
 let pausedAt: number | null = null, lastResume: number | null = null
 for (const e of state.events) { if (e.type === 'pause' && pausedAt == null) pausedAt = e.ts; else if (e.type === 'resume') { if (pausedAt != null) lastResume = e.ts; pausedAt = null } }
 return { pausedAt, lastResume }
}
export const isPaused = (state: AppState) => sessionClock(state).pausedAt != null
/** Um intervalo entre lançamentos que entrou no ritmo (endTs = horário do lançamento que o encerra). */
export type PaceInterval = { endTs: number; active: number; value: number }
/**
 * Ritmo sobre o valor bruto. Cada lançamento é "pago" pelo intervalo que o antecede,
 * então o primeiro não entra (evita contar N valores em N-1 intervalos).
 * Tempo em pausa manual é descontado do intervalo; o que sobrar acima do limite de pausa automática é ignorado.
 * Resumos (vindos de link) trazem a própria contribuição pronta e servem de âncora para o próximo lançamento.
 */
export function paceIntervals(state: AppState) {
 const autoPauseMs = state.config.autoPauseMin > 0 ? state.config.autoPauseMin * 60_000 : Infinity
 const pauses: [number, number][] = []; let open: number | null = null
 for (const e of state.events) { if (e.type === 'pause' && open == null) open = e.ts; else if (e.type === 'resume' && open != null) { pauses.push([open, e.ts]); open = null } }
 if (open != null) pauses.push([open, Infinity])
 const paused = (a: number, b: number) => pauses.reduce((sum, [p, r]) => sum + Math.max(0, Math.min(b, r) - Math.max(a, p)), 0)
 type Group = { ts: number; amount: number; anchor: boolean }
 const groups: Group[] = []
 let time = 0, value = 0, intervals = 0
 const earnings = state.events.filter((e): e is EarningEvent => e.type === 'earning').sort((a, b) => (a.until ?? a.ts) - (b.until ?? b.ts))
 for (const e of earnings) {
  if (e.count) { time += e.paceMs ?? 0; value += e.paceValue ?? 0; intervals += e.paceIntervals ?? 0; groups.push({ ts: e.until ?? e.ts, amount: 0, anchor: true }); continue }
  const last = groups.at(-1)
  if (last && !last.anchor && e.ts - last.ts < BURST_MS) { last.ts = e.ts; last.amount += e.amount } else groups.push({ ts: e.ts, amount: e.amount, anchor: false })
 }
 const counted: PaceInterval[] = []
 for (let i = 1; i < groups.length; i++) {
  if (groups[i].anchor) continue
  const a = groups[i-1].ts, b = groups[i].ts; const active = b - a - paused(a, b)
  if (active > autoPauseMs || active <= 0) continue
  time += active; value += groups[i].amount; intervals++; counted.push({ endTs: b, active, value: groups[i].amount })
 }
 return { time, value, intervals, counted, lastTs: groups.at(-1)?.ts ?? null }
}
export function computePace(state: AppState): Pace {
 const { time, value, intervals, lastTs } = paceIntervals(state)
 return { perHour: intervals >= 2 && time > 0 ? value / time * 3_600_000 : null, avgGapMs: intervals ? time / intervals : null, lastTs, intervals }
}
