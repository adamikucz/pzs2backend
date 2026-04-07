import * as cheerio from "cheerio";

function clean(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cellToLines($, td) {
  const html = $(td).html() || "";
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ");

  return text
    .split("\n")
    .map(clean)
    .filter(Boolean);
}

function rowText($, table) {
  return clean(
    table
      .find("tr")
      .map((_, tr) => clean($(tr).text()))
      .get()
      .join(" ")
  );
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
      .map((table) => ({
        el: table,
        text: rowText($, $(table)),
      }))
      .filter(({ text }) => {
        const t = text.toLowerCase();
        return (
          t.includes("poniedziałek") &&
          t.includes("wtorek") &&
          t.includes("środa") &&
          t.includes("czwartek") &&
          t.includes("piątek")
        );
      })
      .sort((a, b) => rowText($, $(b.el)).length - rowText($, $(a.el)).length)[0]?.el;

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

    $(timetableTable)
      .find("tr")
      .each((_, tr) => {
        const cells = [];

        $(tr)
          .find("th, td")
          .each((_, td) => {
            const lines = cellToLines($, td);
            cells.push(lines);
          });

        const rowFlatText = cells.flat().join(" ").toLowerCase();

        if (!cells.length) return;
        if (rowFlatText.includes("drukuj")) return;
        if (rowFlatText.includes("wygenerowano")) return;
        if (rowFlatText.includes("plan lekcji")) return;
        if (rowFlatText.includes("obowiązuje od")) return;

        rows.push(cells);
      });

    const bodyText = clean($("body").text());

    const validFrom =
      (bodyText.match(/Obowiązuje od:\s*([^\n]+)/i) || [])[1] || null;

    const generatedAt =
      (bodyText.match(/wygenerowano\s*([0-9.\-: ]+)/i) || [])[1] || null;

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
