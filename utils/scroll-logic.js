// Pure, DOM-free logic for the WASD scroller content script.
// Unit-tested via Vitest (utils/scroll-logic.test.js).
// DOM-dependent code (findScrollTarget, stepReel, toast) stays in
// entrypoints/scroller.content/index.js and imports from here.

export const SPEED_MIN = 2;
export const SPEED_MAX = 30;
export const DEFAULT_SPEED = 8;

export const MESSAGE_TYPES = ['GET_STATE', 'SET_ENABLED', 'SET_SPEED'];

export function keyToDir(key) {
  // Synthetic events (page scripts, other extensions, automation) can
  // dispatch keydown/keyup without a `key` string — ignore them.
  if (typeof key !== 'string' || key.length === 0) return null;
  switch (key.toLowerCase()) {
    case 'w': return 'w';
    case 'a': return 'a';
    case 's': return 's';
    case 'd': return 'd';
    default: return null;
  }
}

// Route-based short-form detection. Host/path default to the live page so
// the content script can call it with no args; tests pass explicit values.
export function isShortFormRoute(
  hostname = typeof location !== 'undefined' ? location.hostname : '',
  pathname = typeof location !== 'undefined' ? location.pathname : '',
) {
  const host = String(hostname).toLowerCase();
  const p = String(pathname).toLowerCase();

  // TikTok: For You / Following / @user/video/... are all vertical feeds.
  // Exclude search/settings/inbox where pixel scroll is more useful.
  if (host.includes('tiktok.com')) {
    if (/^\/(search|settings|messages|inbox|upload)/.test(p)) return false;
    return true;
  }
  // YouTube Shorts
  if (host.includes('youtube.com') || host.includes('youtu.be')) {
    return p.includes('/shorts');
  }
  // Instagram + Facebook reels
  if (p.includes('/reel')) return true;
  // Generic: shorts / spotlight routes on any site
  if (p.includes('/shorts') || p.includes('/spotlight')) return true;
  return false;
}

// Returns a clamped speed, or null when the value is not a number.
export function clampSpeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, n));
}

// Content scripts run in hostile pages — treat every message as untrusted.
// Accepts messages with no sender (e.g. extension-internal delivery) but
// rejects foreign extension IDs and unknown types.
export function shouldHandleMessage(msg, sender, runtimeId) {
  try {
    if (sender && sender.id !== undefined && sender.id !== runtimeId) return false;
    if (!msg || typeof msg !== 'object' || !MESSAGE_TYPES.includes(msg.type)) return false;
  } catch {
    return false;
  }
  return true;
}

// Stories viewer detection (Instagram / Facebook). Same no-arg convention
// as isShortFormRoute: live page URL by default, explicit values in tests.
export function isStoriesRoute(
  hostname = typeof location !== 'undefined' ? location.hostname : '',
  pathname = typeof location !== 'undefined' ? location.pathname : '',
) {
  const host = String(hostname).toLowerCase();
  const p = String(pathname).toLowerCase();
  if (!host.includes('instagram.com') && !host.includes('facebook.com')) return false;
  return p.includes('/stories');
}
