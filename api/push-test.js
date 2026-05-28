import webpush from 'web-push';
import { kv } from '@vercel/kv';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

function buildPayload(body = {}) {
  return JSON.stringify({
    title: body.title || 'Rolbuda · test',
    body: body.body || 'Powiadomienia działają poprawnie.',
    icon: '/assets/icon-192.png',
    badge: '/assets/favicon.png',
    tag: `rolbuda-test-${Date.now()}`,
    url: body.url || '/#zastepstwa'
  });
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    configureWebPush();

    const body = req.body || {};
    const payload = buildPayload(body);

    if (body.subscription?.endpoint) {
      await webpush.sendNotification(body.subscription, payload);
      return res.status(200).json({ ok: true, sent: 1, mode: 'direct' });
    }

    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || body.token;
    if (process.env.ADMIN_PUSH_TOKEN && token !== process.env.ADMIN_PUSH_TOKEN) {
      return res.status(401).json({ error: 'Brak uprawnień do wysyłki globalnego testu' });
    }

    const ids = await kv.smembers('push:clients');
    let sent = 0;
    let failed = 0;

    for (const id of ids || []) {
      const record = await kv.get(`push:client:${id}`);
      if (!record?.subscription?.endpoint) continue;

      try {
        await webpush.sendNotification(record.subscription, payload);
        sent += 1;
      } catch (err) {
        failed += 1;
        if (err.statusCode === 404 || err.statusCode === 410) {
          await kv.del(`push:client:${id}`);
          await kv.srem('push:clients', id);
        }
      }
    }

    return res.status(200).json({ ok: true, sent, failed, mode: 'stored' });
  } catch (err) {
    return res.status(500).json({ error: 'Nie udało się wysłać testowego push', details: err.message });
  }
}
