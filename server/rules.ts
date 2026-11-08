// Mail rules: a small structured model that is compiled to a Sieve script. The script carries the model
// as a comment on its first line, so the editor can read its own rules back; scripts that were written
// by hand (or by another webmail) are left alone until the user chooses to replace them.
export type Field = 'from' | 'to' | 'cc' | 'recipient' | 'subject' | 'list' | 'header';
export type Op = 'contains' | 'not-contains' | 'is' | 'begins' | 'ends';
export type ActionType = 'move' | 'read' | 'flag' | 'forward' | 'discard' | 'stop';

export interface Condition {
  field: Field;
  /** Header name, only for field = "header". */
  header?: string;
  op: Op;
  value: string;
}
export interface Action {
  type: ActionType;
  /** Folder path for move, address for forward. */
  value?: string;
}
export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  match: 'all' | 'any';
  conditions: Condition[];
  actions: Action[];
}

export const MARKER = '# goodmail-rules:';
export const SCRIPT_NAME = 'goodmail';
const MAX_RULES = 100;

const FIELDS: Field[] = ['from', 'to', 'cc', 'recipient', 'subject', 'list', 'header'];
const OPS: Op[] = ['contains', 'not-contains', 'is', 'begins', 'ends'];
const ACTIONS: ActionType[] = ['move', 'read', 'flag', 'forward', 'discard', 'stop'];

const clean = (s: unknown, max = 500) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);

/** Validate untrusted input into well-formed rules (throws a user-readable error). */
export function normalizeRules(input: unknown): Rule[] {
  if (!Array.isArray(input)) throw Object.assign(new Error('Rules must be a list'), { status: 400 });
  if (input.length > MAX_RULES) throw Object.assign(new Error(`At most ${MAX_RULES} rules`), { status: 400 });
  return input.map((raw: any, i) => {
    const name = clean(raw?.name, 80) || `Rule ${i + 1}`;
    const bad = (m: string) => Object.assign(new Error(`${name}: ${m}`), { status: 400 });
    const conditions: Condition[] = (Array.isArray(raw?.conditions) ? raw.conditions : []).slice(0, 10).map((c: any) => {
      const field = FIELDS.includes(c?.field) ? (c.field as Field) : 'subject';
      const op = OPS.includes(c?.op) ? (c.op as Op) : 'contains';
      const value = clean(c?.value);
      if (!value) throw bad('a condition has no text');
      const out: Condition = { field, op, value };
      if (field === 'header') {
        const h = clean(c?.header, 60);
        if (!/^[A-Za-z0-9-]+$/.test(h)) throw bad('the header name is not valid');
        out.header = h;
      }
      return out;
    });
    if (!conditions.length) throw bad('add at least one condition');
    const actions: Action[] = (Array.isArray(raw?.actions) ? raw.actions : []).slice(0, 6).map((a: any) => {
      if (!ACTIONS.includes(a?.type)) throw bad('unknown action');
      const out: Action = { type: a.type };
      if (a.type === 'move') {
        out.value = clean(a.value, 200);
        if (!out.value) throw bad('choose a folder');
      }
      if (a.type === 'forward') {
        out.value = clean(a.value, 200).toLowerCase();
        if (!/^[^@\s",;<>]+@[^@\s",;<>]+\.[^@\s",;<>]+$/.test(out.value)) throw bad('enter a valid address to forward to');
      }
      return out;
    });
    if (!actions.length) throw bad('add at least one action');
    return {
      id: clean(raw?.id, 40) || Math.random().toString(36).slice(2, 10),
      name,
      enabled: raw?.enabled !== false,
      match: raw?.match === 'any' ? 'any' : 'all',
      conditions,
      actions,
    };
  });
}

/** Sieve quoted string. */
const str = (s: string) => `"${s.replace(/[\\"]/g, '\\$&')}"`;
/** Escape the wildcards of :matches. */
const lit = (s: string) => s.replace(/[\\*?]/g, '\\$&');

function headers(c: Condition): string[] {
  switch (c.field) {
    case 'from': return ['From'];
    case 'to': return ['To'];
    case 'cc': return ['Cc'];
    case 'recipient': return ['To', 'Cc'];
    case 'subject': return ['Subject'];
    case 'list': return ['List-Id'];
    default: return [c.header!];
  }
}

function test(c: Condition): string {
  const h = headers(c);
  const hs = h.length === 1 ? str(h[0]) : `[${h.map(str).join(', ')}]`;
  const neg = c.op === 'not-contains';
  let t: string;
  switch (c.op) {
    case 'is': t = `header :is ${hs} ${str(c.value)}`; break;
    case 'begins': t = `header :matches ${hs} ${str(lit(c.value) + '*')}`; break;
    case 'ends': t = `header :matches ${hs} ${str('*' + lit(c.value))}`; break;
    default: t = `header :contains ${hs} ${str(c.value)}`;
  }
  return neg ? `not ${t}` : t;
}

export function toSieve(rules: Rule[]): string {
  const need = new Set<string>();
  const body: string[] = [];
  for (const r of rules) {
    if (!r.enabled) {
      body.push(`# disabled: ${r.name.replace(/[\r\n]/g, ' ')}`);
      continue;
    }
    const conds = r.conditions.map(test);
    const cond = conds.length === 1 ? conds[0] : `${r.match === 'any' ? 'anyof' : 'allof'} (${conds.join(', ')})`;
    const acts: string[] = [];
    const flags: string[] = [];
    for (const a of r.actions) {
      if (a.type === 'read') flags.push('\\\\Seen');
      if (a.type === 'flag') flags.push('\\\\Flagged');
    }
    const fl = flags.length ? ` :flags [${flags.map((f) => `"${f}"`).join(', ')}]` : '';
    if (flags.length) need.add('imap4flags');
    for (const a of r.actions) {
      if (a.type === 'forward') {
        acts.push(`redirect :copy ${str(a.value!)};`);
        need.add('copy');
      }
    }
    const move = r.actions.find((a) => a.type === 'move');
    const discard = r.actions.some((a) => a.type === 'discard');
    if (discard) acts.push('discard;');
    else if (move) {
      need.add('fileinto').add('mailbox');
      acts.push(`fileinto :create${fl} ${str(move.value!)};`);
    } else if (flags.length) acts.push(`keep${fl};`);
    if (discard || r.actions.some((a) => a.type === 'stop')) acts.push('stop;');
    body.push(`# ${r.name.replace(/[\r\n]/g, ' ')}`, `if ${cond} {`, ...acts.map((a) => `  ${a}`), '}');
  }
  const model = Buffer.from(JSON.stringify(rules)).toString('base64');
  const req = [...need].sort();
  return [`${MARKER} ${model}`, ...(req.length ? [`require [${req.map(str).join(', ')}];`] : []), ...body, ''].join('\r\n');
}

/** The rules stored in a script written by this editor, or null for a script we did not write. */
export function fromSieve(script: string): Rule[] | null {
  const m = new RegExp('^' + MARKER + ' ([A-Za-z0-9+/=]+)\\s*$', 'm').exec(script);
  if (!m) return null;
  try {
    return normalizeRules(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')));
  } catch {
    return null;
  }
}
