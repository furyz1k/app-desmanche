import type { Metadata, Viewport } from 'next'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'
export const metadata: Metadata = { title: 'Desmanche — Divisão de lucro', description: 'Divida o lucro dos seus desmanches de FiveM com justiça.', appleWebApp: { capable: true, title: 'Desmanche', statusBarStyle: 'black-translucent' } }
export const viewport: Viewport = { colorScheme: 'dark', themeColor: '#000000', width: 'device-width', initialScale: 1, viewportFit: 'cover' }
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="pt-BR" className="dark" suppressHydrationWarning><body className="antialiased">{children}<Toaster theme="dark" offset={20} mobileOffset={{ top: "calc(env(safe-area-inset-top) + 12px)", left: 12, right: 12 }} /></body></html> }
