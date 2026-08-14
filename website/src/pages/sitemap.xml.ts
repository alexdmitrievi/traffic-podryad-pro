import { listPublishedArticles } from '../lib/published'

export async function GET() {
  const articles = await listPublishedArticles()
  const urls = [
    'https://pipupi.ru/',
    'https://pipupi.ru/services/seo-content',
    'https://pipupi.ru/services/b2b-outreach',
    'https://pipupi.ru/services/telegram-marketing',
    'https://pipupi.ru/services/complex-package',
    'https://pipupi.ru/privacy',
    'https://pipupi.ru/articles',
    ...articles.map((article) => `https://pipupi.ru/articles/${article.slug}`),
  ]

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${url}</loc>
  </url>`,
  )
  .join('\n')}
</urlset>
`

  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  })
}
