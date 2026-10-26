import type { AppState } from './types'
import { defaultState } from './types'
export const STORAGE_KEY='desmanche:v1'
const KEY=STORAGE_KEY
export function loadState(): AppState { try { const raw=localStorage.getItem(KEY); if(!raw) return defaultState(); const parsed=JSON.parse(raw); if(parsed?.version!==1) return defaultState(); return parsed } catch { return defaultState() } }
export function saveState(state:AppState) { try { localStorage.setItem(KEY,JSON.stringify(state)); return true } catch { return false } }
