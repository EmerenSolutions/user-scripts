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

const createHarness = ({ weekday = 0 } = {}) => {
  const documentListeners = new Map();
  const frames = [];
  class FixedDate extends Date {
    constructor() {
      super(2026, 9, 11 + weekday, 12);
    }
  }

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
      return frames;
    }
  };

  const context = {
    console,
    CSS: { escape: value => value },
    Date: FixedDate,
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

  const createForecast = ({
    connected = true,
    open = false,
    text = `${context.__reviewForecastTest.getToday().label} 12`,
    panelWeekday = context.__reviewForecastTest.getToday().fullLabel
  } = {}) => {
    const panel = {
      hidden: !open,
      weekday: panelWeekday,
      querySelector(selector) {
        assert.equal(selector, '.review-forecast-widget__day-header svg[title]');
        return this.weekday ? { getAttribute: name => name === 'title' ? this.weekday : null } : null;
      }
    };
    const attributes = new Map([
      ['aria-controls', 'today-panel'],
      ['aria-selected', open ? 'true' : 'false']
    ]);
    const link = {
      textContent: text,
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
    const rows = [link];
    const panels = new Map([['today-panel', panel]]);
    const controller = {
      connected,
      getAttribute(name) {
        if (name === 'data-detail-connected-value') {
          return this.connected ? 'true' : 'false';
        }
        return null;
      },
      querySelector(selector) {
        return panels.get(selector.slice(1)) || null;
      },
      querySelectorAll() {
        return rows;
      }
    };
    const frame = new FakeElement();
    frame.matches = selector => selector.includes('/widgets/review-forecast');
    frame.querySelector = () => controller;

    frames.push(frame);
    return { attributes, controller, frame, link, panel, panels, rows };
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
  forecast.attributes.set('aria-selected', 'false');
  assert.equal(harness.api.openToday(forecast.frame), true);
  assert.equal(forecast.link.clickCount, 1);
});

test('opens every translated weekday using linked panel metadata', () => {
  const translations = ['日', '月', '火', '水', '木', '金', '土'];
  translations.forEach((text, weekday) => {
    const harness = createHarness({ weekday });
    const forecast = harness.createForecast({ text: `${text}曜日 12` });
    // A misleading visible label must not beat the linked panel's weekday.
    const otherAttributes = new Map([
      ['aria-controls', 'other-panel'], ['aria-selected', 'false']
    ]);
    const other = {
      textContent: `${harness.api.getToday().label} 99`,
      getAttribute: name => otherAttributes.get(name) || null,
      click() { assert.fail('clicked a different day'); }
    };
    forecast.rows.unshift(other);
    forecast.panels.set('other-panel', {
      hidden: true,
      querySelector: () => ({ getAttribute: () => 'Different weekday' })
    });

    assert.equal(harness.api.openToday(forecast.frame), true);
    assert.equal(forecast.link.clickCount, 1);
  });
});

test('falls back to English text only without weekday metadata', () => {
  const harness = createHarness();
  const english = harness.createForecast({ panelWeekday: null });
  assert.equal(harness.api.openToday(english.frame), true);

  const translated = harness.createForecast({ panelWeekday: null, text: '日曜日 12' });
  assert.equal(harness.api.openToday(translated.frame), false);
  assert.equal(translated.link.clickCount, 0);

  const wrongDay = harness.createForecast({ panelWeekday: 'Monday' });
  assert.equal(harness.api.openToday(wrongDay.frame), false);
  assert.equal(wrongDay.link.clickCount, 0);
});

test('translation and repeated Turbo events preserve manual closure', async () => {
  const harness = createHarness();
  const forecast = harness.createForecast();
  await harness.dispatch('turbo:load');
  forecast.link.textContent = '日曜日 12';
  forecast.panel.hidden = true;
  forecast.attributes.set('aria-selected', 'false');

  await harness.dispatch('turbo:load');
  await harness.dispatch('turbo:frame-load', { target: forecast.frame });
  assert.equal(forecast.link.clickCount, 1);
  assert.equal(forecast.panel.hidden, true);
});

test('Turbo navigation opens a fresh translated widget', async () => {
  const harness = createHarness();
  harness.context.location.pathname = '/kanji/one';
  const forecast = harness.createForecast({ text: '日曜日 12' });
  await harness.dispatch('turbo:load');
  assert.equal(forecast.link.clickCount, 0);
  harness.context.location.pathname = '/dashboard';
  await harness.dispatch('turbo:load');
  assert.equal(forecast.link.clickCount, 1);
});

test('Turbo replacement of a handled frame reopens the new translated row', async () => {
  const harness = createHarness();
  const previous = harness.createForecast();
  harness.api.openToday(previous.frame);
  previous.panel.hidden = true;
  previous.attributes.set('aria-selected', 'false');
  const replacement = harness.createForecast({ connected: false, text: '日曜日 12' });
  const event = {
    target: previous.frame,
    detail: {
      async render(currentFrame) {
        currentFrame.querySelector = () => replacement.controller;
        queueMicrotask(() => { replacement.controller.connected = true; });
      }
    }
  };
  await harness.dispatch('turbo:before-frame-render', event);
  await event.detail.render(previous.frame, replacement.frame);
  await harness.dispatch('turbo:frame-load', { target: previous.frame });
  assert.equal(previous.link.clickCount, 1);
  assert.equal(replacement.link.clickCount, 1);
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
