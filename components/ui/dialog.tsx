"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/60 transition-opacity duration-250 ease-out data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[ending-style]:duration-150",
        className
      )}
      {...props}
    />
  )
}

/** Resistência progressiva além do limite (rubber band do iOS). */
function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}
/** Onde o gesto pararia sozinho, pela desaceleração de rolagem do iOS (velocidade em px/s). */
function project(velocity: number, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate)
}

/** O fundo escurecido do mesmo diálogo (o Base UI põe guardas de foco entre ele e a folha). */
function overlayOf(el: HTMLElement) {
  const own = el.parentElement?.querySelector<HTMLElement>(":scope > [data-slot=dialog-overlay]")
  if (own) return own
  const all = document.querySelectorAll<HTMLElement>("[data-slot=dialog-overlay]")
  return all[all.length - 1] ?? null
}

type SheetDrag = {
  pointerId: number
  startY: number
  dy: number
  height: number
  active: boolean
  samples: { t: number; y: number }[]
}

/**
 * No celular o diálogo vira uma folha: arrastar a alça ou o cabeçalho acompanha o dedo 1:1,
 * resiste para cima e, ao soltar, usa a velocidade para decidir entre fechar ou voltar.
 */
function useSheetDrag(closeRef: React.RefObject<HTMLButtonElement | null>) {
  const drag = React.useRef<SheetDrag | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !window.matchMedia("(width < 40rem)").matches) return
    const target = e.target as Element
    if (!target.closest("[data-sheet-handle],[data-slot=dialog-header]")) return
    if (target.closest("button,input,textarea,select,a,[role=radio],[role=switch]")) return
    const el = e.currentTarget
    // Sem seleção de texto: arrastar texto selecionado vira drag nativo e cancela o ponteiro
    e.preventDefault()
    window.getSelection()?.removeAllRanges()
    drag.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      dy: 0,
      height: el.offsetHeight,
      active: false,
      samples: [{ t: e.timeStamp, y: e.clientY }],
    }
    el.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    const raw = e.clientY - d.startY
    const el = e.currentTarget
    const overlay = overlayOf(el)
    if (!d.active) {
      // Pequena histerese para um toque não virar arrasto
      if (Math.abs(raw) < 6) return
      d.active = true
      el.style.transition = "none"
      if (overlay) overlay.style.transition = "none"
    }
    d.dy = raw >= 0 ? raw : -rubberband(-raw, d.height)
    el.style.translate = `0 ${d.dy}px`
    if (overlay) overlay.style.opacity = String(1 - Math.max(0, d.dy) / d.height)
    d.samples.push({ t: e.timeStamp, y: e.clientY })
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift()
  }

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    drag.current = null
    if (!d.active) return
    const el = e.currentTarget
    const overlay = overlayOf(el)
    const first = d.samples[0]
    const last = d.samples[d.samples.length - 1]
    const velocity = last.t > first.t ? ((last.y - first.y) / (last.t - first.t)) * 1000 : 0
    const projected = d.dy + project(velocity)
    const shouldClose = e.type === "pointerup" && d.dy > 0 && (projected > d.height * 0.5 || velocity > 900)

    if (shouldClose) {
      // Continua no mesmo sentido e com o embalo do dedo, sem emenda visível
      const remaining = d.height - d.dy
      const ms = Math.round(Math.min(320, Math.max(160, (remaining / Math.max(velocity, 600)) * 1000)))
      el.style.transition = `translate ${ms}ms cubic-bezier(0.2, 0.7, 0.3, 1)`
      el.style.translate = "0 100%"
      if (overlay) {
        overlay.style.transition = `opacity ${ms}ms ease-out`
        overlay.style.opacity = "0"
      }
      closeRef.current?.click()
      return
    }
    // Volta para o lugar a partir da posição atual (interrompível: outro arrasto parte daqui)
    el.style.transition = "translate 380ms cubic-bezier(0.32, 0.72, 0, 1)"
    el.style.translate = "0 0"
    if (overlay) {
      overlay.style.transition = "opacity 300ms ease-out"
      overlay.style.opacity = ""
    }
    const cleanup = () => {
      if (drag.current) return
      el.style.transition = ""
      el.style.translate = ""
      if (overlay) overlay.style.transition = ""
    }
    el.addEventListener("transitionend", cleanup, { once: true })
    window.setTimeout(cleanup, 420)
  }

  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd }
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const sheet = useSheetDrag(closeRef)
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // Posição, entrada e saída ficam no globals.css (folha no celular, cartão central no desktop)
          "grid w-full grid-cols-[minmax(0,1fr)] max-w-[calc(100%-2rem)] gap-4 rounded-2xl bg-popover p-5 text-sm text-popover-foreground shadow-2xl shadow-black/60 ring-1 ring-white/10 outline-none sm:max-w-sm",
          className
        )}
        {...sheet}
        {...props}
      >
        <div data-sheet-handle aria-hidden className="-mx-5 -mb-2 flex h-5 shrink-0 cursor-grab items-center justify-center active:cursor-grabbing sm:hidden">
          <span className="h-1.5 w-9 rounded-full bg-white/25" />
        </div>
        {children}
        <DialogPrimitive.Close
          ref={closeRef}
          data-slot="dialog-close"
          className={showCloseButton ? undefined : "hidden"}
          render={
            <Button
              variant="ghost"
              className="absolute top-3 right-3 rounded-full"
              size="icon-sm"
            />
          }
        >
          <XIcon
          />
          <span className="sr-only">Fechar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-5 -mb-5 flex flex-col-reverse gap-2 rounded-b-xl border-t border-separator/60 bg-black/15 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Fechar
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-lg leading-tight font-semibold tracking-[-0.01em]",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
