import * as cheerio from "cheerio";
import pdfParse from "pdf-parse";

const SOURCE_PAGE = "https://pzs2pszczyna.pl/uczen/zastepstwa";
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

const CLASS_RE = /\b([1-5])\s*(LO[a-d]?|T[a-ząćęłńóśźż]{1,3}|BS[a-d]?)\b/giu;

function normalizeClassCode(grade, type) {
  const raw = String(type || "").replace(/\s+/g, "");
  const lower = raw.toLowerCase();

  if (lower.startsWith("lo")) return `${grade}LO${lower.slice(2)}`;
  if (lower.startsWith("bs")) return `${grade}BS${lower.slice(2)}`;
  if (lower.startsWith("t")) return `${grade}T${lower.slice(1)}`;

  return `${grade}${raw}`;
}

function extractClasses(line) {
  const matches = [...String(line || "").matchAll(CLASS_RE)];

  return [...new Set(matches.map(match => {
    return normalizeClassCode(match[1], match[2]);
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
  // Nazwiska dwuczłonowe typu "Cichocka-Krawczyk" są poprawnymi nagłówkami.
  // Blokujemy tylko myślnik jako separator opisowy, np. "Szkolenie - W. Filipek".
  if (/\s[-–—]\s/.test(t)) return false;
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

function splitTeacherList(text) {
  return String(text || "")
    .split(",")
    .map(part => stripTeacherPunctuation(part))
    .filter(Boolean)
    .filter(part => /^[A-ZĄĆĘŁŃÓŚŹŻ]\.\s*[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}.'-]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}.'-]+)?$/u.test(part));
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

    if (/^(?:[•●◦▪▫‣⁃\-–—\uF0B7]\s*|praktyki|nauczyciele\s+zaangażowani|wyłączone|szkolenie|zajęcia|egzaminy|projekt|wycieczka|warsztaty|olimpiada)\b/i.test(t)) {
      break;
    }

    if (isTeacherHeader(t) || looksLikeSubstitutionLine(t)) {
      break;
    }

    chunks.push(t);
  }

  const declared = splitTeacherList(chunks.join(" "));

  return [...new Set(declared.length ? declared : extractTeacherNames(chunks.join(" ")))];
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

function findSubstitutionPdfUrl($) {
  const substitutionRe = /\bzast(?:ę|e)pstw\w*/i;
  const dateRe = /\b(\d{1,2})(?:\s+|[-_])(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|wrzesnia|października|pazdziernika|listopada|grudnia)(?:\s+|[-_])(\d{4})r?\b/i;
  const months = {
    stycznia: 0,
    lutego: 1,
    marca: 2,
    kwietnia: 3,
    maja: 4,
    czerwca: 5,
    lipca: 6,
    sierpnia: 7,
    września: 8,
    wrzesnia: 8,
    października: 9,
    pazdziernika: 9,
    listopada: 10,
    grudnia: 11,
  };
  const candidates = new Map();

  const extractDate = text => {
    const match = String(text || "").match(dateRe);
    if (!match) return null;

    const year = Number(match[3]);
    const month = months[match[2].toLowerCase()];
    const day = Number(match[1]);
    const date = new Date(year, month, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month ||
      date.getDate() !== day
    ) return null;

    return date.getTime();
  };

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    const lowerHref = href.toLowerCase();
    const isDirectPdf = /\.pdf(?:[?#]|$)/i.test(lowerHref);
    const isDownload = /(?:[?&])download=/i.test(href) || lowerHref.includes("download=");
    if (!isDirectPdf && !isDownload) return;

    const linkText = clean($(element).text());
    const title = clean($(element).attr("title"));
    const ariaLabel = clean($(element).attr("aria-label"));
    const linkDate = extractDate(linkText) || extractDate(href);
    let score = 0;
    let hasSubstitutionContext = false;

    if (substitutionRe.test(linkText)) {
      score += 150;
      hasSubstitutionContext = true;
    }
    if (substitutionRe.test(title)) {
      score += 120;
      hasSubstitutionContext = true;
    }
    if (substitutionRe.test(ariaLabel)) {
      score += 120;
      hasSubstitutionContext = true;
    }
    if (/\bzast(?:ę|e)pstw/i.test(lowerHref)) {
      score += 100;
      hasSubstitutionContext = true;
    }
    if (linkDate) score += 60;
    if (/^pobierz$/i.test(linkText)) score += 5;
    if (isDirectPdf) score += 10;
    if (isDownload) score += 25;

    let parent = $(element).parent();
    for (let level = 0; level < 8 && parent && parent.length; level++) {
      const context = clean(parent.text());
      if (context && context.length <= 2000 && substitutionRe.test(context)) {
        score += [65, 55, 45, 35, 30, 25, 20, 15][level];
        hasSubstitutionContext = true;
      }

      const classAndId = clean(`${parent.attr("class") || ""} ${parent.attr("id") || ""}`);
      if (substitutionRe.test(classAndId)) {
        score += [40, 35, 30, 25, 20, 15, 10, 5][level];
        hasSubstitutionContext = true;
      }

      const heading = parent.find("h1, h2, h3, h4, h5, h6").first();
      if (heading.length && substitutionRe.test(clean(heading.text()))) {
        score += 80;
        hasSubstitutionContext = true;
      }

      parent = parent.parent();
    }

    const hrefLooksUnrelated = /(?:statut|regulamin|plan[-_ ]?lekcji|podr[ęe]cznik|harmonogram|rekrutac|egzamin)/i.test(lowerHref);
    if (hrefLooksUnrelated) score -= 100;

    if (!hasSubstitutionContext) return;

    const key = new URL(href, ORIGIN).toString();
    const existing = candidates.get(key);
    if (!existing || score > existing.score) {
      candidates.set(key, { href, score, date: linkDate });
    }
  });

  const ranked = [...candidates.entries()]
    .map(([url, candidate]) => ({ url, ...candidate }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.date && b.date && a.date !== b.date) return b.date - a.date;
      return 0;
    });

  if (!ranked.length || ranked[0].score < 95) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score && ranked[0].date === ranked[1].date) return null;

  return new URL(ranked[0].url, ORIGIN).toString();
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

    const pdfUrl = findSubstitutionPdfUrl($);
    if (!pdfUrl) {
      return res.status(404).json({ error: "Nie znaleziono aktualnego PDF zastępstw" });
    }

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
