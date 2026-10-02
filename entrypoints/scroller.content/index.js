import './toast.css';
import { browser } from 'wxt/browser';

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
    let speed = 8; // pixels per frame

    // Active keys being held down
    const keys = { w: false, a: false, s: false, d: false };

    // Animation frame reference
    let animFrame = null;

    // ── Load persisted settings (chrome.storage, global across sites) ────
    async function loadSettings() {
      try {
        const data = await browser.storage.local.get([STORAGE_KEY, SPEED_KEY]);
        if (data[STORAGE_KEY] !== undefined) enabled = data[STORAGE_KEY] === true;
        if (data[SPEED_KEY] !== undefined) speed = parseFloat(data[SPEED_KEY]) || 8;
      } catch {
        // storage unavailable (e.g. context invalidated) — keep defaults
      }
    }

    function saveSettings() {
      browser.storage.local.set({ [STORAGE_KEY]: enabled, [SPEED_KEY]: speed }).catch(() => {});
    }

    // ── Listen for messages from the popup ────────────────────────────────
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'GET_STATE') {
        sendResponse({ enabled, speed });
      } else if (msg.type === 'SET_ENABLED') {
        enabled = msg.value;
        saveSettings();
        if (!enabled) stopScroll();
        sendResponse({ ok: true });
      } else if (msg.type === 'SET_SPEED') {
        speed = msg.value;
        saveSettings();
        sendResponse({ ok: true });
      }
      return true;
    });

    // ── Key event helpers ─────────────────────────────────────────────────
    function isInputFocused() {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        el.isContentEditable
      );
    }

    function keyToDir(key) {
      switch (key.toLowerCase()) {
        case 'w': return 'w';
        case 'a': return 'a';
        case 's': return 's';
        case 'd': return 'd';
        default: return null;
      }
    }

    // ── Short-form / inner-scroll handling ────────────────────────────────
    // Why Instagram/TikTok didn't scroll: they lock <body> and scroll an
    // inner <div> (feed / reels viewer with scroll-snap). window.scrollBy()
    // is a no-op there, so we must scroll the inner container instead.
    // On vertical video feeds, W/S snap to prev/next video instead of
    // smooth pixel scrolling.
    function isShortFormRoute() {
      const host = location.hostname.toLowerCase();
      const p = location.pathname.toLowerCase();

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

    function isSnapNavActive() {
      if (isShortFormRoute()) return true;
      return looksLikeShortFormFeed();
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
      while (cur && cur !== document.body && cur !== document.documentElement) {
        let oy = '';
        try { oy = getComputedStyle(cur).overflowY; } catch { oy = ''; }
        if (
          (oy === 'auto' || oy === 'scroll' || oy === 'overlay' || cur.scrollHeight > cur.clientHeight + 10) &&
          cur.scrollHeight > cur.clientHeight + 10 &&
          cur.clientHeight > 100
        ) {
          return cur;
        }
        cur = cur.parentElement;
      }
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

    // ── Toggle shortcut: Alt + S ──────────────────────────────────────────
    let scrollTarget = null;

    document.addEventListener('keydown', (e) => {
      // Alt + S → toggle the extension
      if (e.altKey && e.key.toLowerCase() === 's') {
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

      // Prevent default browser behavior for WASD only when extension is active
      e.preventDefault();
      // Keep Instagram's own handlers from also acting on the key
      try { e.stopPropagation(); } catch {}
      if (typeof e.stopImmediatePropagation === 'function') {
        try { e.stopImmediatePropagation(); } catch {}
      }

      // On short-form video pages, W/S snap to prev/next video instead of pixel scroll
      if ((dir === 'w' || dir === 's') && !e.altKey && !e.ctrlKey && !e.metaKey && isSnapNavActive()) {
        keys.w = keys.s = false;
        if (!keys.a && !keys.d) stopScroll();
        stepReel(dir === 's' ? 1 : -1);
        return;
      }

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
        if (!t || !document.contains(t)) {
          t = scrollTarget = findScrollTarget();
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

      const toast = document.createElement('div');
      toast.className = `uiarc-toast uiarc-toast--${variant}`;

      // Accessibility (matching UIArc spec)
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.setAttribute('aria-atomic', 'true');

      // Lucide icons with draw animation
      // Checkmark for ON, X for OFF
      const iconOn = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="toast-icon-svg" aria-hidden="true"><path class="toast-draw" d="M20 6 9 17l-5-5"/></svg>`;
      const iconOff = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="toast-icon-svg" aria-hidden="true"><path class="toast-draw" d="M18 6 6 18M6 6l12 12"/></svg>`;

      toast.innerHTML = `
        <div class="toast-icon">${variant === 'on' ? iconOn : iconOff}</div>
        <div class="toast-content">
          <div class="toast-title">${title}</div>
          <div class="toast-sub">${sub}</div>
        </div>
        <button class="toast-close" aria-label="Dismiss notification">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      `;

      document.body.appendChild(toast);

      // Swipe to dismiss logic (Touch & Mouse)
      let startX = 0, currentX = 0, isDragging = false;

      function onPointerDown(e) {
        // Only track left clicks or touch
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        isDragging = true;
        startX = e.clientX;
        toast.style.transition = 'none';
        e.target.setPointerCapture(e.pointerId);
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

      toast.querySelector('.toast-close').onclick = () => dismiss();
      currentToast = { el: toast, dismiss };
    }

    // ── Init ──────────────────────────────────────────────────────────────
    loadSettings();
  },
});
