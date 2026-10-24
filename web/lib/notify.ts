// Blocked-bay alert emails to operators, through Resend's REST API (no SDK). Never throws:
// a failed email must not break the plate event that raised the alert.

export const operatorEmails = () =>
  (process.env.OPERATOR_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export async function emailBlockedBay(since: number, bay: { name: string; address: string }): Promise<'sent' | 'skipped' | 'failed'> {
  const key = process.env.RESEND_API_KEY;
  const to = operatorEmails();
  if (!key || !to.length) return 'skipped';
  const at = new Date(since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: process.env.ALERT_FROM ?? 'Baywatch <onboarding@resend.dev>',
        to,
        subject: `Baywatch: ${bay.name} is blocked`,
        // no plate here: email is easy to forward, the plate stays in the operator dashboard
        text: `A car without a booking has been standing in ${bay.name} (${bay.address}) since ${at}. The driver who booked the bay is waiting: their arrival deadline waits, and they got a €5 credit.\n\nOpen the operator dashboard to see the details and resolve the alert.`,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) return 'sent';
    console.error(`Resend answered ${res.status}: ${await res.text()}`);
  } catch (e) {
    console.error('Resend request failed:', e);
  }
  return 'failed';
}
