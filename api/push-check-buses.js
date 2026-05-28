import webpush from 'web-push';
import { kv } from '@vercel/kv';

const STOPS = [
  {
    id: 'szymanowskiego-1',
    label: 'Przystanek 1',
    url: 'https://pszczyna.kiedyprzyjedzie.pl/api/departures/12369:30908'
  },
  {
    id: 'szymanowskiego-2',
    label: 'Przystanek 2',
    url: 'https://pszczyna.kiedyprzyjedzie.pl/api/departures/12369:32430'
  }
];

function clean(text) {
  return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
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

function getFavoriteKey(stopId, row) {
  const line = clean(row.line_name);
  const directionId = String(row.direction_id || 'direction');
  return `${stopId}|${line}|${directionId}`.toLowerCase();
}

function getWarsawParts(date) {
  const formatter = new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function getTimeZoneOffsetMinutes(date, timeZone = 'Europe/Warsaw') {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return (asUtc - date.getTime()) / 60000;
}

function warsawClockToUtcMs(baseTimestamp, hour, minute) {
  const base = getWarsawParts(new Date(Number(baseTimestamp) * 1000));
  const naiveUtc = Date.UTC(base.year, base.month - 1, base.day, hour, minute, 0);
  let offset = getTimeZoneOffsetMinutes(new Date(naiveUtc));
  let utc = naiveUtc - offset * 60000;
  offset = getTimeZoneOffsetMinutes(new Date(utc));
  utc = naiveUtc - offset * 60000;

  if (utc < Date.now() - 60 * 60 * 1000) {
    const nextDayUtc = naiveUtc + 24 * 60 * 60 * 1000;
    offset = getTimeZoneOffsetMinutes(new Date(nextDayUtc));
    utc = nextDayUtc - offset * 60000;
  }

  return utc;
}

function getDepartureTimeMs(apiTimestamp, row) {
  const relative = clean(row.time).toLowerCase().match(/^(\d+)\s*min/);
  if (relative) return (Number(apiTimestamp) + Number(relative[1]) * 60) * 1000;

  const clockText = clean(row.time).match(/^(\d{1,2}):(\d{2})$/)
    ? clean(row.time)
    : clean(row.static_time);
  const clock = clockText.match(/^(\d{1,2}):(\d{2})$/);

  if (clock && Number(apiTimestamp)) {
    return warsawClockToUtcMs(apiTimestamp, Number(clock[1]), Number(clock[2]));
  }

  return null;
}

async function fetchDepartures() {
  const result = [];

  for (const stop of STOPS) {
    const response = await fetch(stop.url, { headers: { Accept: 'application/json' } });
    if (!response.ok) continue;

    const data = await response.json();
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const directions = data.directions || {};

    for (const row of rows) {
      if (row.canceled) continue;

      const departureMs = getDepartureTimeMs(Number(data.timestamp || 0), row);
      if (!departureMs) continue;

      const directionId = String(row.direction_id || '');
      result.push({
        stopId: stop.id,
        stopLabel: stop.label,
        key: getFavoriteKey(stop.id, row),
        line: clean(row.line_name),
        direction: clean(directions[directionId] || ''),
        time: clean(row.time),
        departureMs
      });
    }
  }

  return result;
}

async function sendBusReminder(record, dep, notifyBeforeMinutes) {
  const departureDate = new Date(dep.departureMs);
  const hhmm = departureDate.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });

  const payload = JSON.stringify({
    title: `Rolbuda · bus ${dep.line}`,
    body: `${dep.stopLabel}: odjazd za około ${notifyBeforeMinutes} min (${hhmm}). ${dep.direction}`,
    icon: '/assets/icon-192.png',
    badge: '/assets/favicon.png',
    tag: `rolbuda-bus-${record.clientId}-${dep.key}-${dep.departureMs}`,
    url: '/#start'
  });

  await webpush.sendNotification(record.subscription, payload);
}

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.token;

  if (process.env.CRON_SECRET && token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    configureWebPush();

    const [ids, departures] = await Promise.all([
      kv.smembers('push:clients'),
      fetchDepartures()
    ]);

    const now = Date.now();
    let sent = 0;
    let failed = 0;
    let checked = 0;

    for (const id of ids || []) {
      const record = await kv.get(`push:client:${id}`);
      if (!record?.subscription?.endpoint) continue;

      checked += 1;
      const favorites = new Set((record.favoriteBuses || []).map(item => String(item.key || '').toLowerCase()));
      if (!favorites.size) continue;

      const notifyBeforeMinutes = Math.max(1, Math.min(60, Number(record.notifyBeforeMinutes) || 10));
      const notifyWindowStart = now;
      const notifyWindowEnd = now + 70 * 1000;

      for (const dep of departures) {
        if (!favorites.has(dep.key)) continue;

        const notifyAt = dep.departureMs - notifyBeforeMinutes * 60 * 1000;
        if (notifyAt < notifyWindowStart || notifyAt > notifyWindowEnd) continue;

        const sentKey = `push:sent:${id}:${dep.key}:${dep.departureMs}`;
        const alreadySent = await kv.get(sentKey);
        if (alreadySent) continue;

        try {
          await sendBusReminder(record, dep, notifyBeforeMinutes);
          await kv.set(sentKey, 1, { ex: 36 * 60 * 60 });
          sent += 1;
        } catch (err) {
          failed += 1;
          if (err.statusCode === 404 || err.statusCode === 410) {
            await kv.del(`push:client:${id}`);
            await kv.srem('push:clients', id);
          }
        }
      }
    }

    return res.status(200).json({ ok: true, checked, departures: departures.length, sent, failed });
  } catch (err) {
    return res.status(500).json({ error: 'Bus reminder cron failed', details: err.message });
  }
}
