// ==UserScript==
// @name         WaniKani Review Forecast Open Today
// @namespace    https://github.com/EmerenSolutions/wanikani-userscripts
// @version      0.3.2
// @description  Opens today's Review Forecast schedule on the WaniKani dashboard
// @author       Johan Emerén
// @copyright    2026, Johan Emerén
// @license      MIT
// @match        https://www.wanikani.com/*
// @match        https://preview.wanikani.com/*
// @grant        none
// @inject-into  page
// @run-at       document-start
// @noframes
// @downloadURL  https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/review-forecast-open-today/src/wanikani-review-forecast-open-today.user.js
// @updateURL    https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/review-forecast-open-today/src/wanikani-review-forecast-open-today.user.js
// ==/UserScript==

(() => {
  'use strict';

  const FORECAST_FRAME_SELECTOR = [
    'turbo-frame[src*="/widgets/review-forecast"]',
    'turbo-frame[data-dashboard-widget-url-value*="/widgets/review-forecast"]'
  ].join(', ');
  const FORECAST_LINK_SELECTOR = [
    'a[href^="#forecast-content-"]',
    '[data-action~="detail#showDetail"]',
    '[data-detail-target~="anchor"]'
  ].join('');
  const DETAIL_CONTROLLER_SELECTOR = '[data-controller~="detail"]';
  const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

  // A handled frame stays closed after a manual click until Turbo renders it again.
  const handledFrames = new WeakMap();
  const queuedFrames = new WeakSet();

  const isDashboardPage = () =>
    location.pathname === '/' || /^\/dashboard\/?$/u.test(location.pathname);

  const isForecastFrame = element =>
    element instanceof Element && element.matches(FORECAST_FRAME_SELECTOR);

  const getToday = () => {
    const date = new Date();
    return {
      key: date.toDateString(),
      label: WEEKDAY_FORMATTER.format(date)
    };
  };

  const findTodayLink = (controller, today) =>
    [...controller.querySelectorAll(FORECAST_LINK_SELECTOR)]
      .find(link => link.textContent.replace(/\s+/gu, ' ').trim().startsWith(today));

  const getDetailPanel = (controller, link) => {
    const panelId = link.getAttribute('aria-controls');
    return panelId ? controller.querySelector(`#${CSS.escape(panelId)}`) : null;
  };

  const openToday = frame => {
    if (!isDashboardPage() || !isForecastFrame(frame)) return false;

    const today = getToday();
    if (handledFrames.get(frame) === today.key) return true;

    const controller = frame.querySelector(DETAIL_CONTROLLER_SELECTOR);
    if (controller?.getAttribute('data-detail-connected-value') !== 'true') return false;

    const link = findTodayLink(controller, today.label);
    if (!link) return false;

    const panel = getDetailPanel(controller, link);
    handledFrames.set(frame, today.key);

    if (link.getAttribute('aria-selected') === 'true' || (panel && !panel.hidden)) {
      return true;
    }

    link.click();
    return true;
  };

  const openWhenReady = frame => {
    if (openToday(frame) || queuedFrames.has(frame)) return;

    queuedFrames.add(frame);
    queueMicrotask(() => {
      queuedFrames.delete(frame);
      openToday(frame);
    });
  };

  const openLoadedForecasts = () => {
    if (!isDashboardPage()) return;
    document.querySelectorAll(FORECAST_FRAME_SELECTOR).forEach(openWhenReady);
  };

  document.addEventListener('turbo:before-frame-render', event => {
    const frame = event.target;
    if (!isDashboardPage() || !isForecastFrame(frame)) return;

    handledFrames.delete(frame);

    const render = event.detail.render;
    event.detail.render = async (currentFrame, newFrame) => {
      await render(currentFrame, newFrame);

      // Stimulus connects during the microtask checkpoint after Turbo updates the frame.
      await Promise.resolve();
      openWhenReady(currentFrame);
    };
  });

  document.addEventListener('turbo:frame-load', event => {
    if (isForecastFrame(event.target)) {
      openWhenReady(event.target);
    }
  });

  document.addEventListener('turbo:load', openLoadedForecasts);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', openLoadedForecasts, { once: true });
  } else {
    openLoadedForecasts();
  }
})();
