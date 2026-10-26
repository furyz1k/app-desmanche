/** autoPauseMin: minutos sem lançamento até considerar pausa automática (0 desliga). currency: símbolo da moeda. */
export type Config = { groupName: string; partValue: number; carButtons: number[]; fundPercent: number; autoPauseMin: number; currency: string }
export const CURRENCIES = ['R$', '$', ''] as const
export type Member = { id: string; name: string; present: boolean; removed: boolean }
/**
 * Lançamento de valor. Vindo de um link de sessão, vários carros seguidos com as mesmas pessoas viram um
 * resumo: count = quantos lançamentos, until = horário do último, pace* = contribuição já calculada para o ritmo.
 */
export type EarningEvent = { id: string; type: 'earning'; ts: number; amount: number; label: string; presentIds: string[]; partValue: number; fundPercent: number; count?: number; until?: number; paceMs?: number; paceValue?: number; paceIntervals?: number }
/** batch: mesma id para as entradas/saídas feitas de uma vez ("Todos"/"Ninguém"), desfeitas juntas. */
/**
 * first: entrada de quem acabou de ser adicionado ("entrou"), em vez de uma volta.
 * removal: saída causada por remover o membro enquanto estava presente.
 */
export type PresenceEvent = { id: string; type: 'leave' | 'return'; ts: number; memberId: string; batch?: string; first?: boolean; removal?: boolean }
/** Pausa/retomada manual do cronômetro de ritmo. */
export type SessionEvent = { id: string; type: 'pause' | 'resume'; ts: number }
export type AppEvent = EarningEvent | PresenceEvent | SessionEvent
export type AppState = { version: 1; config: Config; members: Member[]; events: AppEvent[]; sessionStart: number | null }
export const defaultState = (): AppState => ({ version: 1, config: { groupName: 'Desmanche', partValue: 7000, carButtons: [1, 3], fundPercent: 0, autoPauseMin: 15, currency: 'R$' }, members: [], events: [], sessionStart: null })
