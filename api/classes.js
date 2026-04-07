import * as cheerio from "cheerio";

function clean(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function handler(req, res) {
  try {
    const baseUrl = "https://pzs2pszczyna.pl/www/plan_lekcji/plany/";
    const candidates = Array.from({ length: 50 }, (_, i) => `o${i + 1}`);

    const results = [];

    for (const id of candidates) {
      try {
        const url = `${baseUrl}${id}.html`;

        const response = await fetch(url);
        if (!response.ok) continue;

        const html = await response.text();
        const $ = cheerio.load(html);

        // 🔥 tu wyciągamy prawdziwą nazwę klasy
        let name = clean($(".tytulnapis").first().text());

        // fallback jeśli coś pójdzie nie tak
        if (!name) {
          name = id.toUpperCase();
        }

        results.push({ id, name });
      } catch (e) {
        // ignorujemy błędy pojedynczych klas
      }
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

    res.status(200).json(results);
  } catch (err) {
    res.status(500).json({
      error: "Błąd wykrywania klas",
      details: err.message,
    });
  }
}
