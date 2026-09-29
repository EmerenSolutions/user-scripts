// ==UserScript==
// @name         Salesforce Connection Popup Dismiss
// @namespace    https://github.com/EmerenSolutions/user-scripts
// @version      0.2.1
// @author       Johan Emerén
// @copyright    2026, Johan Emerén
// @description  Prevent App Builder's Internet connection popup, with targeted dismissal as a fallback.
// @match        https://*.lightning.force.com/*
// @match        https://*.my.salesforce.com/visualEditor/*
// @match        https://*.my.salesforce-setup.com/*
// @grant        none
// @inject-into  auto
// @run-at       document-start
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/salesforce-connection-popup/src/salesforce-connection-popup.user.js
// @updateURL    https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/salesforce-connection-popup/src/salesforce-connection-popup.user.js
// ==/UserScript==

(() => {
  'use strict';

  // Build 4. Frames deliberately enabled for the App Builder canvas.
  const MESSAGE = 'Check your Internet connection and try again.';
  const attempted = new WeakSet();
  const pageWindow = window.wrappedJSObject || window;
  const HOOK = Symbol.for('emeren.salesforceConnectionPopup.offlineHook');
  let hookedAnchor = null;

  function installPrevention() {
    const aura = pageWindow.$A;
    const anchor = document.querySelector('.flexipageEditorEditor');
    if (!aura || !anchor) return false;
    if (anchor === hookedAnchor) return true;
    try {
      let component = aura.getComponent(anchor.getAttribute('data-aura-rendered-by'));
      // Start at the rendered editor and find its owning page builder.
      for (let depth = 0; component && depth < 12; depth++, component = component.getOwner()) {
        if (component.getDef().getDescriptor().getQualifiedName() !== 'markup://flexipageEditor:pageBuilder') continue;
        let base = component;
        for (let level = 0; base && level < 8; level++, base = base.getSuper()) {
          if (base.getDef().getDescriptor().getQualifiedName() !== 'markup://flexipageEditor:baseBuilder') continue;
          const controller = base.controller;
          const original = controller?.onShowOffline;
          if (typeof original !== 'function') return false;
          if (original[HOOK]) { hookedAnchor = anchor; return true; }

          // Only patch the observed, display-only handler. Fail open on redesigns.
          const code = Function.prototype.toString.call(original);
          if (!['ui:createPanel', 'FlexipageEditor.OfflineMessage', 'v.errorMessageShown'].every(part => code.includes(part))) return false;
          const definition = base.get('c.onShowOffline').getDef();
          // Aura minifies this member's name; identify it by function identity.
          const slots = Object.keys(definition).filter(key => definition[key] === original);
          if (!slots.length || slots.some(key => !Object.getOwnPropertyDescriptor(definition, key)?.writable)) return false;

          function blockedOfflinePopup(...args) {
            let text;
            try { text = aura.get('$Label.FlexipageEditor.OfflineMessage'); } catch { /* Keep the native handler on lookup failure. */ }
            if (typeof text === 'string' && text.replace(/\s+/gu, ' ').trim() === MESSAGE) {
              console.info('[Salesforce Connection Popup Dismiss] Prevented the connection warning.');
              return;
            }
            return Reflect.apply(original, this, args);
          }
          // Firefox content scripts must export callbacks to the page compartment.
          const replacement = typeof exportFunction === 'function'
            ? exportFunction(blockedOfflinePopup, pageWindow) : blockedOfflinePopup;
          Object.defineProperty(replacement, HOOK, { value: true });
          // Replace both the controller method and the cached action definition.
          // Leave errorMessageShown untouched: no modal has been created.
          controller.onShowOffline = replacement;
          for (const key of slots) definition[key] = replacement;
          hookedAnchor = anchor;
          return true;
        }
      }
    } catch { /* Unsupported Aura internals retain the DOM dismissal fallback. */ }
    return false;
  }

  function isVisible(element) {
    if (!element.isConnected || !element.getClientRects().length) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
  }

  function dismissDialog(mask, messageSelector, closeSelector) {
    if (!mask) return;
    const message = mask.querySelector(messageSelector);
    const text = message?.textContent.replace(/\s+/gu, ' ').trim();

    // Never suppress other errors, even if they contain this sentence.
    if (text !== MESSAGE || !isVisible(mask)) {
      attempted.delete(mask);
      return;
    }

    const close = mask.querySelector(closeSelector);
    if (!close || close.disabled || !isVisible(close) || attempted.has(mask)) return;
    // Avoid an observer loop if Salesforce changes its close handler.
    attempted.add(mask);
    close.click();
    if (!isVisible(mask)) {
      attempted.delete(mask);
      console.info('[Salesforce Connection Popup Dismiss] Closed the connection warning.');
    }
  }

  function dismissConnectionPopup() {
    installPrevention();
    dismissDialog(document.getElementById('auraErrorMask'), '#auraErrorMessage', '#dismissError');
    // App Builder uses its own modal, separate from the generic Aura mask.
    for (const dialog of document.querySelectorAll('.flexipageEditorMessage.visualEditorModal [role="dialog"]')) {
      dismissDialog(dialog, '.modal-body', 'button.slds-modal__close.closeIcon');
    }
  }

  // Aura reuses its error mask and changes its text/classes on each error.
  // Observe insertions too, so replacing the mask or loading a new view works.
  const observer = new MutationObserver(dismissConnectionPopup);
  observer.observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'id', 'disabled']
  });
  dismissConnectionPopup();

  // Component registration can finish without another DOM mutation.
  let retries = 0;
  function retryPrevention() {
    if (!installPrevention() && ++retries < 120) setTimeout(retryPrevention, 250);
  }
  retryPrevention();
})();
