import * as cheerio from "cheerio";

function clean(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sortById(a, b) {
  const na = Number(String(a.id).replace(/^o/, ""));
  const nb = Number(String(b.id).replace(/^o/, ""));
  return na - nb;
}

export default async function handler(req, res) {
  try {
    const url = "https://pzs2pszczyna.pl/www/plan_lekcji/";
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(500).json({ error: "Nie udało się pobrać listy klas" });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const classes = [];
    const seen = new Set();

    $("a[href]").each((_, a) => {
      const href = clean($(a).attr("href"));
      const text = clean($(a).text());

      const match = href.match(/\/plany\/(o\d+)\.html$/i);
      if (!match) return;

      const id = match[1];

      if (seen.has(id)) return;
      seen.add(id);

      classes.push({
        id,
        name: text || id,
      });
    });

    classes.sort(sortById);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json(classes);
  } catch (err) {
    res.status(500).json({
      error: "Błąd pobierania klas",
      details: err.message,
    });
  }
}