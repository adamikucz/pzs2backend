export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const publicKey = process.env.VAPID_PUBLIC_KEY || '';

  if (!publicKey) {
    return res.status(503).json({
      error: 'Brak VAPID_PUBLIC_KEY w konfiguracji backendu'
    });
  }

  return res.status(200).json({ publicKey });
}
