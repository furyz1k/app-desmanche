/**
 * Preferências deste aparelho (não fazem parte da sessão: não vão em links nem em backups
 * e não são apagadas por "Apagar tudo").
 */
export type Prefs = { haptics: boolean; shortcuts: boolean; sortBy: 'value' | 'name' }
const KEY = 'desmanche:prefs'
export const defaultPrefs = (): Prefs => ({ haptics: true, shortcuts: true, sortBy: 'value' })
export function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}')
    const d = defaultPrefs()
    return {
      haptics: typeof p.haptics === 'boolean' ? p.haptics : d.haptics,
      shortcuts: typeof p.shortcuts === 'boolean' ? p.shortcuts : d.shortcuts,
      sortBy: p.sortBy === 'name' ? 'name' : 'value',
    }
  } catch {
    return defaultPrefs()
  }
}
export function savePrefs(p: Prefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch {}
}
