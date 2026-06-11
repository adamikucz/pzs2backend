import { kv } from '@vercel/kv';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function clean(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeClientId(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 96);
}

function safeClassName(value) {
  return clean(value)
    .replace(/[^0-9a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, '')
    .slice(0, 24);
}

function clampNotifyBeforeMinutes(value, fallback = 10) {
  return Math.max(1, Math.min(60, Number(value) || fallback));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const {
      clientId,
      subscription,
      favoriteBuses,
      notifyBeforeMinutes,
      userClass,
      notifySubstitutions
    } = body;

    const id = safeClientId(clientId);

    if (!id) return res.status(400).json({ error: 'Brak clientId' });
    if (!subscription?.endpoint) return res.status(400).json({ error: 'Brak subskrypcji push' });

    const existing = (await kv.get(`push:client:${id}`)) || {};

    const nextFavoriteBuses = hasOwn(body, 'favoriteBuses')
      ? (Array.isArray(favoriteBuses) ? favoriteBuses.slice(0, 80) : [])
      : (Array.isArray(existing.favoriteBuses) ? existing.favoriteBuses : []);

    const nextNotifyBeforeMinutes = hasOwn(body, 'notifyBeforeMinutes')
      ? clampNotifyBeforeMinutes(notifyBeforeMinutes, existing.notifyBeforeMinutes || 10)
      : clampNotifyBeforeMinutes(existing.notifyBeforeMinutes || 10);

    const nextUserClass = hasOwn(body, 'userClass')
      ? safeClassName(userClass)
      : safeClassName(existing.userClass || '');

    const nextNotifySubstitutions = hasOwn(body, 'notifySubstitutions')
      ? notifySubstitutions !== false
      : existing.notifySubstitutions !== false;

    const now = Date.now();

    const payload = {
      ...existing,
      clientId: id,
      subscription,
      favoriteBuses: nextFavoriteBuses,
      notifyBeforeMinutes: nextNotifyBeforeMinutes,
      userClass: nextUserClass,
      notifySubstitutions: nextNotifySubstitutions,
      createdAt: existing.createdAt || now,
      updatedAt: now
    };

    await kv.set(`push:client:${id}`, payload);
    await kv.sadd('push:clients', id);

    return res.status(200).json({
      ok: true,
      stored: true,
      favorites: payload.favoriteBuses.length,
      userClass: payload.userClass,
      notifySubstitutions: payload.notifySubstitutions
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Nie udało się zapisać subskrypcji push. Sprawdź, czy backend ma podłączone Vercel KV.',
      details: err.message
    });
  }
}
