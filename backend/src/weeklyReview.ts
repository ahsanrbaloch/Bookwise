import { db } from './db.js';

export function previousWeekStart(today: string) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) - 7);
  return date.toISOString().slice(0, 10);
}

export async function generateWeeklyReview(userId: string, weekStart: string, timeZone = process.env.APP_TIME_ZONE || 'Asia/Karachi') {
  const result = await db.query(`SELECT
    (SELECT count(*)::int FROM books WHERE user_id = $1 AND status = 'FINISHED' AND finished_at >= $2::date AND finished_at < $2::date + 7) AS "booksFinished",
    (SELECT coalesce(round(sum(greatest(e.new_progress - coalesce(e.old_progress, 0), 0) * coalesce(b.page_count, 0) / 100.0)), 0)::int
      FROM reading_events e JOIN books b ON b.id = e.book_id AND b.user_id = e.user_id
      WHERE e.user_id = $1 AND e.created_at >= bounds.from_at AND e.created_at < bounds.to_at) AS "pagesLogged",
    (SELECT count(DISTINCT (e.created_at AT TIME ZONE $3::text)::date)::int FROM reading_events e
      WHERE e.user_id = $1 AND e.new_progress > coalesce(e.old_progress, 0) AND e.created_at >= bounds.from_at AND e.created_at < bounds.to_at) AS "readingDays",
    (SELECT count(*)::int FROM notes WHERE user_id = $1 AND created_at >= bounds.from_at AND created_at < bounds.to_at) AS "notesSaved",
    (SELECT count(*)::int FROM reading_goals WHERE user_id = $1 AND status = 'COMPLETED' AND updated_at >= bounds.from_at AND updated_at < bounds.to_at) AS "goalsCompleted",
    (SELECT count(*)::int FROM reading_tasks WHERE user_id = $1 AND status = 'COMPLETED' AND updated_at >= bounds.from_at AND updated_at < bounds.to_at) AS "tasksCompleted"
    FROM (SELECT ($2::date::timestamp AT TIME ZONE $3::text) AS from_at, (($2::date + 7)::timestamp AT TIME ZONE $3::text) AS to_at) bounds`,
    [userId, weekStart, timeZone]);
  const metrics = result.rows[0];
  const summary = `Last week you finished ${metrics.booksFinished} book${metrics.booksFinished === 1 ? '' : 's'}, logged about ${metrics.pagesLogged} pages on ${metrics.readingDays} day${metrics.readingDays === 1 ? '' : 's'}, saved ${metrics.notesSaved} note${metrics.notesSaved === 1 ? '' : 's'}, and completed ${metrics.tasksCompleted} task${metrics.tasksCompleted === 1 ? '' : 's'} and ${metrics.goalsCompleted} goal${metrics.goalsCompleted === 1 ? '' : 's'}.`;
  const saved = await db.query(`INSERT INTO weekly_reviews (user_id, week_start, metrics, summary) VALUES ($1,$2,$3,$4)
    ON CONFLICT (user_id, week_start) DO UPDATE SET metrics = EXCLUDED.metrics, summary = EXCLUDED.summary, updated_at = now()
    RETURNING id, week_start AS "weekStart", metrics, summary, updated_at AS "updatedAt"`, [userId, weekStart, metrics, summary]);
  return saved.rows[0];
}

export async function getLatestWeeklyReview(userId: string) {
  const result = await db.query(`SELECT id, week_start AS "weekStart", metrics, summary, updated_at AS "updatedAt"
    FROM weekly_reviews WHERE user_id = $1 ORDER BY week_start DESC LIMIT 1`, [userId]);
  return result.rows[0] ?? null;
}
