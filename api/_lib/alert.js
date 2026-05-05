// api/_lib/alert.js
// Helper alertes ops temps reel via Discord webhook.
//
// Pourquoi Discord webhook plutot que Sentry / Datadog :
//   - Tu as deja un serveur Discord avec un channel #mod-log ou #ops-alerts
//   - Notifications push instantanees sur ton telephone (Discord mobile)
//   - Pas de third-party dependency, pas de quota a gerer
//   - Pas de PII envoyee a un service externe (RGPD-friendly)
//
// Setup user :
//   1. Discord serveur > Edit channel #mod-log > Integrations > Webhooks > New
//   2. Copy webhook URL
//   3. Vercel env var : DISCORD_WEBHOOK_ALERTS = <url>
//
// Pattern d'usage :
//   const { sendAlert } = require('./_lib/alert.js');
//   await sendAlert({
//     severity: 'critical',     // critical | error | warning | info
//     title: 'Stripe webhook crash',
//     details: { error: err.message, event_id: event.id },
//     source: 'stripe-webhook',
//   });
//
// Best-effort : ne throw jamais, log silently. Un crash de l'alerte
// elle-meme ne doit pas amplifier le probleme original.
//
// Rate-limiting : pas de limit en code (Discord webhook accepte 30 req/min,
// largement suffisant). Si on spam, c'est qu'on a un vrai probleme.

const SEVERITY_COLORS = {
  critical: 0xFF0000, // rouge
  error:    0xF87171, // rose
  warning:  0xF5C842, // ambre (gold)
  info:     0xB8FF57, // accent vert FragValue
};

const SEVERITY_EMOJI = {
  critical: '🚨',
  error:    '❌',
  warning:  '⚠️',
  info:     'ℹ️',
};

function isEnabled() {
  return !!process.env.DISCORD_WEBHOOK_ALERTS;
}

async function sendAlert({ severity = 'error', title, details, source }) {
  if (!isEnabled()) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[alert/skipped no webhook] ${severity} ${source} ${title}`);
    }
    return { skipped: true };
  }
  if (!title) return { skipped: true, reason: 'no title' };

  const sev = (severity || 'error').toLowerCase();
  const emoji = SEVERITY_EMOJI[sev] || SEVERITY_EMOJI.error;
  const color = SEVERITY_COLORS[sev] || SEVERITY_COLORS.error;

  // Format details proprement (objet -> JSON pretty)
  let detailsText = '';
  if (details) {
    if (typeof details === 'string') {
      detailsText = details.slice(0, 1500);
    } else {
      try {
        detailsText = '```json\n' + JSON.stringify(details, null, 2).slice(0, 1500) + '\n```';
      } catch (_) {
        detailsText = String(details).slice(0, 1500);
      }
    }
  }

  const fields = [];
  if (source) fields.push({ name: 'Source', value: source, inline: true });
  fields.push({ name: 'Environment', value: process.env.VERCEL_ENV || 'unknown', inline: true });
  fields.push({ name: 'Time', value: new Date().toISOString(), inline: true });

  const payload = {
    username: 'FragValue Ops',
    embeds: [{
      title: `${emoji} ${title}`.slice(0, 256),
      description: detailsText.slice(0, 4000),
      color,
      fields,
      footer: { text: 'fragvalue.com · ops alerts' },
    }],
  };

  try {
    const res = await fetch(process.env.DISCORD_WEBHOOK_ALERTS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[alert] Discord webhook ${res.status}: ${body.slice(0, 200)}`);
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    // Best-effort : log et on continue. Une alerte ratee ne doit pas crasher
    // le caller (qui est deja en train de gerer un probleme).
    console.warn('[alert] send failed:', err?.message);
    return { ok: false, error: err?.message };
  }
}

module.exports = { sendAlert, isEnabled };
