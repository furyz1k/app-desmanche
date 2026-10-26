// Formatadores criados uma vez só: criar Intl.*Format a cada chamada custava ~0,25ms (500ms num histórico de 2.000 registros)
const numberFmt = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0})
const timeFmt = new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'})
const dateFmt = new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})
/** Símbolo da moeda escolhido nas Configurações ("R$", "$" ou "" para nenhum). */
let currency = 'R$'
export const setCurrency = (symbol:string) => { currency = symbol }
export const currencySymbol = () => currency
export const money = (value:number) => currency ? `${currency}\u00a0${numberFmt.format(value)}` : numberFmt.format(value)
export const time = (ts:number) => timeFmt.format(ts)
export const date = (ts:number) => dateFmt.format(ts)
export const duration = (ms:number) => { const s=Math.max(0,Math.floor(ms/1000)); if (s<60) return `${s}s`; const m=Math.floor(s/60); if (m<60) return `${m}m${String(s%60).padStart(2,'0')}s`; return `${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}m` }
