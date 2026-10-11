const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SCRIPT_PATH = path.resolve(__dirname, '../src/wanikani-kanji-components.user.js');
const SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');
const ID = 'wanikani_kanji_components';
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

// Small DOM fixture: connected trees, visible subject candidates, and actual
// rendered links/rows. Timers and mutations are driven explicitly by tests.
const createHarness = ({ pathname = '/kanji/億', items, stored = {}, missing = false, components } = {}) => {
  const listeners = new Map();
  const timers = new Map();
  const errors = [];
  let timerId = 0, observer, observerOptions, dialog, fetches = 0;
  const matches = (element, selector) => selector.split(',').some(part => {
    part = part.trim();
    if (part.startsWith('#')) return element.id === part.slice(1);
    if (part.startsWith('.')) return element.className.split(' ').includes(part.slice(1));
    if (part === '[class*="characters"]') return element.className.includes('characters');
    if (part === '[data-subject-character]') return !!element.dataset.subjectCharacter;
    return element.tagName === part;
  });
  class Element {
    constructor(tagName) {
      this.tagName = tagName; this.children = []; this.parent = null;
      this.className = ''; this.id = ''; this.dataset = {}; this.style = {};
      this.text = ''; this.rect = { width: 0, height: 0, top: 0 };
    }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.text = value; this.children = []; }
    appendChild(child) { child.remove(); child.parent = this; this.children.push(child); return child; }
    remove() {
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    }
    insertAdjacentElement(position, child) {
      assert.equal(position, 'afterend');
      assert.ok(this.parent, 'anchor is attached');
      child.remove(); child.parent = this.parent;
      this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, child);
    }
    closest(selector) { return matches(this, selector) ? this : this.parent?.closest(selector); }
    getBoundingClientRect() { return this.rect; }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [ ...(matches(child, selector) ? [child] : []), ...child.querySelectorAll(selector) ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const root = new Element('html');
  const head = root.appendChild(new Element('head'));
  const body = root.appendChild(new Element('body'));
  const main = body.appendChild(new Element('main'));
  const subject = main.appendChild(new Element('div'));
  subject.className = 'subject-character__characters';
  subject.rect = { width: 100, height: 100, top: 0 };
  const addListener = (type, callback) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(callback);
  };
  const context = {
    document: {
      head, body, createElement: tag => new Element(tag), addEventListener: addListener,
      querySelector: selector => root.querySelector(selector),
      querySelectorAll: selector => root.querySelectorAll(selector)
    },
    location: { pathname },
    console: { warn: (...args) => errors.push(args), error: (...args) => errors.push(args) },
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener: addListener,
    MutationObserver: class {
      constructor(callback) { observer = callback; }
      observe(target, options) { observerOptions = options; }
    }
  };
  context.window = context;
  const menu = [];
  const saves = [];
  function Settings(options) { dialog = options; this.open = () => {}; }
  Settings.load = async (id, defaults) => {
    context.wkof.settings[id] = { ...defaults, ...stored };
  };
  Settings.save = async id => { saves.push(id); };
  const wkof = {
    include() {}, ready: async () => {}, Settings, settings: {},
    Menu: { insert_script_link: link => menu.push(link) },
    ItemData: { get_items: async options => {
      fetches++;
      assert.deepEqual(plain(options), { wk_items: { filters: { item_type: 'kan' } } });
      return items ? await items() : ['人', '意', '音', '心', '立', '日', '木', '林', '止', '水'].map(characters => ({ object: 'kanji', data: { characters } }));
    } }
  };
  if (!missing) context.wkof = wkof;
  const source = components
    ? SOURCE.replace(/  const COMPONENTS = [^\n]+;/u, `  const COMPONENTS = ${JSON.stringify(components)};`)
    : SOURCE;
  const exposed = source.replace('  startup();', `  window.__test = {
    render, renderCurrentPage, loadWkKanji, getDisplayDirectComponents,
    getNestedComponents, filterToWkKanji, getSubjectFromPage
  };\n  window.__startup = startup();`);
  assert.notEqual(exposed, SOURCE);
  vm.runInNewContext(exposed, context, { filename: SCRIPT_PATH });
  return {
    api: context.__test, context, subject, main, Element, wkof, menu, saves, errors,
    ready: async () => { await context.__startup; await settle(); },
    get fetches() { return fetches; }, get dialog() { return dialog; },
    get observerOptions() { return observerOptions; },
    panel: () => root.querySelector(`#${ID}_panel`),
    rows: () => root.querySelectorAll(`.${ID}__row`).map(row => ({
      label: row.querySelector(`.${ID}__label`).textContent,
      links: row.querySelectorAll('a').map(link => ({ text: link.textContent, href: link.href, title: link.title }))
    })),
    dispatch: async (type, detail) => {
      for (const callback of listeners.get(type) || []) callback({ detail });
      await settle();
    },
    mutate: () => observer(),
    async timers(delay) {
      const selected = [...timers].filter(([, timer]) => timer.delay === delay);
      for (const [id, timer] of selected) { timers.delete(id); await timer.callback(); }
      await settle();
    }
  };
};

test('renders filtered direct/nested components and alternate forms as WaniKani links', async () => {
  const h = createHarness(); await h.ready();
  const rows = h.rows();
  assert.deepEqual(rows.map(row => row.label), ['Direct', 'Nested']);
  assert.deepEqual(rows[0].links.map(link => link.text), ['人as 亻', '意']);
  assert.equal(rows[0].links[0].href, '/kanji/%E4%BA%BA');
  assert.match(rows[0].links[0].title, /Visible form: 亻/u);
  assert.ok(rows[1].links.some(link => link.text === '心'));
  assert.ok(!rows[1].links.some(link => link.text === '人' || link.text === '意'));
});

test('promotes supplementary intermediate shapes and deduplicates repeated components', async () => {
  const h = createHarness({ pathname: '/kanji/歴' }); await h.ready();
  assert.deepEqual(h.rows()[0].links.map(link => link.text), ['林', '止']);
  assert.deepEqual(h.rows()[1].links.map(link => link.text), ['木']);
  assert.deepEqual(plain(h.api.getDisplayDirectComponents('林', new Set(['木']))), [{ kanji: '木', form: null }]);
});

test('filters ItemData by subject type and single kanji, including alternate response shapes', async () => {
  const h = createHarness({ items: () => [
    { object: 'vocabulary', data: { characters: '人' } },
    { item_type: 'kanji', characters: '意' },
    { data: { object: 'kanji', characters: '音' } },
    { object: 'kanji', data: { characters: '日本' } }, null
  ] }); await h.ready();
  assert.deepEqual([...await h.api.loadWkKanji()], ['意', '音']);
  assert.deepEqual(h.rows()[0].links.map(link => link.text), ['意']);
});

test('overlapping renders share a complete item load and only the newest question renders', async () => {
  const load = deferred(); const h = createHarness({ items: () => load.promise });
  await h.context.__startup; await settle();
  const next = h.api.render('歴'); await settle();
  assert.equal(h.panel(), null, 'never renders with an incomplete empty cache');
  load.resolve(['林', '止', '木'].map(characters => ({ object: 'kanji', data: { characters } })));
  await next; await settle();
  assert.equal(h.fetches, 1);
  assert.deepEqual(h.rows()[0].links.map(link => link.text), ['林', '止']);
});

test('navigation cancels an in-flight panel and leaving supported pages removes existing panels', async () => {
  const load = deferred(); const h = createHarness({ items: () => load.promise });
  await h.context.__startup; await settle();
  h.context.location.pathname = '/dashboard'; await h.dispatch('turbo:load');
  load.resolve([{ object: 'kanji', data: { characters: '人' } }]); await settle();
  assert.equal(h.panel(), null);
  h.context.location.pathname = '/kanji/億'; await h.dispatch('turbo:load');
  assert.ok(h.panel());
  h.context.location.pathname = '/subject-lessons/picker'; await h.dispatch('turbo:render');
  assert.equal(h.panel(), null);
});

test('non-kanji questions clear the panel and stale quiz markup cannot restore it', async () => {
  const h = createHarness({ pathname: '/subjects/review' }); h.subject.textContent = '億'; await h.ready();
  assert.ok(h.panel());
  await h.dispatch('willShowNextQuestion', { subject: { object: 'vocabulary', data: { characters: '億' } } });
  assert.equal(h.panel(), null);
  h.mutate(); await h.timers(100);
  assert.equal(h.panel(), null);
  await h.dispatch('willShowNextQuestion', { subject: { object: 'kanji', data: { characters: '歴' } } });
  assert.deepEqual(h.rows()[0].links.map(link => link.text), ['林', '止']);
  h.mutate(); await h.timers(100);
  assert.deepEqual(h.rows()[0].links.map(link => link.text), ['林', '止']);
  await h.dispatch('willShowNextQuestion', { subject: { object: 'radical', data: { characters: '木' } } });
  assert.equal(h.panel(), null);
});

test('clears a panel when visible quiz subject disappears, and observes character text changes', async () => {
  const h = createHarness({ pathname: '/subjects/review' }); h.subject.textContent = '億'; await h.ready();
  assert.equal(h.observerOptions.characterData, true);
  assert.equal(h.observerOptions.attributes, true);
  h.subject.textContent = '日本'; h.mutate(); await h.timers(100);
  assert.equal(h.panel(), null);
  h.subject.textContent = '歴'; h.mutate(); await h.timers(100);
  assert.deepEqual(h.rows()[0].links.map(link => link.text), ['林', '止']);
});

test('settings load before rendering; saving changes immediately removes or updates the panel', async () => {
  const h = createHarness({ stored: { enabled: false } }); await h.ready();
  assert.equal(h.panel(), null); assert.equal(h.fetches, 0);
  h.menu[0].on_click();
  assert.equal(h.dialog.script_id, ID);
  h.context.wkof.settings[ID] = { enabled: true, showNested: false };
  await h.dialog.on_save(); await settle();
  assert.deepEqual(h.rows().map(row => row.label), ['Direct']);
  h.context.wkof.settings[ID] = { runKanjiPages: false };
  await h.dialog.on_save(); await settle();
  assert.equal(h.panel(), null); assert.equal(h.saves.length, 2);
});

test('each context switch excludes its page, and quiz events respect the current context', async () => {
  for (const [pathname, option] of [['/kanji/億', 'runKanjiPages'], ['/subjects/review', 'runReviews'], ['/subject-lessons', 'runLessons'], ['/subjects/lesson', 'runLessons'], ['/lesson/session', 'runLessons']]) {
    const h = createHarness({ pathname, stored: { [option]: false } }); h.subject.textContent = '億'; await h.ready();
    await h.dispatch('willShowNextQuestion', { object: 'kanji', characters: '億' });
    assert.equal(h.panel(), null, pathname);
    assert.equal(h.fetches, 0, pathname);
  }
});

test('missing WKOF shows a requirement note and recovers when the framework loads later', async () => {
  const h = createHarness({ missing: true }); await h.ready();
  assert.match(h.panel().textContent, /Open Framework is required/u);
  assert.deepEqual(h.rows()[0].links, []);
  const panel = h.panel(); h.mutate(); await h.timers(100);
  assert.equal(h.panel(), panel, 'own panel mutations do not recreate the missing-WKOF panel');
  h.context.wkof = h.wkof; await h.timers(500);
  assert.deepEqual(h.rows()[0].links.map(link => link.text), ['人as 亻', '意']);
  assert.doesNotMatch(h.panel().textContent, /Open Framework is required/u);
});

test('failed ItemData requests do not poison the cache and can be retried', async () => {
  let attempts = 0;
  const h = createHarness({ items: () => {
    if (++attempts === 1) throw new Error('offline');
    return [{ object: 'kanji', data: { characters: '意' } }];
  } }); await h.ready();
  assert.match(h.panel().textContent, /could not be loaded/u);
  const panel = h.panel(); h.mutate(); await h.timers(100);
  assert.equal(h.panel(), panel);
  assert.equal(h.fetches, 1, 'does not repeatedly fetch in response to its own error panel');
  await h.timers(500);
  assert.deepEqual(h.rows()[0].links.map(link => link.text), ['意']);
  assert.equal(h.fetches, 2);
});

test('popstate resets event subject and renders the new route', async () => {
  const h = createHarness({ pathname: '/subjects/review' }); h.subject.textContent = '億'; await h.ready();
  await h.dispatch('willShowNextQuestion', { object: 'kanji', characters: '歴' });
  h.context.location.pathname = '/kanji/億'; await h.dispatch('popstate'); await h.timers(50);
  assert.deepEqual(h.rows()[0].links.map(link => link.text), ['人as 亻', '意']);
});

test('cycles and repeated branches terminate, exclude the root, and promote only first allowed descendants', async () => {
  const h = createHarness({ components: {
    '億': ['意', '人', '意', '億'], '意': ['億', '心', '音'],
    '人': ['音', '心'], '音': ['日', '心'], '心': ['意']
  } }); await h.ready();
  assert.deepEqual(h.rows()[0].links.map(link => link.text), ['意', '人']);
  const nested = plain(h.api.getNestedComponents('億')).map(component => component.kanji);
  assert.deepEqual(nested, ['意', '心', '音', '日', '人']);
  assert.deepEqual(plain(h.api.getDisplayDirectComponents('億', new Set(['音', '日']))).map(component => component.kanji), ['音']);
});

test('uses the largest visible subject and excludes hidden old subjects and panel content', async () => {
  const h = createHarness({ pathname: '/subjects/review' }); h.subject.textContent = '億'; await h.ready();
  const old = h.main.appendChild(new h.Element('div'));
  old.className = 'quiz-header__characters'; old.textContent = '歴';
  assert.equal(h.api.getSubjectFromPage(), '億');
  h.subject.rect.width = 0;
  assert.equal(h.api.getSubjectFromPage(), null);
  old.rect = { width: 200, height: 200, top: 10 };
  assert.equal(h.api.getSubjectFromPage(), '歴');
  h.subject.rect.width = 100;
  assert.equal(h.api.getSubjectFromPage(), '歴');
});

test('pending kanji load cannot reinsert a panel after settings disable the script', async () => {
  const load = deferred(); const h = createHarness({ items: () => load.promise });
  await h.context.__startup; await settle(); h.menu[0].on_click();
  h.context.wkof.settings[ID].enabled = false; await h.dialog.on_save();
  load.resolve([{ object: 'kanji', data: { characters: '意' } }]); await settle();
  assert.equal(h.panel(), null);
});

test('non-kanji events cancel pending loads, even while the old quiz subject remains visible', async () => {
  const load = deferred(); const h = createHarness({ pathname: '/subjects/review', items: () => load.promise });
  h.subject.textContent = '億'; await h.context.__startup; await settle();
  await h.dispatch('willShowNextQuestion', { object: 'radical', characters: '木' });
  load.resolve([{ object: 'kanji', data: { characters: '意' } }]); await settle();
  assert.equal(h.panel(), null);
});

test('renders on supported lesson routes and encoded subject pages, with explicit empty rows', async () => {
  for (const pathname of ['/subjects/kanji/%E5%84%84', '/subject-lessons', '/subjects/lesson', '/lesson/session']) {
    const h = createHarness({ pathname, items: () => [] }); h.subject.textContent = '億'; await h.ready();
    assert.ok(h.panel(), pathname);
    assert.equal(h.rows().length, 2);
    assert.match(h.panel().textContent, /DirectNone foundNestedNone found/u);
    assert.doesNotMatch(h.panel().textContent, /Open Framework is required/u);
  }
});

test('settings-load errors preserve default operation and are retried at startup checks', async () => {
  const h = createHarness();
  const load = h.wkof.Settings.load; let attempts = 0;
  h.wkof.Settings.load = async (...args) => {
    if (++attempts === 1) throw new Error('settings unavailable');
    return load(...args);
  };
  await h.ready();
  assert.ok(h.panel()); assert.equal(h.menu.length, 0);
  await h.timers(500);
  assert.ok(h.menu.length > 0); assert.equal(attempts, 2);
});

test('navigation and question events wait for persisted settings during initialization', async () => {
  const pending = deferred();
  const h = createHarness({ pathname: '/subjects/review', stored: { enabled: false } });
  const load = h.wkof.Settings.load;
  h.wkof.Settings.load = async (...args) => { await pending.promise; return load(...args); };
  await settle();
  await h.dispatch('willShowNextQuestion', { object: 'kanji', characters: '億' });
  await h.dispatch('turbo:load');
  assert.equal(h.fetches, 0); assert.equal(h.panel(), null);
  pending.resolve(); await h.ready();
  assert.equal(h.fetches, 0); assert.equal(h.panel(), null);
});

test('recognizes native quiz subject_category payloads, including vocabulary and radicals with a single kanji glyph', async () => {
  const h = createHarness({ pathname: '/subjects/review' }); h.subject.textContent = '億'; await h.ready();
  await h.dispatch('willShowNextQuestion', { subject: { subject_category: 'Kanji', characters: '歴' }, questionType: 'meaning' });
  assert.deepEqual(h.rows()[0].links.map(link => link.text), ['林', '止']);
  for (const subject_category of ['Vocabulary', 'Radical']) {
    await h.dispatch('willShowNextQuestion', { subject: { subject_category, characters: '木' }, questionType: 'meaning' });
    assert.equal(h.panel(), null);
    h.mutate(); await h.timers(100);
    assert.equal(h.panel(), null);
  }
  await h.dispatch('willShowNextQuestion', { subject: { subject_category: 'Kanji', characters: '億' }, questionType: 'reading' });
  assert.deepEqual(h.rows()[0].links.map(link => link.text), ['人as 亻', '意']);
});
