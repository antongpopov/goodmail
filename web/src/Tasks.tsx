import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.ts';
import type { Task, TaskData, TaskList } from './api.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import { numericDate } from './i18n.ts';
import { DateInput } from './DateInput.tsx';

type Sel = 'myday' | 'important' | 'planned' | 'tasks' | string;
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDaysStr = (s: string, n: number) => {
  const [y, m, d] = s.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
};
const fromYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** "Today", "Tomorrow", "Yesterday" or the date in the user's date format. */
function dueLabel(due: string, today: string) {
  if (due === today) return t('Today');
  if (due === addDaysStr(today, 1)) return t('Tomorrow');
  if (due === addDaysStr(today, -1)) return t('Yesterday');
  return numericDate(fromYmd(due));
}

const REPEATS: Task['repeat'][] = ['', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const repeatName = (r: Task['repeat']) => ({ '': t('Does not repeat'), DAILY: t('Daily'), WEEKLY: t('Weekly'), MONTHLY: t('Monthly'), YEARLY: t('Yearly') })[r];

/** Outlook-style To-Do: My Day, Important, Planned, Tasks and your own lists. */
export function Tasks({ flash, isPhone, onFlagged }: { flash: (m: string) => void; isPhone: boolean; onFlagged: () => void }) {
  const [data, setData] = useState<TaskData>({ lists: [], tasks: [] });
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState<Sel>('myday');
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [showDone, setShowDone] = useState(false);
  const today = ymd(new Date());

  const reload = useCallback(() => api.tasks().then((d) => { setData(d); setLoaded(true); }).catch((e) => flash((e as Error).message)), [flash]);
  useEffect(() => { void reload(); }, [reload]);

  const upsert = (...ts: Task[]) =>
    setData((d) => {
      const tasks = d.tasks.slice();
      for (const x of ts) {
        const i = tasks.findIndex((y) => y.id === x.id);
        if (i >= 0) tasks[i] = x;
        else tasks.push(x);
      }
      return { ...d, tasks };
    });

  /** Optimistic save: show the change at once, reconcile with the server's answer (a repeating task adds its next occurrence). */
  const save = async (task: Task) => {
    upsert(task);
    try {
      const r = await api.saveTask(task, today);
      upsert(r.task, ...(r.next ? [r.next] : []));
      if (r.next) flash(t('Next: {x}').replace('{x}', dueLabel(r.next.due, today)));
    } catch (e) {
      flash((e as Error).message);
      void reload();
    }
  };
  const remove = async (id: string) => {
    setOpen(null);
    setData((d) => ({ ...d, tasks: d.tasks.filter((x) => x.id !== id) }));
    try { await api.deleteTasks([id]); } catch (e) { flash((e as Error).message); void reload(); }
  };

  const isCustom = data.lists.some((l) => l.id === sel);
  const inView = useCallback((x: Task) => {
    if (sel === 'myday') return x.myDay === today;
    if (sel === 'important') return x.important;
    if (sel === 'planned') return !!x.due;
    if (sel === 'tasks') return x.list === 'tasks';
    return x.list === sel;
  }, [sel, today]);

  const count = (s: Sel) => data.tasks.filter((x) => !x.done && (s === 'myday' ? x.myDay === today : s === 'important' ? x.important : s === 'planned' ? !!x.due : x.list === s)).length;

  const todo = useMemo(() => {
    const a = data.tasks.filter((x) => inView(x) && !x.done);
    if (sel === 'planned') return a.sort((x, y) => x.due.localeCompare(y.due) || x.created - y.created);
    return a.sort((x, y) => x.created - y.created);
  }, [data.tasks, inView, sel]);
  const done = useMemo(() => data.tasks.filter((x) => inView(x) && x.done).sort((x, y) => y.doneAt - x.doneAt), [data.tasks, inView]);

  const add = () => {
    const title = text.trim();
    if (!title) return;
    setText('');
    void save({
      id: crypto.randomUUID(), title, notes: '', list: isCustom ? sel : 'tasks', due: sel === 'planned' ? today : '',
      important: sel === 'important', myDay: sel === 'myday' ? today : '', done: false, doneAt: 0, repeat: '', steps: [], created: Date.now(), updated: Date.now(),
    });
  };

  const newList = async () => {
    const name = (prompt(t('List name')) || '').trim();
    if (!name) return;
    try {
      const l = await api.saveTaskList({ name });
      setData((d) => ({ ...d, lists: [...d.lists, l] }));
      setSel(l.id);
    } catch (e) { flash((e as Error).message); }
  };
  const list = data.lists.find((l) => l.id === sel);
  const renameList = async () => {
    if (!list) return;
    const name = (prompt(t('List name'), list.name) || '').trim();
    if (!name || name === list.name) return;
    try {
      const l = await api.saveTaskList({ id: list.id, name });
      setData((d) => ({ ...d, lists: d.lists.map((x) => (x.id === l.id ? l : x)) }));
    } catch (e) { flash((e as Error).message); }
  };
  const deleteList = async () => {
    if (!list || !confirm(t('Delete this list and all its tasks?'))) return;
    try {
      setData(await api.deleteTaskList(list.id));
      setSel('tasks');
      setOpen(null);
    } catch (e) { flash((e as Error).message); }
  };

  const title: Record<string, string> = { myday: t('My Day'), important: t('Important'), planned: t('Planned'), tasks: t('Tasks') };
  const icon: Record<string, string> = { myday: 'sun', important: 'star', planned: 'calendar', tasks: 'home' };
  const sides: [Sel, string][] = [['myday', 'sun'], ['important', 'star'], ['planned', 'calendar']];
  const openTask = data.tasks.find((x) => x.id === open) || null;

  const row = (x: Task) => (
    <div key={x.id} className={`task ${x.done ? 'done' : ''} ${open === x.id ? 'open' : ''}`}>
      <button className="task-check" aria-label={t('Mark read')} onClick={() => void save({ ...x, done: !x.done, doneAt: x.done ? 0 : Date.now() })}>
        <Icon name={x.done ? 'checkCircle' : 'circle'} size={20} />
      </button>
      <button className="task-body" onClick={() => setOpen(open === x.id ? null : x.id)}>
        <span className="task-title">{x.title}</span>
        <span className="task-meta small muted">
          {sel !== 'myday' && x.myDay === today && <span><Icon name="sun" size={12} /> {t('My Day')}</span>}
          {(sel === 'important' || sel === 'planned' || sel === 'myday') && x.list !== 'tasks' && <span>{data.lists.find((l) => l.id === x.list)?.name}</span>}
          {x.steps.length > 0 && <span>{x.steps.filter((s) => s.done).length}/{x.steps.length}</span>}
          {x.due && <span className={!x.done && x.due < today ? 'overdue' : ''}><Icon name="calendar" size={12} /> {dueLabel(x.due, today)}{!x.done && x.due < today ? ` · ${t('Overdue')}` : ''}</span>}
          {x.repeat && <Icon name="repeat" size={12} />}
          {x.notes && <Icon name="drafts" size={12} />}
        </span>
      </button>
      <button className={`task-star ${x.important ? 'on' : ''}`} title={t('Important')} aria-pressed={x.important} onClick={() => void save({ ...x, important: !x.important })}>
        <Icon name="star" size={18} filled={x.important} />
      </button>
    </div>
  );

  return (
    <div className={`tasks ${open ? 'detail-open' : ''}`}>
      <aside className="tasks-side">
        {sides.map(([id, ic]) => (
          <button key={id} className={`folder ${sel === id ? 'active' : ''}`} onClick={() => { setSel(id); setOpen(null); }}>
            <span className="twisty" /><Icon name={ic} size={18} /> <span className="fname">{title[id]}</span>
            {count(id) > 0 && <span className="count">{count(id)}</span>}
          </button>
        ))}
        <button className="folder" onClick={onFlagged}>
          <span className="twisty" /><Icon name="flag" size={18} /> <span className="fname">{t('Flagged email')}</span>
        </button>
        <button className={`folder ${sel === 'tasks' ? 'active' : ''}`} onClick={() => { setSel('tasks'); setOpen(null); }}>
          <span className="twisty" /><Icon name="home" size={18} /> <span className="fname">{t('Tasks')}</span>
          {count('tasks') > 0 && <span className="count">{count('tasks')}</span>}
        </button>
        <div className="tasks-sep" />
        {data.lists.map((l) => (
          <button key={l.id} className={`folder ${sel === l.id ? 'active' : ''}`} onClick={() => { setSel(l.id); setOpen(null); }}>
            <span className="twisty" /><Icon name="list" size={18} /> <span className="fname">{l.name}</span>
            {count(l.id) > 0 && <span className="count">{count(l.id)}</span>}
          </button>
        ))}
        <button className="folder add" onClick={() => void newList()}>
          <span className="twisty" /><Icon name="plus" size={16} /> <span className="fname">{t('New list')}</span>
        </button>
      </aside>

      <section className="tasks-main">
        <div className="tasks-head">
          {isPhone && (
            <select className="tasks-pick" value={sel} onChange={(e) => { setSel(e.target.value); setOpen(null); }} aria-label={t('Tasks')}>
              {['myday', 'important', 'planned', 'tasks'].map((id) => <option key={id} value={id}>{title[id]}</option>)}
              {data.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <h2 className="tasks-title"><Icon name={list ? 'list' : icon[sel]} size={22} /> {list ? list.name : title[sel]}</h2>
          {sel === 'myday' && <span className="muted tasks-date">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>}
          <span className="grow" />
          {list && (
            <>
              <button className="tb" onClick={() => void renameList()}>{t('Rename list')}</button>
              <button className="tb" onClick={() => void deleteList()}>{t('Delete list')}</button>
            </>
          )}
        </div>
        <form className="task-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Icon name="plus" size={20} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Add a task')} aria-label={t('Add a task')} maxLength={500} />
          <button className="pill-btn" disabled={!text.trim()}>{t('Add')}</button>
        </form>
        <div className="task-list">
          {loaded && todo.length === 0 && done.length === 0 && <div className="empty muted">{t('Nothing here. Enjoy your day.')}</div>}
          {todo.map(row)}
          {done.length > 0 && (
            <>
              <button className="task-done-toggle" onClick={() => setShowDone(!showDone)}>
                <Icon name={showDone ? 'chevronDown' : 'chevronRight'} size={14} /> {t('Completed')} <span className="muted">{done.length}</span>
              </button>
              {showDone && done.map(row)}
            </>
          )}
        </div>
      </section>

      {openTask && (
        <TaskDetail key={openTask.id} task={openTask} lists={data.lists} today={today} onSave={(x) => void save(x)} onDelete={() => void remove(openTask.id)} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function TaskDetail({ task, lists, today, onSave, onDelete, onClose }: { task: Task; lists: TaskList[]; today: string; onSave: (t: Task) => void; onDelete: () => void; onClose: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [step, setStep] = useState('');
  const set = (patch: Partial<Task>) => onSave({ ...task, ...patch });
  const commitText = () => {
    const ti = title.trim();
    if (!ti) { setTitle(task.title); return; }
    if (ti !== task.title || notes !== task.notes) set({ title: ti, notes });
  };
  const addStep = () => {
    const s = step.trim();
    if (!s) return;
    setStep('');
    set({ steps: [...task.steps, { id: crypto.randomUUID(), text: s, done: false }] });
  };
  return (
    <aside className="task-detail">
      <div className="task-detail-bar">
        <button className="tb icon" onClick={onClose} title={t('Back')}><Icon name="close" /></button>
      </div>
      <div className="task-detail-body">
        <div className="task-d-title">
          <button className="task-check" onClick={() => set({ done: !task.done, doneAt: task.done ? 0 : Date.now() })}><Icon name={task.done ? 'checkCircle' : 'circle'} size={22} /></button>
          <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={commitText} maxLength={500} aria-label={t('Tasks')} />
          <button className={`task-star ${task.important ? 'on' : ''}`} title={t('Important')} onClick={() => set({ important: !task.important })}><Icon name="star" size={20} filled={task.important} /></button>
        </div>
        {task.steps.map((s) => (
          <div key={s.id} className="task-step">
            <button className="task-check" onClick={() => set({ steps: task.steps.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })}><Icon name={s.done ? 'checkCircle' : 'circle'} size={18} /></button>
            <span className={s.done ? 'strike' : ''}>{s.text}</span>
            <button className="tb icon" onClick={() => set({ steps: task.steps.filter((x) => x.id !== s.id) })} title={t('Delete')}><Icon name="close" size={14} /></button>
          </div>
        ))}
        <form className="task-step add" onSubmit={(e) => { e.preventDefault(); addStep(); }}>
          <Icon name="plus" size={18} />
          <input value={step} onChange={(e) => setStep(e.target.value)} placeholder={t('Add step')} aria-label={t('Add step')} maxLength={500} />
        </form>
        <div className="task-opt">
          <button className={`tb ${task.myDay === today ? 'on' : ''}`} onClick={() => set({ myDay: task.myDay === today ? '' : today })}>
            <Icon name="sun" size={18} /> {task.myDay === today ? t('Remove from My Day') : t('Add to My Day')}
          </button>
        </div>
        <div className="task-opt">
          <Icon name="calendar" size={18} />
          <span className="task-opt-label">{t('Due date')}</span>
          <DateInput value={task.due} onChange={(v) => set({ due: v })} />
          {task.due && <button className="tb icon" onClick={() => set({ due: '', repeat: '' })} title={t('Delete')}><Icon name="close" size={14} /></button>}
        </div>
        <div className="task-opt">
          <Icon name="repeat" size={18} />
          <span className="task-opt-label">{t('Repeat')}</span>
          <select value={task.repeat} onChange={(e) => set({ repeat: e.target.value as Task['repeat'], ...(e.target.value && !task.due ? { due: today } : {}) })}>
            {REPEATS.map((r) => <option key={r} value={r}>{repeatName(r)}</option>)}
          </select>
        </div>
        {lists.length > 0 && (
          <div className="task-opt">
            <Icon name="list" size={18} />
            <span className="task-opt-label">{t('Lists')}</span>
            <select value={task.list} onChange={(e) => set({ list: e.target.value })}>
              <option value="tasks">{t('Tasks')}</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}
        <textarea className="task-notes" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={commitText} placeholder={t('Notes')} aria-label={t('Notes')} rows={5} maxLength={20000} />
      </div>
      <div className="task-detail-foot">
        <span className="muted small">{new Date(task.created).toLocaleDateString()}</span>
        <button className="tb" onClick={onDelete}><Icon name="trash" size={16} /> {t('Delete task')}</button>
      </div>
    </aside>
  );
}
