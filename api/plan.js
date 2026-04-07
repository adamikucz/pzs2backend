import * as cheerio from "cheerio";

function clean(text) {
  return text.replace(/\s+/g, " ").trim();
}

export default async function handler(req, res) {
  try {
    const classId = String(req.query.class || "o1").trim();
    const url = `https://pzs2pszczyna.pl/www/plan_lekcji/plany/${classId}.html`;

    const response = await fetch(url);
    if (!response.ok) {
      return res.status(404).json({ error: "Nie znaleziono planu" });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const rows = [];
    $("table tr").each((_, tr) => {
      const cells = $(tr)
        .find("th, td")
        .map((_, td) => clean($(td).text()))
        .get()
        .filter(Boolean);

      if (cells.length) rows.push(cells);
    });

    const bodyText = clean($("body").text());

    const validFrom =
      (bodyText.match(/Obowiązuje od:\s*([^\n]+)/i) || [])[1] || null;

    const generatedAt =
      (bodyText.match(/wygenerowano\s*([0-9.]+)/i) || [])[1] || null;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

    res.status(200).json({
      classId,
      validFrom,
      generatedAt,
      rows,
    });
  } catch (err) {
    res.status(500).json({
      error: "Błąd pobierania planu",
      details: err.message,
    });
  }
}