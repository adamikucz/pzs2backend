import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  try {
    const response = await fetch('https://pzs2pszczyna.pl/');
    const html = await response.text();

    const $ = cheerio.load(html);

    const news = [];

    $('.items-row .item').each((_, el) => {
      const item = $(el);

      const titleEl = item.find('h2.item-title a').first();
      const descEl = item.find('p').first();

      const title = titleEl.text().trim();
      const href = titleEl.attr('href') || '';
      const desc = descEl.text().replace(/\s+/g, ' ').trim();

      if (title && desc) {
        news.push({
          title,
          desc,
          href: href.startsWith('http') ? href : `https://pzs2pszczyna.pl${href}`
        });
      }
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(news.slice(0, 8));
  } catch (err) {
    res.status(500).json({
      error: 'Błąd pobierania aktualności',
      details: err.message
    });
  }
}
