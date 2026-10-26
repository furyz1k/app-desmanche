"use client";
import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Car,
  Check,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FileText,
  LayoutGrid,
  History,
  LogIn,
  LogOut,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Share2,
  Trash2,
  Undo2,
  Upload,
  UserPlus,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { computePace, computeTotals, isPaused, sessionClock, type MemberTotal, type Pace, type SessionClock } from "@/lib/calc";
import { currencySymbol, date, duration, money, setCurrency, time } from "@/lib/format";
import { loadPrefs, savePrefs, type Prefs } from "@/lib/prefs";
import {
  CURRENCIES,
  defaultState,
  type AppState,
  type Config,
  type AppEvent,
  type EarningEvent,
  type Member,
  type PresenceEvent,
} from "@/lib/types";
import { STORAGE_KEY, loadState, saveState } from "@/lib/storage";
import { decodeSession, decodeShare, encodeSession, encodeShare } from "@/lib/share";

type Action =
  | { type: "IMPORT"; value: AppState }
  | { type: "ADD_MEMBER"; name: string }
  | { type: "RENAME"; id: string; name: string }
  | { type: "REMOVE"; id: string }
  | { type: "RESTORE_MEMBER"; id: string; present: boolean }
  | { type: "PRESENCE"; id: string }
  | { type: "ALL"; value: boolean }
  | { type: "EARN"; id: string; amount: number; label: string }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "DELETE"; id: string }
  | { type: "INSERT_EVENT"; event: AppEvent }
  | { type: "UNDO" }
  | { type: "CONFIG"; value: Partial<Config> }
  | { type: "NEW" }
  | { type: "RESTORE_SESSION"; events: AppEvent[]; sessionStart: number | null }
  | { type: "RESET" };

const HISTORY_PREVIEW = 6;
/** Limite de uma mensagem do Discord (sem Nitro). */
const DISCORD_LIMIT = 2000;
const MAIN_GRID = cn(
  "mx-auto grid w-full max-w-7xl flex-1 gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6",
  // Em telas baixas os cards mantêm um mínimo utilizável e a área rola, em vez de esmagar Divisão/Histórico
  "scrollbar-subtle lg:min-h-0 lg:overflow-y-auto lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:grid-rows-[max-content_minmax(12rem,1fr)_minmax(12rem,1.25fr)] lg:py-4",
  "lg:[grid-template-areas:'car_members'_'result_members'_'result_history']",
);
const MAX_CAR_BUTTONS = 6;

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const isPresence = (e: AppEvent): e is PresenceEvent => e.type === "leave" || e.type === "return";
/** O histórico mostra só entradas, saídas e pausas; os carros ficam guardados para totais, ritmo e desfazer. */
const isLogged = (e: AppEvent) => e.type !== "earning";
/** Quantos lançamentos existem (um resumo vindo de link conta todos os que ele representa). */
const countLaunches = (events: AppEvent[]) => events.reduce((n, e) => (e.type === "earning" ? n + (e.count ?? 1) : n), 0);
const isSummary = (e: AppEvent | undefined) => e?.type === "earning" && !!e.count;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Título e detalhe de um registro, usados no histórico e nos avisos. */
function describeEvent(e: AppEvent, memberName: (id: string) => string) {
  switch (e.type) {
    case "earning":
      if (e.count)
        return { title: money(e.amount), detail: `Resumo de ${plural(e.count, "lançamento", "lançamentos")} · ${plural(e.presentIds.length, "pessoa", "pessoas")}` };
      return {
        title: money(e.amount),
        detail: `${e.label === "Valor total" ? "Valor avulso" : plural(Math.round(e.amount / e.partValue), "carro", "carros")} · ${plural(e.presentIds.length, "pessoa", "pessoas")}`,
      };
    case "leave":
      return e.removal
        ? { title: `${memberName(e.memberId)} saiu da lista`, detail: "Removido do grupo e deixou de receber" }
        : { title: `${memberName(e.memberId)} saiu`, detail: "Deixou de receber" };
    case "return":
      return e.first
        ? { title: `${memberName(e.memberId)} entrou`, detail: "Começou a receber" }
        : { title: `${memberName(e.memberId)} voltou`, detail: "Voltou a receber" };
    case "pause":
      return { title: "Cronômetro pausado", detail: "Tempo parado não conta no ritmo" };
    case "resume":
      return { title: "Cronômetro retomado", detail: "Ritmo voltou a contar" };
  }
}
// Por grafema: emoji compostos (👨‍👩‍👧) e letras acentuadas contam como um caractere só
const graphemes = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("pt-BR", { granularity: "grapheme" }) : null;
const firstChar = (word: string) =>
  (graphemes ? graphemes.segment(word)[Symbol.iterator]().next().value?.segment : Array.from(word)[0]) ?? "";
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => firstChar(p).toUpperCase())
    .join("") || "?";
/** Ligado/desligado em Configurações → Preferências (preferência deste aparelho). */
let hapticsEnabled = true;
const haptic = (pattern: number | number[] = 8) => {
  if (!hapticsEnabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {}
};

/**
 * Confirmação no próprio controle (ex.: botão vira "Copiado" por um instante), no lugar de um aviso
 * flutuante: o retorno aparece onde a pessoa está olhando e não cobre o resto da tela.
 */
function useFlash(ms = 1400) {
  const [value, setValue] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const flash = useCallback(
    (key: string) => {
      setValue(key);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setValue(null), ms);
    },
    [ms],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [value, flash] as const;
}

/** Região invisível que leitores de tela leem em voz alta (substitui o aviso visual das ações frequentes). */
function useAnnouncer() {
  const [message, setMessage] = useState("");
  // Alterna um caractere invisível para repetir o anúncio mesmo quando o texto é igual ao anterior
  const announce = useCallback((text: string) => setMessage((prev) => (prev === text ? text + "\u200b" : text)), []);
  const region = (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
  return [region, announce] as const;
}

function reducer(state: AppState, action: Action): AppState {
  const now = Date.now();
  switch (action.type) {
    case "IMPORT":
      return action.value;
    case "ADD_MEMBER": {
      // Quem é adicionado já começa presente: registra a entrada no histórico
      const id = uid();
      return {
        ...state,
        members: [...state.members, { id, name: action.name, present: true, removed: false }],
        events: [...state.events, { id: uid(), type: "return", ts: now, memberId: id, first: true }],
      };
    }
    case "RENAME":
      return {
        ...state,
        members: state.members.map((m) =>
          m.id === action.id ? { ...m, name: action.name } : m,
        ),
      };
    case "REMOVE": {
      // Remover quem está presente é uma saída: fica registrada no histórico
      const wasPresent = state.members.some((x) => x.id === action.id && x.present && !x.removed);
      return {
        ...state,
        members: state.members.map((x) =>
          x.id === action.id ? { ...x, removed: true, present: false } : x,
        ),
        events: wasPresent
          ? [...state.events, { id: uid(), type: "leave", ts: now, memberId: action.id, removal: true }]
          : state.events,
      };
    }
    case "RESTORE_MEMBER": {
      // Desfazer a remoção também apaga a saída que ela registrou
      const i = state.events.findLastIndex((e) => isPresence(e) && e.memberId === action.id && e.removal);
      return {
        ...state,
        members: state.members.map((x) =>
          x.id === action.id ? { ...x, removed: false, present: action.present } : x,
        ),
        events: i >= 0 ? state.events.filter((_, j) => j !== i) : state.events,
      };
    }
    case "PRESENCE": {
      const m = state.members.find((x) => x.id === action.id);
      if (!m) return state;
      const next = !m.present;
      const ev: PresenceEvent = {
        id: uid(),
        type: next ? "return" : "leave",
        ts: now,
        memberId: m.id,
      };
      return {
        ...state,
        members: state.members.map((x) =>
          x.id === m.id ? { ...x, present: next } : x,
        ),
        events: [...state.events, ev],
      };
    }
    case "ALL": {
      // Cada pessoa que muda ganha sua entrada/saída no histórico; o lote é desfeito de uma vez
      const changed = state.members.filter((m) => !m.removed && m.present !== action.value);
      if (!changed.length) return state;
      const batch = uid();
      return {
        ...state,
        members: state.members.map((m) => ({ ...m, present: !m.removed ? action.value : false })),
        events: [
          ...state.events,
          ...changed.map((m): PresenceEvent => ({ id: uid(), type: action.value ? "return" : "leave", ts: now, memberId: m.id, batch })),
        ],
      };
    }
    case "EARN": {
      const present = state.members
        .filter((m) => m.present && !m.removed)
        .map((m) => m.id);
      if (!present.length) return state;
      const e: EarningEvent = {
        id: action.id,
        type: "earning",
        ts: now,
        amount: action.amount,
        label: action.label,
        presentIds: present,
        partValue: state.config.partValue,
        fundPercent: state.config.fundPercent,
      };
      // Lançar com o cronômetro pausado retoma automaticamente
      const resume: AppEvent[] = isPaused(state) ? [{ id: uid(), type: "resume", ts: now }] : [];
      return {
        ...state,
        sessionStart: state.sessionStart ?? now,
        events: [...state.events, ...resume, e],
      };
    }
    case "PAUSE":
      if (isPaused(state)) return state;
      return { ...state, events: [...state.events, { id: uid(), type: "pause", ts: now }] };
    case "RESUME":
      if (!isPaused(state)) return state;
      return { ...state, events: [...state.events, { id: uid(), type: "resume", ts: now }] };
    case "DELETE":
      return {
        ...state,
        events: state.events.filter((e) => e.id !== action.id),
      };
    case "INSERT_EVENT":
      return {
        ...state,
        events: [...state.events, action.event].sort((a, b) => a.ts - b.ts),
      };
    case "UNDO": {
      const last = state.events.at(-1);
      // Um resumo vindo de link representa vários lançamentos: não some com um Ctrl+Z
      if (!last || isSummary(last)) return state;
      if (isPresence(last) && last.removal)
        return {
          ...state,
          members: state.members.map((m) => (m.id === last.memberId ? { ...m, removed: false, present: true } : m)),
          events: state.events.slice(0, -1),
        };
      if (isPresence(last) && last.first)
        return {
          ...state,
          members: state.members.filter((m) => m.id !== last.memberId),
          events: state.events.slice(0, -1),
        };
      if (isPresence(last)) {
        let cut = state.events.length - 1;
        if (last.batch)
          while (cut > 0) {
            const prev = state.events[cut - 1];
            if (isPresence(prev) && prev.batch === last.batch) cut--;
            else break;
          }
        const revert = new Map((state.events.slice(cut) as PresenceEvent[]).map((e) => [e.memberId, e.type === "leave"]));
        return {
          ...state,
          members: state.members.map((m) => (revert.has(m.id) ? { ...m, present: revert.get(m.id)! } : m)),
          events: state.events.slice(0, cut),
        };
      }
      return { ...state, events: state.events.slice(0, -1) };
    }
    case "CONFIG":
      return { ...state, config: { ...state.config, ...action.value } };
    case "NEW":
      return { ...state, events: [], sessionStart: null };
    case "RESTORE_SESSION":
      return { ...state, events: action.events, sessionStart: action.sessionStart };
    case "RESET":
      return defaultState();
    default:
      return state;
  }
}

/** Garante que dados antigos/corrompidos do localStorage tenham todos os campos. */
function sanitize(saved: AppState): AppState {
  const base = defaultState();
  const config = { ...base.config, ...saved.config };
  const buttons = Array.isArray(config.carButtons)
    ? config.carButtons.filter((n) => Number.isInteger(n) && n > 0 && n < 100).slice(0, MAX_CAR_BUTTONS)
    : [];
  const events = Array.isArray(saved.events) ? saved.events.filter(isValidEvent).sort((a, b) => a.ts - b.ts) : [];
  return {
    ...base,
    ...saved,
    // Início da sessão = primeiro lançamento (recalculado: o valor salvo pode estar corrompido)
    sessionStart: events.find((e) => e.type === "earning")?.ts ?? null,
    config: {
      ...config,
      groupName: typeof config.groupName === "string" && config.groupName.trim() ? config.groupName.slice(0, 40) : base.config.groupName,
      currency: (CURRENCIES as readonly string[]).includes(config.currency) ? config.currency : base.config.currency,
      fundPercent:
        typeof config.fundPercent === "number" && config.fundPercent >= 0 && config.fundPercent <= 1
          ? config.fundPercent
          : base.config.fundPercent,
      carButtons: buttons.length ? buttons : base.config.carButtons,
      partValue: typeof config.partValue === "number" && config.partValue > 0 ? config.partValue : base.config.partValue,
      autoPauseMin:
        Number.isFinite(config.autoPauseMin) && config.autoPauseMin >= 0
          ? Math.min(240, config.autoPauseMin)
          : base.config.autoPauseMin,
    },
    members: Array.isArray(saved.members)
      ? saved.members.filter((m) => m && typeof m.id === "string" && typeof m.name === "string" && m.name.trim())
      : [],
    events,
  };
}

function isValidEvent(e: unknown): e is AppEvent {
  if (!e || typeof e !== "object") return false;
  const ev = e as Record<string, unknown>;
  if (typeof ev.id !== "string" || typeof ev.ts !== "number" || !Number.isFinite(ev.ts)) return false;
  switch (ev.type) {
    case "earning":
      return (
        typeof ev.amount === "number" && ev.amount > 0 && Array.isArray(ev.presentIds) &&
        typeof ev.partValue === "number" && ev.partValue > 0 && typeof ev.fundPercent === "number"
      );
    case "leave":
    case "return":
      return typeof ev.memberId === "string";
    case "pause":
    case "resume":
      return true;
    default:
      return false;
  }
}

/** Aceita o arquivo de backup (ou o estado puro) e devolve um estado válido, ou null. */
function parseBackup(text: string): AppState | null {
  try {
    const data = JSON.parse(text);
    const state = data?.app === "desmanche" ? data.state : data;
    if (!state || state.version !== 1 || !Array.isArray(state.members) || !Array.isArray(state.events)) return null;
    return sanitize(state);
  } catch {
    return null;
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback para contextos sem Clipboard API (ex.: http em rede local)
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/* ───────────────────────── Peças de interface ───────────────────────── */

function Panel({
  title,
  subtitle,
  icon,
  action,
  className,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-slot="panel"
      className={cn(
        "flex min-h-0 min-w-0 scroll-mt-20 flex-col gap-4 rounded-[1.375rem] bg-card p-4 ring-1 ring-white/[0.06] sm:p-5",
        className,
      )}
    >
      {/* Quebra a linha quando o texto cresce (Texto Dinâmico / zoom): título e ações nunca estouram */}
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-[5.5rem] flex-1 items-center gap-3">
          {icon && (
            <span className="hidden size-8 shrink-0 items-center justify-center rounded-[0.625rem] bg-fill text-muted-foreground sm:flex [&_svg]:size-[1.0625rem]">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-[1.0625rem] leading-tight font-semibold tracking-[-0.012em]">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 line-clamp-2 text-[0.8125rem] text-pretty text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {action && <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5">{action}</div>}
      </header>
      {children}
    </section>
  );
}

function MoneyInput({
  value,
  onValueChange,
  className,
  ...props
}: {
  value: number | null;
  onValueChange: (value: number | null) => void;
} & Omit<React.ComponentProps<"input">, "value" | "onChange" | "type">) {
  return (
    <div className={cn("relative min-w-0", className)}>
      {currencySymbol() && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
          {currencySymbol()}
        </span>
      )}
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={cn("h-11 tabular-nums", currencySymbol().length > 1 ? "pl-10" : currencySymbol() ? "pl-8" : "pl-3")}
        value={value == null ? "" : new Intl.NumberFormat("pt-BR").format(value)}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 12);
          onValueChange(digits ? Number(digits) : null);
        }}
        {...props}
      />
    </div>
  );
}

function PresenceSwitch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-[1.625rem] w-[2.75rem] shrink-0 rounded-full transition-colors duration-200",
        on ? "bg-success" : "bg-[rgb(120_120_128/0.36)]",
      )}
    >
      <span
        data-slot="presence-thumb"
        className={cn(
          "absolute top-[2px] left-[2px] size-[1.375rem] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.3)] transition-transform duration-250 ease-[cubic-bezier(0.32,0.72,0,1)]",
          on && "translate-x-[1.125rem]",
        )}
      />
    </span>
  );
}

function Stat({
  label,
  value,
  title,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  title?: string;
  tone?: "warning";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-2.5 max-[380px]:px-2 sm:px-3" title={title}>
      <span className="truncate text-[0.6875rem] font-medium tracking-[0.01em] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "truncate text-[0.9375rem] font-semibold tracking-[-0.01em] tabular-nums max-[380px]:text-[0.8125rem]",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Cronômetro ao vivo. Atualiza sozinho para não re-renderizar o app a cada segundo. */
function SinceLast({
  lastCarTs,
  clock,
  autoPauseMin,
}: {
  lastCarTs: number | null;
  clock: SessionClock;
  autoPauseMin: number;
}) {
  const base = Math.max(lastCarTs ?? -Infinity, clock.lastResume ?? -Infinity);
  const live = clock.pausedAt != null || Number.isFinite(base);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live, base, clock.pausedAt]);

  if (clock.pausedAt != null)
    return <Stat label="Pausado há" value={duration(now - clock.pausedAt)} tone="warning" />;
  if (!Number.isFinite(base)) return <Stat label="Último" value="—" />;
  const elapsed = now - base;
  const auto = autoPauseMin > 0 && elapsed > autoPauseMin * 60_000;
  const resumed = (clock.lastResume ?? -Infinity) > (lastCarTs ?? -Infinity);
  return (
    <Stat
      label={auto ? "Pausa auto há" : resumed ? "Retomado há" : "Último"}
      value={elapsed < 5000 ? "agora" : duration(elapsed)}
      tone={auto ? "warning" : undefined}
      title={auto ? `Mais de ${autoPauseMin} min sem lançamento: esse intervalo não conta no ritmo` : undefined}
    />
  );
}

/** Sempre renderizada (com "—" sem dados) para o card não mudar de altura no primeiro lançamento. */
function PaceStrip({
  pace,
  clock,
  autoPauseMin,
  onTogglePause,
}: {
  pace: Pace;
  clock: SessionClock;
  autoPauseMin: number;
  /** Sem esta função a faixa é só leitura (link compartilhado): sem botão e sem cronômetro ao vivo. */
  onTogglePause?: () => void;
}) {
  const paused = clock.pausedAt != null;
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-2xl bg-fill/60 p-1.5 ring-1 ring-transparent transition-[background-color,box-shadow] duration-200 sm:flex-row",
        paused && "bg-warning/10 ring-warning/25",
      )}
    >
      <div className="grid flex-1 grid-cols-[1.7fr_1fr_1fr] divide-x divide-separator/50 py-1 sm:grid-cols-3">
        <Stat
          label="Ritmo bruto"
          value={
            pace.perHour != null ? (
              <>
                {money(pace.perHour)}
                <span className="ml-0.5 text-xs font-medium text-muted-foreground">/h</span>
              </>
            ) : (
              "—"
            )
          }
          title={pace.perHour == null ? "Aparece a partir do 3º lançamento" : "Valor bruto por hora, sem contar o tempo em pausa"}
        />
        <Stat label="Intervalo" value={pace.avgGapMs != null ? duration(pace.avgGapMs) : "—"} />
        {onTogglePause ? (
          <SinceLast lastCarTs={pace.lastTs} clock={clock} autoPauseMin={autoPauseMin} />
        ) : clock.pausedAt != null ? (
          <Stat label="Pausado às" value={time(clock.pausedAt)} tone="warning" />
        ) : (
          <Stat label="Último às" value={pace.lastTs != null ? time(pace.lastTs) : "—"} />
        )}
      </div>
      {onTogglePause && (
      <button
        type="button"
        onClick={onTogglePause}
        disabled={pace.lastTs == null}
        aria-pressed={paused}
        title={pace.lastTs == null ? "Disponível após o primeiro lançamento" : paused ? "Retomar cronômetro (P)" : "Pausar cronômetro (P)"}
        className={cn(
          "press flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold outline-none select-none focus-visible:ring-3 focus-visible:ring-ring sm:h-auto sm:min-w-30",
          "disabled:cursor-not-allowed disabled:opacity-40",
          paused ? "bg-warning text-black hover:brightness-105" : "bg-white/[0.07] text-foreground hover:bg-white/[0.11]",
        )}
      >
        {paused ? <Play className="size-4 fill-current" /> : <Pause className="size-4 fill-current" />}
        {paused ? "Retomar" : "Pausar"}
      </button>
      )}
    </div>
  );
}

/** Quadros de resumo + ranking de quanto cada um recebe (painel e link de sessão usam o mesmo). */
function DivisionSummary({
  members,
  gross,
  fund,
  distributed,
  fundPercent,
  earnings,
  sortBy = "value",
}: {
  members: MemberTotal[];
  gross: number;
  fund: number;
  distributed: number;
  fundPercent: number;
  earnings: number;
  sortBy?: Prefs["sortBy"];
}) {
  const results = members.filter((m) => m.value > 0 || !m.removed);
  if (sortBy === "name") results.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const maxValue = Math.max(1, ...results.map((m) => m.value));
  const tile = "rounded-2xl bg-fill/60 px-3 py-2.5";
  const value = "mt-0.5 truncate text-base font-semibold tabular-nums sm:text-lg";
  return (
    <>
      <dl className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(min(100%,6rem),1fr))] gap-2">
        <div className={tile}>
          <dt className="truncate text-xs text-muted-foreground">Bruto</dt>
          <dd className={value}>{money(gross)}</dd>
        </div>
        {fundPercent > 0 && (
          <div className={tile}>
            <dt className="truncate text-xs text-muted-foreground">Caixa · {Math.round(fundPercent * 1000) / 10}%</dt>
            <dd className={cn(value, "text-primary")}>{money(fund)}</dd>
          </div>
        )}
        {fundPercent > 0 || fund > 0 ? (
          <div className={tile}>
            <dt className="truncate text-xs text-muted-foreground">Líquido</dt>
            <dd className={value}>{money(distributed)}</dd>
          </div>
        ) : (
          <div className={tile}>
            <dt className="truncate text-xs text-muted-foreground">Lançamentos</dt>
            <dd className={value}>{earnings}</dd>
          </div>
        )}
      </dl>

      {results.length === 0 ? (
        <EmptyState icon={<Users />} title="Nada para dividir ainda">
          Adicione membros e registre carros para ver a divisão.
        </EmptyState>
      ) : (
        <ol className="scrollbar-subtle scroll-gutter flex min-h-0 flex-1 flex-col divide-y divide-separator/40 overflow-y-auto overscroll-contain lg:scroll-fade">
          {results.map((m, i) => (
            <li key={m.id} className="flex items-center gap-3 py-3 first:pt-1">
              {/* Número grande, na altura do nome + barra */}
              <span className="w-7 shrink-0 text-center text-[1.375rem] leading-none font-semibold tracking-[-0.02em] text-tertiary-foreground tabular-nums">
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="flex min-w-[5rem] flex-1 items-center gap-2">
                    <span className="truncate text-[0.9375rem]">{m.name}</span>
                    {m.removed && (
                      <span className="shrink-0 rounded-full bg-fill px-2 py-0.5 text-[0.6875rem] text-muted-foreground">
                        fora da lista
                      </span>
                    )}
                  </span>
                  <strong className="max-w-full truncate text-[0.9375rem] font-semibold tabular-nums">{money(m.value)}</strong>
                </div>
                <span className="h-1 overflow-hidden rounded-full bg-fill" aria-hidden>
                  <span
                    data-slot="bar"
                    className="block h-full origin-left rounded-full bg-primary transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
                    style={{ transform: `scaleX(${m.value / maxValue})` }}
                  />
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** Controle segmentado (escolha única entre poucas opções), como no iOS. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="grid auto-cols-fr grid-flow-col rounded-[0.625rem] bg-fill p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "press hit-44 h-8 min-w-0 cursor-pointer truncate rounded-lg px-2 text-[0.8125rem] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === o.value ? "bg-[#636366] text-white shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Linha de configuração com interruptor (a linha inteira é clicável). */
function ToggleRow({ title, hint, on, onChange }: { title: string; hint: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="press flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-2xl bg-fill/60 px-3.5 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-medium">{title}</span>
        <span className="block text-xs text-pretty text-muted-foreground">{hint}</span>
      </span>
      <PresenceSwitch on={on} />
    </button>
  );
}

function EmptyState({
  icon,
  title,
  compact,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center", compact ? "py-3" : "py-8")}>
      <span className={cn("mb-1 size-11 items-center justify-center rounded-full bg-fill text-muted-foreground [&_svg]:size-5", compact ? "flex lg:hidden" : "flex")}>
        {icon}
      </span>
      <p className="text-[0.9375rem] font-medium">{title}</p>
      {children && <p className="max-w-64 text-[0.8125rem] text-muted-foreground">{children}</p>}
    </div>
  );
}

/** Botão "⊖" do modo edição, no padrão de listas do iOS. Nativo porque listas longas montam dezenas. */
function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="press hit-44 -ml-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-destructive/50"
    >
      <span className="flex size-[1.375rem] items-center justify-center rounded-full bg-destructive text-white">
        <Minus className="size-3.5" strokeWidth={3} />
      </span>
    </button>
  );
}

function EditToggle({ editing, onToggle, label }: { editing: boolean; onToggle: () => void; label: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onToggle}
      aria-pressed={editing}
      aria-label={editing ? `Concluir edição de ${label}` : `Editar ${label}`}
      className={cn("px-2.5 text-primary hover:text-primary", editing && "font-semibold")}
    >
      {editing ? "OK" : "Editar"}
    </Button>
  );
}

function EventRow({
  event,
  memberName,
  editing,
  onDelete,
}: {
  event: AppEvent;
  memberName: (id: string) => string;
  editing: boolean;
  onDelete: (event: AppEvent) => void;
}) {
  const { title, detail } = describeEvent(event, memberName);
  return (
    <li className="flex min-h-[3.25rem] min-w-0 items-center gap-3 rounded-xl px-2 py-2 [contain-intrinsic-size:auto_3.25rem] [content-visibility:auto]">
      {editing && <RemoveButton label={`Excluir: ${title}`} onClick={() => onDelete(event)} />}
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4",
          event.type === "return"
            ? "bg-success/15 text-success"
            : event.type === "pause" || event.type === "resume"
              ? "bg-warning/15 text-warning"
              : "bg-fill text-muted-foreground",
        )}
      >
        {event.type === "return" ? (
          <LogIn />
        ) : event.type === "pause" ? (
          <Pause className="fill-current" />
        ) : event.type === "resume" ? (
          <Play className="fill-current" />
        ) : (
          <LogOut />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <time className="shrink-0 text-xs text-muted-foreground tabular-nums">{time(event.ts)}</time>
    </li>
  );
}

function MemberEditRow({
  member,
  isTaken,
  onRename,
  onRemove,
}: {
  member: Member;
  isTaken: (name: string, exceptId: string) => boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(member.name);
  useEffect(() => setDraft(member.name), [member.name]);
  const trimmed = draft.trim();
  const taken = trimmed.length > 0 && trimmed.toLowerCase() !== member.name.toLowerCase() && isTaken(trimmed, member.id);
  function commit() {
    if (!trimmed || taken) setDraft(member.name);
    else if (trimmed !== member.name) onRename(trimmed);
  }
  return (
    <li className="flex min-h-14 items-center gap-2 rounded-2xl px-3 py-2">
      <RemoveButton label={`Remover ${member.name}`} onClick={onRemove} />
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fill text-[0.8125rem] font-semibold text-muted-foreground">
        {initials(trimmed || member.name)}
      </span>
      <Input
        className="h-11"
        value={draft}
        maxLength={32}
        aria-label={`Nome de ${member.name}`}
        aria-invalid={taken || undefined}
        title={taken ? "Já existe um membro com esse nome" : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(member.name);
            e.currentTarget.blur();
          }
        }}
      />
    </li>
  );
}

/* ───────────────────────── Histórico com filtros ───────────────────────── */

type HistoryKind = "all" | "presence" | "pauses";
const HISTORY_KINDS: { id: HistoryKind; label: string }[] = [
  { id: "all", label: "Tudo" },
  { id: "presence", label: "Entradas e saídas" },
  { id: "pauses", label: "Pausas" },
];
const kindOf = (e: AppEvent): Exclude<HistoryKind, "all"> =>
  e.type === "pause" || e.type === "resume" ? "pauses" : "presence";
/** Minúsculas e sem acento, para "joao" achar "João". */
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function HistoryDialog({
  open,
  onOpenChange,
  events,
  memberName,
  sessionStart,
  editing,
  onToggleEditing,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: AppEvent[];
  memberName: (id: string) => string;
  sessionStart: number | null;
  editing: boolean;
  /** Sem esta função o histórico é só leitura (link compartilhado). */
  onToggleEditing?: () => void;
  onDelete: (event: AppEvent) => void;
}) {
  const [kind, setKind] = useState<HistoryKind>("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);

  // Sessão zerada: filtros antigos não fazem mais sentido
  useEffect(() => {
    if (!events.length) {
      setKind("all");
      setQuery("");
    }
  }, [events.length]);

  // Texto pesquisável de cada registro: título, detalhe, horário, valor sem pontos e quem estava presente
  const indexed = useMemo(() => {
    if (!open) return [];
    return events
      .slice()
      .reverse()
      .map((e) => {
        const { title, detail } = describeEvent(e, memberName);
        const extra = e.type === "earning" ? `${e.amount} ${e.presentIds.map(memberName).join(" ")}` : "";
        const haystack = normalize(`${title} ${detail} ${time(e.ts)} ${extra}`);
        return { event: e, kind: kindOf(e), haystack, digits: haystack.replace(/\./g, "") };
      });
  }, [events, memberName, open]);

  const counts = useMemo(() => {
    const c = { all: indexed.length, presence: 0, pauses: 0 };
    for (const item of indexed) c[item.kind]++;
    return c;
  }, [indexed]);

  const filtered = useMemo(() => {
    const terms = normalize(deferredQuery).replace(/r\$/g, "").split(/\s+/).filter(Boolean)
      // "7.000" e "7000" acham o mesmo valor
      .map((t) => (/^[\d.]+$/.test(t) ? t.replace(/\./g, "") : t));
    return indexed.filter(
      (item) =>
        (kind === "all" || item.kind === kind) &&
        terms.every((t) => item.haystack.includes(t) || item.digits.includes(t)),
    );
  }, [indexed, kind, deferredQuery]);

  // Agrupa por hora, com subtotal dos carros daquela hora
  const groups = useMemo(() => {
    const multiDay = events.length > 0 && date(events[0].ts) !== date(events[events.length - 1].ts);
    const out: { key: string; label: string; items: AppEvent[] }[] = [];
    for (const { event } of filtered) {
      const d = new Date(event.ts);
      const hour = String(d.getHours()).padStart(2, "0");
      const key = `${date(event.ts)}-${hour}`;
      let g = out.at(-1);
      if (!g || g.key !== key) {
        g = { key, label: multiDay ? `${date(event.ts).slice(0, 5)} · ${hour}h` : `${hour}:00 – ${hour}:59`, items: [] };
        out.push(g);
      }
      g.items.push(event);
    }
    return out;
  }, [filtered, events]);

  // Renderiza em lotes: com milhares de registros o diálogo abre sem travar
  const PAGE = 120;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [kind, deferredQuery, open]);
  const visibleGroups = useMemo(() => {
    let left = limit;
    const out: typeof groups = [];
    for (const g of groups) {
      if (left <= 0) break;
      const items = g.items.slice(0, left);
      left -= items.length;
      out.push(items.length === g.items.length ? g : { ...g, items });
    }
    return out;
  }, [groups, limit]);
  const hasMore = limit < filtered.length;
  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && setLimit((l) => l + PAGE), {
      root: el.parentElement,
      rootMargin: "600px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const filtering = kind !== "all" || query.trim() !== "";
  const clear = () => {
    setKind("all");
    setQuery("");
    searchRef.current?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(85dvh,44rem)] flex-col gap-3 sm:max-w-lg"
        // No celular não abre o teclado sozinho; no computador já foca a busca
        initialFocus={(type) => (type === "touch" ? false : searchRef.current)}
      >
        <DialogHeader className="pr-10">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>Histórico</DialogTitle>
            {onToggleEditing && <EditToggle editing={editing} onToggle={onToggleEditing} label="histórico" />}
          </div>
          <DialogDescription>
            {filtering
              ? `${plural(filtered.length, "registro encontrado", "registros encontrados")} de ${events.length}`
              : sessionStart
                ? `Sessão iniciada às ${time(sessionStart)} · ${plural(events.length, "registro", "registros")}`
                : plural(events.length, "registro", "registros")}
          </DialogDescription>
        </DialogHeader>

        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            type="search"
            className="h-11 pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
            placeholder="Buscar nome ou hora"
            aria-label="Buscar no histórico"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Esc limpa a busca antes de fechar o diálogo
              if (e.key === "Escape" && query) {
                e.preventDefault();
                e.stopPropagation();
                setQuery("");
              }
            }}
            enterKeyHint="search"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              aria-label="Limpar busca"
              className="hit-44 absolute top-1/2 right-2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/15 text-foreground outline-none hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="grid shrink-0 grid-cols-[auto_1fr_auto] gap-1 sm:flex sm:gap-1.5" role="radiogroup" aria-label="Tipo de registro">
          {HISTORY_KINDS.map((k) => {
            const active = kind === k.id;
            return (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={k.id !== "all" && counts[k.id] === 0}
                onClick={() => setKind(k.id)}
                className={cn(
                  "press hit-44 flex h-8 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-full px-2 text-[0.8125rem] font-medium sm:px-3 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40",
                  active ? "bg-primary text-primary-foreground" : "bg-fill text-muted-foreground hover:text-foreground",
                )}
              >
                {k.label}
                <span className={cn("hidden text-xs tabular-nums sm:inline", active ? "opacity-70" : "text-tertiary-foreground")}>
                  {counts[k.id]}
                </span>
              </button>
            );
          })}
        </div>

        {groups.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-fill text-muted-foreground">
              <Search className="size-5" />
            </span>
            <div>
              <p className="text-[0.9375rem] font-medium">Nada encontrado</p>
              <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                {query.trim() ? `Nenhum registro com “${query.trim()}”` : "Nenhum registro desse tipo"}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={clear}>
              Limpar filtros
            </Button>
          </div>
        ) : (
          <div className="scrollbar-subtle -mx-5 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3">
            {visibleGroups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <h3 className="sticky top-0 z-10 flex items-baseline justify-between gap-3 bg-popover px-2 pt-3 pb-1.5 text-xs font-semibold text-muted-foreground">
                  <span className="tabular-nums">{g.label}</span>
                </h3>
                <ul>
                  {g.items.map((e) => (
                    <EventRow key={e.id} event={e} memberName={memberName} editing={editing} onDelete={onDelete} />
                  ))}
                </ul>
              </section>
            ))}
            {hasMore && <div key={limit} ref={sentinelRef} className="h-px" aria-hidden />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── Relatório compartilhado ───────────────────────── */

type SharedPayload = {
  v: number;
  /** Moeda de quem enviou (links antigos não têm: R$). */
  c?: string;
  g: string;
  d: number;
  total: number;
  caixa: number;
  m: [string, number, ...unknown[]][];
};

function SharedReport({ data, onExit }: { data: SharedPayload; onExit: () => void }) {
  setCurrency(data.c != null && (CURRENCIES as readonly string[]).includes(data.c) ? data.c : "R$");
  const max = Math.max(1, ...data.m.map((x) => x[1]));
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 py-10 sm:items-center">
      <div className="w-full max-w-md rounded-[1.75rem] bg-card p-6 ring-1 ring-white/[0.06]">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Relatório · {date(data.d)}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-[-0.022em]">{data.g}</h1>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-fill/60 p-3">
            <p className="text-xs text-muted-foreground">Total bruto</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">{money(data.total)}</p>
          </div>
          <div className="rounded-2xl bg-fill/60 p-3">
            <p className="text-xs text-muted-foreground">Caixa</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">{money(data.caixa)}</p>
          </div>
        </div>
        <ul className="mt-5 flex flex-col divide-y divide-separator/50">
          {data.m.map(([name, value]) => (
            <li key={name} className="flex flex-col gap-1.5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="min-w-[5rem] flex-1 truncate text-[0.9375rem]">{name}</span>
                <strong className="font-semibold tabular-nums">{money(value)}</strong>
              </div>
              <span className="h-1 overflow-hidden rounded-full bg-fill">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${(value / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Valores arredondados.</p>
        <Button size="lg" className="mt-6 w-full" onClick={onExit}>
          Abrir meu painel
          <ChevronRight data-icon="inline-end" />
        </Button>
      </div>
    </main>
  );
}

/* ───────────────────────── Compartilhar ───────────────────────── */

const shareBase = () => `${window.location.origin}${window.location.pathname}`;

function ShareDialog({ open, onOpenChange, state }: { open: boolean; onOpenChange: (open: boolean) => void; state: AppState }) {
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);
  const reportUrl = useMemo(() => (open ? `${shareBase()}#r=${encodeShare(state)}` : ""), [open, state]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setSessionUrl(null);
    encodeSession(state).then((code) => alive && setSessionUrl(`${shareBase()}#s=${code}`));
    return () => {
      alive = false;
    };
  }, [open, state]);
  const tooLong = sessionUrl != null && sessionUrl.length > DISCORD_LIMIT;

  const [copied, flashCopied] = useFlash(900);
  async function copy(url: string, what: string) {
    if (await copyText(url)) {
      flashCopied(what);
      // Mostra "Copiado" no botão e fecha o diálogo logo depois, como a folha de compartilhar do iOS
      window.setTimeout(() => onOpenChange(false), 700);
    } else toast.error("Não foi possível copiar o link");
  }

  const option = (props: {
    icon: React.ReactNode;
    title: string;
    text: string;
    meta: React.ReactNode;
    url: string | null;
    what: string;
  }) => (
    <div className="flex items-start gap-3 rounded-2xl bg-fill/60 p-3.5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary [&_svg]:size-5">{props.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] font-semibold">{props.title}</p>
        <p className="mt-0.5 text-[0.8125rem] text-pretty text-muted-foreground">{props.text}</p>
        <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">{props.meta}</p>
      </div>
      <Button size="sm" className="mt-0.5" disabled={!props.url} onClick={() => props.url && copy(props.url, props.what)}>
        {copied === props.what ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
        {copied === props.what ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Compartilhar</DialogTitle>
          <DialogDescription>
            O link leva uma cópia de agora. Nada fica ligado ao seu painel.
          </DialogDescription>
        </DialogHeader>
        {option({
          icon: <FileText />,
          title: "Relatório",
          text: "Só o total de cada membro, para conferir o pagamento.",
          meta: reportUrl ? `${reportUrl.length} caracteres` : "",
          url: reportUrl || null,
          what: "do relatório",
        })}
        {option({
          icon: <LayoutGrid />,
          title: "Sessão completa",
          text: "Painel inteiro: divisão, ritmo, entradas, saídas e pausas. Quem abrir pode consultar ou continuar a sessão no próprio aparelho.",
          meta:
            sessionUrl == null ? (
              "Gerando…"
            ) : tooLong ? (
              <span className="text-warning">
                {sessionUrl.length} caracteres: passa do limite do Discord ({DISCORD_LIMIT}). Envie em outro lugar ou use o backup.
              </span>
            ) : (
              `${sessionUrl.length} caracteres · cabe numa mensagem do Discord`
            ),
          url: sessionUrl,
          what: "da sessão",
        })}
        <p className="text-xs text-pretty text-muted-foreground">Quem tiver o link vê os nomes e os valores.</p>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── Sessão compartilhada (só leitura) ───────────────────────── */

function SessionViewer({
  state,
  sharedAt,
  onExit,
  onContinue,
}: {
  state: AppState;
  sharedAt: number;
  onExit: () => void;
  onContinue: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sortBy] = useState(() => loadPrefs().sortBy);
  // Mostra os valores na moeda de quem enviou
  setCurrency(state.config.currency);
  const totals = useMemo(() => computeTotals(state), [state]);
  const pace = useMemo(() => computePace(state), [state]);
  const clock = useMemo(() => sessionClock(state), [state]);
  const nameById = useMemo(() => new Map(state.members.map((m) => [m.id, m.name])), [state.members]);
  const memberName = useCallback((id: string) => nameById.get(id) || "Membro", [nameById]);
  const active = state.members.filter((m) => !m.removed);
  const present = active.filter((m) => m.present).length;
  const logEvents = useMemo(() => state.events.filter(isLogged), [state.events]);
  const logDesc = useMemo(() => logEvents.slice().reverse(), [logEvents]);
  const earnings = countLaunches(state.events);
  const lastTs = state.events.reduce((t, e) => Math.max(t, e.type === "earning" ? (e.until ?? e.ts) : e.ts), 0) || undefined;
  const tile = "rounded-2xl bg-fill/60 px-3 py-2.5";

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="material-bar sticky top-0 z-30 shrink-0 border-b border-white/[0.08] pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[0.75rem] bg-gradient-to-b from-[#ffb340] to-[#ff8a00] text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]">
            <Wrench className="size-5" />
          </div>
          <div className="min-w-0 flex-1 basis-32">
            <h1 className="truncate text-lg leading-tight font-bold tracking-[-0.02em] sm:text-xl">{state.config.groupName}</h1>
            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              <Eye className="size-3.5 shrink-0" />
              Só leitura · enviado em {date(sharedAt).slice(0, 5)} às {time(sharedAt)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onExit}>
              Meu painel
            </Button>
            <Button size="sm" onClick={onContinue}>
              <Play data-icon="inline-start" className="fill-current" />
              Continuar daqui
            </Button>
          </div>
        </div>
      </header>

      <main className={MAIN_GRID}>
        <Panel
          className="min-h-fit lg:[grid-area:car]"
          icon={<Car />}
          title="Resumo da sessão"
          subtitle={`Total bruto de ${money(totals.gross)}`}
        >
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,6rem),1fr))] gap-2">
            <div className={tile}>
              <dt className="truncate text-xs text-muted-foreground">Início</dt>
              <dd className="mt-0.5 truncate text-base font-semibold tabular-nums">{pace.lastTs != null && state.sessionStart ? time(state.sessionStart) : "—"}</dd>
            </div>
            <div className={tile}>
              <dt className="truncate text-xs text-muted-foreground">Duração</dt>
              <dd className="mt-0.5 truncate text-base font-semibold tabular-nums">
                {state.sessionStart && lastTs ? duration(lastTs - state.sessionStart) : "—"}
              </dd>
            </div>
            <div className={tile}>
              <dt className="truncate text-xs text-muted-foreground">Presentes</dt>
              <dd className="mt-0.5 truncate text-base font-semibold tabular-nums">
                {present}/{active.length}
              </dd>
            </div>
          </dl>
          <PaceStrip pace={pace} clock={clock} autoPauseMin={state.config.autoPauseMin} />
        </Panel>

        <Panel
          className="lg:[grid-area:members]"
          icon={<Users />}
          title="Membros"
          subtitle={active.length ? `${present}/${active.length} presentes no envio` : "Nenhum membro"}
        >
          <ul className="scrollbar-subtle scroll-gutter -mx-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-2 lg:scroll-fade lg:py-1">
            {active.map((m) => {
              const value = totals.members.find((x) => x.id === m.id)?.value || 0;
              return (
                <li key={m.id} className={cn("flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2", m.present && "bg-success/[0.07]")}>
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full text-[0.8125rem] font-semibold",
                      m.present ? "bg-success/20 text-success" : "bg-fill text-muted-foreground",
                    )}
                  >
                    {initials(m.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-[0.9375rem] font-medium", !m.present && "opacity-60")}>{m.name}</span>
                    <span className="block truncate text-xs text-muted-foreground tabular-nums">
                      {m.present ? "Presente" : "Fora"} · {money(value)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel className="lg:[grid-area:result]" icon={<Check />} title="Divisão" subtitle="Quanto cada um recebe">
          <DivisionSummary
            members={totals.members}
            gross={totals.gross}
            fund={totals.fund}
            distributed={totals.distributed}
            fundPercent={state.config.fundPercent}
            earnings={earnings}
            sortBy={sortBy}
          />
        </Panel>

        <Panel
          className="lg:[grid-area:history]"
          icon={<History />}
          title="Histórico"
          subtitle={logEvents.length ? plural(logEvents.length, "registro", "registros") : "Entradas, saídas e pausas"}
          action={
            logEvents.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)} aria-label="Ver tudo e buscar no histórico">
                <Search data-icon="inline-start" />
                {logEvents.length > HISTORY_PREVIEW ? "Ver tudo" : "Buscar"}
              </Button>
            )
          }
        >
          {logEvents.length === 0 ? (
            <EmptyState icon={<History />} title="Ninguém entrou ou saiu" compact>
              A equipe ficou completa a sessão toda.
            </EmptyState>
          ) : (
            <ul className="scrollbar-subtle scroll-gutter-flush -mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain lg:scroll-fade">
              {logDesc.slice(0, HISTORY_PREVIEW).map((e) => (
                <EventRow key={e.id} event={e} memberName={memberName} editing={false} onDelete={() => {}} />
              ))}
            </ul>
          )}
        </Panel>
      </main>

      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        events={logEvents}
        memberName={memberName}
        sessionStart={state.sessionStart}
        editing={false}
        onDelete={() => {}}
      />
    </div>
  );
}

/* ───────────────────────── Configurações ───────────────────────── */

function SettingsDialog({
  open,
  onOpenChange,
  config,
  dispatch,
  hasEvents,
  onNewSession,
  onReset,
  onExport,
  onImport,
  prefs,
  onPrefsChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: Config;
  dispatch: React.Dispatch<Action>;
  hasEvents: boolean;
  onNewSession: () => void;
  onReset: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  prefs: Prefs;
  onPrefsChange: (patch: Partial<Prefs>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [exported, flashExported] = useFlash();
  const [partValue, setPartValue] = useState<number | null>(config.partValue);
  const [fund, setFund] = useState(String(Math.round(config.fundPercent * 1000) / 10));
  const [buttons, setButtons] = useState(config.carButtons.join(", "));
  const [autoPause, setAutoPause] = useState(String(config.autoPauseMin));

  // Ao abrir, sincroniza os rascunhos com a configuração atual
  useEffect(() => {
    if (!open) return;
    setPartValue(config.partValue);
    setFund(String(Math.round(config.fundPercent * 1000) / 10));
    setButtons(config.carButtons.join(", "));
    setAutoPause(String(config.autoPauseMin));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsedButtons = buttons
    .split(/[,;\s]+/)
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v > 0 && v < 100)
    .slice(0, MAX_CAR_BUTTONS);

  function commitButtons() {
    const next = parsedButtons.length ? parsedButtons : config.carButtons;
    setButtons(next.join(", "));
    dispatch({ type: "CONFIG", value: { carButtons: next } });
  }

  const label = "text-[0.8125rem] font-medium text-muted-foreground";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-md"
        initialFocus={(type) => type !== "touch"}
      >
        <DialogHeader>
          <DialogTitle>Configurações</DialogTitle>
          <DialogDescription>
            Mudanças valem para os próximos lançamentos. O histórico não é alterado.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={label}>Nome do grupo</span>
            <Input
              className="h-11"
              value={config.groupName}
              maxLength={40}
              onChange={(e) => dispatch({ type: "CONFIG", value: { groupName: e.target.value } })}
              onBlur={(e) => {
                if (!e.target.value.trim())
                  dispatch({ type: "CONFIG", value: { groupName: "Desmanche" } });
              }}
            />
          </label>

          <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={label}>Valor por carro</span>
              <MoneyInput
                value={partValue}
                onValueChange={(v) => {
                  setPartValue(v);
                  if (v && v > 0) dispatch({ type: "CONFIG", value: { partValue: v } });
                }}
                onBlur={() => {
                  if (!partValue) setPartValue(config.partValue);
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={label}>Caixa</span>
              <div className="relative">
                <Input
                  type="text"
                  inputMode="decimal"
                  className="h-11 pr-8 tabular-nums"
                  value={fund}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d.,]/g, "").slice(0, 5);
                    setFund(raw);
                    const n = Number(raw.replace(",", "."));
                    if (Number.isFinite(n))
                      dispatch({
                        type: "CONFIG",
                        value: { fundPercent: Math.min(100, Math.max(0, n)) / 100 },
                      });
                  }}
                  onBlur={() => setFund(String(Math.round(config.fundPercent * 1000) / 10))}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                  %
                </span>
              </div>
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="auto-pause" className={label}>
              Pausa automática
            </label>
            <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3">
              <div className="relative">
                <Input
                  id="auto-pause"
                  type="text"
                  inputMode="numeric"
                  className="h-11 pr-11 tabular-nums"
                  value={autoPause}
                  aria-describedby="auto-pause-hint"
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, "").slice(0, 3);
                    setAutoPause(raw);
                    if (raw) dispatch({ type: "CONFIG", value: { autoPauseMin: Math.min(240, Number(raw)) } });
                  }}
                  onBlur={() => setAutoPause(String(config.autoPauseMin))}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                  min
                </span>
              </div>
              <p id="auto-pause-hint" className="text-xs text-pretty text-muted-foreground">
                {config.autoPauseMin > 0
                  ? `Sem lançamento por mais de ${config.autoPauseMin} min, o intervalo sai do ritmo. Use 0 para desligar.`
                  : "Desligada: só a pausa manual tira tempo do ritmo."}
              </p>
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className={label}>Botões rápidos (quantidade de carros)</span>
            <Input
              className="h-11"
              value={buttons}
              placeholder="1, 3"
              onChange={(e) => setButtons(e.target.value)}
              onBlur={commitButtons}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitButtons();
              }}
            />
            <span className="flex flex-wrap gap-1.5 pt-0.5">
              {(parsedButtons.length ? parsedButtons : config.carButtons).map((n, i) => (
                <span
                  key={`${n}-${i}`}
                  className="rounded-full bg-fill px-2.5 py-1 text-xs text-muted-foreground tabular-nums"
                >
                  {plural(n, "carro", "carros")} = {money(n * (partValue || config.partValue))}
                </span>
              ))}
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-3 border-t border-separator/60 pt-4">
          <span className={label}>Preferências</span>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Moeda</span>
              <Segmented
                label="Moeda"
                value={config.currency}
                options={[
                  { value: "R$", label: "R$" },
                  { value: "$", label: "$" },
                  { value: "", label: "Nenhuma" },
                ]}
                onChange={(currency) => dispatch({ type: "CONFIG", value: { currency } })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Ordem da divisão</span>
              <Segmented
                label="Ordem da divisão"
                value={prefs.sortBy}
                options={[
                  { value: "value", label: "Maior valor" },
                  { value: "name", label: "Nome" },
                ]}
                onChange={(sortBy) => onPrefsChange({ sortBy })}
              />
            </div>
          </div>
          <ToggleRow
            title="Atalhos de teclado"
            hint={`${config.carButtons.length > 1 ? `1–${config.carButtons.length}` : "1"} lançam carros, P pausa. O Ctrl+Z continua funcionando.`}
            on={prefs.shortcuts}
            onChange={(shortcuts) => onPrefsChange({ shortcuts })}
          />
          <ToggleRow
            title="Vibrar ao lançar e pausar"
            hint="Só em celulares compatíveis."
            on={prefs.haptics}
            onChange={(haptics) => onPrefsChange({ haptics })}
          />
          <p className="text-xs text-pretty text-muted-foreground">
            A moeda vale para a sessão e vai junto nos links. As outras preferências são só deste aparelho.
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t border-separator/60 pt-4">
          <span className={label}>Backup</span>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                onExport();
                flashExported("1");
              }}
            >
              {exported ? <Check data-icon="inline-start" /> : <Download data-icon="inline-start" />}
              {exported ? "Exportado" : "Exportar"}
            </Button>
            <Button variant="outline" size="lg" onClick={() => fileRef.current?.click()}>
              <Upload data-icon="inline-start" />
              Importar
            </Button>
          </div>
          <p className="text-xs text-pretty text-muted-foreground">
            Os dados ficam só neste navegador. Exporte um arquivo para não perder nada ou para continuar em outro aparelho.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onImport(file);
            }}
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-separator/60 pt-4">
          <Button
            variant="outline"
            size="lg"
            className="h-auto min-h-11 justify-between gap-3 py-2.5 whitespace-normal"
            disabled={!hasEvents}
            onClick={onNewSession}
          >
            <span className="flex shrink-0 items-center gap-2">
              <RotateCcw className="size-4" />
              Nova sessão
            </span>
            <span className="text-right text-xs font-normal text-muted-foreground">Zera valores, mantém membros</span>
          </Button>
          <Button variant="destructive" size="lg" className="h-auto min-h-11 justify-between gap-3 py-2.5 whitespace-normal" onClick={onReset}>
            <span className="flex shrink-0 items-center gap-2">
              <Trash2 className="size-4" />
              Apagar tudo
            </span>
            <span className="text-right text-xs font-normal">Membros e histórico</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── App ───────────────────────── */

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, defaultState);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [launched, flashLaunched] = useFlash(1200);
  const [undone, flashUndone] = useFlash(1200);
  const [copied, flashCopied] = useFlash();
  const [nobody, flashNobody] = useFlash(400);
  const [liveRegion, announce] = useAnnouncer();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  // Cada mudança parte do valor mais recente (duas trocas seguidas não se sobrescrevem)
  const updatePrefs = useCallback((patch: Partial<Prefs>) => setPrefs((prev) => ({ ...prev, ...patch })), []);
  useEffect(() => savePrefs(prefs), [prefs]);
  hapticsEnabled = prefs.haptics;
  const [editingMembers, setEditingMembers] = useState(false);
  const [editingHistory, setEditingHistory] = useState(false);
  const [saveWarning, setSaveWarning] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const totals = useMemo(() => computeTotals(state), [state]);
  const pace = useMemo(() => computePace(state), [state.events, state.config.autoPauseMin]);
  const clock = useMemo(() => sessionClock(state), [state.events]);
  const active = state.members.filter((m) => !m.removed);
  const present = active.filter((m) => m.present).length;
  const { carButtons, partValue, fundPercent } = state.config;
  // Antes de qualquer formatação de dinheiro deste render
  setCurrency(state.config.currency);
  const logEvents = useMemo(() => state.events.filter(isLogged), [state.events]);
  const logDesc = useMemo(() => logEvents.slice().reverse(), [logEvents]);
  const earnings = countLaunches(state.events);
  const canUndo = state.events.length > 0 && !isSummary(state.events.at(-1));
  const nameById = useMemo(() => new Map(state.members.map((m) => [m.id, m.name])), [state.members]);
  const memberName = useCallback((id: string) => nameById.get(id) || "Membro", [nameById]);

  useEffect(() => {
    dispatch({ type: "IMPORT", value: sanitize(loadState()) });
    setReady(true);
  }, []);
  // Último conteúdo gravado ou recebido de outra aba: evita gravar de novo o que já está salvo
  const lastSaved = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const json = JSON.stringify(state);
    if (json === lastSaved.current) return;
    lastSaved.current = json;
    setSaveWarning(!saveState(state));
  }, [state, ready]);
  // Com o app aberto em duas abas, cada uma gravaria por cima da outra: quando outra aba salva, esta passa a usar os dados dela
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue || e.newValue === lastSaved.current) return;
      try {
        const next = sanitize(JSON.parse(e.newValue));
        lastSaved.current = JSON.stringify(next);
        dispatch({ type: "IMPORT", value: next });
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  // Linha sob o cabeçalho só aparece quando há conteúdo rolando por baixo dele
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t === document) setScrolled(window.scrollY > 2);
      else if (t instanceof HTMLElement && t.tagName === "MAIN") setScrolled(t.scrollTop > 2);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    // iOS Safari só aplica :active (feedback ao pressionar) se existir algum listener de toque
    const noop = () => {};
    document.addEventListener("touchstart", noop, { passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("touchstart", noop);
    };
  }, []);

  // Sai do modo edição quando a lista esvazia (nada mais para editar)
  useEffect(() => {
    if (!active.length) setEditingMembers(false);
  }, [active.length]);
  useEffect(() => {
    if (!state.events.length) setEditingHistory(false);
  }, [state.events.length]);

  /** source identifica o botão que lançou, para ele mesmo mostrar a confirmação. */
  function add(amountValue: number, label: string, source: string) {
    if (!present) {
      // Só acontece pelo atalho de teclado (os botões ficam desativados): os botões tremem, como senha errada no iPhone
      flashNobody("1");
      haptic([12, 60, 12]);
      announce("Ninguém presente. Marque quem está no desmanche antes de lançar.");
      return;
    }
    dispatch({ type: "EARN", id: uid(), amount: amountValue, label });
    haptic();
    flashLaunched(source);
    const each = (amountValue * (1 - fundPercent)) / present;
    announce(`${money(amountValue)} lançado, ${money(each)} para cada${clock.pausedAt != null ? ". Cronômetro retomado" : ""}.`);
  }
  const addCars = (cars: number, index: number) => add(cars * partValue, money(cars * partValue), `car-${index}`);
  function addTotal() {
    if (amount && amount > 0) {
      add(amount, "Valor total", "total");
      setAmount(null);
    }
  }

  function togglePause() {
    if (pace.lastTs == null) return;
    if (clock.pausedAt != null) {
      dispatch({ type: "RESUME" });
      haptic();
      announce(`Cronômetro retomado. Pausa de ${duration(Date.now() - clock.pausedAt)} fora do ritmo.`);
    } else {
      dispatch({ type: "PAUSE" });
      haptic();
      announce("Cronômetro pausado. O tempo parado não conta no ritmo.");
    }
  }

  function undo() {
    const last = state.events.at(-1);
    if (!last) return;
    if (isSummary(last)) {
      toast("Nada para desfazer", { id: "earn", description: "Os lançamentos que vieram no link não podem ser desfeitos aqui." });
      return;
    }
    const batchSize =
      isPresence(last) && last.batch ? state.events.filter((e) => isPresence(e) && e.batch === last.batch).length : 0;
    dispatch({ type: "UNDO" });
    flashUndone("1");
    announce("Desfeito: " + (isPresence(last)
        ? last.removal
          ? `${memberName(last.memberId)} voltou para a lista`
          : last.first
          ? `Adição de ${memberName(last.memberId)} desfeita`
          : batchSize > 1
          ? `${plural(batchSize, "pessoa voltou", "pessoas voltaram")} a ficar ${last.type === "leave" ? "presentes" : "fora"}`
          : `${memberName(last.memberId)} ${last.type === "leave" ? "voltou a ficar presente" : "voltou a ficar fora"}`
        : last.type === "earning"
          ? `Lançamento de ${money(last.amount)} removido`
          : last.type === "pause"
            ? "Pausa cancelada"
            : "Cronômetro pausado de novo"));
  }

  const isNameTaken = useCallback(
    (candidate: string, exceptId?: string) =>
      state.members.some(
        (m) => !m.removed && m.id !== exceptId && m.name.toLowerCase() === candidate.toLowerCase(),
      ),
    [state.members],
  );

  function addMember(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      nameRef.current?.focus();
      return;
    }
    if (isNameTaken(trimmed)) {
      setNameError(`“${trimmed}” já está na lista.`);
      return;
    }
    dispatch({ type: "ADD_MEMBER", name: trimmed });
    setName("");
    setNameError("");
    nameRef.current?.focus();
  }

  function removeMember(id: string) {
    const m = state.members.find((x) => x.id === id);
    if (!m) return;
    dispatch({ type: "REMOVE", id });
    toast(`${m.name} saiu da lista`, {
      description: "Os valores já recebidos continuam na divisão.",
      action: {
        label: "Desfazer",
        onClick: () => dispatch({ type: "RESTORE_MEMBER", id, present: m.present }),
      },
    });
  }

  function deleteEvent(event: AppEvent) {
    dispatch({ type: "DELETE", id: event.id });
    toast("Registro excluído", {
      description: `${describeEvent(event, memberName).title} às ${time(event.ts)}`,
      action: { label: "Desfazer", onClick: () => dispatch({ type: "INSERT_EVENT", event }) },
    });
  }

  function newSession() {
    const snapshot = { events: state.events, sessionStart: state.sessionStart };
    dispatch({ type: "NEW" });
    setSettingsOpen(false);
    toast("Nova sessão iniciada", {
      description: "Valores zerados. Os membros foram mantidos.",
      action: {
        label: "Desfazer",
        onClick: () => dispatch({ type: "RESTORE_SESSION", ...snapshot }),
      },
    });
  }

  function resetAll() {
    const snapshot = state;
    dispatch({ type: "RESET" });
    setResetOpen(false);
    setSettingsOpen(false);
    toast("Tudo apagado", {
      action: { label: "Desfazer", onClick: () => dispatch({ type: "IMPORT", value: snapshot }) },
    });
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify({ app: "desmanche", exportedAt: new Date().toISOString(), state }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `desmanche-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importBackup(file: File) {
    const next = file.size <= 5_000_000 ? parseBackup(await file.text()) : null;
    if (!next) {
      toast.error("Arquivo inválido", { description: "Escolha um backup exportado pelo Desmanche." });
      return;
    }
    const snapshot = state;
    dispatch({ type: "IMPORT", value: next });
    setSettingsOpen(false);
    toast.success("Backup importado", {
      description: `${plural(next.members.filter((m) => !m.removed).length, "membro", "membros")} · ${plural(next.events.length, "registro", "registros")}`,
      action: { label: "Desfazer", onClick: () => dispatch({ type: "IMPORT", value: snapshot }) },
    });
  }

  async function copyDiscord() {
    const lines = [
      `**${state.config.groupName} — ${date(Date.now())}**`,
      `Total: ${money(totals.gross)}`,
      ...(pace.perHour != null ? [`Ritmo: ${money(pace.perHour)}/h`] : []),
      ...totals.members
        .filter((m) => m.value > 0)
        .map((m) => `• ${m.name}: ${money(m.value)}`),
      ...(totals.fund ? [`Caixa: ${money(totals.fund)}`] : []),
      "_valores arredondados_",
    ];
    const ok = await copyText(lines.join("\n"));
    if (ok) {
      flashCopied("summary");
      announce("Resumo copiado. Cole no canal do Discord.");
    } else toast.error("Não foi possível copiar");
  }


  // Atalhos de teclado: sempre usam o estado mais recente (evita closure velha)
  const stateRef = useRef(state);
  stateRef.current = state;
  const shortcuts = useRef({ addCars, undo, togglePause, blocked: false, enabled: true });
  shortcuts.current = { addCars, undo, togglePause, blocked: settingsOpen || historyOpen || resetOpen || shareOpen, enabled: prefs.shortcuts };
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !shortcuts.current.blocked) {
        setEditingMembers(false);
        setEditingHistory(false);
      }
      if (e.target instanceof Element && e.target.closest("input,textarea,select,[contenteditable=true]")) return;
      if (shortcuts.current.blocked) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        shortcuts.current.undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (!shortcuts.current.enabled) return;
      if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        shortcuts.current.togglePause();
        return;
      }
      const n = Number(e.key);
      const buttons = stateRef.current.config.carButtons;
      if (n > 0 && n <= buttons.length) {
        e.preventDefault();
        shortcuts.current.addCars(buttons[n - 1], n - 1);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  if (!ready) return <main className="min-h-dvh bg-background" />;

  const cols = Math.min(carButtons.length, 3);

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      {/* Barra superior translúcida */}
      <header
        className={cn(
          "material-bar sticky top-0 z-30 shrink-0 border-b pt-[env(safe-area-inset-top)] transition-colors duration-200",
          scrolled ? "border-white/[0.08]" : "border-transparent",
        )}
      >
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[0.75rem] bg-gradient-to-b from-[#ffb340] to-[#ff8a00] text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]">
            <Wrench className="size-5" />
          </div>
          <div className="min-w-0 flex-1 basis-24">
            <h1 className="truncate text-lg leading-tight font-bold tracking-[-0.02em] sm:text-xl">
              {state.config.groupName}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {clock.pausedAt != null ? (
                <span className="text-warning">Pausado desde {time(clock.pausedAt)}</span>
              ) : state.sessionStart ? (
                `Sessão desde ${time(state.sessionStart)}`
              ) : (
                "Sessão não iniciada"
              )}
            </p>
          </div>
          <div className="min-w-0 shrink text-right" aria-live="polite">
            <p key={totals.gross} className="value-pop origin-right truncate text-lg leading-tight font-bold tracking-[-0.02em] tabular-nums sm:text-xl">
              {money(totals.gross)}
            </p>
            <p className="flex items-center justify-end gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", present ? "bg-success" : "bg-muted-foreground/50")} />
              {plural(present, "presente", "presentes")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={() => setSettingsOpen(true)}
            aria-label="Configurações"
          >
            <Settings />
          </Button>
        </div>
      </header>

      <main className={MAIN_GRID}>
        {/* Registrar carro */}
        <Panel
          className="min-h-fit lg:[grid-area:car]"
          icon={<Car />}
          title="Registrar carro"
          subtitle={
            present ? (
              `Divide entre ${plural(present, "pessoa presente", "pessoas presentes")}`
            ) : (
              <span className="text-warning">
                {active.length ? "Ninguém presente" : "Sem membros"}
              </span>
            )
          }
          action={
            !present ? (
              active.length ? (
                <Button size="sm" variant="outline" onClick={() => dispatch({ type: "ALL", value: true })}>
                  Marcar todos
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    nameRef.current?.focus();
                    nameRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
                  }}
                >
                  Adicionar
                </Button>
              )
            ) : (
              carButtons.length > 0 && prefs.shortcuts && (
                <span className="hidden text-xs text-tertiary-foreground lg:inline">
                  Atalhos: {carButtons.length > 1 ? `1–${carButtons.length}` : "1"} · P pausa · Ctrl+Z
                </span>
              )
            )
          }
        >
          <div className="grid gap-3" data-shake={nobody ? "" : undefined} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {carButtons.map((cars, i) => {
              const value = cars * partValue;
              return (
                <button
                  key={`${cars}-${i}`}
                  type="button"
                  disabled={!present}
                  onClick={() => addCars(cars, i)}
                  title={money(value)}
                  className={cn(
                    "press group relative flex min-h-26 min-w-0 cursor-pointer flex-col items-start justify-between gap-3 overflow-hidden rounded-2xl p-3.5 text-left sm:p-4 outline-none select-none touch-manipulation focus-visible:ring-3 focus-visible:ring-ring",
                    "bg-gradient-to-b from-[#ffad33] to-[#ff9500] text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_8px_24px_-10px_rgb(255_149_0/0.6)] hover:brightness-105 active:brightness-95",
                    "disabled:cursor-not-allowed disabled:bg-none disabled:bg-fill disabled:text-muted-foreground disabled:shadow-none",
                  )}
                >
                  <span className="flex w-full items-center justify-between text-[0.8125rem] font-semibold opacity-80">
                    {plural(cars, "carro", "carros")}
                    <kbd className="hidden rounded-md bg-black/15 px-1.5 py-0.5 font-sans text-[0.6875rem] font-semibold lg:inline group-disabled:bg-white/5">
                      {i + 1}
                    </kbd>
                  </span>
                  <span className="flex w-full min-w-0 flex-col">
                    <span className="truncate text-[clamp(1.25rem,5.6vw,1.875rem)] leading-none font-bold tracking-[-0.025em] tabular-nums lg:text-[1.875rem]">
                      {money(value)}
                    </span>
                    {launched === `car-${i}` ? (
                      <span className="mt-1.5 flex items-center gap-1 truncate text-xs font-semibold">
                        <Check className="size-3.5 shrink-0" strokeWidth={3} />
                        Lançado
                      </span>
                    ) : (
                      <span className="mt-1.5 truncate text-xs font-medium tabular-nums opacity-75">
                        {present ? `${money((value * (1 - fundPercent)) / present)} cada` : "Marque presentes"}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addTotal();
            }}
          >
            <MoneyInput
              className="w-full sm:w-auto sm:min-w-[10rem] sm:flex-1"
              value={amount}
              onValueChange={setAmount}
              placeholder="Outro valor"
              aria-label="Lançar outro valor"
            />
            <Button type="submit" size="lg" className="flex-[1_1_7rem] sm:flex-none" disabled={launched !== "total" && (!present || !amount)}>
              {launched === "total" ? <Check data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
              {launched === "total" ? "Lançado" : "Lançar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="flex-[1_1_7rem] sm:flex-none"
              onClick={undo}
              disabled={!canUndo && !undone}
            >
              {undone ? <Check data-icon="inline-start" /> : <Undo2 data-icon="inline-start" />}
              {undone ? "Desfeito" : "Desfazer"}
            </Button>
          </form>

          <PaceStrip
            pace={pace}
            clock={clock}
            autoPauseMin={state.config.autoPauseMin}
            onTogglePause={togglePause}
          />
        </Panel>

        {/* Membros */}
        <Panel
          className="lg:[grid-area:members]"
          icon={<Users />}
          title="Membros"
          subtitle={
            editingMembers
              ? "Renomeie ou remova membros"
              : active.length
                ? `${present}/${active.length} presentes`
                : "Nenhum membro ainda"
          }
          action={
            active.length > 0 && (
              <>
              {!editingMembers && (
              <div className="flex rounded-[0.625rem] bg-fill p-0.5" role="group" aria-label="Presença de todos">
                <button
                  type="button"
                  onClick={() => dispatch({ type: "ALL", value: true })}
                  className={cn(
                    "press hit-44 h-7 cursor-pointer rounded-lg px-2.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    present === active.length ? "bg-[#636366] text-white shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "ALL", value: false })}
                  className={cn(
                    "press hit-44 h-7 cursor-pointer rounded-lg px-2.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    present === 0 ? "bg-[#636366] text-white shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Ninguém
                </button>
              </div>
              )}
              <EditToggle editing={editingMembers} onToggle={() => setEditingMembers((v) => !v)} label="membros" />
              </>
            )
          }
        >
          <form className="flex shrink-0 flex-col gap-1.5" onSubmit={addMember}>
            <div className="flex gap-2">
              <Input
                ref={nameRef}
                className="h-11"
                value={name}
                maxLength={32}
                aria-invalid={!!nameError || undefined}
                aria-describedby={nameError ? "name-error" : undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError("");
                }}
                placeholder="Nome do membro"
                aria-label="Nome do membro"
                enterKeyHint="done"
              />
              <Button type="submit" size="icon-lg" aria-label="Adicionar membro" disabled={!name.trim()}>
                <Plus />
              </Button>
            </div>
            {nameError && (
              <p id="name-error" className="px-1 text-xs text-destructive">
                {nameError}
              </p>
            )}
          </form>

          {active.length === 0 ? (
            <EmptyState icon={<UserPlus />} title="Sem membros" compact>
              Digite o nome de quem participa do desmanche e pressione Enter.
            </EmptyState>
          ) : (
            <ul className="scrollbar-subtle scroll-gutter -mx-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-2 lg:scroll-fade lg:py-1">
              {active.map((m) => {
                if (editingMembers)
                  return (
                    <MemberEditRow
                      key={m.id}
                      member={m}
                      isTaken={isNameTaken}
                      onRename={(name) => dispatch({ type: "RENAME", id: m.id, name })}
                      onRemove={() => removeMember(m.id)}
                    />
                  );
                const value = totals.members.find((x) => x.id === m.id)?.value || 0;
                return (
                  <li key={m.id} className="flex">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={m.present}
                      aria-label={`${m.name}: ${m.present ? "presente" : "fora"}`}
                      onClick={() => dispatch({ type: "PRESENCE", id: m.id })}
                      className={cn(
                        "press flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring",
                        m.present ? "bg-success/[0.07] hover:bg-success/[0.11]" : "hover:bg-white/[0.04]",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-full text-[0.8125rem] font-semibold transition-colors",
                          m.present ? "bg-success/20 text-success" : "bg-fill text-muted-foreground",
                        )}
                      >
                        {initials(m.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-[0.9375rem] font-medium transition-opacity", !m.present && "opacity-60")}>
                          {m.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground tabular-nums">
                          {m.present ? "Presente" : "Fora"} · {money(value)}
                        </span>
                      </span>
                      <PresenceSwitch on={m.present} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Divisão */}
        <Panel
          className="lg:[grid-area:result]"
          icon={<Check />}
          title="Divisão"
          subtitle="Quanto cada um recebe"
          action={
            <>
              <Button variant="outline" size="sm" onClick={copyDiscord} disabled={!totals.gross}>
                {copied === "summary" ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                {copied === "summary" ? "Copiado" : <>Copiar<span className="hidden sm:inline"> resumo</span></>}
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setShareOpen(true)}
                disabled={!state.events.length}
                aria-label="Compartilhar"
                title="Compartilhar relatório ou sessão completa"
              >
                <Share2 />
              </Button>
            </>
          }
        >
          <DivisionSummary
            members={totals.members}
            gross={totals.gross}
            fund={totals.fund}
            distributed={totals.distributed}
            fundPercent={fundPercent}
            earnings={earnings}
            sortBy={prefs.sortBy}
          />
        </Panel>

        {/* Histórico */}
        <Panel
          className="lg:[grid-area:history]"
          icon={<History />}
          title="Histórico"
          subtitle={logEvents.length ? plural(logEvents.length, "registro", "registros") : "Entradas, saídas e pausas"}
          action={
            logEvents.length > 0 && (
              <>
                <EditToggle editing={editingHistory} onToggle={() => setEditingHistory((v) => !v)} label="histórico" />
                <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)} aria-label="Ver tudo e buscar no histórico">
                  <Search data-icon="inline-start" />
                  {logEvents.length > HISTORY_PREVIEW ? "Ver tudo" : "Buscar"}
                </Button>
              </>
            )
          }
        >
          {logEvents.length === 0 ? (
            <EmptyState icon={<History />} title="Nenhum registro" compact>
              Quem entra, quem sai e as pausas aparecem aqui.
            </EmptyState>
          ) : (
            <ul className="scrollbar-subtle scroll-gutter-flush -mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain lg:scroll-fade">
              {logDesc.slice(0, HISTORY_PREVIEW).map((e) => (
                <EventRow key={e.id} event={e} memberName={memberName} editing={editingHistory} onDelete={deleteEvent} />
              ))}
            </ul>
          )}
        </Panel>
      </main>

      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        events={logEvents}
        memberName={memberName}
        sessionStart={state.sessionStart}
        editing={editingHistory}
        onToggleEditing={() => setEditingHistory((v) => !v)}
        onDelete={deleteEvent}
      />

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} state={state} />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        config={state.config}
        dispatch={dispatch}
        hasEvents={state.events.length > 0}
        onNewSession={newSession}
        onReset={() => setResetOpen(true)}
        onExport={exportBackup}
        onImport={importBackup}
        prefs={prefs}
        onPrefsChange={updatePrefs}
      />

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar todos os dados?</AlertDialogTitle>
            <AlertDialogDescription>
              Membros, histórico e configurações serão removidos deste navegador.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={resetAll}>
              Apagar tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {liveRegion}

      {saveWarning && (
        <p
          role="status"
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2 rounded-full bg-warning/15 px-4 py-2 text-xs font-medium text-warning ring-1 ring-warning/30 backdrop-blur-xl"
        >
          Os dados não estão sendo salvos neste navegador
        </p>
      )}
    </div>
  );
}

type View =
  | { kind: "loading" }
  | { kind: "app" }
  | { kind: "report"; data: SharedPayload }
  | { kind: "session"; state: AppState; sharedAt: number };

export default function Page() {
  const [view, setView] = useState<View>({ kind: "loading" });
  useEffect(() => {
    const probe = document.createElement("div");
    probe.className = "scrollbar-subtle";
    probe.style.cssText = "position:absolute;top:-9999px;width:100px;height:100px;overflow-y:scroll";
    document.body.appendChild(probe);
    document.documentElement.style.setProperty("--sb", `${probe.offsetWidth - probe.clientWidth}px`);
    probe.remove();
  }, []);
  const [appKey, setAppKey] = useState(0);
  const [confirm, setConfirm] = useState<{ state: AppState; current: { members: number; events: number } } | null>(null);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      const hash = window.location.hash;
      if (hash.startsWith("#s=")) {
        const decoded = await decodeSession(hash.slice(3));
        if (!alive) return;
        if (decoded) {
          setView({ kind: "session", state: sanitize(decoded.state), sharedAt: decoded.sharedAt });
          return;
        }
        // Link cortado (ex.: colado pela metade) ou corrompido
        history.replaceState(null, "", window.location.pathname);
        toast.error("Link de sessão inválido", { description: "Ele pode ter sido cortado ao colar. Peça para enviarem de novo." });
        setView({ kind: "app" });
        return;
      }
      const match = hash.match(/^#r=(.+)$/);
      const data = match ? decodeShare(match[1]) : null;
      const valid =
        data && Array.isArray(data.m) && typeof data.g === "string" &&
        data.m.every((x: unknown) => Array.isArray(x) && typeof x[0] === "string" && Number.isFinite(x[1]));
      setView(
        valid
          ? { kind: "report", data: { ...data, total: Number(data.total) || 0, caixa: Number(data.caixa) || 0, d: Number(data.d) || Date.now() } }
          : { kind: "app" },
      );
    };
    read();
    window.addEventListener("hashchange", read);
    return () => {
      alive = false;
      window.removeEventListener("hashchange", read);
    };
  }, []);

  const exitToApp = () => {
    history.replaceState(null, "", window.location.pathname);
    setView({ kind: "app" });
  };

  /** "Continuar daqui": a sessão recebida vira os dados deste navegador, sem ligação com quem enviou. */
  function adopt(next: AppState) {
    const previous = loadState();
    saveState(next);
    setConfirm(null);
    setAppKey((k) => k + 1);
    exitToApp();
    toast.success("Sessão copiada para este aparelho", {
      description: "Agora é sua: o que você lançar não muda nada para quem enviou.",
      duration: 10_000,
      action: {
        label: "Desfazer",
        onClick: () => {
          saveState(previous);
          setAppKey((k) => k + 1);
        },
      },
    });
  }

  function requestAdopt(next: AppState) {
    const current = sanitize(loadState());
    const members = current.members.filter((m) => !m.removed).length;
    // Só pede confirmação se houver algo a perder neste navegador
    if (members || current.events.length) setConfirm({ state: next, current: { members, events: current.events.length } });
    else adopt(next);
  }

  let content: React.ReactNode;
  if (view.kind === "loading") content = <main className="min-h-dvh bg-background" />;
  else if (view.kind === "report") content = <SharedReport data={view.data} onExit={exitToApp} />;
  else if (view.kind === "session")
    content = <SessionViewer state={view.state} sharedAt={view.sharedAt} onExit={exitToApp} onContinue={() => requestAdopt(view.state)} />;
  else content = <App key={appKey} />;

  return (
    <>
      {content}
      <AlertDialog open={confirm != null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir seus dados?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm
                ? `Este navegador tem ${plural(confirm.current.members, "membro", "membros")} e ${plural(confirm.current.events, "registro", "registros")}. Eles serão trocados pela sessão recebida. Dá para desfazer logo em seguida.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && adopt(confirm.state)}>Substituir e continuar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
