import * as cheerio from 'cheerio';

const BASE_URL = 'https://pzs2pszczyna.pl';
const NEWS_URL = `${BASE_URL}/aktualnosci`;

export default async function handler(req, res) {
  try {
    const response = await fetch(NEWS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RolbudaBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      // Zapobiega wiszeniu requestu w nieskończoność
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`PZS2 HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const news = [];

    $('li.wp-block-post').each((_, el) => {
      const item = $(el);

      const link = item.find(
        '.wp-block-post-title a[href], h2.wp-block-post-title a[href]'
      ).first();

      if (!link.length) return;

      const title = link
        .text()
        .replace(/\s+/g, ' ')
        .trim();

      const href = link.attr('href') || '';

      if (!title || !href || title.length <= 3) return;

      // Pomijamy ewentualne elementy, które nie są aktualnościami
      const normalizedTitle = title.toLowerCase();

      if (
        title === 'Plan lekcji' ||
        title === 'SCWEW Pszczyna' ||
        title === 'Pobierz' ||
        normalizedTitle.includes('sale')
      ) {
        return;
      }

      const fullUrl = href.startsWith('http')
        ? href
        : new URL(href, BASE_URL).href;

      // Nowa strona posiada gotową zajawkę wpisu
      let desc = item
        .find(
          '.wp-block-post-excerpt__excerpt, .wp-block-post-excerpt p'
        )
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim();

      // Fallback - gdyby WordPress zmienił klasę zajawki
      if (!desc) {
        desc = item
          .find('.wp-block-post-excerpt')
          .first()
          .text()
          .replace(/\s+/g, ' ')
          .trim();
      }

      // Nie dodawaj duplikatów
      if (!news.some(article => article.href === fullUrl)) {
        news.push({
          title,
          desc,
          href: fullUrl
        });
      }
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Cache-Control',
      's-maxage=300, stale-while-revalidate=600'
    );

    return res.status(200).json(news.slice(0, 5));
  } catch (err) {
    console.error('NEWS ERROR:', err);

    return res.status(500).json({
      error: 'Błąd pobierania aktualności',
      details: err instanceof Error ? err.message : String(err)
    });
  }
}
