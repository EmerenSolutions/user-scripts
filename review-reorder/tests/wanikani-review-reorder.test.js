const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../src/wanikani-review-reorder.user.js'), 'utf8');
const item = (id, subject_category) => ({ id, subject_category });
const plain = value => JSON.parse(JSON.stringify(value));

function harness({ subjects = [item(3, 'Vocabulary'), item(2, 'Kanji'), item(1, 'Radical')], remaining = [], fetch, pathname = '/subjects/review', stats = [], conflict = false } = {}) {
  const windowEvents = new Map();
  const documentEvents = new Map();
  const timers = new Map();
  let timerId = 0;
  const classes = new Set(['character-header', 'character-header--vocabulary', 'custom-theme']);
  const header = { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
  const input = { inert: false };
  const responseInput = { value: '', focus() { this.focused = true; } };
  const notices = [];
  const element = { isConnected: true, dataset: { quizQueueItemsUrlValue: '/subjects' } };
  const inputController = { currentSubject: subjects[0] };
  const queue = {
    activeQueue: subjects.slice(0, 2), backlogQueue: subjects.slice(2), remainingIds: [...remaining],
    maxActiveQueueSize: 2, totalItems: subjects.length + remaining.length,
    stats: { toJSON: () => stats }, fetchingMoreItems: false,
    completeSubjectsInOrder: false, questionOrder: '',
    wrapUpManager: { wrappingUp: false, updateQueueSize(n) { this.size = n; } },
    nextItem() {
      this.nextCalls = (this.nextCalls || 0) + 1;
      this.currentItem = this.activeQueue[0];
      dispatch(windowEvents, 'willShowNextQuestion', { detail: { subject: this.currentItem, questionType: 'meaning' } });
    }
  };
  const controllers = new Map([[element, {quizQueue: queue}], [input, inputController], [header, {}]]);
  const document = {
    getElementById(id) { return id === 'quiz-queue' ? (element.isConnected ? element : null) : id === 'user-response' ? responseInput : null; },
    querySelector(selector) {
      if (selector.includes('quiz-header') || selector === '.character-header') return header;
      if (selector.includes('quiz-input')) return input;
      return null;
    },
    createElement() { return { style: {}, setAttribute() {}, remove() { this.removed = true; } }; },
    body: { appendChild(notice) { notices.push(notice); } },
    addEventListener(name, callback) { register(documentEvents, name, callback); }
  };
  const window = {
    Stimulus: { getControllerForElementAndIdentifier: node => controllers.get(node) },
    addEventListener(name, callback) { register(windowEvents, name, callback); }
  };
  if (conflict) window.wkQueue = {};
  const requests = [];
  const sandbox = {
    window, document, location: { pathname, href: `https://www.wanikani.com${pathname}`, origin: 'https://www.wanikani.com' },
    MutationObserver: class { observe() {} }, AbortController, URL, queueMicrotask,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    console: { warn() {} },
    fetch: async (url, options) => { requests.push({url, options}); return fetch ? fetch(url, options) : { ok: true, json: async () => [] }; }
  };
  vm.createContext(sandbox);
  // Expose the original functions for focused tests without changing the userscript API.
  const instrumented = source.replace('  scheduleScan();\n})();', '  globalThis.audit = { orderSubjects, syncHeader, scan };\n  scheduleScan();\n})();');
  vm.runInContext(instrumented, sandbox);
  return { sandbox, queue, element, input, responseInput, header, classes, notices, requests, timers, controllers,
    emit: (name, event = {}) => dispatch(windowEvents, name, event),
    navigate: (name, event = {}) => dispatch(documentEvents, name, event),
    flush: async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }
  };
}
function register(events, name, callback) {
  if (!events.has(name)) events.set(name, []);
  events.get(name).push(callback);
}
function dispatch(events, name, event) {
  for (const callback of events.get(name) || []) callback(event);
}

test('groups the whole queue, shuffles each group, and preserves every item', async () => {
  const h = harness({ pathname: '/dashboard' });
  const original = [item(1, 'Vocabulary'), item(2, 'Kanji'), item(3, 'Radical'), item(4, 'Kanji'), item(5, 'Vocabulary'), item(6, 'Radical')];
  const sorted = h.sandbox.audit.orderSubjects(original, () => 0);
  assert.deepEqual(plain(sorted.map(x => x.id)), [6, 3, 4, 2, 5, 1]);
  assert.deepEqual(original.map(x => x.id), [1, 2, 3, 4, 5, 6]);
  assert.throws(() => h.sandbox.audit.orderSubjects([item(1, 'Kanji'), item(1, 'Kanji')]));
  assert.throws(() => h.sandbox.audit.orderSubjects([item(1, 'Unknown')]));
  assert.deepEqual(plain(h.sandbox.audit.orderSubjects([])), []);
  await h.flush();
});

test('prepares once, keeps native state objects, and uses native meaning/retry controls', async () => {
  const h = harness();
  const stats = h.queue.stats;
  const wrap = h.queue.wrapUpManager;
  await h.flush();
  assert.deepEqual(plain(h.queue.activeQueue.map(x => x.id)), [1, 2]);
  assert.deepEqual(plain(h.queue.backlogQueue.map(x => x.id)), [3]);
  assert.equal(h.queue.completeSubjectsInOrder, true);
  assert.equal(h.queue.questionOrder, 'meaningFirst');
  assert.equal(h.queue.stats, stats);
  assert.equal(h.queue.wrapUpManager, wrap);
  assert.equal(wrap.size, 2);
  assert.equal(h.queue.totalItems, 3);
  assert.equal(h.queue.nextCalls, 1);
  assert.equal(h.input.inert, false);
  for (let i = 0; i < 5; i++) h.sandbox.audit.scan();
  assert.equal(h.queue.nextCalls, 1);
});

test('question events replace stale type colors without delayed writes', async () => {
  const h = harness();
  await h.flush();
  assert(h.classes.has('character-header--radical'));
  assert(!h.classes.has('character-header--vocabulary'));
  h.emit('willShowNextQuestion', {detail: {subject: item(2, 'Kanji')}});
  assert(h.classes.has('character-header--kanji'));
  assert(!h.classes.has('character-header--radical'));
  h.emit('willShowNextQuestion', {detail: {subject: item(3, 'Vocabulary')}});
  assert(h.classes.has('character-header--vocabulary'));
  assert(!h.classes.has('character-header--kanji'));
  assert(h.classes.has('custom-theme'));
  assert.equal(h.timers.size, 0);
});

test('loads missing items before sorting, including radicals beyond the initial batch', async () => {
  const h = harness({subjects: [item(1, 'Vocabulary')], remaining: [2, 3], fetch: async () => ({ok: true, json: async () => [item(3, 'Kanji'), item(2, 'Radical')]})});
  await h.flush();
  assert.equal(h.requests.length, 1);
  assert.equal(new URL(h.requests[0].url).searchParams.get('ids'), '2-3');
  assert.equal(h.requests[0].options.credentials, 'same-origin');
  assert.deepEqual(plain(h.queue.activeQueue.map(x => x.id)), [2, 3]);
  assert.deepEqual(plain(h.queue.backlogQueue.map(x => x.id)), [1]);
  assert.deepEqual(plain(h.queue.remainingIds), []);
});

test('blocks interaction until fetching finishes, then restores inert state', async () => {
  let finish;
  const h = harness({subjects: [item(1, 'Vocabulary')], remaining: [2], fetch: () => new Promise(resolve => { finish = resolve; })});
  await h.flush();
  assert.equal(h.input.inert, true);
  let prevented = false;
  h.emit('click', { target: {closest: () => true}, preventDefault() {prevented = true;}, stopImmediatePropagation() {} });
  assert(prevented);
  finish({ok: true, json: async () => [item(2, 'Radical')]});
  await h.flush();
  assert.equal(h.input.inert, false);
});

for (const failure of ['http', 'missing', 'duplicate', 'unknown']) {
  test(`fetch failure (${failure}) leaves the original queue and releases input`, async () => {
    const h = harness({subjects: [item(1, 'Vocabulary')], remaining: [2, 3], fetch: async () => ({
      ok: failure !== 'http', json: async () => failure === 'missing' ? [] : failure === 'duplicate' ? [item(2, 'Radical'), item(2, 'Radical')] : [item(2, 'Unknown'), item(3, 'Kanji')]
    })});
    const initial = h.queue.activeQueue;
    await h.flush();
    assert.equal(h.queue.activeQueue, initial);
    assert.equal(h.queue.nextCalls, undefined);
    assert.equal(h.input.inert, false);
    assert.match(h.notices[0].textContent, /paused/u);
  });
}

for (const reason of ['answered', 'completed', 'wrapup', 'conflict', 'typed']) {
  test(`does not reorder an unsafe session (${reason})`, async () => {
    const h = harness({conflict: reason === 'conflict'});
    if (reason === 'answered') h.emit('didAnswerQuestion');
    if (reason === 'completed') h.queue.totalItems += 1;
    if (reason === 'wrapup') h.queue.wrapUpManager.wrappingUp = true;
    if (reason === 'typed') h.responseInput.value = 'answer';
    await h.flush();
    assert.equal(h.queue.nextCalls, undefined);
    assert.equal(h.input.inert, false);
    assert.equal(h.queue.activeQueue[0].id, 3);
    assert.match(h.notices[0].textContent, /paused/u);
  });
}

test('navigation aborts pending work without modifying the outgoing queue', async () => {
  let finish;
  const h = harness({subjects: [item(1, 'Vocabulary')], remaining: [2], fetch: () => new Promise(resolve => { finish = resolve; })});
  await h.flush();
  h.navigate('turbo:before-render');
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.equal(h.input.inert, false);
  h.sandbox.audit.scan();
  finish({ok: true, json: async () => [item(2, 'Radical')]});
  await h.flush();
  assert.equal(h.queue.nextCalls, undefined);
  assert.equal(h.notices.length, 1);
});

test('rejects queue changes during asynchronous preparation', async () => {
  let finish;
  const h = harness({subjects: [item(1, 'Vocabulary')], remaining: [2], fetch: () => new Promise(resolve => { finish = resolve; })});
  await h.flush();
  h.emit('didAnswerQuestion');
  finish({ok: true, json: async () => [item(2, 'Radical')]});
  await h.flush();
  assert.equal(h.queue.nextCalls, undefined);
  assert.equal(h.queue.activeQueue[0].id, 1);
  assert.equal(h.input.inert, false);
});

test('waits for native controllers and times out without keeping input locked', async () => {
  const h = harness();
  h.controllers.delete(h.header);
  await h.flush();
  assert.equal(h.input.inert, true);
  assert.equal(h.queue.nextCalls, undefined);
  vm.runInContext('Date.now = () => Number.MAX_SAFE_INTEGER', h.sandbox);
  h.sandbox.audit.scan();
  assert.equal(h.input.inert, false);
  assert.match(h.notices[0].textContent, /did not become ready/u);
});

for (const pathname of ['/dashboard', '/subject-lessons/123/quiz', '/subjects/extra_study', '/recent-mistakes/123/quiz']) {
  test(`does nothing on ${pathname}`, async () => {
    const h = harness({pathname});
    await h.flush();
    assert.equal(h.queue.nextCalls, undefined);
    assert.equal(h.notices.length, 0);
    assert.equal(h.requests.length, 0);
  });
}

test('starts after dashboard-to-review Turbo navigation and keeps the active order on repeated loads', async () => {
  const h = harness({pathname: '/dashboard'});
  await h.flush();
  h.navigate('turbo:before-render');
  h.sandbox.location.pathname = '/subjects/review';
  h.sandbox.location.href = 'https://www.wanikani.com/subjects/review';
  h.sandbox.audit.scan();
  assert.equal(h.queue.nextCalls, undefined);
  h.navigate('turbo:load');
  await h.flush();
  assert.equal(h.queue.nextCalls, 1);
  h.navigate('turbo:load');
  await h.flush();
  assert.equal(h.queue.nextCalls, 1);
});

test('handles more than 100 missing subjects with bounded parallel requests', async () => {
  const pending = new Map();
  const remaining = Array.from({length: 205}, (_, index) => index + 2);
  const h = harness({subjects: [item(1, 'Vocabulary')], remaining, fetch: url => new Promise(resolve => {
    const ids = new URL(url).searchParams.get('ids').split('-').map(Number);
    pending.set(ids[0], () => resolve({ok: true, json: async () => ids.map(id => item(id, id === 206 ? 'Radical' : 'Vocabulary'))}));
  })});
  await h.flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.input.inert, true);
  pending.get(2)();
  await h.flush();
  assert.equal(h.requests.length, 3);
  pending.get(102)();
  pending.get(202)();
  await h.flush();
  assert.equal(h.queue.activeQueue[0].id, 206);
  const result = [...h.queue.activeQueue, ...h.queue.backlogQueue];
  assert.equal(result.length, 206);
  assert.equal(new Set(result.map(x => x.id)).size, 206);
  assert.equal(h.input.inert, false);
});

test('preserves an existing inert input and rejects a changed controller', async () => {
  let finish;
  const h = harness({subjects: [item(1, 'Vocabulary')], remaining: [2], fetch: () => new Promise(resolve => {finish = resolve;})});
  h.input.inert = true;
  await h.flush();
  h.controllers.set(h.element, {quizQueue: {...h.queue}});
  finish({ok: true, json: async () => [item(2, 'Radical')]});
  await h.flush();
  assert.equal(h.queue.nextCalls, undefined);
  assert.equal(h.input.inert, true);
  assert.match(h.notices[0].textContent, /replaced/u);
});
