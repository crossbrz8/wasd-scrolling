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

    // ── Toggle shortcut: Alt + S ──────────────────────────────────────────
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
        window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
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
