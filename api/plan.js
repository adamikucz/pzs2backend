import * as cheerio from "cheerio";

function clean(text) {
  return text.replace(/\s+/g, " ").trim();
}

function parseCell($, td) {
  // zachowujemy linie!
  return $(td)
    .html()
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map(t => clean(t))
    .filter(Boolean);
}

export default async function handler(req, res) {
  try {
    const classId = String(req.query.class || "o1");
    const url = `https://pzs2pszczyna.pl/www/plan_lekcji/plany/${classId}.html`;

    const response = await fetch(url);
    const html = await response.text();

    const $ = cheerio.load(html);

    const table = $("table").first();

    const rows = [];

    table.find("tr").each((_, tr) => {
      const row = [];

      $(tr).find("td, th").each((_, td) => {
        row.push(parseCell($, td));
      });

      if (row.length) rows.push(row);
    });

    // ❌ usuwamy śmieci (drukuj itp.)
    const cleanRows = rows.filter(row =>
      !row.some(cell =>
        cell.join(" ").toLowerCase().includes("drukuj") ||
        cell.join(" ").toLowerCase().includes("wygenerowano")
      )
    );

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ rows: cleanRows });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
