import * as cheerio from "cheerio";
import pdfParse from "pdf-parse";

const SOURCE_PAGE = "https://pzs2pszczyna.pl/zastepstwa";
const ORIGIN = "https://pzs2pszczyna.pl";

function clean(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseLine(line) {
  const t = clean(line).toLowerCase();
  return (
    !t ||
    t === "pobierz" ||
    t === "szczegóły" ||
    t.includes("powered by phoca download") ||
    t.includes("drukuj") ||
    t.includes("plan lekcji optivum") ||
    t.includes("wygenerowano") ||
    t.includes("strona główna") ||
    t.includes("zastępstwa") ||
    t.includes("jesteś tutaj")
  );
}

function isTeacherHeader(line) {
  const t = clean(line);
  if (!t) return false;
  if (t.includes("lek.")) return false;
  if (/\b\d{1,2}:\d{2}\b/.test(t)) return false;

  // np. "I Zalasa," albo "II Kowalski,"
  return /^(?:[IVXLCDM]+\s+)?[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}.'-]+,?$/u.test(t);
}

function parseLessons(line) {
  const match = line.match(/(?:lek\.|l\.)\s*([\d,\-\s]+)/i);
  if (!match) return [];

  const raw = clean(match[1]);
  const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
  const result = [];

  for (const part of parts) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let i = start; i <= end; i++) result.push(i);
      continue;
    }

    const num = Number(part);
    if (!Number.isNaN(num)) result.push(num);
  }

  return [...new Set(result)];
}

function extractClasses(line) {
  // klasy typu 1LOa, 3Tga, 1BS, 2Tha itd.
  const matches = [...line.matchAll(/\b\d{1,2}[A-Za-z][A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż./-]*\b/g)];
  return [...new Set(matches.map(m => m[0]))];
}

function detectType(line) {
  const t = clean(line).toLowerCase();
  if (t.includes("zwolnion") || t.includes("odwołan")) return "cancelled";
  if (t.includes("przen.")) return "moved";
  if (t.includes("zastęp") || t.includes("zastep")) return "substitution";
  return "info";
}

function stripLessonMarkers(line) {
  return clean(
    line
      .replace(/(?:lek\.|l\.)\s*[\d,\-\s]+/gi, " ")
      .replace(/\bzwolnion[aey]\b/gi, " ")
      .replace(/\bodwołan[aey]?\b/gi, " ")
      .replace(/\bprzen\.\b/gi, " ")
      .replace(/\bzastępstw[oey]?\b/gi, " ")
      .replace(/\bna\s+\d{1,2}-\d{2}\s+l\.\s*\d+/gi, " ")
      .replace(/\s+/g, " ")
  );
}

function parseItems(text) {
  const lines = String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(clean)
    .filter(Boolean)
    .filter(line => !isNoiseLine(line));

  const items = [];
  let currentTeacher = "";

  for (const line of lines) {
    if (isTeacherHeader(line)) {
      currentTeacher = clean(line).replace(/,+$/, "");
      continue;
    }

    const classes = extractClasses(line);
    const lessons = parseLessons(line);
    const type = detectType(line);
    const summary = stripLessonMarkers(line);

    // Zostawiamy też wpisy bez klasy, bo czasem PDF tak je zapisuje.
    items.push({
      teacher: currentTeacher || null,
      classes,
      className: classes[0] || null,
      lessons,
      type,
      summary,
      raw: line,
    });
  }

  return items;
}

export default async function handler(req, res) {
  try {
    const pageRes = await fetch(SOURCE_PAGE, { cache: "no-store" });
    if (!pageRes.ok) {
      return res.status(502).json({ error: "Nie udało się pobrać strony zastępstw" });
    }

    const pageHtml = await pageRes.text();
    const $ = cheerio.load(pageHtml);

    const href = $('a[href*="download="]').first().attr("href");
    if (!href) {
      return res.status(404).json({ error: "Nie znaleziono linku do PDF" });
    }

    const pdfUrl = new URL(href, ORIGIN).toString();

    const pdfRes = await fetch(pdfUrl, { cache: "no-store" });
    if (!pdfRes.ok) {
      return res.status(502).json({ error: "Nie udało się pobrać PDF" });
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    const parsed = await pdfParse(pdfBuffer);

    const items = parseItems(parsed.text);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");

    res.status(200).json({
      source: pdfUrl,
      items,
      rawText: parsed.text,
    });
  } catch (err) {
    res.status(500).json({
      error: "Błąd zastępstw",
      details: err.message,
    });
  }
}