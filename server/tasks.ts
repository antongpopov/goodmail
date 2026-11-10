// Per-account To-Do: lists and tasks in <data>/tasks/<sha256(account)>.json (same pattern as the calendar).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA } from './vault.ts';

export interface Step { id: string; text: string; done: boolean }
export interface Task {
  id: string;
  title: string;
  notes: string;
  /** 'tasks' is the built-in default list; anything else is the id of a TaskList. */
  list: string;
  /** "YYYY-MM-DD" or "" */
  due: string;
  important: boolean;
  /** The day (YYYY-MM-DD) it was added to "My Day"; it shows there only on that day. */
  myDay: string;
  done: boolean;
  doneAt: number;
  repeat: '' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  steps: Step[];
  created: number;
  updated: number;
}
export interface TaskList { id: string; name: string }
export interface TaskData { lists: TaskList[]; tasks: Task[] }

const DIR = path.join(DATA, 'tasks');
const fileFor = (account: string) => path.join(DIR, crypto.createHash('sha256').update(account.toLowerCase()).digest('hex') + '.json');

const queues = new Map<string, Promise<unknown>>();
function serial<T>(account: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(account) ?? Promise.resolve()).then(fn, fn);
  queues.set(account, next.catch(() => {}));
  return next;
}

export async function loadTasks(account: string): Promise<TaskData> {
  try {
    const d = JSON.parse(await fs.readFile(fileFor(account), 'utf8'));
    return { lists: d.lists || [], tasks: d.tasks || [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { lists: [], tasks: [] };
    throw err;
  }
}

async function store(account: string, d: TaskData) {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  const file = fileFor(account);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(d), { mode: 0o600 });
  await fs.rename(tmp, file);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number) => String(v ?? '').slice(0, max);
const REPEATS = ['', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;

export function normalizeTask(e: Partial<Task>, lists: TaskList[] = []): Task {
  const title = str(e.title, 500).trim();
  if (!title) throw Object.assign(new Error('A task needs a title'), { status: 400 });
  const list = e.list && e.list !== 'tasks' && lists.some((l) => l.id === e.list) ? String(e.list) : 'tasks';
  const done = !!e.done;
  return {
    id: str(e.id, 64) || crypto.randomUUID(),
    title,
    notes: str(e.notes, 20000),
    list,
    due: DATE_RE.test(String(e.due)) ? String(e.due) : '',
    important: !!e.important,
    myDay: DATE_RE.test(String(e.myDay)) ? String(e.myDay) : '',
    done,
    doneAt: done ? Number(e.doneAt) || Date.now() : 0,
    repeat: (REPEATS as readonly string[]).includes(String(e.repeat)) ? (e.repeat as Task['repeat']) : '',
    steps: (Array.isArray(e.steps) ? e.steps : []).slice(0, 100).map((s) => ({
      id: str(s?.id, 64) || crypto.randomUUID(),
      text: str(s?.text, 500).trim(),
      done: !!s?.done,
    })).filter((s) => s.text),
    created: Number(e.created) || Date.now(),
    updated: Date.now(),
  };
}

/** The next due date of a repeating task, counted from the old due date (or today when it had none). */
export function nextDue(due: string, repeat: Task['repeat'], today: string): string {
  const d = new Date((due || today) + 'T00:00:00Z');
  if (repeat === 'DAILY') d.setUTCDate(d.getUTCDate() + 1);
  else if (repeat === 'WEEKLY') d.setUTCDate(d.getUTCDate() + 7);
  else if (repeat === 'MONTHLY') {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  } else if (repeat === 'YEARLY') {
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    d.setUTCMonth(m);
    const last = new Date(Date.UTC(d.getUTCFullYear(), m + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d.toISOString().slice(0, 10);
}

/** Save a task. Completing a repeating task also adds the next occurrence ("today" is the client's local date). */
export const saveTask = (account: string, input: Partial<Task>, today = new Date().toISOString().slice(0, 10)) =>
  serial(account, async () => {
    const d = await loadTasks(account);
    const t = normalizeTask(input, d.lists);
    const i = d.tasks.findIndex((x) => x.id === t.id);
    const wasDone = i >= 0 && d.tasks[i].done;
    if (i >= 0) {
      t.created = d.tasks[i].created;
      if (wasDone && t.done) t.doneAt = d.tasks[i].doneAt || t.doneAt;
      d.tasks[i] = t;
    } else d.tasks.push(t);
    let next: Task | undefined;
    if (t.done && !wasDone && t.repeat) {
      next = normalizeTask({ ...t, id: undefined, done: false, doneAt: 0, myDay: '', due: nextDue(t.due, t.repeat, today), steps: t.steps.map((s) => ({ ...s, id: crypto.randomUUID(), done: false })), created: undefined }, d.lists);
      d.tasks.push(next);
    }
    await store(account, d);
    return { task: t, next };
  });

export const deleteTasks = (account: string, ids: string[]) =>
  serial(account, async () => {
    const drop = new Set(ids);
    const d = await loadTasks(account);
    d.tasks = d.tasks.filter((t) => !drop.has(t.id));
    await store(account, d);
    return d.tasks.length;
  });

export const saveList = (account: string, input: Partial<TaskList>) =>
  serial(account, async () => {
    const d = await loadTasks(account);
    const name = str(input.name, 100).trim();
    if (!name) throw Object.assign(new Error('A list needs a name'), { status: 400 });
    const id = str(input.id, 64);
    const i = id ? d.lists.findIndex((l) => l.id === id) : -1;
    const list: TaskList = { id: i >= 0 ? id : crypto.randomUUID(), name };
    if (i >= 0) d.lists[i] = list;
    else d.lists.push(list);
    await store(account, d);
    return list;
  });

/** Deleting a list deletes its tasks too. */
export const deleteList = (account: string, id: string) =>
  serial(account, async () => {
    const d = await loadTasks(account);
    d.lists = d.lists.filter((l) => l.id !== id);
    d.tasks = d.tasks.filter((t) => t.list !== id);
    await store(account, d);
    return d;
  });
