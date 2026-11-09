// Mailbox / alias administration is the mail server's business, so goodmail hands it to a command the
// administrator configures (admincmdN=…). The command gets {"op","caller",…arguments} as one JSON line on stdin
// (never through a shell) and answers with one JSON line: {"ok":true,…} or {"error":"text for the user"}.
// The command alone decides who may do what; goodmail only says which mailbox the user signed in with.
import { spawn } from 'node:child_process';

export type AdminOp = 'whoami' | 'domain.get' | 'mailbox.create' | 'mailbox.update' | 'mailbox.delete' | 'alias.save' | 'alias.delete';

export function runAdminCommand(argv: string[], op: AdminOp, caller: string, args: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const fail = (msg: string, status = 502) => reject(Object.assign(new Error(msg), { status }));
    let p;
    try {
      p = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    } catch {
      return fail("Can't run the administration command");
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      fail('The mail server did not answer in time');
    }, timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', () => {
      clearTimeout(timer);
      fail("Can't run the administration command");
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      let res: any;
      try {
        res = JSON.parse(out.split('\n')[0]);
      } catch {
        console.error('admin command failed:', code, err.split('\n').slice(-3).join(' | ').slice(0, 300));
        return fail('The administration service did not answer properly. Ask the server administrator.');
      }
      if (res && typeof res.error === 'string') return fail(res.error.slice(0, 300), 400);
      if (code !== 0 || !res || res.ok !== true) return fail('The administration service did not answer properly. Ask the server administrator.');
      const { ok, ...rest } = res;
      resolve(rest);
    });
    p.stdin.on('error', () => {});
    p.stdin.end(JSON.stringify({ ...args, op, caller }) + '\n');
  });
}
