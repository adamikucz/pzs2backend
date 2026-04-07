import * as cheerio from "cheerio";

function clean(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function directRows($, table) {
  const tbodyRows = $(table).children("tbody").children("tr");
  if (tbodyRows.length) return tbodyRows;
  return $(table).children("tr");
}

function cellToLines($, td) {
  const clone = $(td).clone();
  clone.find("table").remove();

  const html = clone.html() || "";
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ");

  return text
    .split("\n")
    .map(clean)
    .filter(Boolean);
}

function normalizeRow(cells) {
  const fixed = cells.slice(0, 7).map(cell => {
    if (Array.isArray(cell)) return cell.filter(Boolean);
    const txt = clean(cell);
    return txt ? [txt] : [];
  });

  while (fixed.length < 7) fixed.push([]);
  return fixed;
}

function scoreTable($, table) {
  const rows = directRows($, table);
  if (!rows.length) return 0;

  const text = clean(rows.map((_, tr) => $(tr).text()).get().join(" ")).toLowerCase();

  const weekdays = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek"];
  const dayHits = weekdays.reduce((sum, day) => sum + (text.includes(day) ? 1 : 0), 0);
  const timeHits = (text.match(/\b\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\b/g) || []).length;

  let cellCount = 0;
  rows.each((_, tr) => {
    cellCount += $(tr).children("th,td").length;
  });

  return dayHits * 20 + timeHits * 3 + Math.min(rows.length, 20) + Math.min(cellCount / 3, 20);
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

    const tables = $("table").toArray();

    const timetableTable = tables
      .map((table) => ({ el: table, score: scoreTable($, table) }))
      .sort((a, b) => b.score - a.score)[0]?.el;

    if (!timetableTable) {
      return res.status(200).json({
        classId,
        validFrom: null,
        generatedAt: null,
        rows: [],
        error: "Nie znaleziono tabeli planu",
      });
    }

    const rows = [];

    directRows($, timetableTable).each((_, tr) => {
      const cells = $(tr)
        .children("th,td")
        .toArray()
        .map((td) => cellToLines($, td));

      if (!cells.length) return;

      const flat = cells.flat().join(" ").toLowerCase();
      if (flat.includes("drukuj")) return;
      if (flat.includes("wygenerowano")) return;
      if (flat.includes("plan lekcji")) return;
      if (flat.includes("obowiązuje od")) return;

      rows.push(normalizeRow(cells));
    });

    const bodyText = clean($("body").text());

    const validFromMatch = bodyText.match(
      /Obowiązuje od:\s*([^]*?)(?:Drukuj plan|wygenerowano|za pomocą programu|$)/i
    );
    const generatedAtMatch = bodyText.match(/wygenerowano\s*([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{4})/i);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

    res.status(200).json({
      classId,
      validFrom: validFromMatch ? clean(validFromMatch[1]) : null,
      generatedAt: generatedAtMatch ? generatedAtMatch[1] : null,
      rows,
    });
  } catch (err) {
    res.status(500).json({
      error: "Błąd pobierania planu",
      details: err.message,
    });
  }
}
