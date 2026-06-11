import { kv } from '@vercel/kv';
import webpush from 'web-push';
import { createHash } from 'node:crypto';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function clean(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@rolbuda.pl';

  if (!publicKey || !privateKey) {
    throw new Error('Brak VAPID_PUBLIC_KEY lub VAPID_PRIVATE_KEY');
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function hashData(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 24);
}

function getSubstitutionsUrl(req) {
  if (process.env.SUBSTITUTIONS_URL) return process.env.SUBSTITUTIONS_URL;

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'rolbuda.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}/api/substitutions`;
}

async function fetchSubstitutions(req) {
  const url = getSubstitutionsUrl(req);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'RolbudaPushSubstitutions/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Nie udało się pobrać zastępstw: HTTP ${response.status}`);
  }

  const data = await response.json();
  const dateLabel = clean(data.dateLabel);

  if (!dateLabel) {
    throw new Error('API zastępstw nie zwróciło dateLabel');
  }

  return { data, dateLabel, url };
}

const MONTHS_PL = {
  stycznia: 1,
  lutego: 2,
  marca: 3,
  kwietnia: 4,
  maja: 5,
  czerwca: 6,
  lipca: 7,
  sierpnia: 8,
  września: 9,
  wrzesnia: 9,
  października: 10,
  pazdziernika: 10,
  listopada: 11,
  grudnia: 12
};

function removePolishMarks(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/ż/g, 'z');
}

function getWarsawDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  };
}

function parseDateLabel(dateLabel) {
  const text = clean(dateLabel);
  const weekday = clean(text.split(/\s+/)[0]).replace(/[.,:]$/g, '');
  const match = text.match(/(\d{1,2})\s+([a-ząćęłńóśźż]+)\s+(\d{4})/i);

  if (!match) {
    return {
      weekday,
      dateKey: text.toLowerCase(),
      year: null,
      month: null,
      day: null
    };
  }

  const originalMonthName = match[2].toLowerCase();
  const plainMonthName = removePolishMarks(originalMonthName);
  const month = MONTHS_PL[originalMonthName] || MONTHS_PL[plainMonthName] || null;

  return {
    weekday,
    dateKey: `${match[3]}-${String(month || 0).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`,
    year: Number(match[3]),
    month,
    day: Number(match[1])
  };
}

function toDayNumber(year, month, day) {
  if (!year || !month || !day) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function getHumanWhen(parsed) {
  const today = getWarsawDateParts();
  const todayNumber = toDayNumber(today.year, today.month, today.day);
  const targetNumber = toDayNumber(parsed.year, parsed.month, parsed.day);
  const weekday = parsed.weekday ? parsed.weekday.toLowerCase() : '';

  if (todayNumber !== null && targetNumber !== null) {
    if (targetNumber === todayNumber) {
      return weekday ? `dzisiaj (${weekday})` : 'dzisiaj';
    }

    if (targetNumber === todayNumber + 1) {
      return weekday ? `jutro (${weekday})` : 'jutro';
    }
  }

  return weekday || 'nowy dzień';
}

function countEntries(data) {
  const teacherEntries = Array.isArray(data.teachers)
    ? data.teachers.reduce((sum, group) => sum + (Array.isArray(group.entries) ? group.entries.length : 0), 0)
    : 0;

  const generalEntries = Array.isArray(data.general) ? data.general.length : 0;

  return {
    teacherEntries,
    generalEntries,
    totalEntries: teacherEntries + generalEntries
  };
}

function buildNotificationPayload({ dateLabel, humanWhen, fingerprint, counts }) {
  const body = `Zastępstwa na ${humanWhen} się pojawiły. Sprawdź szczegóły w Rolbudzie.`;

  return JSON.stringify({
    title: 'Rolbuda · zastępstwa',
    body,
    icon: '/assets/icon-192.png',
    badge: '/assets/favicon.png',
    tag: `rolbuda-substitutions-${fingerprint}`,
    url: '/#zastepstwa',
    data: {
      type: 'substitutions',
      dateLabel,
      fingerprint,
      counts,
      url: '/#zastepstwa'
    }
  });
}

async function sendNotification(record, payload) {
  await webpush.sendNotification(record.subscription, payload);
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.token;

  if (process.env.CRON_SECRET && token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dryRun = req.query.dry === '1' || req.query.dryRun === '1';
  const force = req.query.force === '1';

  try {
    configureWebPush();

    const { data, dateLabel, url } = await fetchSubstitutions(req);
    const parsed = parseDateLabel(dateLabel);
    const counts = countEntries(data);
    const fingerprint = hashData({
      source: data.source || '',
      dateLabel,
      general: data.general || [],
      teachers: data.teachers || []
    });

    const stateKey = 'push:substitutions:state';
    const state = (await kv.get(stateKey)) || {};
    const previousDateKey = clean(state.dateKey);
    const previousFingerprint = clean(state.fingerprint);

    const firstRun = !previousDateKey;
    const newDate = Boolean(previousDateKey && previousDateKey !== parsed.dateKey);
    const contentChanged = Boolean(previousFingerprint && previousFingerprint !== fingerprint);

    let shouldNotify = force || newDate;

    // Pierwsze uruchomienie tylko ustawia punkt odniesienia, żeby po wdrożeniu nie wysłać starego alertu.
    if (firstRun && !force) {
      shouldNotify = false;
    }

    const ids = (await kv.smembers('push:clients')) || [];
    const payload = buildNotificationPayload({
      dateLabel,
      humanWhen: getHumanWhen(parsed),
      fingerprint,
      counts
    });

    let checked = 0;
    let eligible = 0;
    let sent = 0;
    let failed = 0;
    let removed = 0;

    if (shouldNotify && !dryRun) {
      for (const id of ids) {
        const record = await kv.get(`push:client:${id}`);
        if (!record?.subscription?.endpoint) continue;

        checked += 1;

        if (record.notifySubstitutions === false) continue;
        eligible += 1;

        const sentKey = `push:sent:substitutions:${id}:${parsed.dateKey}:${fingerprint}`;
        const alreadySent = await kv.get(sentKey);
        if (alreadySent) continue;

        try {
          await sendNotification(record, payload);
          await kv.set(sentKey, 1, { ex: 21 * 24 * 60 * 60 });
          sent += 1;
        } catch (err) {
          failed += 1;

          if (err.statusCode === 404 || err.statusCode === 410) {
            await kv.del(`push:client:${id}`);
            await kv.srem('push:clients', id);
            removed += 1;
          }
        }
      }
    } else {
      for (const id of ids) {
        const record = await kv.get(`push:client:${id}`);
        if (!record?.subscription?.endpoint) continue;

        checked += 1;
        if (record.notifySubstitutions !== false) eligible += 1;
      }
    }

    if (!dryRun) {
      await kv.set(stateKey, {
        dateLabel,
        dateKey: parsed.dateKey,
        weekday: parsed.weekday || '',
        fingerprint,
        source: data.source || '',
        substitutionsUrl: url,
        counts,
        updatedAt: Date.now()
      });
    }

    return res.status(200).json({
      ok: true,
      dateLabel,
      dateKey: parsed.dateKey,
      weekday: parsed.weekday || null,
      firstRun,
      newDate,
      contentChanged,
      shouldNotify,
      dryRun,
      force,
      clients: ids.length,
      checked,
      eligible,
      sent,
      failed,
      removed,
      counts
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Substitution push check failed',
      details: err.message
    });
  }
}
