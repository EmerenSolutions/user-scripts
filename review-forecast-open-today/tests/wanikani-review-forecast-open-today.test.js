const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SCRIPT_PATH = path.resolve(
  __dirname,
  '..',
  'src',
  'wanikani-review-forecast-open-today.user.js'
);
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');

const exposeInternals = SCRIPT_SOURCE.replace(
  "  document.addEventListener('turbo:before-frame-render', event => {",
  `  window.__reviewForecastTest = {
    getToday,
    isDashboardPage,
    isForecastFrame,
    openToday,
    openWhenReady
  };

  document.addEventListener('turbo:before-frame-render', event => {`
);

const createHarness = () => {
  const documentListeners = new Map();

  class FakeElement {
    matches() {
      return false;
    }
  }

  const document = {
    readyState: 'complete',
    addEventListener(type, callback) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(callback);
    },
    querySelectorAll() {
      return [];
    }
  };

  const context = {
    console,
    CSS: { escape: value => value },
    Date,
    document,
    Element: FakeElement,
    Intl,
    location: { pathname: '/' },
    Promise,
    queueMicrotask,
    WeakMap,
    WeakSet
  };
  context.window = context;

  vm.runInNewContext(exposeInternals, context, { filename: SCRIPT_PATH });

  const createForecast = ({ connected = true, open = false } = {}) => {
    const panel = { hidden: !open };
    const attributes = new Map([
      ['aria-controls', 'today-panel'],
      ['aria-selected', open ? 'true' : 'false']
    ]);
    const link = {
      textContent: `${context.__reviewForecastTest.getToday().label} 12`,
      clickCount: 0,
      getAttribute(name) {
        return attributes.get(name) || null;
      },
      click() {
        this.clickCount += 1;
        attributes.set('aria-selected', 'true');
        panel.hidden = false;
      }
    };
    const controller = {
      connected,
      getAttribute(name) {
        if (name === 'data-detail-connected-value') {
          return this.connected ? 'true' : 'false';
        }
        return null;
      },
      querySelector(selector) {
        return selector === '#today-panel' ? panel : null;
      },
      querySelectorAll() {
        return [link];
      }
    };
    const frame = new FakeElement();
    frame.matches = selector => selector.includes('/widgets/review-forecast');
    frame.querySelector = () => controller;

    return { controller, frame, link, panel };
  };

  return {
    api: context.__reviewForecastTest,
    context,
    createForecast,
    async dispatch(type, event) {
      for (const callback of documentListeners.get(type) || []) {
        await callback(event);
      }
    }
  };
};

test('requests access only to WaniKani and uses no privileged APIs', () => {
  const matches = [...SCRIPT_SOURCE.matchAll(/^\/\/ @match\s+(.+)$/gmu)]
    .map(match => match[1]);

  assert.deepEqual(matches, [
    'https://www.wanikani.com/*',
    'https://preview.wanikani.com/*'
  ]);
  assert.match(SCRIPT_SOURCE, /^\/\/ @grant\s+none$/mu);
  assert.match(SCRIPT_SOURCE, /^\/\/ @inject-into\s+page$/mu);
  assert.match(SCRIPT_SOURCE, /^\/\/ @noframes$/mu);
});

test("opens today's forecast once and respects a later manual close", () => {
  const harness = createHarness();
  const forecast = harness.createForecast();

  assert.equal(harness.api.openToday(forecast.frame), true);
  assert.equal(forecast.link.clickCount, 1);
  assert.equal(forecast.panel.hidden, false);

  forecast.panel.hidden = true;
  assert.equal(harness.api.openToday(forecast.frame), true);
  assert.equal(forecast.link.clickCount, 1);
});

test('leaves an already-open forecast unchanged', () => {
  const harness = createHarness();
  const forecast = harness.createForecast({ open: true });

  assert.equal(harness.api.openToday(forecast.frame), true);
  assert.equal(forecast.link.clickCount, 0);
});

test('waits for the detail controller and ignores non-dashboard pages', () => {
  const harness = createHarness();
  const forecast = harness.createForecast({ connected: false });

  assert.equal(harness.api.openToday(forecast.frame), false);
  assert.equal(forecast.link.clickCount, 0);

  forecast.controller.connected = true;
  harness.context.location.pathname = '/subjects/review';
  assert.equal(harness.api.openToday(forecast.frame), false);

  harness.context.location.pathname = '/dashboard';
  assert.equal(harness.api.openToday(forecast.frame), true);
  assert.equal(forecast.link.clickCount, 1);
});

test('opens the forecast after a Turbo frame render reconnects Stimulus', async () => {
  const harness = createHarness();
  const forecast = harness.createForecast({ connected: false });
  const event = {
    target: forecast.frame,
    detail: {
      render() {
        forecast.controller.connected = true;
      }
    }
  };

  await harness.dispatch('turbo:before-frame-render', event);
  await event.detail.render(forecast.frame, forecast.frame);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(forecast.link.clickCount, 1);
});
