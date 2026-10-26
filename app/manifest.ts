import type { MetadataRoute } from 'next'

// Site estático (GitHub Pages): o manifesto é gerado uma vez no build
export const dynamic = 'force-static'

// Caminho do GitHub Pages (/<nome-do-repo>); vazio no localhost
const base = process.env.NEXT_PUBLIC_BASE_PATH || ''

/** Permite "Adicionar à tela de início" no celular e abrir em tela cheia, como um app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Desmanche — Divisão de lucro',
    short_name: 'Desmanche',
    description: 'Divida o lucro dos seus desmanches de FiveM com justiça.',
    lang: 'pt-BR',
    start_url: `${base}/`,
    scope: `${base}/`,
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      { src: `${base}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
