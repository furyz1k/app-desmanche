"use client"

import * as React from "react"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/** No celular os avisos descem do topo, como as notificações do iOS; no desktop ficam no canto, fora do conteúdo. */
function useToastPosition(): ToasterProps["position"] {
  const [mobile, setMobile] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia("(width < 40rem)")
    const update = () => setMobile(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])
  return mobile ? "top-center" : "bottom-right"
}

const Toaster = ({ ...props }: ToasterProps) => {
  const position = useToastPosition()

  return (
    <Sonner
      theme="dark"
      containerAriaLabel="Notificações"
      className="toaster group"
      position={position}
      visibleToasts={2}
      duration={5000}
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "1rem",
          "--width": "min(380px, calc(100vw - 32px))",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !shadow-2xl !shadow-black/50",
          actionButton: "!bg-primary !text-primary-foreground !rounded-lg !font-semibold !h-8 !px-3",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
