'use strict';

/*
 * YouTube captions. Hovering a word in the captions draws a yellow underline
 * under it; clicking it opens the UWords panel and pauses the video until the
 * panel is closed. Hovering alone never pauses.
 *
 * Hit-testing is purely geometric (caption boxes and word rects), so it doesn't
 * depend on how the player sets up pointer-events or caption dragging, and it
 * works on any page that embeds the YouTube player.
 *
 * Loaded after content.js (uses globalThis.uwPage).
 */

(() => {
  const segments = document.getElementsByClassName('ytp-caption-segment');
  const WORD_RE = /[\p{L}\p{M}](?:[\p{L}\p{M}'’\-]*[\p{L}\p{M}])?/gu;
  const RESUME_DELAY = 300;
  const POLL_MS = 250;
  const POINTER_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'dragstart'];

  let pointer = null;        // last pointer position, viewport coords
  let frame = 0;
  let hover = null;          // { query, rect, segment } of the underlined word
  let overCaptions = false;
  let lookupOpen = false;    // the panel was opened from a caption word
  let pressing = false;      // a caption word is being pressed (pointerdown → click)
  let pausedVideo = null;    // the video we paused and should resume
  let gesture = null;        // { kind: 'word' | 'dismiss', hit } for the current press
  let resumeTimer = 0;
  let pollTimer = 0;
  let underline = null;
  let cursorEls = [];

  const settings = () => uwPage.settings;
  const enabled = () => uwPage.isActive() && settings().ytCaptions;

  function inRect(x, y, r, pad) {
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  // ---------- hit testing ----------

  function hitTest(x, y) {
    let over = false;
    for (const seg of Array.from(segments)) {
      const box = (seg.closest('.caption-window') || seg).getBoundingClientRect();
      if (!box.width || !inRect(x, y, box, 4)) continue;
      over = true;
      const word = wordInSegment(seg, x, y);
      if (word) return { over, ...word };
    }
    return { over, query: null };
  }

  function wordInSegment(seg, x, y) {
    if (!inRect(x, y, seg.getBoundingClientRect(), 2)) return null;
    const walker = document.createTreeWalker(seg, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      WORD_RE.lastIndex = 0;
      for (let m = WORD_RE.exec(node.data); m; m = WORD_RE.exec(node.data)) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const rect = Array.from(range.getClientRects()).find(r => inRect(x, y, r, 1));
        if (!rect) continue;
        const query = uwNormalizeQuery(m[0]);
        if (!uwIsWord(query)) return null;
        const { left, top, right, bottom, width, height } = rect;
        return { query, segment: seg, rect: { left, top, right, bottom, width, height } };
      }
    }
    return null;
  }

  function update() {
    frame = 0;
    if (!pointer || !enabled() || !segments.length) {
      setHover(null);
      setOver(false);
      return;
    }
    const hit = hitTest(pointer.x, pointer.y);
    setOver(hit.over);
    setHover(hit.query ? hit : null);
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  // ---------- underline ----------

  function sameWord(a, b) {
    return !!a && !!b && a.segment === b.segment && a.query === b.query &&
      Math.abs(a.rect.left - b.rect.left) < 1 && Math.abs(a.rect.top - b.rect.top) < 1;
  }

  function setHover(hit) {
    const isNew = !sameWord(hover, hit);
    hover = hit;
    setCursor(hit);
    if (!hit) {
      if (underline) underline.remove();
      return;
    }
    // Same word, same place: leave it alone (and don't restart the animation).
    if (!isNew && underline && underline.isConnected) return;
    const player = hit.segment.closest('.html5-video-player') || document.documentElement;
    if (!underline) {
      underline = document.createElement('uwords-underline');
      const style = {
        all: 'initial', display: 'block', position: 'absolute', left: '0px', top: '0px',
        height: '3px', 'border-radius': '2px', background: '#ffd400',
        'box-shadow': '0 0 6px rgba(255, 212, 0, .7)', 'pointer-events': 'none', 'z-index': '2147483646',
        'transform-origin': '50% 50%',
      };
      for (const [k, v] of Object.entries(style)) underline.style.setProperty(k, v, 'important');
    }
    if (underline.parentNode !== player) player.append(underline);
    // Measure where (0,0) ends up to convert viewport coords into the player's.
    const s = underline.style;
    s.setProperty('transition', 'none', 'important');
    s.setProperty('left', '0px', 'important');
    s.setProperty('top', '0px', 'important');
    s.setProperty('transform', 'none', 'important');
    const origin = underline.getBoundingClientRect();
    s.setProperty('left', `${hit.rect.left - origin.left}px`, 'important');
    s.setProperty('top', `${hit.rect.bottom - 2 - origin.top}px`, 'important');
    s.setProperty('width', `${hit.rect.width}px`, 'important');
    if (isNew) {
      // Entrance: grow from the middle of the word out to both ends.
      s.setProperty('transform', 'scaleX(0)', 'important');
      void underline.offsetWidth; // commit the start state before transitioning
      s.setProperty('transition', 'transform 160ms cubic-bezier(.2, .8, .2, 1)', 'important');
      s.setProperty('transform', 'scaleX(1)', 'important');
    }
  }

  function setCursor(hit) {
    for (const el of cursorEls) el.style.removeProperty('cursor');
    cursorEls = [];
    if (!hit) return;
    const win = hit.segment.closest('.caption-window');
    const player = hit.segment.closest('.html5-video-player');
    cursorEls = [hit.segment, win, player].filter(Boolean);
    for (const el of cursorEls) el.style.setProperty('cursor', 'pointer', 'important');
  }

  // ---------- playback ----------

  function videoFor(segment) {
    const player = segment && segment.closest('.html5-video-player');
    return (player || document).querySelector('video');
  }

  function wantPaused() {
    return (lookupOpen || pressing) && settings().ytPauseOnLookup;
  }

  // Prefer YouTube's own player API (keeps its UI/state machine in sync); fall
  // back to the <video> element on other players.
  function playerApi(video) {
    const player = video.closest('.html5-video-player');
    const api = player && player.wrappedJSObject;
    return api && typeof api.pauseVideo === 'function' && typeof api.playVideo === 'function' ? api : null;
  }

  function pauseVideo(video) {
    try { const api = playerApi(video); if (api) api.pauseVideo(); } catch (e) { /* use the element */ }
    if (!video.paused) video.pause();
  }

  function playVideo(video) {
    try { const api = playerApi(video); if (api) { api.playVideo(); return; } } catch (e) { /* use the element */ }
    video.play().catch(() => {});
  }

  function syncPlayback() {
    clearTimeout(resumeTimer);
    if (wantPaused()) {
      const video = videoFor(hover ? hover.segment : segments[0]);
      if (video && !video.paused && !pausedVideo) {
        pausedVideo = video;
        pauseVideo(video);
        // If the user starts playback themselves, it's no longer ours to resume.
        video.addEventListener('play', () => { if (pausedVideo === video) pausedVideo = null; }, { once: true });
      }
    } else if (pausedVideo) {
      // Small delay so crossing the captions (e.g. on the way to the controls)
      // doesn't stutter the video.
      resumeTimer = setTimeout(() => {
        if (wantPaused() || !pausedVideo) return;
        const video = pausedVideo;
        pausedVideo = null;
        if (video.paused) playVideo(video);
      }, RESUME_DELAY);
    }
  }

  function setOver(over) {
    if (over === overCaptions) return;
    overCaptions = over;
    clearInterval(pollTimer);
    // Captions change under a still pointer; keep the underline in sync.
    if (over) pollTimer = setInterval(schedule, POLL_MS);
  }

  // ---------- events ----------

  window.addEventListener('mousemove', e => {
    if (!segments.length && !overCaptions && !hover) return;
    pointer = { x: e.clientX, y: e.clientY };
    schedule();
  }, { capture: true, passive: true });

  window.addEventListener('mouseout', e => {
    if (e.relatedTarget) return; // still inside the page
    pointer = null;
    schedule();
  }, true);

  // Runs before any page listener: a press on a caption word must neither toggle
  // playback nor start dragging the caption box. While a lookup panel is open,
  // pressing on the player only closes the panel.
  function onPointerEvent(e) {
    const now = performance.now();
    if (gesture && gesture.endAt && now > gesture.endAt) gesture = null;
    if (e.type === 'pointerdown' || (e.type === 'mousedown' && !gesture)) gesture = classify(e);
    if (!gesture) return;
    // Note: preventDefault() on pointerdown also suppresses the compatibility
    // mousedown/mouseup events (but not click).
    e.preventDefault();
    e.stopImmediatePropagation();
    if (gesture.kind === 'dismiss' && uwPage.isOpen) uwPage.close();
    if (gesture.kind === 'word' && e.type === 'pointerdown') {
      // Stop the video the moment a word is pressed, not only once the panel opens.
      pressing = true;
      syncPlayback();
    }
    if (e.type === 'pointerup') {
      // Pressed but released elsewhere (no click): let playback resume.
      setTimeout(() => { if (pressing) { pressing = false; syncPlayback(); } }, 0);
    }
    if (e.type === 'click') {
      if (gesture.kind === 'word') lookUp(gesture.hit);
      // Keep swallowing briefly so a double-click doesn't reach the player
      // (YouTube toggles fullscreen on dblclick).
      gesture.endAt = now + 500;
    }
  }

  function classify(e) {
    if (e.button !== 0 || !enabled() || uwPage.contains(e)) return null;
    if (segments.length) {
      const hit = hitTest(e.clientX, e.clientY);
      if (hit.query) return { kind: 'word', hit };
    }
    const inPlayer = e.target instanceof Element && e.target.closest('.html5-video-player');
    if (lookupOpen && uwPage.isOpen && inPlayer) return { kind: 'dismiss' };
    return null;
  }

  for (const type of POINTER_EVENTS) window.addEventListener(type, onPointerEvent, true);

  let lastQuery = '';

  function lookUp(hit) {
    if (lookupOpen && uwPage.isOpen && hit.query === lastQuery) return; // 2nd click of a double-click
    lastQuery = hit.query;
    lookupOpen = true;
    pressing = false;
    // Anchor to the whole caption box vertically so the panel never covers the
    // other caption line.
    const box = (hit.segment.closest('.caption-window') || hit.segment).getBoundingClientRect();
    uwPage.open(hit.query, { left: hit.rect.left, right: hit.rect.right, top: box.top, bottom: box.bottom });
    syncPlayback();
  }

  uwPage.onClose(() => {
    if (!lookupOpen) return;
    lookupOpen = false;
    syncPlayback();
  });
})();
