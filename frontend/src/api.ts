export type Status = 'WANT_TO_READ' | 'CURRENTLY_READING' | 'FINISHED' | 'ABANDONED';
export type Book = {
  id: string; userId: string; title: string; author: string; description: string | null;
  coverImageUrl: string | null; pageCount: number | null; status: Status; progress: number;
  rating: number | null; tags: string[]; startedAt: string | null; finishedAt: string | null;
  createdAt: string; updatedAt: string;
};
export type BookInput = Omit<Book, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;
export type Dashboard = {
  stats: { total: number; reading: number; finished: number; averageProgress: number };
  currentBooks: Book[];
  recentNotes: { id: string; content: string; bookTitle: string; createdAt: string }[];
  weeklyReview: { weekStart: string; summary: string; metrics: { booksFinished: number; pagesLogged: number; readingDays: number; notesSaved: number; goalsCompleted: number; tasksCompleted: number } } | null;
};
export type ReadingData = {
  goals: { id: string; title: string; description: string | null; target: number; currentProgress: number; dueDate: string | null; status: string }[];
  tasks: { id: string; title: string; description: string | null; bookTitle: string | null; dueDate: string | null; status: string }[];
  notes: { id: string; bookTitle: string; content: string; pageNumber: number | null; chapter: string | null }[];
  quotes: { id: string; bookTitle: string; content: string; pageNumber: number | null }[];
  history: { id: string; bookTitle: string; oldStatus: string | null; newStatus: string; oldProgress: number | null; newProgress: number; createdAt: string }[];
  stats: { totalBooks: number; finishedBooks: number; currentBooks: number; notes: number; quotes: number; activeGoals: number; pendingTasks: number };
};

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json();
}
