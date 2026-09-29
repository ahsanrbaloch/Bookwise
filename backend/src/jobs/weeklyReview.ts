import { db } from '../db.js';
import { generateWeeklyReview, previousWeekStart } from '../weeklyReview.js';

export async function runWeeklyReviews() {
  const timeZone = process.env.APP_TIME_ZONE || 'Asia/Karachi';
  const today = new Date().toLocaleDateString('sv-SE', { timeZone });
  const weekStart = previousWeekStart(today);
  const users = await db.query('SELECT id FROM users');
  for (const user of users.rows) {
    try { await generateWeeklyReview(user.id, weekStart, timeZone); }
    catch (error) { console.error('Weekly review failed', { userId: user.id, weekStart, error }); }
  }
  console.info('Weekly reviews refreshed', { weekStart, users: users.rows.length });
}

export function startWeeklyReviews() {
  void runWeeklyReviews().catch(error => console.error('Weekly review job failed', error));
  setInterval(() => void runWeeklyReviews().catch(error => console.error('Weekly review job failed', error)), 24 * 60 * 60 * 1000).unref();
}
