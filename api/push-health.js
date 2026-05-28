// backend/api/push-health.js

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const env = {
    VAPID_PUBLIC_KEY: Boolean(process.env.VAPID_PUBLIC_KEY),
    VAPID_PRIVATE_KEY: Boolean(process.env.VAPID_PRIVATE_KEY),
    VAPID_SUBJECT: Boolean(process.env.VAPID_SUBJECT),
    CRON_SECRET: Boolean(process.env.CRON_SECRET),
    ADMIN_PUSH_TOKEN: Boolean(process.env.ADMIN_PUSH_TOKEN),
    KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
    KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
    REDIS_URL: Boolean(process.env.REDIS_URL)
  };

  const result = {
    ok: false,
    env,
    imports: {},
    kv: null
  };

  try {
    const kvModule = await import('@vercel/kv');
    result.imports.vercelKv = true;

    const { kv } = kvModule;

    await kv.set('push:health', { ok: true, at: Date.now() }, { ex: 60 });
    const value = await kv.get('push:health');

    result.kv = {
      ok: true,
      value
    };
  } catch (err) {
    result.imports.vercelKv = false;
    result.kv = {
      ok: false,
      error: err?.message || String(err)
    };

    return res.status(500).json(result);
  }

  try {
    await import('web-push');
    result.imports.webPush = true;
  } catch (err) {
    result.imports.webPush = false;
    result.webPushError = err?.message || String(err);

    return res.status(500).json(result);
  }

  result.ok = true;
  return res.status(200).json(result);
}
