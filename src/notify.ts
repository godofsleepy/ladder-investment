import { checkAlerts } from "./alerts.js";
import { today } from "./dates.js";
import { withUser, type Db } from "./db.js";
import { canEmail, sendMail, type Send } from "./mail.js";
import { getPortfolio } from "./portfolio.js";

interface Recipient {
  id: number;
  email: string;
  notify_zone: boolean;
  notify_review: boolean;
  notify_weekly: boolean;
  weekly_sent_on: string | null;
}

const isMonday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 1;

/** Sends what each account asked for on the Account page. Each hit is emailed once. */
export async function sendDueEmails(db: Db, send: Send = sendMail): Promise<{ sent: number; skipped: string | null }> {
  if (send === sendMail && !canEmail()) return { sent: 0, skipped: "SMTP_URL is not set" };
  const { rows: users } = await db.query<Recipient>(
    "select id, email, notify_zone, notify_review, notify_weekly, weekly_sent_on from users where notify_zone or notify_review or notify_weekly",
  );
  const date = today();
  let sent = 0;

  for (const user of users) {
    const { alerts, portfolio } = await withUser(
      user.id,
      async (tx) => ({ alerts: await checkAlerts(tx), portfolio: await getPortfolio(tx) }),
      { readOnly: true },
    );

    if (user.notify_zone) {
      const { rows } = await db.query<{ id: number }>(
        "select id from watchlist where user_id = $1 and status = 'triggered' and alert and notified_at is null",
        [user.id],
      );
      const fresh = new Set(rows.map((r) => r.id));
      const hits = alerts.watchlist_in_zone.filter((w) => fresh.has(w.id));
      if (hits.length > 0) {
        await send({
          to: user.email,
          subject: hits.length === 1 ? `${hits[0]?.symbol} is in your buy zone` : `${hits.length} ideas are in their buy zone`,
          text: hits.map((w) => `${w.symbol}: ${w.price}, zone ${w.zone_low} to ${w.zone_high}. ${w.reason}`).join("\n"),
        });
        await db.query("update watchlist set notified_at = now() where id = any($1)", [hits.map((w) => w.id)]);
        sent += 1;
      }
    }

    if (user.notify_review) {
      const { rows } = await db.query<{ id: number }>(
        "select id from theses where user_id = $1 and status = 'active' and review_notified_on is null",
        [user.id],
      );
      const fresh = new Set(rows.map((r) => r.id));
      const due = alerts.theses_needing_review.filter((t) => fresh.has(t.id));
      if (due.length > 0) {
        await send({
          to: user.email,
          subject: due.length === 1 ? `Review ${due[0]?.symbol}: ${due[0]?.title}` : `${due.length} theses need a review`,
          text: due.map((t) => `${t.symbol}, ${t.title}: ${t.triggers.join(". ")}`).join("\n"),
        });
        await db.query("update theses set review_notified_on = $2 where id = any($1)", [due.map((t) => t.id), date]);
        sent += 1;
      }
    }

    if (user.notify_weekly && isMonday(date) && user.weekly_sent_on !== date) {
      const t = portfolio.totals;
      await send({
        to: user.email,
        subject: "Your Ladder week",
        text: [
          `Portfolio value: Rp ${t.value_idr}`,
          `Open gain: Rp ${t.unrealized_idr}`,
          `Realized: Rp ${t.realized_idr}`,
          `Theses to review: ${alerts.theses_needing_review.length}`,
          `Ideas in their buy zone: ${alerts.watchlist_in_zone.length}`,
        ].join("\n"),
      });
      await db.query("update users set weekly_sent_on = $2 where id = $1", [user.id, date]);
      sent += 1;
    }
  }
  return { sent, skipped: null };
}
