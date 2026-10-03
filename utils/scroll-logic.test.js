import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEED,
  MESSAGE_TYPES,
  clampSpeed,
  isShortFormRoute,
  keyToDir,
  shouldHandleMessage,
} from './scroll-logic.js';

describe('keyToDir', () => {
  it.each([['w', 'w'], ['W', 'w'], ['a', 'a'], ['A', 'a'], ['s', 's'], ['S', 's'], ['d', 'd'], ['D', 'd']])(
    'maps %s to %s',
    (input, expected) => expect(keyToDir(input)).toBe(expected),
  );

  it.each([['q'], ['Enter'], [' '], ['ArrowUp'], ['wasd']])('rejects %s', (input) => {
    expect(keyToDir(input)).toBeNull();
  });

  // Synthetic events from page scripts / automation may carry no key string
  it.each([[undefined], [null], [''], [{}], [[1]]])('ignores non-string key %s', (input) => {
    expect(keyToDir(input)).toBeNull();
  });
});

describe('isShortFormRoute', () => {
  it.each([
    // TikTok vertical feeds
    ['www.tiktok.com', '/foryou', true],
    ['www.tiktok.com', '/following', true],
    ['www.tiktok.com', '/@user/video/123', true],
    ['www.tiktok.com', '/', true],
    // TikTok exclusions where pixel scroll wins
    ['www.tiktok.com', '/search?q=cats', false],
    ['www.tiktok.com', '/settings', false],
    ['www.tiktok.com', '/messages', false],
    ['www.tiktok.com', '/upload', false],
    // YouTube
    ['www.youtube.com', '/shorts/abc', true],
    ['www.youtube.com', '/watch?v=abc', false],
    ['youtu.be', '/shorts/abc', true],
    // Instagram / Facebook
    ['www.instagram.com', '/reels/', true],
    ['www.instagram.com', '/reel/abc/', true],
    ['www.instagram.com', '/', false],
    ['www.facebook.com', '/reel/abc', true],
    ['www.facebook.com', '/', false],
    // Generic routes
    ['example.com', '/shorts/abc', true],
    ['www.snapchat.com', '/spotlight/abc', true],
    ['example.com', '/', false],
    ['example.com', '/articles/long-read', false],
  ])('%s%s -> %s', (host, path, expected) => {
    expect(isShortFormRoute(host, path)).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(isShortFormRoute('WWW.TIKTOK.COM', '/FORYOU')).toBe(true);
    expect(isShortFormRoute('WWW.YOUTUBE.COM', '/SHORTS/ABC')).toBe(true);
  });
});

describe('clampSpeed', () => {
  it('passes through in-range values', () => {
    expect(clampSpeed(8)).toBe(8);
    expect(clampSpeed(2)).toBe(2);
    expect(clampSpeed(30)).toBe(30);
  });

  it('clamps out-of-range values', () => {
    expect(clampSpeed(1)).toBe(2);
    expect(clampSpeed(100)).toBe(30);
  });

  it('accepts numeric strings like the old Number() path did', () => {
    expect(clampSpeed('10')).toBe(10);
  });

  it.each([[NaN], [Infinity], [undefined], ['fast'], [{}]])(
    'returns null for non-numeric %s',
    (input) => expect(clampSpeed(input)).toBeNull(),
  );

  it('null input coerces to 0 and clamps to min (documents Number(null) edge)', () => {
    // Number(null) === 0 — callers must not treat this as a real speed.
    // Kept explicit so a future strictness change updates this test first.
    expect(clampSpeed(null)).toBe(2);
  });
});

describe('shouldHandleMessage', () => {
  const RUNTIME_ID = 'test-runtime-id';

  it.each([['GET_STATE'], ['SET_ENABLED'], ['SET_SPEED']])('accepts %s from the popup', (type) => {
    expect(shouldHandleMessage({ type }, { id: RUNTIME_ID }, RUNTIME_ID)).toBe(true);
  });

  it('accepts messages with no sender (extension-internal delivery)', () => {
    expect(shouldHandleMessage({ type: 'GET_STATE' }, undefined, RUNTIME_ID)).toBe(true);
  });

  it('rejects foreign sender ids', () => {
    expect(shouldHandleMessage({ type: 'GET_STATE' }, { id: 'evil-id' }, RUNTIME_ID)).toBe(false);
  });

  it.each([[null], [undefined], ['GET_STATE'], [42]])('rejects non-object message %s', (msg) => {
    expect(shouldHandleMessage(msg, { id: RUNTIME_ID }, RUNTIME_ID)).toBe(false);
  });

  it('rejects unknown types', () => {
    expect(shouldHandleMessage({ type: 'DELETE_EVERYTHING' }, { id: RUNTIME_ID }, RUNTIME_ID)).toBe(
      false,
    );
  });

  it('exposes the allowlist', () => {
    expect(MESSAGE_TYPES).toEqual(['GET_STATE', 'SET_ENABLED', 'SET_SPEED']);
    expect(DEFAULT_SPEED).toBe(8);
  });
});
