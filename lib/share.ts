import type { AppState, EarningEvent } from './types'
import { computeTotals, paceIntervals } from './calc'
export function encodeShare(state:AppState) { const t=computeTotals(state); const payload={v:1,c:state.config.currency,g:state.config.groupName,d:Date.now(),total:t.gross,caixa:t.fund,m:t.members.filter(x=>x.value>0).map(x=>[x.name,x.value])}; const bytes=new TextEncoder().encode(JSON.stringify(payload)); let s=''; bytes.forEach(b=>s+=String.fromCharCode(b)); return btoa(s).replaceAll('+','-').replaceAll('/','_').replaceAll('=','') }
export function decodeShare(value:string) { try { const s=atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4)); return JSON.parse(new TextDecoder().decode(Uint8Array.from(s,c=>c.charCodeAt(0)))) } catch { return null } }

/*
 * Link da sessão completa (só leitura). Formato compacto para caber numa mensagem do Discord:
 * membros viram índices, horários viram segundos desde o registro anterior e o JSON é comprimido (deflate).
 * Prefixo "z" = comprimido, "j" = JSON puro (navegadores sem CompressionStream).
 */
type Packed = { v: 2; g: string; d: number; t: number; c: [number, number, number, number[]]; m: [string, number][]; e: unknown[][] }
const toB64url = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') }
const fromB64url = (v: string) => Uint8Array.from(atob(v.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - v.length % 4) % 4)), c => c.charCodeAt(0))
const through = async (bytes: Uint8Array, stream: CompressionStream | DecompressionStream) => new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer())

/* Formato 3 (prefixo "b"): binário com inteiros de tamanho variável. Os carros vão resumidos em trechos
 * (lançamentos seguidos com as mesmas pessoas), com totais exatos e a contribuição de cada trecho para o ritmo.
 * Horários em unidades de 10 s; o tempo de ritmo de cada trecho em décimos de segundo (ritmo idêntico ao de quem enviou). Entradas, saídas e pausas vão uma a uma. */
const UNIT = 10_000
class Writer {
  bytes: number[] = []
  v(x: number) { x = Math.max(0, Math.round(x)); while (x > 127) { this.bytes.push((x % 128) | 128); x = Math.floor(x / 128) } this.bytes.push(x) }
  s(t: string) { const b = new TextEncoder().encode(t); this.v(b.length); for (const c of b) this.bytes.push(c) }
}
class Reader {
  i = 0
  constructor(private b: Uint8Array) {}
  v() { let x = 0, m = 1, c: number; do { if (this.i >= this.b.length) throw new Error('fim'); c = this.b[this.i++]; x += (c & 127) * m; m *= 128 } while (c & 128); return x }
  s() { const n = this.v(); if (this.i + n > this.b.length) throw new Error('fim'); const t = new TextDecoder().decode(this.b.subarray(this.i, this.i + n)); this.i += n; return t }
}
type Run = { ts: number; until: number; amount: number; count: number; presentIds: string[]; partValue: number; fundPercent: number; paceMs: number; paceValue: number; paceIntervals: number }

export async function encodeSession(state: AppState): Promise<string> {
  const { partValue, fundPercent, autoPauseMin, carButtons } = state.config
  const idx = new Map(state.members.map((m, i) => [m.id, i]))
  const { counted } = paceIntervals(state)
  // Agrupa carros seguidos com as mesmas pessoas (e mesmo valor por carro/caixa) num trecho só
  type Item = { kind: 'run'; run: Run } | { kind: 'event'; ev: AppState['events'][number] }
  const items: Item[] = []
  let run: Run | null = null, runKey = ''
  const flush = () => { if (run) items.push({ kind: 'run', run }); run = null; runKey = '' }
  for (const ev of state.events) {
    if (ev.type !== 'earning') { flush(); items.push({ kind: 'event', ev }); continue }
    if (ev.count) { flush(); items.push({ kind: 'run', run: { ts: ev.ts, until: ev.until ?? ev.ts, amount: ev.amount, count: ev.count, presentIds: ev.presentIds, partValue: ev.partValue, fundPercent: ev.fundPercent, paceMs: ev.paceMs ?? 0, paceValue: ev.paceValue ?? 0, paceIntervals: ev.paceIntervals ?? 0 } }); continue }
    const key = [...ev.presentIds].sort().join(',') + '|' + ev.partValue + '|' + ev.fundPercent
    if (!run || key !== runKey) { flush(); run = { ts: ev.ts, until: ev.ts, amount: 0, count: 0, presentIds: ev.presentIds, partValue: ev.partValue, fundPercent: ev.fundPercent, paceMs: 0, paceValue: 0, paceIntervals: 0 }; runKey = key }
    run.until = ev.ts; run.amount += ev.amount; run.count++
  }
  flush()
  // Cada intervalo do ritmo pertence ao trecho que contém o lançamento que o encerra
  for (const it of items) if (it.kind === 'run' && !it.run.paceIntervals) for (const c of counted) if (c.endTs >= it.run.ts && c.endTs <= it.run.until) { it.run.paceMs += c.active; it.run.paceValue += c.value; it.run.paceIntervals++ }

  const w = new Writer()
  // Versão 4 = versão 3 + símbolo da moeda
  w.v(4); w.s(state.config.groupName); w.v(partValue); w.v(fundPercent * 10000); w.v(autoPauseMin)
  w.v(carButtons.length); carButtons.forEach(n => w.v(n))
  w.s(state.config.currency)
  w.v(Date.now() / 1000)
  w.v(state.members.length); state.members.forEach(m => { w.s(m.name); w.v((m.removed ? 1 : 0) | (m.present ? 2 : 0)) })
  const t0 = Math.round((state.events[0]?.ts ?? Date.now()) / UNIT); w.v(t0)
  // Registros vão num buffer à parte: só no fim se sabe quantos foram gravados (trocas de valor entram, órfãos saem)
  const body = new Writer()
  let prev = t0, curPv = partValue, curFp = fundPercent, written = 0
  for (const it of items) {
    const ts = it.kind === 'run' ? it.run.ts : it.ev.ts
    const u = Math.max(prev, Math.round(ts / UNIT))
    if (it.kind === 'run') {
      const r = it.run
      if (r.partValue !== curPv || r.fundPercent !== curFp) { body.v(4); body.v(0); body.v(r.partValue); body.v(r.fundPercent * 10000); curPv = r.partValue; curFp = r.fundPercent; written++ }
      const ids = r.presentIds.map(id => idx.get(id)).filter((i): i is number => i != null).sort((a, b) => a - b)
      body.v(5); body.v(u - prev); body.v(r.amount); body.v(r.count); body.v(Math.max(0, Math.round(r.until / UNIT) - u))
      body.v(ids.length); let last = 0; ids.forEach(i => { body.v(i - last); last = i })
      body.v(r.paceMs / 100); body.v(r.paceValue); body.v(r.paceIntervals)
    } else {
      const ev = it.ev
      if (ev.type === 'leave' || ev.type === 'return') { const i = idx.get(ev.memberId); if (i == null) continue; body.v(ev.type === 'leave' ? (ev.removal ? 7 : 0) : ev.first ? 6 : 1); body.v(u - prev); body.v(i) }
      else { body.v(ev.type === 'pause' ? 2 : 3); body.v(u - prev) }
    }
    written++
    prev = u
  }
  w.v(written)
  const raw = new Uint8Array([...w.bytes, ...body.bytes])
  if (typeof CompressionStream === 'undefined') return 'c' + toB64url(raw)
  return 'b' + toB64url(await through(raw, new CompressionStream('deflate-raw')))
}

function decodeV3(bytes: Uint8Array): { state: AppState; sharedAt: number } {
  const r = new Reader(bytes)
  const version = r.v()
  if (version !== 3 && version !== 4) throw new Error('versão')
  const groupName = r.s(), partValue = r.v(), fundPercent = r.v() / 10000, autoPauseMin = r.v()
  const carButtons = Array.from({ length: r.v() }, () => r.v())
  const currency = version >= 4 ? r.s() : 'R$'
  const sharedAt = r.v() * 1000
  const members = Array.from({ length: r.v() }, (_, i) => { const name = r.s(), f = r.v(); return { id: 'm' + i, name, removed: (f & 1) === 1, present: (f & 2) === 2 } })
  let u = r.v(), curPv = partValue, curFp = fundPercent
  const events: AppState['events'] = []
  const n = r.v()
  for (let i = 0; i < n; i++) {
    const code = r.v(); u += r.v(); const ts = u * UNIT, id = 's' + i
    if (code === 0 || code === 1) events.push({ id, type: code === 0 ? 'leave' : 'return', ts, memberId: 'm' + r.v() })
    else if (code === 6) events.push({ id, type: 'return', ts, memberId: 'm' + r.v(), first: true })
    else if (code === 7) events.push({ id, type: 'leave', ts, memberId: 'm' + r.v(), removal: true })
    else if (code === 2 || code === 3) events.push({ id, type: code === 2 ? 'pause' : 'resume', ts })
    else if (code === 4) { curPv = r.v(); curFp = r.v() / 10000 }
    else if (code === 5) {
      const amount = r.v(), count = r.v(), until = ts + r.v() * UNIT
      let last = 0; const presentIds = Array.from({ length: r.v() }, () => 'm' + (last += r.v()))
      const run: EarningEvent = { id, type: 'earning', ts, until, amount, count, label: 'x', presentIds, partValue: curPv, fundPercent: curFp, paceMs: r.v() * 100, paceValue: r.v(), paceIntervals: r.v() }
      events.push(run)
    } else throw new Error('código')
  }
  return { state: { version: 1, config: { groupName, partValue, fundPercent, autoPauseMin, carButtons, currency }, members, events, sessionStart: null }, sharedAt }
}

/** Devolve o estado da sessão (ainda não sanitizado) e quando o link foi gerado, ou null se o link estiver quebrado/incompleto. */
export async function decodeSession(value: string): Promise<{ state: AppState; sharedAt: number } | null> {
  try {
    const kind = value[0], body = fromB64url(value.slice(1))
    if (kind === 'b') return decodeV3(await through(body, new DecompressionStream('deflate-raw')))
    if (kind === 'c') return decodeV3(body)
    // Formato 2 (JSON), dos primeiros links enviados
    const bytes = kind === 'z' ? await through(body, new DecompressionStream('deflate-raw')) : kind === 'j' ? body : null
    if (!bytes) return null
    const p = JSON.parse(new TextDecoder().decode(bytes)) as Packed
    if (p?.v !== 2 || !Array.isArray(p.m) || !Array.isArray(p.e) || !Array.isArray(p.c)) return null
    const [partValue, fundPercent, autoPauseMin, carButtons] = p.c
    const members = p.m.map(([name, flags], i) => ({ id: 'm' + i, name: String(name), removed: (flags & 1) === 1, present: (flags & 2) === 2 }))
    let secs = 0
    const events = p.e.map((row, i): AppState['events'][number] | null => {
      secs += Number(row[1]) || 0; const ts = p.t + secs * 1000; const id = 's' + i
      switch (row[0]) {
        case 0: return { id, type: 'earning', ts, amount: Number(row[2]), presentIds: (row[3] as number[]).map(n => 'm' + n), label: row[4] ? 'Valor total' : 'x', partValue: row.length > 5 ? Number(row[5]) : partValue, fundPercent: row.length > 6 ? Number(row[6]) : fundPercent }
        case 1: case 2: return { id, type: row[0] === 1 ? 'leave' : 'return', ts, memberId: 'm' + row[2] }
        case 3: case 4: return { id, type: row[0] === 3 ? 'pause' : 'resume', ts }
        default: return null
      }
    }).filter((x): x is AppState['events'][number] => x != null)
    return { state: { version: 1, config: { groupName: String(p.g), partValue, fundPercent, autoPauseMin, carButtons, currency: 'R$' }, members, events, sessionStart: null }, sharedAt: Number(p.d) || Date.now() }
  } catch { return null }
}
