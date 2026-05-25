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
    t === "cieszynie" ||
    t.includes("powered by phoca download") ||
    t.includes("drukuj") ||
    t.includes("plan lekcji optivum") ||
    t.includes("wygenerowano") ||
    t.includes("strona główna") ||
    t.includes("zastępstwa") ||
    t.includes("jesteś tutaj") ||
    t.includes("szukaj...")
  );
}

function stripTeacherPunctuation(line) {
  return clean(line).replace(/[,.]+$/g, "").trim();
}

function extractClasses(line) {
  const matches = [...String(line || "").matchAll(
    /\b([1-5])\s*(LO[a-d]|T[a-ząćęłńóśźż]{1,3}|BS[a-d]?|Bs[a-d]?)\b/gi
  )];

  return [...new Set(matches.map(match => {
    return `${match[1]}${match[2]}`.replace(/\s+/g, "");
  }))];
}

function parseLessons(line) {
  const match = String(line || "").match(/\b(?:lek|le|l)\.?\s*([\d,\-\si]+)/i);
  if (!match) return [];

  const raw = clean(match[1]).replace(/\s+i\s+/gi, ",");
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

    const num = Number(part.match(/\d+/)?.[0]);
    if (!Number.isNaN(num)) result.push(num);
  }

  return [...new Set(result)];
}

function isTeacherHeader(line) {
  const t = stripTeacherPunctuation(line);
  if (!t) return false;
  if (/\b(?:lek|le|l)\.?\b/i.test(t)) return false;
  if (/\b\d{1,2}:\d{2}\b/.test(t)) return false;
  if (/[-–—]/.test(t)) return false;
  if (/^(?:nauczyciele|praktyki|egzamin|projekt|wycieczka|warsztaty|olimpiada)\b/i.test(t)) return false;
  if (t.length > 60) return false;

  return /^(?:[IVXLCDM]+\s+)?[A-ZĄĆĘŁŃÓŚŹŻ]\.\s*[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}.'-]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}.'-]+)?$/u.test(t);
}

function looksLikeSubstitutionLine(line) {
  const t = clean(line);
  if (!t) return false;
  if (/^(?:nauczyciele|praktyki|projekt|wycieczka|warsztaty|olimpiada)\b/i.test(t)) return false;

  const hasClass = extractClasses(t).length > 0;
  const hasLesson = /\b(?:lek|le|l)\.?\s*\d/i.test(t);
  const hasKnownMarker = /\b(?:zwolnion|odwołan|biblioteka|łączenie|zastęp|przenies)/i.test(t);

  return (hasClass && (hasLesson || hasKnownMarker)) || /^\s*(?:lek|le|l)\.?\s*\d/i.test(t);
}

function isTeacherHeaderAt(lines, index) {
  if (!isTeacherHeader(lines[index])) return false;

  for (let i = index + 1; i < lines.length; i++) {
    const next = clean(lines[i]);
    if (!next) continue;
    if (isTeacherHeader(next)) return false;
    return looksLikeSubstitutionLine(next);
  }

  return false;
}

function detectType(line) {
  const t = clean(line).toLowerCase();
  if (t.includes("zwolnion") || t.includes("odwołan")) return "cancelled";
  if (t.includes("przen.")) return "moved";
  if (t.includes("zastęp") || t.includes("zastep")) return "substitution";
  return "info";
}

function stripMarkers(line) {
  return clean(
    line
      .replace(/\b(?:lek|le|l)\.?\s*[\d,\-\si]+/gi, " ")
      .replace(/\bzwolnion[aey]\b/gi, " ")
      .replace(/\bodwołan[aey]?\b/gi, " ")
      .replace(/\bprzen\.\b/gi, " ")
      .replace(/\bzastępstw[oey]?\b/gi, " ")
      .replace(/\bna\s+\d{1,2}-\d{2}\s+l\.\s*\d+/gi, " ")
      .replace(/\s+/g, " ")
  );
}

function extractTeacherNames(text) {
  const source = clean(text)
    .replace(/\blek\.?\s*[\d,\-\si]+\s*-\s*/gi, " ")
    .replace(/\bl\.\s*\d+/gi, " ");

  const matches = [...source.matchAll(/\b[A-ZĄĆĘŁŃÓŚŹŻ]\.\s*[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}.'-]+(?:\s*[–-]\s*[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}.'-]+)?/gu)];

  return [...new Set(matches.map(match => clean(match[0])))] ;
}

function extractAbsentTeachersFromLines(lines) {
  const chunks = [];
  let collecting = false;

  for (const line of lines) {
    const t = clean(line);
    if (!t) continue;

    if (/^nauczyciele\s+nieobecni\s*:/i.test(t)) {
      collecting = true;
      chunks.push(t.replace(/^nauczyciele\s+nieobecni\s*:/i, ""));
      continue;
    }

    if (!collecting) continue;

    if (/^(?:praktyki|nauczyciele\s+zaangażowani|[•]|projekt|wycieczka|warsztaty|olimpiada)\b/i.test(t)) {
      break;
    }

    chunks.push(t);
  }

  return extractTeacherNames(chunks.join(" "));
}

function createEntry(line, currentTeacherGroup = null) {
  const classes = extractClasses(line);
  const lessons = parseLessons(line);
  const type = detectType(line);
  const summary = stripMarkers(line);

  if (!summary) return null;

  return {
    teacher: currentTeacherGroup ? currentTeacherGroup.teacher : null,
    classes,
    className: classes[0] || null,
    lessons,
    type,
    summary,
    raw: line,
  };
}

function parseItems(text) {
  const lines = String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(clean)
    .filter(Boolean)
    .filter(line => !isNoiseLine(line));

  const general = [];
  const teachers = [];
  const seenGeneral = new Set();
  const absentTeachers = extractAbsentTeachersFromLines(lines);
  let currentTeacherGroup = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isTeacherHeaderAt(lines, i)) {
      currentTeacherGroup = {
        teacher: stripTeacherPunctuation(line),
        entries: [],
        _seen: new Set(),
      };
      teachers.push(currentTeacherGroup);
      continue;
    }

    const entry = createEntry(line, currentTeacherGroup);
    if (!entry) continue;

    if (currentTeacherGroup && !looksLikeSubstitutionLine(line)) {
      const key = ["", entry.classes.join(","), entry.lessons.join(","), entry.type, entry.summary].join("|");
      if (!seenGeneral.has(key)) {
        seenGeneral.add(key);
        general.push({ ...entry, teacher: null });
      }
      continue;
    }

    const key = [
      entry.teacher || "",
      entry.classes.join(","),
      entry.lessons.join(","),
      entry.type,
      entry.summary,
    ].join("|");

    if (currentTeacherGroup) {
      if (currentTeacherGroup._seen.has(key)) continue;
      currentTeacherGroup._seen.add(key);
      currentTeacherGroup.entries.push(entry);
    } else {
      if (seenGeneral.has(key)) continue;
      seenGeneral.add(key);
      general.push(entry);
    }
  }

  return {
    general,
    teachers: teachers
      .filter(group => group.entries.length)
      .map(({ _seen, ...group }) => group),
    absentTeachers,
  };
}

export default async function handler(req, res) {
  try {
    const pageRes = await fetch(SOURCE_PAGE, {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

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

    const pdfRes = await fetch(pdfUrl, {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/pdf,*/*",
      },
    });

    if (!pdfRes.ok) {
      return res.status(502).json({ error: "Nie udało się pobrać PDF" });
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    const parsed = await pdfParse(pdfBuffer);

    const data = parseItems(parsed.text);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

    const dateLabel =
      (parsed.text.match(
        /(?:Poniedziałek|Wtorek|Środa|Czwartek|Piątek|Sobota|Niedziela)\s+\d{1,2}\s+[A-Za-ząćęłńóśźż]+\s+\d{4}r?/i
      ) || [])[0] || null;

    res.status(200).json({
      source: pdfUrl,
      dateLabel,
      general: data.general,
      teachers: data.teachers,
      absentTeachers: data.absentTeachers,
      rawText: parsed.text,
    });
  } catch (err) {
    res.status(500).json({
      error: "Błąd zastępstw",
      details: err.message,
    });
  }
}
