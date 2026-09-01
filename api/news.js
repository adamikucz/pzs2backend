import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  try {
    const response = await fetch('https://pzs2pszczyna.pl/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RolbudaBot/1.0)'
      }
    });

    if (!response.ok) {
      throw new Error(`PZS2 HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const news = [];

    $('h2 a').each((_, el) => {
      const link = $(el);

      const title = link.text().replace(/\s+/g, ' ').trim();
      const href = link.attr('href') || '';

      if (!title || !href) return;

      // Pomijamy elementy, które nie są aktualnościami
      if (
        title === 'Plan lekcji' ||
        title === 'SCWEW Pszczyna' ||
        title === 'Pobierz' ||
        title.toLowerCase().includes('sale')
      ) {
        return;
      }

      const article = link.closest('article, .item, .blog-item, .item-page');

      let desc = '';

      if (article.length) {
        desc = article
          .find('p')
          .first()
          .text()
          .replace(/\s+/g, ' ')
          .trim();
      }

      // Jeśli nie znaleziono opisu wewnątrz kontenera,
      // szukamy pierwszego paragrafu po nagłówku.
      if (!desc) {
        let next = link.closest('h2').next();

        for (let i = 0; i < 5 && next.length; i++) {
          if (next.is('p') || next.find('p').length) {
            desc = (next.is('p') ? next : next.find('p').first())
              .text()
              .replace(/\s+/g, ' ')
              .trim();
            break;
          }

          next = next.next();
        }
      }

      const fullUrl = href.startsWith('http')
        ? href
        : new URL(href, 'https://pzs2pszczyna.pl/').href;

      // Nie dodawaj duplikatów
      if (
        !news.some(item => item.href === fullUrl) &&
        title.length > 3
      ) {
        news.push({
          title,
          desc,
          href: fullUrl
        });
      }
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

    res.status(200).json(news.slice(0, 5));

  } catch (err) {
    console.error('NEWS ERROR:', err);

    res.status(500).json({
      error: 'Błąd pobierania aktualności',
      details: err.message
    });
  }
}
