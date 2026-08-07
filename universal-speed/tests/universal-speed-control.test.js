const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SCRIPT_PATH = path.resolve(
  __dirname,
  '..',
  'src',
  'universal-speed-control.user.js'
);
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');

const DEFAULT_SETTINGS = {
  speed: 2,
  setInterval: true,
  setTimeout: true,
  performanceNow: true,
  dateNow: true,
  requestAnimationFrame: true
};

test('limits injection to itch.io and CrazyGames pages', () => {
  const matches = [...SCRIPT_SOURCE.matchAll(/^\/\/ @match\s+(.+)$/gm)]
    .map(match => match[1]);

  assert.deepEqual(matches, [
    'https://itch.io/*',
    'https://*.itch.io/*',
    'https://html-classic.itch.zone/*',
    'https://crazygames.com/*',
    'https://*.crazygames.com/*'
  ]);
  assert.doesNotMatch(SCRIPT_SOURCE, /Alt\+Shift|KeyS/);
});

const createHarness = (initialSettings = DEFAULT_SETTINGS, options = {}) => {
  const timerTasks = new Map();
  const frameTasks = new Map();
  const listeners = new Map();
  const documentListeners = new Map();
  let nextNativeId = 1;
  let realTime = 0;

  class FakeDate extends Date {}
  FakeDate.now = () => 1_700_000_000_000 + realTime;

  class FakeElement {
    constructor(innerText = '') {
      this.id = '';
      this.innerText = innerText;
      this.textContent = innerText;
      this.parentElement = null;
      this.isConnected = true;
      this.isContentEditable = false;
      this.style = { outline: '', outlineOffset: '' };
    }

    matches() {
      return false;
    }
  }

  const context = {
    console,
    Date: FakeDate,
    document: {
      documentElement: {},
      activeElement: null,
      getElementById: () => ({}),
      querySelectorAll: () => options.frames || [],
      addEventListener(type, callback) {
        if (!documentListeners.has(type)) documentListeners.set(type, new Set());
        documentListeners.get(type).add(callback);
      },
      removeEventListener(type, callback) {
        documentListeners.get(type)?.delete(callback);
      }
    },
    Element: FakeElement,
    eval,
    JSON,
    Math,
    Number,
    Object,
    Reflect,
    String,
    Symbol,
    TypeError,
    localStorage: {
      getItem() {
        return initialSettings === null ? null : JSON.stringify(initialSettings);
      },
      setItem() {}
    },
    performance: {
      now: () => realTime
    },
    setTimeout(callback, delay) {
      const id = nextNativeId;
      nextNativeId += 1;
      timerTasks.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timerTasks.delete(id);
    },
    setInterval(callback, delay) {
      const id = nextNativeId;
      nextNativeId += 1;
      timerTasks.set(id, { callback, delay, interval: true });
      return id;
    },
    clearInterval(id) {
      timerTasks.delete(id);
    },
    requestAnimationFrame(callback) {
      const id = nextNativeId;
      nextNativeId += 1;
      frameTasks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frameTasks.delete(id);
    },
    addEventListener(type, callback) {
      listeners.set(type, callback);
    }
  };

  context.window = context;
  context.parent = options.parentWindow || context;
  context.top = options.parentWindow || context;

  const scriptSource = options.exposeInternals
    ? SCRIPT_SOURCE.replace(
      /\n\}\)\(\);\s*$/,
      '\n  window.__universalSpeedTest = { beginCounterDetection, cancelCounterDetection, applyDetectedMethod, detectionState };\n})();'
    )
    : SCRIPT_SOURCE;
  vm.runInNewContext(scriptSource, context, { filename: SCRIPT_PATH });

  return {
    context,
    advance(milliseconds) {
      realTime += milliseconds;
    },
    dispatchStorage(settings) {
      listeners.get('storage')({
        key: 'emeren.universal-speed-control.settings.v1',
        newValue: JSON.stringify(settings)
      });
    },
    dispatchMessage(source, data) {
      listeners.get('message')({ source, data });
    },
    dispatchDocument(type, event) {
      const callbacks = [...(documentListeners.get(type) || [])];
      callbacks.forEach(callback => callback(event));
    },
    fireFrame(timestamp = realTime) {
      const callbacks = [...frameTasks.values()];
      frameTasks.clear();
      callbacks.forEach(callback => callback(timestamp));
    },
    fireTimer(id) {
      const task = timerTasks.get(id);
      timerTasks.delete(id);
      task.callback();
    },
    getFrameCount: () => frameTasks.size,
    getFrameTasks: () => [...frameTasks.entries()],
    getTimerTasks: () => [...timerTasks.entries()]
  };
};

test('scales timeouts, forwards arguments, and clears logical timer IDs', () => {
  const harness = createHarness();
  const received = [];
  const timeoutId = harness.context.setTimeout(value => received.push(value), 100, 'done');
  const [[nativeId, task]] = harness.getTimerTasks();

  assert.equal(task.delay, 50);
  assert.notEqual(timeoutId, nativeId);

  harness.fireTimer(nativeId);
  assert.deepEqual(received, ['done']);

  const clearedId = harness.context.setTimeout(() => received.push('unexpected'), 50);
  harness.context.clearInterval(clearedId);

  assert.equal(harness.getTimerTasks().length, 0);
});

test('implements intervals with scaled recursive scheduling and supports clearing in a callback', () => {
  const harness = createHarness();
  let callCount = 0;

  const intervalId = harness.context.setInterval(() => {
    callCount += 1;
    harness.context.clearTimeout(intervalId);
  }, 80);

  const [[nativeId, firstTask]] = harness.getTimerTasks();
  assert.equal(firstTask.delay, 40);

  harness.fireTimer(nativeId);

  assert.equal(callCount, 1);
  assert.equal(harness.getTimerTasks().length, 0);
});

test('keeps active timeout progress when settings change', () => {
  const harness = createHarness();
  harness.context.setTimeout(() => {}, 100);

  assert.equal(harness.getTimerTasks()[0][1].delay, 50);
  harness.advance(20);
  harness.dispatchStorage({ ...DEFAULT_SETTINGS, speed: 4 });

  const [[, rescheduledTask]] = harness.getTimerTasks();
  assert.equal(rescheduledTask.delay, 15);
});

test('scales Date.now and performance.now continuously across a speed change', () => {
  const harness = createHarness();
  const startDate = harness.context.Date.now();

  harness.advance(10);
  assert.equal(harness.context.performance.now(), 20);
  assert.equal(harness.context.Date.now(), startDate + 20);

  harness.dispatchStorage({ ...DEFAULT_SETTINGS, speed: 4 });
  harness.advance(5);

  assert.equal(harness.context.performance.now(), 40);
  assert.equal(harness.context.Date.now(), startDate + 40);
});

test('keeps accelerated clocks continuous when their overrides are disabled', () => {
  const harness = createHarness();
  const startDate = harness.context.Date.now();

  harness.advance(10);
  harness.dispatchStorage({
    ...DEFAULT_SETTINGS,
    performanceNow: false,
    dateNow: false
  });

  assert.equal(harness.context.performance.now(), 20);
  assert.equal(harness.context.Date.now(), startDate + 20);
  harness.advance(5);
  assert.equal(harness.context.performance.now(), 25);
  assert.equal(harness.context.Date.now(), startDate + 25);
});

test('runs multiple logical animation frames and honors cancellation', () => {
  const harness = createHarness();
  const timestamps = [];

  const callback = timestamp => {
    timestamps.push(timestamp);
    if (timestamps.length < 2) harness.context.requestAnimationFrame(callback);
  };

  harness.context.requestAnimationFrame(callback);
  harness.advance(16);
  harness.fireFrame();

  assert.equal(timestamps.length, 2);
  assert.ok(timestamps[1] > timestamps[0]);

  const cancelledId = harness.context.requestAnimationFrame(() => {
    throw new Error('cancelled callback should not run');
  });
  harness.context.cancelAnimationFrame(cancelledId);

  assert.equal(harness.getFrameCount(), 0);
});

test('allows one animation callback to cancel another callback in the same frame', () => {
  const harness = createHarness({
    ...DEFAULT_SETTINGS,
    speed: 1,
    requestAnimationFrame: false
  });
  const calls = [];
  harness.context.requestAnimationFrame(() => {
    calls.push('first');
    harness.context.cancelAnimationFrame(secondId);
  });
  const secondId = harness.context.requestAnimationFrame(() => calls.push('second'));

  harness.advance(16);
  harness.fireFrame();

  assert.deepEqual(calls, ['first']);
  assert.equal(harness.getFrameCount(), 0);
});

test('uses the native animation path when animation and clock overrides are off', () => {
  const harness = createHarness(null);
  const callback = () => {};
  const animationId = harness.context.requestAnimationFrame(callback);
  const [[nativeId, nativeCallback]] = harness.getFrameTasks();

  assert.equal(animationId, nativeId);
  assert.equal(nativeCallback, callback);

  harness.context.cancelAnimationFrame(animationId);
  assert.equal(harness.getFrameCount(), 0);
});

test('drops excess animation work after reaching the per-frame CPU budget', () => {
  const harness = createHarness({
    ...DEFAULT_SETTINGS,
    speed: 100
  });
  let callCount = 0;

  const callback = () => {
    callCount += 1;
    harness.advance(2);
    harness.context.requestAnimationFrame(callback);
  };

  harness.context.requestAnimationFrame(callback);
  harness.advance(16);
  harness.fireFrame();

  assert.equal(callCount, 4);
  assert.equal(harness.getFrameCount(), 1);
});

test('defaults to native speed with every override disabled', () => {
  const harness = createHarness(null);
  harness.context.setTimeout(() => {}, 100);
  harness.advance(10);

  assert.equal(harness.getTimerTasks()[0][1].delay, 100);
  assert.equal(harness.context.performance.now(), 10);
  assert.equal(harness.context.Date.now(), 1_700_000_000_010);
});

test('allows 100x speed and clamps larger stored values to that maximum', () => {
  const harness = createHarness({
    ...DEFAULT_SETTINGS,
    speed: 250
  });

  harness.context.setTimeout(() => {}, 1000);

  assert.equal(harness.getTimerTasks()[0][1].delay, 10);
});

test('applies the top-level configuration inside a cross-origin game frame', () => {
  const parentMessages = [];
  const parentWindow = {
    postMessage(message, targetOrigin) {
      parentMessages.push({ message, targetOrigin });
    }
  };
  const harness = createHarness(DEFAULT_SETTINGS, { parentWindow });

  assert.equal(parentMessages[0].message.type, 'request-config');
  assert.equal(parentMessages[0].targetOrigin, '*');

  harness.context.setTimeout(() => {}, 100);
  assert.equal(harness.getTimerTasks()[0][1].delay, 100);
  harness.context.clearTimeout(1_000_000_001);

  harness.dispatchMessage(parentWindow, {
    channel: 'emeren.universal-speed-control.frame.v1',
    type: 'config',
    config: {
      ...DEFAULT_SETTINGS,
      speed: 10
    }
  });
  harness.context.setTimeout(() => {}, 100);

  assert.equal(harness.getTimerTasks()[0][1].delay, 10);
});

test('reports achieved animation speed from an embedded game frame', () => {
  const parentMessages = [];
  const parentWindow = {
    postMessage(message, targetOrigin) {
      parentMessages.push({ message, targetOrigin });
    }
  };
  const harness = createHarness(DEFAULT_SETTINGS, { parentWindow });
  harness.dispatchMessage(parentWindow, {
    channel: 'emeren.universal-speed-control.frame.v1',
    type: 'config',
    config: DEFAULT_SETTINGS
  });

  const callback = () => harness.context.requestAnimationFrame(callback);
  harness.context.requestAnimationFrame(callback);
  for (let frame = 0; frame < 61; frame += 1) {
    harness.advance(1000 / 60);
    harness.fireFrame();
  }

  const report = parentMessages.find(entry => entry.message.type === 'animation-stats');
  assert.ok(report);
  assert.ok(Math.abs(report.message.achieved - 2) < 0.01);
  assert.equal(report.targetOrigin, '*');
});

test('selects and reads a clock counter inside an embedded frame', () => {
  const parentMessages = [];
  const parentWindow = {
    postMessage(message, targetOrigin) {
      parentMessages.push({ message, targetOrigin });
    }
  };
  const harness = createHarness(DEFAULT_SETTINGS, { parentWindow });
  const counter = new harness.context.Element('Elapsed 01:02');

  harness.dispatchMessage(parentWindow, {
    channel: 'emeren.universal-speed-control.frame.v1',
    type: 'counter-selection-start'
  });
  harness.dispatchDocument('pointerover', { target: counter });
  assert.equal(counter.style.outline, '2px solid #1976d2');

  harness.dispatchDocument('click', {
    target: counter,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  });

  const selection = parentMessages.find(entry => entry.message.type === 'counter-selected');
  assert.equal(selection.message.text, 'Elapsed 01:02');
  assert.equal(counter.style.outline, '');

  counter.innerText = 'Elapsed 01:07';
  harness.dispatchMessage(parentWindow, {
    channel: 'emeren.universal-speed-control.frame.v1',
    type: 'counter-read',
    requestId: 42
  });

  const response = parentMessages.find(entry => entry.message.type === 'counter-value');
  assert.equal(response.message.requestId, 42);
  assert.equal(response.message.result.value, 67);
  assert.equal(response.targetOrigin, '*');
});

test('rejects a selected element containing multiple counters', () => {
  const parentMessages = [];
  const parentWindow = {
    postMessage(message) {
      parentMessages.push(message);
    }
  };
  const harness = createHarness(DEFAULT_SETTINGS, { parentWindow });
  const ambiguousCounter = new harness.context.Element('Level 2 / 10');

  harness.dispatchMessage(parentWindow, {
    channel: 'emeren.universal-speed-control.frame.v1',
    type: 'counter-selection-start'
  });
  harness.dispatchDocument('click', {
    target: ambiguousCounter,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  });

  const error = parentMessages.find(message => message.type === 'counter-selection-error');
  assert.match(error.error, /exactly one number/i);
  assert.equal(parentMessages.some(message => message.type === 'counter-selected'), false);
});

test('runs all probes and ranks the timing method controlling the selected counter', async () => {
  const harness = createHarness({
    speed: 20,
    setInterval: false,
    setTimeout: false,
    performanceNow: false,
    dateNow: false,
    requestAnimationFrame: false
  }, { exposeInternals: true });
  const counter = new harness.context.Element();
  Object.defineProperty(counter, 'innerText', {
    get: () => String(harness.context.performance.now())
  });

  harness.context.__universalSpeedTest.beginCounterDetection();
  harness.dispatchDocument('click', {
    target: counter,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  });

  for (let step = 0; step < 20; step += 1) {
    for (let microtask = 0; microtask < 8; microtask += 1) await Promise.resolve();
    if (harness.context.__universalSpeedTest.detectionState.phase !== 'running') break;

    const [[timerId, timer]] = harness.getTimerTasks();
    assert.ok(timer, `expected a detection timer at step ${step}`);
    harness.advance(timer.delay);
    harness.fireTimer(timerId);
  }
  for (let microtask = 0; microtask < 8; microtask += 1) await Promise.resolve();

  const state = harness.context.__universalSpeedTest.detectionState;
  assert.equal(state.phase, 'complete');
  assert.equal(state.best.key, 'performanceNow');
  assert.equal(state.results[0].key, 'performanceNow');
  assert.ok(Math.abs(state.results[0].ratio - 5) < 0.01);

  const restoredTime = harness.context.performance.now();
  harness.advance(5);
  assert.equal(harness.context.performance.now(), restoredTime + 5);

  harness.context.__universalSpeedTest.applyDetectedMethod();
  const appliedTime = harness.context.performance.now();
  harness.advance(5);
  assert.equal(harness.context.performance.now(), appliedTime + 100);
  assert.equal(state.phase, 'applied');
});

test('cancels a running probe and restores the original settings', () => {
  const harness = createHarness({
    ...DEFAULT_SETTINGS,
    speed: 10
  }, { exposeInternals: true });
  const counter = new harness.context.Element('1');

  harness.context.__universalSpeedTest.beginCounterDetection();
  harness.dispatchDocument('click', {
    target: counter,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  });
  assert.equal(harness.context.__universalSpeedTest.detectionState.phase, 'running');

  harness.context.__universalSpeedTest.cancelCounterDetection();
  assert.equal(harness.context.__universalSpeedTest.detectionState.phase, 'idle');
  const restoredTime = harness.context.performance.now();
  harness.advance(5);
  assert.equal(harness.context.performance.now(), restoredTime + 50);
});
