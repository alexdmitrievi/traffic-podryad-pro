/**
 * The local stand-in for the production site: serves the published article files from
 * the backend's publishing directory under /blog/<slug> and the built Astro pages for
 * everything else, proxying /api to the backend.
 *
 * Production serves pipupi.ru from object storage through the CDN; the E2E run only
 * needs the two properties the scenario asserts: the published page is the backend's
 * rendered HTML, and the CTA form reaches the API.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

const port = Number(process.env.SITE_PORT ?? 4321)
const root = path.join(process.cwd(), '..', 'website')
const published = path.join(process.cwd(), '..', 'backend', '.storage', 'public')

const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/')) {
      const target = new URL(request.url)
      target.protocol = 'http:'
      target.host = '127.0.0.1:8080'
      const upstream = new Request(target, {
        method: request.method,
        headers: request.headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
      })
      return fetch(upstream)
    }

    const blog = url.pathname.match(/^\/blog\/([a-z0-9-]+)$/)
    if (blog) {
      try {
        const html = await readFile(path.join(published, `${blog[1]}.html`))
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    }

    const distPath = path.join(root, 'dist', url.pathname === '/' ? 'index.html' : `${url.pathname}/index.html`)
    try {
      const html = await readFile(distPath)
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  },
})

console.log(`[e2e-site] listening on http://127.0.0.1:${server.port}`)
