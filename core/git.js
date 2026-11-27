// The one function that runs git (docs/ARCHITECTURE.md §3.1).
//
// runGit(root, args, opts) -> Promise<{ stdout, stderr, exitCode }>
//   root   absolute path of the folder git runs in. REQUIRED: there is no fallback to process.cwd(), so a caller that
//          lost its repository cannot run a destructive command somewhere else by accident.
//   args   argument array (no shell). Values from the UI must come after `--` / `--end-of-options`.
//   opts   input          string | Buffer written to stdin
//          env            extra environment variables
//          timeoutMs      kill git after this long (default 120 s; 0 = no timeout)
//          signal         AbortSignal; aborting kills git and rejects with a GitError where `cancelled` is true
//          quiet          do not report this command on the Console stream
//          console        fn(lines[]) receiving Console lines ({ time, kind: 'cmd'|'out'|'err', text })
//          optionalLocks  false for background reads: `--no-optional-locks` + GIT_OPTIONAL_LOCKS=0, so a status poll
//                         never takes index.lock away from the user's own git
//          okCodes        exit codes that are not failures (default [0]; merge/rebase use [0, 1])
//          encoding       'utf8' (default) or 'buffer' for stdout
//          maxBytes       stdout cap (default 512 MiB); exceeding it rejects with code 'too_large'
//          onProgress     fn(line) for every stderr line, split on \r and \n (git's --progress output)
//          onStdout       fn(Buffer) receives stdout as it arrives (the result's stdout is then empty)
//          limiter        { acquire(key, signal) -> Promise<release> } (createLimiter): waits for a slot before git starts
//          limitKey       the queue this call waits in (callers that share a key are served in order; keys take turns)
//          trace          fn({ root, args, ms, exitCode, ok, killed, signal, outBytes, errBytes, stderr }) when the command
//                         ends, quiet or not (the engine's log on disk); ok: exit 0 and not killed; stderr only when
//                         not ok; never the output
//
// Environment: the host process's variables are inherited EXCEPT the ones that point git at another repository or
// change what it reads (REDIRECT_ENV, GIT_CONFIG_KEY_n/VALUE_n, GIT_TRACE*): a server started from a git hook, an
// alias or a shell that exports GIT_DIR must still only touch the repository it was asked to open (Hard Rule 1).
// A caller that needs one of them sets it explicitly with `env`; GIT_PANEL_CEILING_DIRECTORIES becomes
// GIT_CEILING_DIRECTORIES (the test fixtures use it to fence their temporary root).
//
// Processes: git is the leader of its own process group, so a timeout or a cancel ends git AND whatever it started
// (a clean filter, a credential helper, ssh, a hook): SIGTERM to the group, SIGKILL 2 s later. Once git has exited the
// call settles even when something still holds the output pipes (200 ms after a kill, 2 s after a normal exit).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineError } from './errors.js';
import { PRODUCT } from './product.js';

/** Options every command gets: stable output, UTF-8 paths, no colors, no signatures. */
export const GIT_CONFIG_ARGS = Object.freeze([
  '-c', 'core.quotepath=false',
  '-c', 'i18n.logOutputEncoding=UTF-8',
  '-c', 'log.showSignature=false',
  '-c', 'color.ui=false',
  // Windows OpenSSH in the Orca plugin host can exit silently on Git's SSH transport; Git's bundled
  // ssh.exe resolves ~/.ssh correctly there. Leave other platforms to their own config.
  ...(process.platform === 'win32' ? ['-c', 'core.sshCommand=ssh'] : []),
]);

export const BASE_ENV = Object.freeze({
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  GIT_EDITOR: 'true',
  GIT_MERGE_AUTOEDIT: 'no',
  GIT_LITERAL_PATHSPECS: '1', // a path from the UI is a path, never a glob or pathspec magic
  LC_ALL: 'C',
  LANG: 'C',
});

/**
 * Variables never inherited from the host process. Everything `git rev-parse --local-env-vars` prints (they select
 * the repository, its object store, index, config injection, grafts, replace refs, shallow file), plus what else moves
 * or reshapes the repository git sees: namespaces, discovery limits, quarantine, pathspec modes that would undo
 * GIT_LITERAL_PATHSPECS, external diff drivers that change the output the engine parses.
 */
export const REDIRECT_ENV = Object.freeze([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY',
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
  'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_QUARANTINE_PATH',
  'GIT_INTERNAL_SUPER_PREFIX', 'GIT_INDEX_VERSION', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS',
  'GIT_LITERAL_PATHSPECS', 'GIT_EXTERNAL_DIFF', 'GIT_DIFF_OPTS', 'GIT_OPTIONAL_LOCKS', 'GIT_REF_PARANOIA',
]);
const REDIRECT_SET = new Set(REDIRECT_ENV);
// Locale variables of the host are dropped too: BASE_ENV sets LC_ALL=C and LANG=C, and LANGUAGE (which gettext reads
// before LC_ALL wherever the locale is not "C") would otherwise stay. The engine reads some of git's English messages
// ("Dropped stash@{n} (…)", "would be overwritten") as a second signal beside state checks.
const LOCALE_SET = new Set(['LANGUAGE', 'LC_MESSAGES', 'LC_CTYPE', 'LC_NUMERIC', 'LC_TIME', 'LC_COLLATE', 'LC_MONETARY']);
const REDIRECT_RE = /^(GIT_CONFIG_(KEY|VALUE)_\d+|GIT_TRACE.*)$/;

/** The host environment without the variables that could move git to another repository. */
export function cleanEnv(source = process.env) {
  const env = {};
  for (const [k, v] of Object.entries(source)) if (!REDIRECT_SET.has(k) && !REDIRECT_RE.test(k) && !LOCALE_SET.has(k)) env[k] = v;
  if (source[PRODUCT.ceilingEnv]) env.GIT_CEILING_DIRECTORIES = source[PRODUCT.ceilingEnv];
  return env;
}

/**
 * A cap on simultaneous git processes with a fair queue: waiting calls are grouped by key (a client, a repository's
 * background refresh) and the keys take turns, so one client firing 50 reads cannot starve another one.
 * acquire(key, signal) -> Promise<release>; an aborted wait rejects with a cancelled GitError and takes no slot.
 */
export function createLimiter(max) {
  let running = 0;
  let tick = 0;
  const queues = new Map(); // key -> [waiter]
  const served = new Map(); // key -> tick of its last start: the key served longest ago goes next
  const next = () => {
    while (running < max && queues.size) {
      let key = null;
      let best = Infinity;
      for (const k of queues.keys()) { const t = served.has(k) ? served.get(k) : -1; if (t < best) { best = t; key = k; } }
      const list = queues.get(key);
      const w = list.shift();
      if (!list.length) queues.delete(key);
      served.set(key, ++tick);
      if (served.size > 4096) for (const k of served.keys()) { if (!queues.has(k)) served.delete(k); if (served.size <= 2048) break; }
      running++;
      w.start();
    }
  };
  return {
    get running() { return running; },
    get waiting() { let n = 0; for (const l of queues.values()) n += l.length; return n; },
    /** How many keys it remembers (diagnostics: bounded, see `served` above). */
    get keys() { return served.size + queues.size; },
    acquire(key = '', signal) {
      return new Promise((resolve, reject) => {
        if (signal && signal.aborted) { reject(new GitError('cancelled', { command: null, exitCode: null, stderr: '', cancelled: true })); return; }
        let released = false;
        const release = () => { if (released) return; released = true; running--; next(); };
        const w = {
          start() { if (signal) signal.removeEventListener('abort', onAbort); resolve(release); },
        };
        const onAbort = () => {
          const list = queues.get(key);
          const i = list ? list.indexOf(w) : -1;
          if (i < 0) return;
          list.splice(i, 1);
          if (!list.length) queues.delete(key);
          reject(new GitError('cancelled', { command: null, exitCode: null, stderr: '', cancelled: true }));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        if (!queues.has(key)) queues.set(key, []);
        queues.get(key).push(w);
        next();
      });
    },
  };
}

const CONSOLE_LINE_CAP = 400;

// git processes of this process that have not exited yet (diagnostics: the soak test checks none is left behind).
const living = new Map(); // child -> the root it runs in
/** { count, pids, roots } of git processes started here that are still running. */
export const liveGit = () => ({ count: living.size, pids: Array.from(living.keys(), (c) => c.pid), roots: Array.from(new Set(living.values())) });

export class GitError extends Error {
  constructor(message, fields) {
    super(message);
    this.name = 'GitError';
    Object.assign(this, fields);
  }
}

function checkRoot(root) {
  if (typeof root !== 'string' || !root) throw new EngineError('internal', 'runGit: repository root is required');
  if (!path.isAbsolute(root)) throw new EngineError('internal', 'runGit: repository root must be absolute: ' + root);
  let st;
  try { st = fs.statSync(root); } catch { throw new EngineError('not_found', 'runGit: folder does not exist: ' + root); }
  if (!st.isDirectory()) throw new EngineError('internal', 'runGit: not a folder: ' + root);
}

/** The command line as the Console shows it. */
export function displayCommand(args) {
  return 'git ' + args.map((a) => (a === '' || /[\s"'\\$`]/.test(a) ? "'" + a.replace(/'/g, "'\\''") + "'" : a)).join(' ');
}

function splitLines(text) {
  const lines = text.split(/\r?\n|\r/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function runGit(root, args, opts = {}) {
  checkRoot(root);
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) throw new EngineError('internal', 'runGit: args must be an array of strings');
  const pre = [];
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const env = { ...cleanEnv(), ...BASE_ENV, HOME: home, USERPROFILE: home, APPDATA: appData, LOCALAPPDATA: localAppData };
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy']) {
    const v = process.env[k];
    if (v !== undefined && v !== '') env[k] = v;
  }
  Object.assign(env, opts.env || {});
  if (opts.optionalLocks === false) { pre.push('--no-optional-locks'); env.GIT_OPTIONAL_LOCKS = '0'; }
  const full = pre.concat(GIT_CONFIG_ARGS, args);
  const command = displayCommand(full);
  const sink = !opts.quiet && typeof opts.console === 'function' ? opts.console : null;
  const okCodes = opts.okCodes || [0];
  const maxBytes = opts.maxBytes || 512 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs === undefined ? 120000 : opts.timeoutMs;
  if (sink) sink([{ time: Date.now(), kind: 'cmd', text: command }]);
  const cancelled = () => new GitError('cancelled', { command, exitCode: null, stderr: '', cancelled: true });
  if (opts.signal && opts.signal.aborted) return Promise.reject(cancelled());
  if (!opts.limiter) return spawnGit(root, full, command, env, sink, okCodes, maxBytes, timeoutMs, opts);
  return opts.limiter.acquire(opts.limitKey || root, opts.signal).then(
    (release) => spawnGit(root, full, command, env, sink, okCodes, maxBytes, timeoutMs, opts).finally(release),
    (e) => { throw e && e.cancelled ? cancelled() : e; },
  );
}

function signalGroup(child, sig) {
  try { process.kill(-child.pid, sig); return; } catch { /* the group is gone, or not a group leader */ }
  try { child.kill(sig); } catch { /* exited */ }
}

function spawnGit(root, full, command, env, sink, okCodes, maxBytes, timeoutMs, opts) {
  return new Promise((resolve, reject) => {
    if (opts.signal && opts.signal.aborted) {
      reject(new GitError('cancelled', { command, exitCode: null, stderr: '', cancelled: true }));
      return;
    }
    // detached: git leads a new process group, so killing the group also ends the helpers it started.
    const child = spawn('git', full, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    living.set(child, root);
    const forget = () => living.delete(child);
    child.once('exit', forget);
    child.once('error', forget);
    const out = [];
    let outBytes = 0;
    const err = [];
    let errTail = '';
    let killedFor = null;
    let timer = null;
    let exited = false;

    const kill = (why) => {
      if (killedFor) return;
      killedFor = why;
      signalGroup(child, 'SIGTERM');
      setTimeout(() => signalGroup(child, 'SIGKILL'), 2000).unref();
    };
    const onAbort = () => { if (!exited) kill('cancelled'); };
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs > 0) timer = setTimeout(() => { if (!exited) kill('timeout'); }, timeoutMs);

    child.stdout.on('data', (b) => {
      outBytes += b.length;
      if (outBytes > maxBytes) { kill('too_large'); return; }
      if (opts.onStdout) { try { opts.onStdout(b); } catch (e) { kill('cancelled'); } return; }
      out.push(b);
    });
    child.stderr.on('data', (b) => {
      err.push(b);
      if (opts.onProgress) {
        const parts = (errTail + b.toString('utf8')).split(/\r|\n/);
        errTail = parts.pop();
        parts.forEach((p) => { if (p) opts.onProgress(p); });
      }
    });
    child.stdin.on('error', () => {}); // git may exit before reading all input
    if (opts.input !== undefined && opts.input !== null) child.stdin.end(opts.input);
    else child.stdin.end();

    child.on('error', (e) => {
      if (finished) return;
      finished = true;
      cleanup();
      trace(null, false, 'cannot run git: ' + e.message);
      reject(new GitError('cannot run git: ' + e.message, { command, exitCode: null, stderr: '' }));
    });
    // The end of every command, quiet ones included, for the engine's log (opts.trace, core/disklog.js): the caller's
    // own arguments (without GIT_CONFIG_ARGS), duration, exit code, output sizes, stderr when it failed. Never output.
    const t0 = Date.now();
    function trace(code, ok, stderr) {
      if (typeof opts.trace !== 'function') return;
      try {
        opts.trace({ root, args: full.slice(GIT_CONFIG_ARGS.length + (full[0] === '--no-optional-locks' ? 1 : 0)), ms: Date.now() - t0, exitCode: code, ok, killed: killedFor, signal: exitSignal, outBytes, errBytes: err.reduce((n, b) => n + b.length, 0), stderr: ok ? '' : stderr });
      } catch { /* the log must not break a command */ }
    }
    // A child of git (a transport helper, ssh, a hook, a daemon it started) can still hold the output pipes after git
    // has exited, so 'close' would wait for that child. Once git itself has exited, finish without it.
    let finished = false;
    let exitSignal = null;
    child.on('exit', (code, sig) => {
      exited = true;
      exitSignal = sig || null;
      setTimeout(() => {
        if (finished) return;
        child.stdout.destroy();
        child.stderr.destroy();
        finish(code);
      }, killedFor ? 200 : 2000).unref();
    });
    child.on('close', (code) => finish(code));
    function finish(code) {
      if (finished) return;
      finished = true;
      cleanup();
      if (opts.onProgress && errTail) opts.onProgress(errTail);
      const stdoutBuf = Buffer.concat(out);
      const stderr = Buffer.concat(err).toString('utf8');
      const stdout = opts.encoding === 'buffer' ? stdoutBuf : stdoutBuf.toString('utf8');
      if (sink) report(sink, opts.encoding === 'buffer' ? '' : stdout, stderr);
      // stderr goes with every non-zero exit: callers that accept any code (tryGit) still had a failing git
      trace(code, !killedFor && code === 0, stderr);
      if (killedFor === 'too_large') { reject(new EngineError('too_large', 'git output is over ' + maxBytes + ' bytes', { command })); return; }
      // `signal`: what ended git (SIGTERM: it tidied up after itself; SIGKILL: it could not, a lock file may be left)
      if (killedFor === 'cancelled') { reject(new GitError('cancelled', { command, exitCode: code, stderr, cancelled: true, signal: exitSignal })); return; }
      if (killedFor === 'timeout') { reject(new GitError('git timed out after ' + timeoutMs + ' ms', { command, exitCode: code, stderr, timedOut: true })); return; }
      if (!okCodes.includes(code)) {
        const first = stderr.split('\n').find((l) => l.trim()) || 'git exited with code ' + code;
        reject(new GitError(first.trim(), { command, exitCode: code, stderr, stdout: typeof stdout === 'string' ? stdout.slice(0, 64 * 1024) : '' }));
        return;
      }
      resolve({ stdout, stderr, exitCode: code });
    }

    function cleanup() {
      if (timer) clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    }
  });
}

function report(sink, stdout, stderr) {
  const lines = [];
  const now = Date.now();
  const add = (kind, text) => splitLines(text.replace(/\0/g, ' ')).forEach((t) => lines.push({ time: now, kind, text: t }));
  add('out', stdout);
  add('err', stderr);
  if (!lines.length) return;
  if (lines.length > CONSOLE_LINE_CAP) {
    const more = lines.length - CONSOLE_LINE_CAP;
    lines.length = CONSOLE_LINE_CAP;
    lines.push({ time: now, kind: 'out', text: '… ' + more + ' more lines' });
  }
  sink(lines);
}

/** Reads a fraction out of a git progress line ("Receiving objects:  45% (9/20)"); null when there is none. */
export function parseProgress(line) {
  const m = /^(?:remote: )?([^:]+):\s+(\d{1,3})%/.exec(line);
  if (!m) return null;
  return { phase: m[1].trim(), fraction: Math.min(1, Number(m[2]) / 100) };
}
