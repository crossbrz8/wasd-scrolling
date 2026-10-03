import './toast.css';
import { browser } from 'wxt/browser';
import {
  DEFAULT_SPEED,
  clampSpeed,
  isShortFormRoute,
  isStoriesRoute,
  keyToDir,
  shouldHandleMessage,
} from '../../utils/scroll-logic.js';

// WASD Page Scroller - Content Script (WXT)
// Toggle with Alt+S | Scroll speed adjustable via popup

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  main() {
    const STORAGE_KEY = 'wasdScrollerEnabled';
    const SPEED_KEY = 'wasdScrollerSpeed';

    // Default settings
    let enabled = true;
    let speed = DEFAULT_SPEED; // pixels per frame

    // Active keys being held down
    const keys = { w: false, a: false, s: false, d: false };

    // Animation frame reference
    let animFrame = null;

    // ── Load persisted settings (chrome.storage, global across sites) ────
    async function loadSettings() {
      try {
        const data = await browser.storage.local.get([STORAGE_KEY, SPEED_KEY]);
        if (data[STORAGE_KEY] !== undefined) enabled = data[STORAGE_KEY] === true;
        if (data[SPEED_KEY] !== undefined) speed = clampSpeed(data[SPEED_KEY]) ?? DEFAULT_SPEED;
      } catch {
        // storage unavailable (e.g. context invalidated) — keep defaults
      }
    }

    function saveSettings() {
      browser.storage.local.set({ [STORAGE_KEY]: enabled, [SPEED_KEY]: speed }).catch(() => {});
    }

    // ── Listen for messages from the popup ────────────────────────────────
    // Sender + shape validated per extension-analyze security checklist:
    // content scripts run in hostile pages, so treat every message as untrusted.
    browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!shouldHandleMessage(msg, sender, browser.runtime.id)) return false;
      if (msg.type === 'GET_STATE') {
        sendResponse({ enabled, speed });
      } else if (msg.type === 'SET_ENABLED') {
        if (typeof msg.value !== 'boolean') return false;
        enabled = msg.value;
        saveSettings();
        if (!enabled) stopScroll();
        sendResponse({ ok: true });
      } else if (msg.type === 'SET_SPEED') {
        const v = clampSpeed(msg.value);
        if (v === null) return false;
        speed = v;
        saveSettings();
        sendResponse({ ok: true });
      }
      return true;
    });

    // ── Key event helpers ─────────────────────────────────────────────────
    // (keyToDir lives in utils/scroll-logic.js so it can be unit-tested)
    function isInputFocused() {
      const el = document.activeElement;
      if (!el) return false;
      const tag = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '';
      return (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        el.isContentEditable
      );
    }

    // ── Short-form / inner-scroll handling ────────────────────────────────
    // Why Instagram/TikTok didn't scroll: they lock <body> and scroll an
    // inner <div> (feed / reels viewer with scroll-snap). window.scrollBy()
    // is a no-op there, so we must scroll the inner container instead.
    // On vertical video feeds, W/S snap to prev/next video instead of
    // smooth pixel scrolling.
    // (isShortFormRoute lives in utils/scroll-logic.js so it can be unit-tested;
    // called with no args it reads the live page URL.)

    // Auto-detect reels-like pages on any site: >=2 large videos stacked
    // vertically (covers embedded feeds, new routes, other platforms).
    function looksLikeShortFormFeed() {
      try {
        const vids = [...document.querySelectorAll('video')].filter((v) => {
          const r = v.getBoundingClientRect();
          return r.height > 300 && r.width > 150 && r.bottom > 0 && r.top < innerHeight;
        });
        if (vids.length < 2) return false;
        const tops = vids
          .map((v) => v.getBoundingClientRect().top)
          .sort((a, b) => a - b);
        // Vertically stacked = tops spread over more than one viewport
        return tops[tops.length - 1] - tops[0] > innerHeight * 0.8;
      } catch {
        return false;
      }
    }

    // Cached: route check is string ops, but the heuristic below scans every
    // <video> on the page — far too heavy to run on each keypress.
    // Route result is cached per URL; heuristic result gets a short TTL so
    // newly loaded feeds are picked up without rescanning per keystroke.
    let snapCache = { url: '', route: null, heuristic: null, heuristicAt: 0 };
    const SNAP_HEURISTIC_TTL_MS = 2000;
    function isSnapNavActive() {
      const url = location.href;
      if (snapCache.url !== url) {
        snapCache = { url, route: null, heuristic: null, heuristicAt: 0 };
      }
      if (snapCache.route === null) snapCache.route = isShortFormRoute();
      if (snapCache.route) return true;
      const now = performance.now();
      if (snapCache.heuristic === null || now - snapCache.heuristicAt > SNAP_HEURISTIC_TTL_MS) {
        snapCache.heuristic = looksLikeShortFormFeed();
        snapCache.heuristicAt = now;
      }
      return snapCache.heuristic;
    }

    function isVisible(el) {
      const r = el.getBoundingClientRect();
      return r.height > 200 && r.width > 100 && r.bottom > 0 && r.top < innerHeight;
    }

    // Find the scrollable element under the viewport center.
    function findScrollTarget() {
      const cx = innerWidth / 2;
      const cy = innerHeight / 2;
      let el = null;
      try {
        el = document.elementFromPoint(cx, cy);
      } catch { el = null; }
      let cur = el;
      let depth = 0;
      let overflowFallback = null;
      while (cur && cur !== document.body && cur !== document.documentElement && depth < 15) {
        depth++;
        // Cheap layout check first; getComputedStyle only for real candidates.
        if (cur.scrollHeight > cur.clientHeight + 10 && cur.clientHeight > 100) {
          if (!overflowFallback) overflowFallback = cur;
          let oy = '';
          try { oy = getComputedStyle(cur).overflowY; } catch { oy = ''; }
          if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return cur;
        }
        cur = cur.parentElement;
      }
      // No explicit scroll container found — an ancestor with overflowing
      // content may still take scroll (old behavior), prefer it over <body>.
      if (overflowFallback) return overflowFallback;
      // Fallback: largest plausible scroll container on the page
      let best = null;
      let bestArea = 0;
      for (const cand of document.querySelectorAll('main div, main, div')) {
        try {
          if (cand.scrollHeight <= cand.clientHeight + 50 || cand.clientHeight < 200) continue;
          const r = cand.getBoundingClientRect();
          if (r.top > innerHeight / 2 || r.bottom < innerHeight / 2) continue;
          const area = cand.clientWidth * cand.clientHeight;
          if (area > bestArea) { bestArea = area; best = cand; }
        } catch { /* ignore */ }
      }
      return best || document.scrollingElement || document.documentElement;
    }

    // Reels / Shorts / TikTok: snap to next/previous video instead of smooth pixel scrolling.
    let lastReelStep = 0;
    function getReelItem(video, target) {
      // Prefer semantic wrappers first (stable across obfuscated class names)
      try {
        const semantic = video.closest(
          'article, section, li, ytd-reel-video-renderer, ytd-shorts, [data-e2e="recommend-list-item-container"]'
        );
        if (semantic && semantic !== document.body && target.contains(semantic)) {
          const r = semantic.getBoundingClientRect();
          if (r.height > 200) return semantic;
        }
      } catch { /* ignore */ }
      // Fallback: walk up until we own a viewport-sized block
      let cur = video;
      for (let i = 0; i < 7 && cur && cur.parentElement && cur.parentElement !== target; i++) {
        cur = cur.parentElement;
        try {
          const r = cur.getBoundingClientRect();
          if (r.height > innerHeight * 0.5 && r.height > 200) return cur;
        } catch { break; }
      }
      return cur || video;
    }
    function tryNativeShortsButton(dir) {
      // YouTube Shorts has stable nav buttons — clicking is more reliable
      // than scrolling because YT intercepts scroll to drive its player.
      try {
        const host = location.hostname.toLowerCase();
        if (host.includes('youtube.com') || host.includes('youtu.be')) {
          const sel = dir > 0
            ? '#navigation-button-down button, ytd-shorts [aria-label="Next"]'
            : '#navigation-button-up button, ytd-shorts [aria-label="Previous"]';
          const btn = document.querySelector(sel);
          if (btn) { btn.click(); return true; }
        }
      } catch { /* fall through to scroll-based nav */ }
      return false;
    }
    function stepReel(dir) {
      const now = performance.now();
      if (now - lastReelStep < 350) return; // debounce held key
      lastReelStep = now;

      if (tryNativeShortsButton(dir)) return;

      const target = findScrollTarget();
      if (!target) return;

      // Collect reel candidates: videos (most reliable — class names change)
      const scope = target;
      let reels = [...scope.querySelectorAll('video')].filter(isVisible);
      if (reels.length < 2) {
        // Videos may live outside the scroll container (overlay layouts)
        reels = [...document.querySelectorAll('video')].filter(isVisible);
      }
      // Map videos -> their snap item wrapper
      let items = reels.map((v) => getReelItem(v, target));
      // Dedupe + sort top-to-bottom
      items = [...new Set(items)].sort(
        (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top
      );

      if (items.length >= 2) {
        const centerY = innerHeight / 2;
        let current = 0;
        let bestDist = Infinity;
        items.forEach((el, i) => {
          const r = el.getBoundingClientRect();
          const d = Math.abs(r.top + r.height / 2 - centerY);
          if (d < bestDist) { bestDist = d; current = i; }
        });
        const next = Math.min(items.length - 1, Math.max(0, current + dir));
        if (next !== current) {
          items[next].scrollIntoView({ behavior: 'instant', block: 'center' });
          // Nudge the container too (some layouts listen on container scroll)
          try { target.dispatchEvent(new Event('scroll', { bubbles: true })); } catch {}
          return;
        }
      }
      // Fallback: page by one viewport height (standard reels UX)
      try {
        target.scrollBy({ top: dir * (target.clientHeight || innerHeight) * 0.95, behavior: 'instant' });
      } catch {
        target.scrollTop += dir * (target.clientHeight || innerHeight);
      }
    }

    // Stories (Instagram/Facebook viewer): A/D step to prev/next story.
    let lastStoryStep = 0;
    function stepStory(dir) {
      const now = performance.now();
      if (now - lastStoryStep < 350) return; // debounce held key
      lastStoryStep = now;

      // 1. Click the viewer's own prev/next chevron (drives the site's
      //    player instead of fighting it). Matched by exact accessible name
      //    + screen half so unrelated carousels can't be hit.
      try {
        const wantNext = dir > 0;
        const btns = [...document.querySelectorAll('button')].filter((b) => {
          const label = (b.getAttribute('aria-label') || '').trim().toLowerCase();
          if (wantNext ? label !== 'next' : label !== 'previous') return false;
          const r = b.getBoundingClientRect();
          if (r.width < 20 || r.height < 20 || r.bottom <= 0 || r.top >= innerHeight) return false;
          const cx = r.left + r.width / 2;
          return wantNext ? cx > innerWidth / 2 : cx < innerWidth / 2;
        });
        if (btns.length > 0) {
          btns.sort((a, b) => {
            const ax = a.getBoundingClientRect().left;
            const bx = b.getBoundingClientRect().left;
            return wantNext ? bx - ax : ax - bx;
          });
          btns[0].click();
          return;
        }
      } catch { /* fall through to arrow-key fallback */ }

      // 2. Stories viewers respond to arrow keys natively.
      try {
        for (const type of ['keydown', 'keyup']) {
          document.dispatchEvent(
            new KeyboardEvent(type, {
              key: dir > 0 ? 'ArrowRight' : 'ArrowLeft',
              code: dir > 0 ? 'ArrowRight' : 'ArrowLeft',
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      } catch { /* nothing else to try */ }
    }

    // ── Toggle shortcut: Alt + S ──────────────────────────────────────────
    let scrollTarget = null;
    let scrollTargetUrl = '';

    document.addEventListener('keydown', (e) => {
      // Alt + S → toggle the extension (guarded: synthetic events may
      // carry no `key` string at all)
      const rawKey = typeof e.key === 'string' ? e.key : '';
      if (e.altKey && rawKey.toLowerCase() === 's') {
        enabled = !enabled;
        saveSettings();
        if (enabled) {
          showToast('WASD Scroll', 'Keys are active on this page', 'on');
        } else {
          showToast('WASD Scroll', 'Scrolling paused', 'off');
          stopScroll();
        }
        return;
      }

      if (!enabled) return;
      if (isInputFocused()) return;

      const dir = keyToDir(e.key);
      if (!dir) return;

      // In story viewers, A/D step to prev/next story instead of scrolling
      const isStoryKey =
        (dir === 'a' || dir === 'd') &&
        !e.altKey && !e.ctrlKey && !e.metaKey &&
        isStoriesRoute();

      if (isStoryKey) {
        // Same hijack treatment as snap keys: block page handlers.
        e.preventDefault();
        try { e.stopPropagation(); } catch {}
        if (typeof e.stopImmediatePropagation === 'function') {
          try { e.stopImmediatePropagation(); } catch {}
        }
        keys.a = keys.d = false;
        if (!keys.w && !keys.s) stopScroll();
        stepStory(dir === 'd' ? 1 : -1);
        return;
      }

      // On short-form video pages, W/S snap to prev/next video instead of pixel scroll
      const isSnapKey =
        (dir === 'w' || dir === 's') &&
        !e.altKey && !e.ctrlKey && !e.metaKey &&
        isSnapNavActive();

      if (isSnapKey) {
        // We hijack a key the page may also handle: block page handlers
        // and the default action.
        e.preventDefault();
        try { e.stopPropagation(); } catch {}
        if (typeof e.stopImmediatePropagation === 'function') {
          try { e.stopImmediatePropagation(); } catch {}
        }
        keys.w = keys.s = false;
        if (!keys.a && !keys.d) stopScroll();
        stepReel(dir === 's' ? 1 : -1);
        return;
      }

      // Smooth scroll: prevent the default action only — the page and other
      // extensions still see the event.
      e.preventDefault();
      keys[dir] = true;
      startScroll();
    }, { capture: true });

    document.addEventListener('keyup', (e) => {
      const dir = keyToDir(e.key);
      if (!dir) return;
      keys[dir] = false;
      if (!anyKeyActive()) stopScroll();
    }, { capture: true });

    // ── Scroll loop ───────────────────────────────────────────────────────
    function anyKeyActive() {
      return keys.w || keys.a || keys.s || keys.d;
    }

    function startScroll() {
      if (animFrame !== null) return; // already running
      scrollTarget = findScrollTarget();
      scrollTargetUrl = location.href;
      tick();
    }

    function stopScroll() {
      if (animFrame !== null) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
      }
      // Reset all keys (e.g. when toggling off mid-press)
      keys.w = keys.a = keys.s = keys.d = false;
    }

    function tick() {
      let dx = 0;
      let dy = 0;

      if (keys.w) dy -= speed;
      if (keys.s) dy += speed;
      if (keys.a) dx -= speed;
      if (keys.d) dx += speed;

      // Diagonal normalisation (keep consistent speed on diagonals)
      if (dx !== 0 && dy !== 0) {
        const factor = 1 / Math.SQRT2;
        dx *= factor;
        dy *= factor;
      }

      if (dx !== 0 || dy !== 0) {
        const root = document.scrollingElement || document.documentElement;
        let t = scrollTarget;
        // Re-resolve when the target is gone OR the SPA navigated
        // (Instagram/TikTok/YouTube swap content without a reload).
        if (!t || !document.contains(t) || scrollTargetUrl !== location.href) {
          t = scrollTarget = findScrollTarget();
          scrollTargetUrl = location.href;
        }
        const isRoot = !t || t === root || t === document.body || t === document.documentElement;
        if (isRoot) {
          window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
        } else {
          // Inner container first (Instagram, modals, sidebars…).
          const beforeTop = t.scrollTop;
          const beforeLeft = t.scrollLeft;
          try {
            t.scrollBy({ left: dx, top: dy, behavior: 'instant' });
          } catch {
            t.scrollLeft += dx;
            t.scrollTop += dy;
          }
          // If the inner container is at its edge and couldn't consume
          // the scroll, let the outer page take over (avoids double-speed
          // when both could scroll).
          if (t.scrollTop === beforeTop && t.scrollLeft === beforeLeft) {
            window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
          }
        }
      }

      if (anyKeyActive() && enabled) {
        animFrame = requestAnimationFrame(tick);
      } else {
        animFrame = null;
      }
    }

    // ── Toast (Vanilla JS + UIArc Style) ────────────────────────────────
    let currentToast = null;

    function showToast(title, sub, variant) {
      if (currentToast) currentToast.dismiss(true);

      const SVG_NS = 'http://www.w3.org/2000/svg';
      function makeIcon(size, stroke, pathDs) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', stroke);
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('class', 'toast-icon-svg');
        svg.setAttribute('aria-hidden', 'true');
        for (const d of pathDs) {
          const p = document.createElementNS(SVG_NS, 'path');
          p.setAttribute('d', d);
          p.setAttribute('class', 'toast-draw');
          svg.appendChild(p);
        }
        return svg;
      }

      const safeVariant = variant === 'on' ? 'on' : 'off';
      const toast = document.createElement('div');
      toast.className = `uiarc-toast uiarc-toast--${safeVariant}`;

      // Accessibility (matching UIArc spec)
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.setAttribute('aria-atomic', 'true');

      const iconWrap = document.createElement('div');
      iconWrap.className = 'toast-icon';
      iconWrap.appendChild(
        safeVariant === 'on'
          ? makeIcon(20, '#34d399', ['M20 6 9 17l-5-5'])
          : makeIcon(20, '#71717a', ['M18 6 6 18M6 6l12 12'])
      );

      const content = document.createElement('div');
      content.className = 'toast-content';
      const titleEl = document.createElement('div');
      titleEl.className = 'toast-title';
      titleEl.textContent = String(title);
      const subEl = document.createElement('div');
      subEl.className = 'toast-sub';
      subEl.textContent = String(sub);
      content.append(titleEl, subEl);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'toast-close';
      closeBtn.setAttribute('aria-label', 'Dismiss notification');
      closeBtn.appendChild(makeIcon(16, 'currentColor', ['M18 6 6 18', 'm6 6 12 12']));

      toast.append(iconWrap, content, closeBtn);

      document.body.appendChild(toast);

      // Swipe to dismiss logic (Touch & Mouse)
      let startX = 0, currentX = 0, isDragging = false;

      function onPointerDown(e) {
        // Only track left clicks or touch
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        isDragging = true;
        startX = e.clientX;
        toast.style.transition = 'none';
        try {
          if (e.target && typeof e.target.setPointerCapture === 'function') {
            e.target.setPointerCapture(e.pointerId);
          }
        } catch {
          // pointer already released / target detached — drag still works via move/up
        }
      }

      function onPointerMove(e) {
        if (!isDragging) return;
        currentX = e.clientX - startX;
        // UI Arc behavior: Horizontal swipe
        toast.style.transform = `translateX(${currentX}px)`;
      }

      function onPointerUp(e) {
        if (!isDragging) return;
        isDragging = false;
        toast.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease';

        // Swipe threshold: 80px
        if (Math.abs(currentX) > 80) {
          toast.style.transform = `translateX(${currentX > 0 ? 100 : -100}%)`;
          toast.style.opacity = '0';
          setTimeout(() => dismiss(true), 300);
        } else {
          toast.style.transform = 'translateX(0)';
        }
      }

      toast.addEventListener('pointerdown', onPointerDown);
      toast.addEventListener('pointermove', onPointerMove);
      toast.addEventListener('pointerup', onPointerUp);
      toast.addEventListener('pointercancel', onPointerUp);

      let timer = setTimeout(() => dismiss(), 4500);

      function dismiss(immediate = false) {
        if (!toast.parentNode) return;
        clearTimeout(timer);

        if (immediate) {
          toast.remove();
        } else {
          toast.classList.add('toast-exit');
          setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
        }
        if (currentToast?.el === toast) currentToast = null;
      }

      closeBtn.addEventListener('click', () => dismiss());
      currentToast = { el: toast, dismiss };
    }

    // ── Init ──────────────────────────────────────────────────────────────
    // SPA navigation swaps content without a reload — drop cached targets
    // proactively so the next keypress re-resolves them.
    function handleNav() {
      scrollTarget = null;
      scrollTargetUrl = '';
      snapCache = { url: '', route: null, heuristic: null, heuristicAt: 0 };
    }
    try {
      const origPushState = history.pushState.bind(history);
      const origReplaceState = history.replaceState.bind(history);
      history.pushState = (...args) => {
        const r = origPushState(...args);
        handleNav();
        return r;
      };
      history.replaceState = (...args) => {
        const r = origReplaceState(...args);
        handleNav();
        return r;
      };
    } catch {
      // history is non-configurable here — tick()'s URL check still catches navs
    }
    window.addEventListener('popstate', handleNav);
    window.addEventListener('hashchange', handleNav);
    loadSettings();
  },
});
