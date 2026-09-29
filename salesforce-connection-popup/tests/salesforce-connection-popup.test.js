const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../src/salesforce-connection-popup.user.js'), 'utf8');
const MESSAGE = 'Check your Internet connection and try again.';

function popup(text = MESSAGE, { visible = true, workingClose = true, builder = false } = {}) {
  const mask = {
    isConnected: true,
    visible,
    message: { textContent: text },
    clicks: 0,
    getClientRects() { return this.visible && this.isConnected ? [{}] : []; },
    querySelector(selector) {
      if (selector === (builder ? '.modal-body' : '#auraErrorMessage')) return this.message;
      if (selector === (builder ? 'button.slds-modal__close.closeIcon' : '#dismissError')) return this.close;
      throw new Error(`Unexpected selector: ${selector}`);
    }
  };
  mask.close = {
    isConnected: true,
    disabled: false,
    getClientRects: () => mask.getClientRects(),
    click() {
      mask.clicks++;
      if (workingClose) mask.visible = false;
    }
  };
  return mask;
}

function start(mask = null, dialogs = [], hook = {}) {
  const state = { mask, dialogs, logs: [], observer: null };
  const document = {
    querySelector(selector) {
      assert.equal(selector, '.flexipageEditorEditor');
      return hook.anchor || null;
    },
    getElementById(id) {
      assert.equal(id, 'auraErrorMask');
      return state.mask;
    },
    querySelectorAll(selector) {
      assert.equal(selector, '.flexipageEditorMessage.visualEditorModal [role="dialog"]');
      return state.dialogs;
    }
  };
  vm.runInNewContext(source, {
    document,
    exportFunction: hook.exportFunction,
    window: hook.window || {},
    setTimeout(callback) { state.retry = callback; },
    getComputedStyle: element => ({ display: 'block', visibility: element.visibility || 'visible' }),
    console: { info: message => state.logs.push(message) },
    MutationObserver: class {
      constructor(callback) { state.mutate = callback; }
      observe(target, options) { state.observer = { target, options }; }
    }
  });
  return state;
}

test('closes an existing connection popup through its close control', () => {
  const mask = popup();
  const state = start(mask);
  assert.equal(mask.clicks, 1);
  assert.equal(mask.visible, false);
  assert.equal(state.logs.length, 1);
  state.mutate();
  assert.equal(mask.clicks, 1);
});

test('handles insertion, reopening the same mask, and replacement masks', () => {
  const state = start();
  const mask = popup();
  state.mask = mask;
  state.mutate();
  assert.equal(mask.clicks, 1);
  mask.visible = true;
  state.mutate();
  assert.equal(mask.clicks, 2);
  state.mask = popup();
  state.mutate();
  assert.equal(state.mask.clicks, 1);
});

test('accepts whitespace changes but preserves every other message', () => {
  assert.equal(start(popup('  Check your Internet\n connection and try again.\u00a0')).mask.clicks, 1);
  for (const text of [
    'Your session has expired.',
    'Unable to save this page.',
    `${MESSAGE} Saving failed.`,
    `Error: ${MESSAGE}`,
    'Check your internet connection and try again.',
    'Kontrollera din internetanslutning och försök igen.',
    ''
  ]) {
    const mask = popup(text);
    start(mask);
    assert.equal(mask.clicks, 0, text);
    assert.equal(mask.visible, true, text);
  }
});

test('a different error after dismissal remains visible', () => {
  const mask = popup();
  const state = start(mask);
  mask.message.textContent = 'Unable to save this page.';
  mask.visible = true;
  state.mutate();
  assert.equal(mask.clicks, 1);
  assert.equal(mask.visible, true);
  mask.message.textContent = MESSAGE;
  state.mutate();
  assert.equal(mask.clicks, 2);
});

test('waits for a visible popup and usable close control', () => {
  const mask = popup(MESSAGE, { visible: false });
  const state = start(mask);
  assert.equal(mask.clicks, 0);
  mask.visible = true;
  const close = mask.close;
  mask.close = null;
  state.mutate();
  assert.equal(mask.clicks, 0);
  mask.close = close;
  close.disabled = true;
  state.mutate();
  assert.equal(mask.clicks, 0);
  close.disabled = false;
  close.visibility = 'hidden';
  state.mutate();
  assert.equal(mask.clicks, 0);
  close.visibility = 'visible';
  state.mutate();
  assert.equal(mask.clicks, 1);
});

test('ignores missing messages and detached or visibility-hidden masks', () => {
  for (const change of [
    mask => { mask.message = null; },
    mask => { mask.isConnected = false; },
    mask => { mask.visibility = 'hidden'; }
  ]) {
    const mask = popup();
    change(mask);
    start(mask);
    assert.equal(mask.clicks, 0);
  }
});

test('a nonworking close handler cannot create an observer click loop', () => {
  const mask = popup(MESSAGE, { workingClose: false });
  const state = start(mask);
  for (let i = 0; i < 10; i++) state.mutate();
  assert.equal(mask.clicks, 1);
  assert.equal(mask.visible, true);
  assert.equal(state.logs.length, 0);
  mask.visible = false;
  state.mutate();
  mask.visible = true;
  state.mutate();
  assert.equal(mask.clicks, 2);
});

test('watches reused popup text and visibility without polling', () => {
  const { observer } = start();
  assert.equal(observer.options.subtree, true);
  assert.equal(observer.options.childList, true);
  assert.equal(observer.options.characterData, true);
  assert.equal(observer.options.attributes, true);
  for (const name of ['class', 'style', 'hidden', 'disabled']) {
    assert.ok(observer.options.attributeFilter.includes(name));
  }
});

test('closes the actual App Builder message modal independently of the Aura mask', () => {
  const aura = popup('CSS Error', { visible: false });
  const builder = popup(MESSAGE, { builder: true });
  const state = start(aura, [builder]);
  assert.equal(aura.clicks, 0);
  assert.equal(builder.clicks, 1);
  assert.equal(builder.visible, false);
  state.dialogs = [popup(MESSAGE, { builder: true })];
  state.mutate();
  assert.equal(state.dialogs[0].clicks, 1);
});

test('preserves unrelated App Builder dialogs and connection text embedded in other errors', () => {
  for (const text of ['Changes could not be saved.', `Save failed. ${MESSAGE}`, 'Your session has expired.']) {
    const builder = popup(text, { builder: true });
    start(null, [builder]);
    assert.equal(builder.clicks, 0);
    assert.equal(builder.visible, true);
  }
});

test('waits for App Builder animation to finish without clicking repeatedly', () => {
  const builder = popup(MESSAGE, { builder: true, workingClose: false });
  const state = start(null, [builder]);
  state.mutate();
  assert.equal(builder.clicks, 1);
  builder.visible = false;
  state.mutate();
  builder.visible = true;
  state.mutate();
  assert.equal(builder.clicks, 2);
});

function builderHook({ label = MESSAGE, supported = true, writable = true } = {}) {
  const calls = [];
  function onShowOffline(...args) {
    // Observed native handler: ui:createPanel, FlexipageEditor.OfflineMessage,
    // and v.errorMessageShown. The stub records dialog creation and state writes.
    calls.push({ receiver: this, args });
    return 'native-result';
  }
  const original = supported ? onShowOffline : function changedHandler() { calls.push('changed'); };
  const controller = { onShowOffline: original, onShowMessage() { return 'other-message'; } };
  const definition = {};
  Object.defineProperty(definition, 'minifiedCodeSlot', { value: original, writable, enumerable: true });
  const descriptor = name => ({ getDescriptor: () => ({ getQualifiedName: () => name }) });
  const base = {
    controller,
    getDef: () => descriptor('markup://flexipageEditor:baseBuilder'),
    get(name) { assert.equal(name, 'c.onShowOffline'); return { getDef: () => definition }; }
  };
  const page = {
    getDef: () => descriptor('markup://flexipageEditor:pageBuilder'),
    getSuper: () => base
  };
  const rendered = {
    getDef: () => descriptor('markup://aura:html'),
    getOwner: () => page
  };
  const anchor = { getAttribute: () => 'fixture:0' };
  const aura = { getComponent: () => rendered, get: () => label };
  return { anchor, window: { $A: aura }, controller, definition, original, calls, aura };
}

test('prevents the dedicated offline action before modal creation or open-state writes', () => {
  const hook = builderHook();
  const other = hook.controller.onShowMessage;
  const state = start(null, [], hook);
  assert.notEqual(hook.controller.onShowOffline, hook.original);
  assert.equal(hook.controller.onShowOffline, hook.definition.minifiedCodeSlot);
  hook.definition.minifiedCodeSlot({}, {}, {});
  hook.controller.onShowOffline({}, {}, {});
  assert.equal(hook.calls.length, 0);
  assert.equal(state.logs.length, 2);
  assert.equal(hook.controller.onShowMessage, other);
  assert.equal(other(), 'other-message');
  const installed = hook.controller.onShowOffline;
  state.mutate();
  assert.equal(hook.controller.onShowOffline, installed);
});

test('preserves the native action, arguments and return value for a different message', () => {
  const hook = builderHook({ label: 'A different warning.' });
  start(null, [], hook);
  const receiver = {};
  const args = [{}, {}, {}];
  assert.equal(hook.controller.onShowOffline.apply(receiver, args), 'native-result');
  assert.equal(hook.calls[0].receiver, receiver);
  assert.deepEqual(hook.calls[0].args, args);
  hook.aura.get = () => { throw new Error('Unavailable label'); };
  assert.equal(hook.controller.onShowOffline(), 'native-result');
});

test('retains dismissal if the native handler changed or its action definition is read-only', () => {
  for (const options of [{ supported: false }, { writable: false }]) {
    const hook = builderHook(options);
    const dialog = popup(MESSAGE, { builder: true });
    start(null, [dialog], hook);
    assert.equal(hook.controller.onShowOffline, hook.original);
    assert.equal(hook.definition.minifiedCodeSlot, hook.original);
    assert.equal(dialog.clicks, 1);
  }
});

test('installs after delayed Aura initialization without requiring a DOM mutation', () => {
  const hook = builderHook();
  const aura = hook.window.$A;
  delete hook.window.$A;
  const state = start(null, [], hook);
  assert.equal(hook.controller.onShowOffline, hook.original);
  hook.window.$A = aura;
  state.retry();
  assert.notEqual(hook.controller.onShowOffline, hook.original);
});


test('uses Firefox wrapped page objects and exports the callback', () => {
  const hook = builderHook();
  const pageWindow = hook.window;
  hook.window = { wrappedJSObject: pageWindow };
  let exported = 0;
  hook.exportFunction = (callback, target) => {
    assert.equal(target, pageWindow);
    exported++;
    return function (...args) { return callback.apply(this, args); };
  };
  start(null, [], hook);
  assert.equal(exported, 1);
  hook.definition.minifiedCodeSlot();
  assert.equal(hook.calls.length, 0);
});

test('keeps native behavior for missing or non-English labels', () => {
  for (const label of [null, {}, '', 'Kontrollera din internetanslutning och försök igen.']) {
    const hook = builderHook({ label });
    start(null, [], hook);
    assert.equal(hook.definition.minifiedCodeSlot(), 'native-result');
    assert.equal(hook.calls.length, 1);
  }
});

test('bridge export failure retains native handlers and DOM dismissal', () => {
  const hook = builderHook();
  hook.exportFunction = () => { throw new Error('Export unavailable'); };
  const dialog = popup(MESSAGE, { builder: true });
  start(null, [dialog], hook);
  assert.equal(hook.controller.onShowOffline, hook.original);
  assert.equal(hook.definition.minifiedCodeSlot, hook.original);
  assert.equal(dialog.clicks, 1);
});

test('a read-only controller retains native action and DOM dismissal', () => {
  const hook = builderHook();
  Object.freeze(hook.controller);
  const dialog = popup(MESSAGE, { builder: true });
  start(null, [dialog], hook);
  assert.equal(hook.definition.minifiedCodeSlot, hook.original);
  assert.equal(dialog.clicks, 1);
});

test('repeated script initialization does not wrap the same action twice', () => {
  const hook = builderHook();
  start(null, [], hook);
  const installed = hook.definition.minifiedCodeSlot;
  start(null, [], hook);
  assert.equal(hook.definition.minifiedCodeSlot, installed);
  assert.equal(hook.controller.onShowOffline, installed);
});

test('replacement builder initializes after client-side navigation', () => {
  const hook = builderHook();
  const state = start(null, [], hook);
  const replacement = builderHook();
  hook.anchor = replacement.anchor;
  hook.window.$A = replacement.aura;
  state.mutate();
  assert.notEqual(replacement.definition.minifiedCodeSlot, replacement.original);
  replacement.definition.minifiedCodeSlot();
  assert.equal(replacement.calls.length, 0);
});
