// Changing the mailbox password is the mail server's business, so goodmail hands it to a command the
// administrator configures (passwordcmdN=…). The command gets {"login","user","old","new"} as one JSON line on
// stdin and is never run through a shell. Exit 0 = done; otherwise the first line it prints on stdout
// (if any) is shown to the user.
import { spawn } from 'node:child_process';

export interface PasswordJob {
  login: string; // the mail address
  user: string; // the name the mail server signs this mailbox in with

  old: string;
  next: string;
}

export function runPasswordCommand(argv: string[], job: PasswordJob, timeoutMs = 25_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (msg: string, status = 502) => reject(Object.assign(new Error(msg), { status }));
    let p;
    try {
      p = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    } catch (e) {
      return fail("Can't run the password command");
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      fail('The password service did not answer in time');
    }, timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', () => {
      clearTimeout(timer);
      fail("Can't run the password command");
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const line = out.split('\n')[0].trim().slice(0, 200);
      if (line) return fail(line, 400);
      console.error('password command failed:', code, err.split('\n').slice(-3).join(' | ').slice(0, 300));
      fail("The password could not be changed. Ask your administrator.");
    });
    p.stdin.on('error', () => {});
    p.stdin.end(JSON.stringify({ login: job.login, user: job.user, old: job.old, new: job.next }) + '\n');
  });
}

/** Reasons to refuse before bothering the server. */
export function checkNewPassword(old: string, next: string, min: number): string | null {
  if (next.length < min) return `The new password needs at least ${min} characters`;
  if (next.length > 200) return 'That password is too long';
  if (/[\u0000-\u001f\u007f]/.test(next)) return 'The password may not contain control characters';
  if (next === old) return 'The new password is the same as the current one';
  return null;
}
