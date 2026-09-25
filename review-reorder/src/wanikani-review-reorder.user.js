// ==UserScript==
// @name         Wanikani Review Reorder
// @namespace    https://github.com/EmerenSolutions/user-scripts
// @version      0.1.0
// @description  Random reviews grouped by radicals, kanji, and vocabulary, with meaning first and immediate retries
// @author       Johan Emerén
// @copyright    2026, Johan Emerén
// @license      MIT
// @match        https://www.wanikani.com/*
// @match        https://preview.wanikani.com/*
// @grant        none
// @run-at       document-start
// @noframes
// @downloadURL  https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/review-reorder/src/wanikani-review-reorder.user.js
// @updateURL    https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/review-reorder/src/wanikani-review-reorder.user.js
// ==/UserScript==

(() => {
  'use strict';

  // Installable build 1. WaniKani owns answer checking, retry statistics,
  // completion requests, and wrap-up; this script only prepares the order.
  const SCRIPT_ID = 'wanikani_review_reorder';
  if (window[SCRIPT_ID]) return;
  window[SCRIPT_ID] = true;

  const COLORS = ['radical', 'kanji', 'vocabulary'];
  const REVIEW_PATH = /^\/subjects\/review\/?$/u;
  const answered = new WeakSet();
  let session = null;
  let scanPending = false;
  let navigating = false;

  const isReview = () => REVIEW_PATH.test(location.pathname);
  const category = subject => {
    const value = subject?.subject_category?.toLowerCase();
    if (!COLORS.includes(value)) throw new Error('Unrecognized review item type.');
    return value;
  };

  const orderSubjects = (subjects, random = Math.random) => {
    const groups = COLORS.map(() => []);
    const ids = new Set();
    for (const subject of subjects) {
      if (!Number.isSafeInteger(subject?.id) || subject.id <= 0 || ids.has(subject.id)) {
        throw new Error('Invalid or duplicate review item.');
      }
      ids.add(subject.id);
      groups[COLORS.indexOf(category(subject))].push(subject);
    }
    for (const group of groups) {
      for (let index = group.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        [group[index], group[other]] = [group[other], group[index]];
      }
    }
    return groups.flat();
  };

  const syncHeader = (header, subject) => {
    const selected = `character-header--${category(subject)}`;
    // Remove the server-rendered class as well as any previous question class.
    // Preserve every unrelated header class and let WK render the characters.
    for (const color of COLORS) {
      const name = `character-header--${color}`;
      if (name !== selected) header.classList.remove(name);
    }
    header.classList.add(selected);
  };

  const controller = (element, name) =>
    element && window.Stimulus?.getControllerForElementAndIdentifier(element, name);

  const isCurrent = state => session === state && !state.abort.signal.aborted
    && isReview() && state.element.isConnected
    && document.getElementById('quiz-queue') === state.element;

  const showStatus = (state, message) => {
    if (!isCurrent(state)) return;
    if (!state.notice) {
      state.notice = document.createElement('div');
      state.notice.id = `${SCRIPT_ID}_status`;
      state.notice.setAttribute('role', 'status');
      Object.assign(state.notice.style, {
        position: 'fixed', bottom: '1rem', left: '50%', transform: 'translateX(-50%)',
        zIndex: '10000', padding: '0.6rem 1rem', borderRadius: '0.4rem',
        background: '#222', color: '#fff', font: '14px system-ui',
        maxWidth: 'calc(100vw - 2rem)', boxSizing: 'border-box'
      });
      document.body.appendChild(state.notice);
    }
    state.notice.textContent = message;
  };

  const lockInput = state => {
    const input = document.querySelector('[data-controller~="quiz-input"]');
    if (input && !state.locks.has(input)) {
      state.locks.set(input, input.inert);
      input.inert = true;
    }
  };

  const unlockInput = state => {
    for (const [element, previous] of state.locks) element.inert = previous;
    state.locks.clear();
  };

  const stop = () => {
    if (!session) return;
    session.abort.abort();
    clearTimeout(session.timer);
    unlockInput(session);
    session.notice?.remove();
    session = null;
  };

  const fail = (state, error) => {
    if (!isCurrent(state)) return;
    state.phase = 'failed';
    state.abort.abort();
    unlockInput(state);
    // showStatus requires a live signal; update the already visible notice.
    if (state.notice) state.notice.textContent = `Review Reorder paused: ${error.message} Reload to retry.`;
    console.warn('Wanikani Review Reorder:', error);
  };

  const queueIds = queue => [
    ...queue.activeQueue.map(subject => subject.id),
    ...queue.backlogQueue.map(subject => subject.id),
    ...queue.remainingIds
  ];

  const assertUntouched = (state, queue, ids) => {
    if (answered.has(state.element) || queue.stats.toJSON().length
      || queue.totalItems !== ids.length
      || queue.fetchingMoreItems || queue.wrapUpManager.wrappingUp
      || JSON.stringify(queueIds(queue)) !== JSON.stringify(ids)) {
      throw new Error('The review session has already changed.');
    }
  };

  const readSubjects = async (state, queue, ids) => {
    const known = new Map([...queue.activeQueue, ...queue.backlogQueue].map(item => [item.id, item]));
    const missing = ids.filter(id => !known.has(id));
    const endpoint = state.element.dataset.quizQueueItemsUrlValue;
    if (typeof endpoint !== 'string' || !endpoint) throw new Error('Missing review items URL.');
    const url = new URL(endpoint, location.href);
    if (url.origin !== location.origin || !/^https:$/u.test(url.protocol)) {
      throw new Error('Unsupported review items URL.');
    }
    let cursor = 0;
    // Fetch only the IDs in this review session, in small bounded batches.
    const worker = async () => {
      while (cursor < missing.length) {
        const batch = missing.slice(cursor, cursor += 100);
        const request = new URL(url);
        request.searchParams.set('ids', batch.join('-'));
        const abort = new AbortController();
        const cancel = () => abort.abort();
        state.abort.signal.addEventListener('abort', cancel, { once: true });
        if (state.abort.signal.aborted) cancel();
        const timer = setTimeout(cancel, 15000);
        try {
          const response = await fetch(request.href, { credentials: 'same-origin', signal: abort.signal });
          if (!response.ok) throw new Error('Could not load review items.');
          const data = await response.json();
          const expected = new Set(batch);
          if (!Array.isArray(data) || data.length !== batch.length) throw new Error('Incomplete review item data.');
          for (const item of data) {
            if (!expected.delete(item.id)) throw new Error('Unexpected review item data.');
            category(item);
            known.set(item.id, item);
          }
        } finally {
          clearTimeout(timer);
          state.abort.signal.removeEventListener('abort', cancel);
        }
      }
    };
    await Promise.all([worker(), worker()]);
    return ids.map(id => known.get(id));
  };

  const prepare = async (state, queue) => {
    try {
      if (window.wkQueue) throw new Error('Disable Reorder Omega or other queue scripts first.');
      const ids = queueIds(queue);
      if (!ids.length) {
        state.phase = 'done';
        unlockInput(state);
        state.notice?.remove();
        return;
      }
      if (new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
        throw new Error('Unsupported review queue.');
      }
      assertUntouched(state, queue, ids);
      if (document.getElementById('user-response')?.value?.trim()) {
        throw new Error('An answer has already been entered.');
      }
      const ordered = orderSubjects(await readSubjects(state, queue, ids));
      if (!isCurrent(state)) return;
      if (controller(state.element, 'quiz-queue')?.quizQueue !== queue) {
        throw new Error('The review queue was replaced.');
      }
      assertUntouched(state, queue, ids);

      // One synchronous handoff before answering. Keep the existing queue,
      // statistics, SRS manager, API instance, and all controller listeners.
      queue.activeQueue = ordered.slice(0, queue.maxActiveQueueSize);
      queue.backlogQueue = ordered.slice(queue.maxActiveQueueSize);
      queue.remainingIds = [];
      queue.completeSubjectsInOrder = true;
      queue.questionOrder = 'meaningFirst';
      queue.wrapUpManager.updateQueueSize(queue.activeQueue.length);
      state.phase = 'active';
      queue.nextItem();
      unlockInput(state);
      state.notice?.remove();
      document.getElementById('user-response')?.focus();
    } catch (error) {
      fail(state, error);
    }
  };

  const scan = () => {
    if (navigating || !isReview()) { stop(); return; }
    const element = document.getElementById('quiz-queue');
    if (!element) { if (session) stop(); return; }
    if (session?.element !== element) {
      stop();
      session = {
        element, phase: 'waiting', abort: new AbortController(), locks: new Map(),
        started: Date.now(), timer: null, notice: null
      };
      showStatus(session, 'Preparing reviews: radicals → kanji → vocabulary…');
    }
    const state = session;
    if (!['waiting', 'loading'].includes(state.phase)) return;
    lockInput(state);
    if (state.phase === 'loading') return;
    const queue = controller(element, 'quiz-queue')?.quizQueue;
    const headerElement = document.querySelector('[data-controller~="quiz-header"]');
    const inputElement = document.querySelector('[data-controller~="quiz-input"]');
    const ready = queue && controller(headerElement, 'quiz-header')
      && controller(inputElement, 'quiz-input')?.currentSubject;
    if (ready) {
      if (!Array.isArray(queue.activeQueue) || !Array.isArray(queue.backlogQueue)
        || !Array.isArray(queue.remainingIds) || typeof queue.stats?.toJSON !== 'function'
        || !Number.isSafeInteger(queue.maxActiveQueueSize) || queue.maxActiveQueueSize < 1
        || typeof queue.wrapUpManager?.updateQueueSize !== 'function'
        || typeof queue.nextItem !== 'function') {
        fail(state, new Error('WaniKani’s review interface has changed.'));
        return;
      }
      state.phase = 'loading';
      prepare(state, queue);
    } else if (Date.now() - state.started >= 10000) {
      fail(state, new Error('WaniKani’s review interface did not become ready.'));
    } else {
      clearTimeout(state.timer);
      state.timer = setTimeout(scan, 50);
    }
  };

  const scheduleScan = () => {
    if (scanPending) return;
    scanPending = true;
    queueMicrotask(() => { scanPending = false; scan(); });
  };

  window.addEventListener('willShowNextQuestion', event => {
    if (!isReview()) return;
    if (session?.phase === 'active' && isCurrent(session)) {
      const header = document.querySelector('.character-header');
      if (header) syncHeader(header, event.detail.subject);
    }
    scheduleScan();
  }, true);

  window.addEventListener('didAnswerQuestion', () => {
    if (!isReview()) return;
    const element = document.getElementById('quiz-queue');
    if (element) answered.add(element);
  }, true);

  // Inert handles user interaction; capture also blocks synthetic button clicks
  // from auto-commit scripts while the initial order is being prepared.
  for (const type of ['click', 'keydown', 'beforeinput', 'submit']) {
    window.addEventListener(type, event => {
      if (!isReview() || (session && !['waiting', 'loading'].includes(session.phase))) return;
      if (event.target?.closest?.('[data-controller~="quiz-input"], .quiz-input')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  const suspend = () => { navigating = true; stop(); };
  const resume = () => { navigating = false; scheduleScan(); };
  document.addEventListener('turbo:before-cache', suspend);
  document.addEventListener('turbo:before-render', suspend);
  document.addEventListener('turbo:load', resume);
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', resume);
  window.addEventListener('popstate', resume);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document, { childList: true, subtree: true });
  scheduleScan();
})();
