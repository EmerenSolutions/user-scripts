const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../src/wanikani-safe-auto-commit.user.js'), 'utf8');
const subject = (id, meaning) => ({ id, data: { meanings: [{ meaning, accepted_answer: true }] } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function harness({ items = async () => [], api = async () => ({ data: [] }) } = {}) {
  const events = new Map();
  const timers = new Map();
  let timerId = 0;
  const input = { value: '', dataset: {}, addEventListener() {} };
  const container = { correct: null, getAttribute() { return this.correct; } };
  const controller = { currentSubject: null, currentQuestionType: 'meaning' };
  const element = {};
  const button = { isConnected: true, disabled: false, clicks: 0,
    click() { this.clicks++; this.onClick?.(); } };
  const nodes = new Map([
    ['#user-response', input], ['.quiz-input__submit-button', button],
    ['[data-quiz-input-target="inputContainer"]', container],
    ['[data-controller~="quiz-input"]', element]
  ]);
  const register = (name, callback) => {
    if (!events.has(name)) events.set(name, []);
    events.get(name).push(callback);
  };
  const wkof = {
    include() {}, ready: async () => {},
    settings: { wanikani_safe_auto_commit: { showToggleButton: false } },
    Settings: { load: async () => {}, save: async () => {} },
    ItemData: { get_items: items }, Apiv2: { fetch_endpoint: api }
  };
  const window = { wkof, addEventListener: register,
    Stimulus: { getControllerForElementAndIdentifier: () => controller },
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); }, requestAnimationFrame(fn) { fn(); }
  };
  const errors = [];
  const sandbox = { window, document: { querySelector: selector => nodes.get(selector) || null,
    addEventListener: register }, location: { pathname: '/subjects/review' },
    setTimeout: window.setTimeout, console: { warn() {}, error(...args) { errors.push(args); } } };
  vm.createContext(sandbox);
  vm.runInContext(source.replace('  startup();', '  globalThis.audit = { checkAnswer, saveSettings };\n  startup();'), sandbox);
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const emit = (name, detail) => { for (const fn of events.get(name) || []) fn({ detail }); };
  const show = (item, questionType = 'meaning') => {
    controller.currentSubject = item;
    controller.currentQuestionType = questionType;
    input.value = '';
    container.correct = null;
    emit('willShowNextQuestion', { subject: item, questionType });
  };
  const answer = value => { input.value = value; sandbox.audit.checkAnswer(); };
  const run = delay => {
    const pending = [...timers].filter(([, timer]) => timer.delay === delay);
    for (const [id, timer] of pending) { timers.delete(id); timer.fn(); }
  };
  await flush();
  return { show, emit, answer, run, flush, input, button, container, controller, nodes, sandbox, wkof, errors };
}

test('a late ItemData answer cannot overwrite the next question', async () => {
  const pending = deferred();
  const h = await harness({ items: () => pending.promise });
  h.show({ id: 1 });
  await h.flush();
  h.show(subject(2, 'two'));
  pending.resolve([subject(1, 'one')]);
  await h.flush();
  h.answer('one');
  assert.equal(h.button.clicks, 0);
  h.answer('two');
  assert.equal(h.button.clicks, 1);
});

test('a late API answer cannot overwrite the next question or question type', async () => {
  const pending = deferred();
  const h = await harness({ api: () => pending.promise });
  h.show({ id: 1 });
  await h.flush();
  h.show({ id: 1, data: { readings: [{ reading: 'いち', accepted_answer: true }] } }, 'reading');
  pending.resolve({ data: [subject(1, 'one')] });
  await h.flush();
  h.answer('one');
  assert.equal(h.button.clicks, 0);
  h.answer('いち');
  assert.equal(h.button.clicks, 1);
});

for (const boundary of ['turbo:before-render', 'turbo:load', 'turbo:render', 'popstate', 'settings']) {
  test(`pending lookups are invalidated on ${boundary}`, async () => {
    const pending = deferred();
    const h = await harness({ items: () => pending.promise });
    h.show({ id: 1 });
    await h.flush();
    if (boundary === 'settings') await h.sandbox.audit.saveSettings();
    else h.emit(boundary);
    pending.resolve([subject(1, 'one')]);
    await h.flush();
    h.answer('one');
    assert.equal(h.button.clicks, 0);
  });
}

test('a stale lookup rejection does not fail the active question', async () => {
  const pending = deferred();
  const h = await harness({ items: () => pending.promise });
  h.show({ id: 1 });
  await h.flush();
  h.show(subject(2, 'two'));
  pending.reject(new Error('old lookup failed'));
  await h.flush();
  h.answer('two');
  assert.equal(h.errors.length, 0);
  assert.equal(h.button.clicks, 1);
});

for (const correct of [null, 'false', 'true']) {
  test(`advance requires the native correct state (${correct})`, async () => {
    const h = await harness();
    h.show(subject(1, 'one'));
    h.button.onClick = () => { h.container.correct = correct; };
    h.answer('one');
    h.run(80);
    assert.equal(h.button.clicks, correct === 'true' ? 2 : 1);
  });
}

for (const change of ['next-event', 'same-question-event', 'native-subject', 'native-type', 'controller', 'input', 'button', 'container', 'detached', 'disabled', 'value', 'paused', 'settings', 'navigation']) {
  test(`advance is cancelled after ${change} changes`, async () => {
    const h = await harness();
    h.show(subject(1, 'one'));
    h.button.onClick = () => { h.container.correct = 'true'; };
    h.answer('one');
    if (change === 'next-event') h.show(subject(2, 'two'));
    if (change === 'same-question-event') h.show(subject(1, 'one'));
    if (change === 'native-subject') h.controller.currentSubject = subject(2, 'two');
    if (change === 'native-type') h.controller.currentQuestionType = 'reading';
    if (change === 'controller') h.sandbox.window.Stimulus.getControllerForElementAndIdentifier = () => ({ ...h.controller });
    if (change === 'input') h.nodes.set('#user-response', { ...h.input });
    if (change === 'button') h.nodes.set('.quiz-input__submit-button', { ...h.button });
    if (change === 'container') h.nodes.set('[data-quiz-input-target="inputContainer"]', { ...h.container });
    if (change === 'detached') h.button.isConnected = false;
    if (change === 'disabled') h.button.disabled = true;
    if (change === 'value') h.input.value = 'changed';
    if (change === 'paused' || change === 'settings') {
      h.wkof.settings.wanikani_safe_auto_commit[change === 'paused' ? 'enabled' : 'autoAdvance'] = false;
      await h.sandbox.audit.saveSettings();
    }
    if (change === 'navigation') h.emit('turbo:before-render');
    h.run(80);
    assert.equal(h.button.clicks, 1);
  });
}

test('missing native controller allows submission but never automatic advance', async () => {
  const h = await harness();
  h.show(subject(1, 'one'));
  h.sandbox.window.Stimulus = undefined;
  h.button.onClick = () => { h.container.correct = 'true'; };
  h.answer('one');
  h.run(80);
  assert.equal(h.button.clicks, 1);
});

test('already graded answers and native question mismatches are not submitted', async () => {
  const h = await harness();
  h.show(subject(1, 'one'));
  h.container.correct = 'true';
  h.answer('one');
  h.container.correct = 'false';
  h.answer('one');
  h.container.correct = null;
  h.controller.currentSubject = subject(2, 'two');
  h.answer('one');
  assert.equal(h.button.clicks, 0);
});

test('overlapping input checks submit and advance only once', async () => {
  const h = await harness();
  h.show(subject(1, 'one'));
  h.button.onClick = () => { h.container.correct = 'true'; };
  h.answer('one');
  h.answer('one');
  h.run(80);
  h.run(500);
  h.answer('one');
  assert.equal(h.button.clicks, 2);
});

for (const fallback of ['ItemData', 'API']) {
  test(`the active question can still submit answers from ${fallback}`, async () => {
    const h = await harness({
      items: async () => fallback === 'ItemData' ? [subject(1, 'one')] : [],
      api: async () => ({ data: [subject(1, 'one')] })
    });
    h.show({ id: 1 });
    await h.flush();
    h.answer('one');
    assert.equal(h.button.clicks, 1);
  });
}

test('a stale empty ItemData result does not start another API lookup', async () => {
  const pending = deferred();
  let apiCalls = 0;
  const h = await harness({ items: () => pending.promise, api: async () => { apiCalls++; return { data: [] }; } });
  h.show({ id: 1 });
  await h.flush();
  h.show(subject(2, 'two'));
  pending.resolve([]);
  await h.flush();
  assert.equal(apiCalls, 0);
  h.answer('two');
  assert.equal(h.button.clicks, 1);
});
