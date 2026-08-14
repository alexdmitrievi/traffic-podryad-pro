import { defineConfig } from 'astro/config'

/**
 * Pure SSG, no ISR and no SSR (docs/WEB_SURFACES.md): publication is an outbox event —
 * the backend publishes, the site builds from the published sources, the output uploads
 * to object storage and the CDN invalidates.
 */
export default defineConfig({
  site: 'https://pipupi.ru',
  output: 'static',
  trailingSlash: 'ignore',
})
