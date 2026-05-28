import { kv } from '@vercel/kv';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function safeClientId(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 96);
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { clientId, subscription, favoriteBuses = [], notifyBeforeMinutes = 10 } = req.body || {};
    const id = safeClientId(clientId);

    if (!id) return res.status(400).json({ error: 'Brak clientId' });
    if (!subscription?.endpoint) return res.status(400).json({ error: 'Brak subskrypcji push' });

    const payload = {
      clientId: id,
      subscription,
      favoriteBuses: Array.isArray(favoriteBuses) ? favoriteBuses.slice(0, 80) : [],
      notifyBeforeMinutes: Math.max(1, Math.min(60, Number(notifyBeforeMinutes) || 10)),
      updatedAt: Date.now()
    };

    await kv.set(`push:client:${id}`, payload);
    await kv.sadd('push:clients', id);

    return res.status(200).json({ ok: true, stored: true, favorites: payload.favoriteBuses.length });
  } catch (err) {
    return res.status(500).json({
      error: 'Nie udało się zapisać subskrypcji push. Sprawdź, czy backend ma podłączone Vercel KV.',
      details: err.message
    });
  }
}
