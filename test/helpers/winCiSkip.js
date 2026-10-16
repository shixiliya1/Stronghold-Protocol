// The upstream plugin runtime suites (child-process match hosts, script sandboxes, the release harness) are not yet
// stable on the GitHub Windows runners (timing, process trees). This fork skips them there in CI only; they run on
// Linux CI and on any local machine. Usage: import { test, describe } from './helpers/winCiSkip.js' (same API).
import * as nt from 'node:test';

const SKIP = process.platform === 'win32' && !!process.env.CI ? 'upstream plugin runtime: skipped on Windows CI (fork)' : false;
const wrap = (fn) => (name, opts, body) => {
  if (typeof opts === 'function') { body = opts; opts = {}; }
  return fn(name, { ...(opts || {}), ...(SKIP ? { skip: SKIP } : {}) }, body);
};
export const test = wrap(nt.test);
export const describe = wrap(nt.describe);
export const after = nt.after;
export const before = nt.before;
