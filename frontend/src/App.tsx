import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Book, type BookInput, type Dashboard, type ReadingData, type Status } from './api';
import Reading from './Reading';

type Page = 'Dashboard' | 'Library' | 'Currently Reading' | 'Goals' | 'Tasks' | 'Notes' | 'Assistant';
type Conversation = { id: string; title: string; updatedAt: string };
type Memory = { id: string; subject: string; content: string; type: string };
const statuses: Record<Status, string> = { WANT_TO_READ: 'Want to read', CURRENTLY_READING: 'Currently reading', FINISHED: 'Finished', ABANDONED: 'Abandoned' };
function formatAssistantText(content: string) {
  const numbers = [...content.matchAll(/(?:^|\s)(\d{1,2})\.\s/g)].map(match => Number(match[1]));
  return numbers.length > 1 && numbers.every((number, index) => number === index + 1)
    ? content.replace(/(?:^|\s)(?=\d{1,2}\.\s)/g, '\n').trim()
    : content;
}
const blank: BookInput = { title: '', author: '', description: null, coverImageUrl: null, pageCount: null, status: 'WANT_TO_READ', progress: 0, rating: null, tags: [], startedAt: null, finishedAt: null };

function BookCover({ book }: { book: Book }) {
  return book.coverImageUrl ? <img className="cover" src={book.coverImageUrl} alt={`Cover of ${book.title}`} /> : <div className="cover cover-fallback"><span>✦</span><strong>{book.title}</strong><small>{book.author}</small></div>;
}

function BookCard({ book, onEdit, onDelete }: { book: Book; onEdit: (book: Book) => void; onDelete: (book: Book) => void }) {
  return <article className="book-card">
    <BookCover book={book} />
    <div className="book-info"><span className="eyebrow">{statuses[book.status]}</span><h3>{book.title}</h3><p>{book.author}</p>
      <div className="progress-row"><span>Progress</span><strong>{book.progress}%</strong></div><div className="progress"><i style={{ width: `${book.progress}%` }} /></div>
      <div className="book-actions"><button onClick={() => onEdit(book)}>Edit book</button><button className="delete" onClick={() => onDelete(book)}>Delete</button></div>
    </div>
  </article>;
}

function BookForm({ initial, onSave, onClose }: { initial: Book | null; onSave: (input: BookInput) => Promise<void>; onClose: () => void }) {
  const [form, setForm] = useState<BookInput>(initial ? { title: initial.title, author: initial.author, description: initial.description, coverImageUrl: initial.coverImageUrl, pageCount: initial.pageCount, status: initial.status, progress: initial.progress, rating: initial.rating, tags: initial.tags, startedAt: initial.startedAt, finishedAt: initial.finishedAt } : blank);
  const [tagsText, setTagsText] = useState(initial?.tags.join(', ') ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof BookInput>(key: K, value: BookInput[K]) => setForm(previous => ({ ...previous, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try { await onSave({ ...form, tags: tagsText.split(',').map(t => t.trim()).filter(Boolean) }); onClose(); } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="form-title" onMouseDown={e => e.stopPropagation()}>
    <div className="modal-top"><div><span className="eyebrow">YOUR LIBRARY</span><h2 id="form-title">{initial ? 'Edit book' : 'Add a book'}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close">×</button></div>
    <form onSubmit={submit}>
      <div className="form-grid"><label>Title <input required maxLength={300} value={form.title} onChange={e => set('title', e.target.value)} autoFocus /></label><label>Author <input required maxLength={300} value={form.author} onChange={e => set('author', e.target.value)} /></label></div>
      <label>Description <textarea rows={3} value={form.description ?? ''} onChange={e => set('description', e.target.value || null)} /></label>
      <label>Cover image URL <input type="url" placeholder="https://..." value={form.coverImageUrl ?? ''} onChange={e => set('coverImageUrl', e.target.value || null)} /></label>
      <div className="form-grid"><label>Status <select value={form.status} onChange={e => set('status', e.target.value as Status)}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Page count <input type="number" min="1" value={form.pageCount ?? ''} onChange={e => set('pageCount', e.target.value ? Number(e.target.value) : null)} /></label></div>
      <div className="form-grid"><label>Progress (%) <input type="number" min="0" max="100" value={form.progress} onChange={e => set('progress', Number(e.target.value))} /></label><label>Rating <select value={form.rating ?? ''} onChange={e => set('rating', e.target.value ? Number(e.target.value) : null)}><option value="">Not rated</option>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n} stars</option>)}</select></label></div>
      <label>Tags <input placeholder="Fiction, favorites, learning" value={tagsText} onChange={e => setTagsText(e.target.value)} /></label>
      <div className="form-grid"><label>Started <input type="date" value={form.startedAt ?? ''} onChange={e => set('startedAt', e.target.value || null)} /></label><label>Finished <input type="date" value={form.finishedAt ?? ''} onChange={e => set('finishedAt', e.target.value || null)} /></label></div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button className="button-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Add to library'}</button></div>
    </form>
  </div></div>;
}

export default function App() {
  const [page, setPage] = useState<Page>('Dashboard');
  const [books, setBooks] = useState<Book[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [reading, setReading] = useState<ReadingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Book | null | 'new'>(null);
  const [search, setSearch] = useState('');
  const [chatInput, setChatInput] = useState('');
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [chatError, setChatError] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(() => localStorage.getItem('bookwise-conversation-id'));
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'system'; content: string; events?: { name: string; success: boolean; summary: string }[]; debugContext?: unknown }[]>([]);
  const refresh = useCallback(async () => {
    try { const [nextBooks, nextDashboard, nextReading, nextMemories] = await Promise.all([api<Book[]>('/books'), api<Dashboard>('/dashboard'), api<ReadingData>('/reading'), api<Memory[]>('/memories')]); setBooks(nextBooks); setDashboard(nextDashboard); setReading(nextReading); setMemories(nextMemories); setError(''); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useLayoutEffect(() => {
    const field = chatInputRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 180)}px`;
  }, [chatInput, page]);
  useEffect(() => {
    void api<Conversation[]>('/conversations').then(setConversations).catch(error => setChatError((error as Error).message));
    if (conversationId) void openConversation(conversationId);
  }, []);
  async function openConversation(id: string) {
    setChatLoading(true); setChatError('');
    try {
      const messages = await api<{ role: 'user' | 'assistant'; content: string }[]>(`/conversations/${id}/messages`);
      setChatMessages(messages.map(item => ({ role: item.role === 'assistant' ? 'system' : 'user', content: item.content })));
      setConversationId(id);
      localStorage.setItem('bookwise-conversation-id', id);
    } catch (error) { setChatError((error as Error).message); }
    finally { setChatLoading(false); }
  }
  async function removeConversation(item: Conversation) {
    if (!window.confirm(`Delete chat “${item.title}”? This will remove its messages.`)) return;
    setDeletingChatId(item.id); setChatError('');
    try {
      await api(`/conversations/${item.id}`, { method: 'DELETE' });
      setConversations(previous => previous.filter(chat => chat.id !== item.id));
      if (conversationId === item.id) {
        localStorage.removeItem('bookwise-conversation-id');
        setConversationId(null);
        setChatMessages([]);
      }
    } catch (error) { setChatError((error as Error).message); }
    finally { setDeletingChatId(null); }
  }
  async function save(input: BookInput) {
    await api(`/books${editing && editing !== 'new' ? `/${editing.id}` : ''}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: JSON.stringify(input) });
    await refresh();
  }
  async function remove(book: Book) {
    if (!window.confirm(`Delete “${book.title}” and its notes and quotes?`)) return;
    try { await api(`/books/${book.id}`, { method: 'DELETE' }); await refresh(); } catch (e) { setError((e as Error).message); }
  }
  async function sendChat(event: FormEvent) {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message || chatBusy || chatLoading || deletingChatId !== null) return;
    setChatInput(''); setChatBusy(true);
    setChatMessages(previous => [...previous, { role: 'user', content: message }]);
    try {
      const result = await api<{ reply: string; conversationId: string; historySaved: boolean; events: { name: string; success: boolean; summary: string }[]; debugContext?: unknown }>('/chat', { method: 'POST', body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }) });
      setConversationId(result.conversationId);
      localStorage.setItem('bookwise-conversation-id', result.conversationId);
      setChatMessages(previous => [...previous, { role: 'system', content: result.historySaved ? result.reply : `${result.reply}\nThis conversation turn could not be saved.`, events: result.events, debugContext: result.debugContext }]);
      void api<Conversation[]>('/conversations').then(setConversations).catch(() => {});
      if (result.events.some(item => item.success && ['addBook', 'updateBook', 'updateReadingProgress', 'saveNote', 'saveQuote', 'createReadingGoal', 'updateReadingGoal', 'createReadingTask', 'createReadingPlan', 'completeReadingTask', 'saveMemory', 'forgetMemory'].includes(item.name))) await refresh();
    } catch (e) {
      setChatMessages(previous => [...previous, { role: 'system', content: (e as Error).message }]);
    } finally { setChatBusy(false); }
  }
  async function completeReadingTask(id: string) {
    try { await api(`/tasks/${id}/complete`, { method: 'POST' }); await refresh(); }
    catch (e) { setError((e as Error).message); }
  }
  async function deleteReadingItem(kind: 'task' | 'note' | 'quote', id: string) {
    if (!window.confirm(`Delete this ${kind}?`)) return;
    try { await api(`/${kind}s/${id}`, { method: 'DELETE' }); await refresh(); }
    catch (e) { setError((e as Error).message); }
  }
  async function forgetSavedMemory(id: string) {
    try { await api(`/memories/${id}`, { method: 'DELETE' }); setMemories(previous => previous.filter(item => item.id !== id)); }
    catch (e) { setChatError((e as Error).message); }
  }
  const shown = books.filter(b => (page !== 'Currently Reading' || b.status === 'CURRENTLY_READING') && `${b.title} ${b.author} ${b.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const date = new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">✦</span><span>bookwise<small>YOUR READING SPACE</small></span></div>
      <div className="nav-heading">WORKSPACE</div><nav>{(['Dashboard', 'Library', 'Currently Reading', 'Goals', 'Tasks', 'Notes', 'Assistant'] as Page[]).map((item, i) => <button key={item} className={page === item ? 'active' : ''} onClick={() => { setPage(item); setSearch(''); }}><span className="nav-icon">{['▦', '▤', '◫', '◎', '☑', '✎', '✧'][i]}</span>{item}{item === 'Currently Reading' && <em>{dashboard?.stats.reading ?? 0}</em>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span>✦</span><strong>A little every day</strong><p>Every page is progress. Keep your reading journey going.</p></div><div className="profile"><div className="avatar">R</div><div><strong>Reader</strong><small>Personal library</small></div><span>⌄</span></div></div>
    </aside>
    <main className="main"><header className="topbar"><div className="breadcrumb">My space <span>/</span> <strong>{page}</strong></div><div className="topbar-right"><span>{date}</span><div className="avatar small">R</div></div></header>
      <div className="content">
        {error && <div className="error-banner" role="alert">Could not load Bookwise: {error} <button onClick={() => void refresh()}>Retry</button></div>}
        {page === 'Dashboard' && <><section className="welcome"><div><span className="eyebrow">YOUR READING JOURNEY</span><h1>Welcome back, Reader<span>.</span></h1><p>Your next great read is waiting. Take a moment to see how far you’ve come.</p><button className="button-dark" onClick={() => setPage('Library')}>Explore your library <span>↗</span></button></div><div className="welcome-art" aria-hidden="true"><div className="art-circle"></div><div className="art-book one"></div><div className="art-book two"></div><div className="art-book three"></div><span className="art-spark">✦</span></div></section>
          <section className="stats-grid"><div className="stat-card"><span className="stat-icon peach">▤</span><span>Total books</span><strong>{dashboard?.stats.total ?? '—'}</strong><small>In your library</small></div><div className="stat-card"><span className="stat-icon sage">◫</span><span>Currently reading</span><strong>{dashboard?.stats.reading ?? '—'}</strong><small>Stories in progress</small></div><div className="stat-card"><span className="stat-icon gold">✧</span><span>Books finished</span><strong>{dashboard?.stats.finished ?? '—'}</strong><small>Journeys completed</small></div><div className="stat-card"><span className="stat-icon lavender">◕</span><span>Average progress</span><strong>{dashboard?.stats.averageProgress ?? '—'}%</strong><small>Across current reads</small></div></section>
          {dashboard?.weeklyReview && <section className="weekly-review"><span className="eyebrow">LAST WEEK IN READING · {dashboard.weeklyReview.weekStart}</span><p>{dashboard.weeklyReview.summary}</p></section>}
          <section className="section"><div className="section-head"><div><span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>Currently reading</h2></div><button className="text-button" onClick={() => setPage('Currently Reading')}>View all <span>→</span></button></div>{dashboard?.currentBooks.length ? <div className="book-grid">{dashboard.currentBooks.map(b => <BookCard key={b.id} book={b} onEdit={setEditing} onDelete={remove} />)}</div> : <div className="empty"><span>◫</span><h3>No books in progress yet</h3><p>Set a book to “Currently reading” to track it here.</p><button className="button-primary" onClick={() => setEditing('new')}>Add a book</button></div>}</section>
          <div className="lower-grid"><section className="panel"><span className="eyebrow">A SPACE TO REFLECT</span><h2>Recent notes</h2>{dashboard?.recentNotes.length ? dashboard.recentNotes.map(n => <div className="note" key={n.id}><p>“{n.content}”</p><small>{n.bookTitle}</small></div>) : <p className="muted">Save a note about a book to see it here.</p>}</section><section className="panel assistant-promo"><span className="eyebrow">YOUR READING COMPANION</span><h2>Ask Bookwise</h2><p>Search your library, save notes, set goals, and plan reading tasks.</p><button className="button-secondary" onClick={() => setPage('Assistant')}>Open assistant →</button></section></div>
          <div className="lower-grid"><section className="panel"><span className="eyebrow">KEEP YOUR PROMISES</span><h2>Active goals <small>{reading?.stats.activeGoals ?? 0}</small></h2>{reading?.goals.filter(goal => goal.status === 'ACTIVE').slice(0, 2).map(goal => <div className="note" key={goal.id}><p>{goal.title}</p><small>{goal.currentProgress} of {goal.target} complete</small></div>)}<button className="text-button" onClick={() => setPage('Goals')}>View goals →</button></section><section className="panel"><span className="eyebrow">NEXT SMALL STEP</span><h2>Pending tasks <small>{reading?.stats.pendingTasks ?? 0}</small></h2>{reading?.tasks.filter(task => task.status === 'PENDING').slice(0, 2).map(task => <div className="note" key={task.id}><p>{task.title}</p><small>{task.dueDate ?? 'No due date'}</small></div>)}<button className="text-button" onClick={() => setPage('Tasks')}>View tasks →</button></section></div>
        </>}
        {(page === 'Library' || page === 'Currently Reading') && <><div className="page-head"><div><span className="eyebrow">YOUR PERSONAL COLLECTION</span><h1>{page === 'Library' ? 'Your library' : 'Currently reading'}<span>.</span></h1><p>{page === 'Library' ? 'Every book has a place here, from someday to finished.' : 'Keep moving through the stories on your nightstand.'}</p></div><button className="button-primary" onClick={() => setEditing('new')}>＋ Add book</button></div><div className="toolbar"><label className="search"><span>⌕</span><input placeholder="Search books, authors, or tags" value={search} onChange={e => setSearch(e.target.value)} /></label><span>{shown.length} {shown.length === 1 ? 'book' : 'books'}</span></div>{loading ? <p>Loading your books…</p> : shown.length ? <div className="book-grid library-grid">{shown.map(b => <BookCard key={b.id} book={b} onEdit={setEditing} onDelete={remove} />)}</div> : <div className="empty"><span>▤</span><h3>{search ? 'No matching books' : 'Your shelf is waiting'}</h3><p>{search ? 'Try a different search.' : 'Add your first book to start your collection.'}</p>{!search && <button className="button-primary" onClick={() => setEditing('new')}>Add a book</button>}</div>}</>}
        {(page === 'Goals' || page === 'Tasks' || page === 'Notes') && <Reading section={page} data={reading} onAssistant={() => setPage('Assistant')} onComplete={completeReadingTask} onDelete={deleteReadingItem} />}
        {page === 'Assistant' && <>
          <div className="page-head"><div><span className="eyebrow">A THOUGHTFUL READING COMPANION</span><h1>Ask Bookwise<span>.</span></h1><p>Ask about your books, notes, goals, and tasks.</p></div><button className="button-secondary" onClick={() => { localStorage.removeItem('bookwise-conversation-id'); setConversationId(null); setChatMessages([]); setChatError(''); }} disabled={chatBusy || chatLoading || deletingChatId !== null}>New chat</button></div>
          <div className="assistant-layout">
            <aside className="chat-history" aria-label="Saved conversations"><span className="eyebrow">RECENT CHATS</span>
              {conversations.length ? conversations.map(item => <div className={`chat-history-row ${item.id === conversationId ? 'active' : ''}`} key={item.id}><button className="chat-history-open" onClick={() => void openConversation(item.id)} disabled={chatBusy || chatLoading || deletingChatId !== null} aria-current={item.id === conversationId ? 'page' : undefined}><strong>{item.title}</strong><small>{new Date(item.updatedAt).toLocaleDateString()}</small></button><button className="chat-history-delete" onClick={() => void removeConversation(item)} disabled={chatBusy || chatLoading || deletingChatId !== null} aria-label={`Delete chat ${item.title}`} title="Delete chat"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v6m4-6v6" /></svg></button></div>) : <p>No saved chats yet.</p>}
              <div className="memory-panel"><span className="eyebrow">REMEMBERED</span>{memories.length ? memories.map(item => <div className="memory-item" key={item.id}><p>{item.content}</p><button onClick={() => void forgetSavedMemory(item.id)} aria-label={`Forget ${item.subject}`}>Forget</button></div>) : <p>No saved memories yet.</p>}</div>
            </aside>
            <div className="chat">{chatError && <p className="error" role="alert">{chatError}</p>}{!chatMessages.length && !chatLoading && <div className="chat-intro"><div className="chat-star">✦</div><h2>Let's talk books.</h2><p>Try “What am I reading?”, “Save a note for Deep Work”, or “Create a task to read tomorrow.”</p></div>}
              <div className="chat-messages" aria-live="polite">{chatMessages.map((m, i) => <div key={i} className={`message ${m.role}`}>{m.events?.map((item, j) => <div key={j} className={`tool-event ${item.success ? '' : 'failed'}`}>{item.name === 'addBook' ? '✦' : '⌕'} {item.summary}</div>)}{m.role === 'system' ? formatAssistantText(m.content) : m.content}{m.debugContext != null && <details className="context-details"><summary>Context used</summary><pre>{JSON.stringify(m.debugContext, null, 2)}</pre></details>}</div>)}{chatLoading && <div className="message system">Loading conversation…</div>}{chatBusy && <div className="message system">Working on your request…</div>}</div>
              <form className="chat-form" onSubmit={sendChat}><textarea ref={chatInputRef} rows={1} maxLength={4000} aria-label="Message Bookwise" placeholder="Ask about your reading…" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} disabled={chatBusy || chatLoading || deletingChatId !== null} /><button aria-label="Send message" disabled={!chatInput.trim() || chatBusy || chatLoading || deletingChatId !== null}>↑</button></form><small className="chat-footnote">Enter to send · Shift+Enter for a new line</small>
            </div>
          </div>
        </>}
      </div>
    </main>
    {editing && <BookForm initial={editing === 'new' ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
  </div>;
}
