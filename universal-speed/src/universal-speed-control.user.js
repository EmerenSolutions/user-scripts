// ==UserScript==
// @name         Universal Speed Control
// @namespace    https://github.com/EmerenSolutions/user-scripts
// @version      0.6.0
// @description  Adjusts browser timers and animation clocks with per-site controls
// @author       Johan Emerén
// @copyright    2026, Johan Emerén
// @license      MIT
// @match        https://itch.io/*
// @match        https://*.itch.io/*
// @match        https://html-classic.itch.zone/*
// @match        https://crazygames.com/*
// @match        https://*.crazygames.com/*
// @grant        none
// @inject-into  page
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/universal-speed/src/universal-speed-control.user.js
// @updateURL    https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/universal-speed/src/universal-speed-control.user.js
// ==/UserScript==

(() => {
  'use strict';

  // Avoid patching the same page realm twice if a manager reinjects the script.
  const INSTANCE_KEY = Symbol.for('emeren.universalSpeedControl.instance');
  if (window[INSTANCE_KEY]) return;

  Object.defineProperty(window, INSTANCE_KEY, {
    configurable: false,
    enumerable: false,
    value: true
  });

  const STORAGE_KEY = 'emeren.universal-speed-control.settings.v1';
  const FRAME_MESSAGE_CHANNEL = 'emeren.universal-speed-control.frame.v1';
  const PANEL_HOST_ID = 'emeren-universal-speed-control';
  const MIN_SPEED = 0.1;
  const MAX_SPEED = 100;
  const MAX_TIMER_DELAY = 2_147_483_647;
  const MAX_RAF_TICKS_PER_FRAME = 100;
  const MAX_RAF_WORK_MS = 8;
  const DEFAULT_FRAME_DURATION = 1000 / 60;
  const ANIMATION_SAMPLE_MS = 1000;
  const ANIMATION_REPORT_MAX_AGE_MS = 3000;
  const SLIDER_APPLY_DELAY_MS = 60;
  const DETECTION_SPEED = 5;
  const DETECTION_SAMPLE_MS = 2000;
  const DETECTION_SETTLE_MS = 100;
  const COUNTER_READ_TIMEOUT_MS = 1000;
  const TIMING_METHODS = Object.freeze([
    { key: 'setInterval', label: 'setInterval' },
    { key: 'setTimeout', label: 'setTimeout' },
    { key: 'performanceNow', label: 'performance.now()' },
    { key: 'dateNow', label: 'Date.now()' },
    { key: 'requestAnimationFrame', label: 'requestAnimationFrame' }
  ]);
  const DEFAULT_CONFIG = Object.freeze({
    speed: 1,
    setInterval: false,
    setTimeout: false,
    performanceNow: false,
    dateNow: false,
    requestAnimationFrame: false
  });

  // Keep stable references so our wrappers never call themselves recursively.
  const native = Object.freeze({
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    clearInterval: window.clearInterval.bind(window),
    performanceNow: window.performance.now.bind(window.performance),
    dateNow: Date.now.bind(Date),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window)
  });

  const normalizeSpeed = value => {
    const speed = Number(value);
    if (!Number.isFinite(speed)) return DEFAULT_CONFIG.speed;
    return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 10) / 10));
  };

  const normalizeConfig = value => {
    const source = value && typeof value === 'object' ? value : {};

    return {
      speed: normalizeSpeed(source.speed),
      setInterval: source.setInterval === true,
      setTimeout: source.setTimeout === true,
      performanceNow: source.performanceNow === true,
      dateNow: source.dateNow === true,
      requestAnimationFrame: source.requestAnimationFrame === true
    };
  };

  const readStoredConfig = () => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored ? normalizeConfig(JSON.parse(stored)) : { ...DEFAULT_CONFIG };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  };

  const storeConfig = value => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Storage can be unavailable in sandboxed or opaque-origin documents.
    }
  };

  // Only the top page owns persisted settings and UI. Child frames receive a
  // synchronized copy, preventing different origins from drifting apart.
  const isTopWindow = window.top === window;
  let config = isTopWindow ? readStoredConfig() : { ...DEFAULT_CONFIG };
  // Logical IDs remain stable even when an active timer is rescheduled. The
  // high range minimizes collisions with native IDs created before injection.
  let nextLogicalId = 1_000_000_000;
  const timers = new Map();
  const animationCallbacks = new Map();
  const inFlightAnimationCallbacks = new Set();
  const frameAnimationReports = new Map();
  let achievedAnimationSpeed = null;
  let renderPanel = () => {};
  let openPanel = () => {};

  const allocateLogicalId = () => {
    do {
      nextLogicalId += 1;
      if (nextLogicalId > 2_000_000_000) nextLogicalId = 1_000_000_000;
    } while (timers.has(nextLogicalId) || animationCallbacks.has(nextLogicalId));

    return nextLogicalId;
  };

  // Anchor-based virtual clocks stay continuous when the multiplier changes;
  // only elapsed time after the change uses the new multiplier.
  const createVirtualClock = (readReal, isScaled) => {
    let realAnchor = readReal();
    let virtualAnchor = realAnchor;

    const read = () => {
      const realNow = readReal();
      const multiplier = isScaled() ? config.speed : 1;
      return virtualAnchor + ((realNow - realAnchor) * multiplier);
    };

    const rebase = () => {
      const currentValue = read();
      realAnchor = readReal();
      virtualAnchor = currentValue;
    };

    return { read, rebase };
  };

  const performanceClock = createVirtualClock(
    native.performanceNow,
    () => config.performanceNow
  );
  const dateClock = createVirtualClock(native.dateNow, () => config.dateNow);

  // Timers store their remaining delay in virtual milliseconds. A configuration
  // change rebases that value before scheduling a new native timeout.
  const normalizeDelay = value => {
    const delay = Number(value ?? 0);
    if (!Number.isFinite(delay) || delay <= 0) return 0;
    return Math.min(delay, MAX_TIMER_DELAY);
  };

  const timerMultiplier = kind => {
    const enabled = kind === 'interval' ? config.setInterval : config.setTimeout;
    return enabled ? config.speed : 1;
  };

  const invokeTimerHandler = timer => {
    if (typeof timer.handler === 'function') {
      Reflect.apply(timer.handler, window, timer.args);
      return;
    }

    window.eval(String(timer.handler));
  };

  const scheduleTimer = timer => {
    timer.factor = timerMultiplier(timer.kind);
    timer.realAnchor = native.performanceNow();
    timer.nativeId = native.setTimeout(() => {
      if (!timers.has(timer.id)) return;

      if (timer.kind === 'timeout') {
        timers.delete(timer.id);
      } else {
        timer.remaining = timer.delay;
        scheduleTimer(timer);
      }

      invokeTimerHandler(timer);
    }, timer.remaining / timer.factor);
  };

  const rebaseTimer = timer => {
    const elapsed = Math.max(0, native.performanceNow() - timer.realAnchor);
    timer.remaining = Math.max(0, timer.remaining - (elapsed * timer.factor));
    native.clearTimeout(timer.nativeId);
  };

  const createTimer = (kind, handler, delay, args) => {
    const id = allocateLogicalId();
    const normalizedDelay = normalizeDelay(delay);
    const timer = {
      id,
      kind,
      handler,
      args,
      delay: normalizedDelay,
      remaining: normalizedDelay,
      factor: 1,
      realAnchor: native.performanceNow(),
      nativeId: null
    };

    timers.set(id, timer);
    scheduleTimer(timer);
    return id;
  };

  const clearTimer = id => {
    const timer = timers.get(Number(id));
    if (!timer) return false;

    native.clearTimeout(timer.nativeId);
    timers.delete(timer.id);
    return true;
  };

  window.setTimeout = (handler, delay, ...args) =>
    createTimer('timeout', handler, delay, args);

  window.setInterval = (handler, delay, ...args) =>
    createTimer('interval', handler, delay, args);

  window.clearTimeout = id => {
    if (!clearTimer(id)) native.clearTimeout(id);
  };

  window.clearInterval = id => {
    if (!clearTimer(id)) native.clearInterval(id);
  };

  // Always read through the anchors so toggling a clock never makes time jump
  // backward after an accelerated probe.
  const virtualPerformanceNow = () => performanceClock.read();
  const virtualDateNow = () => Math.floor(dateClock.read());

  try {
    Object.defineProperty(window.performance, 'now', {
      configurable: true,
      value: virtualPerformanceNow
    });
  } catch {
    window.performance.now = virtualPerformanceNow;
  }

  Date.now = virtualDateNow;

  // A single native animation-frame pump can emit multiple logical frames when
  // speeding up, or accumulate fractional work when slowing down.
  let nativeAnimationFrameId = null;
  let previousNativeFrameTime = null;
  let virtualAnimationFrameTime = null;
  let animationFrameAccumulator = 0;
  let pendingVirtualFrameTime = 0;
  let animationPumpRunning = false;
  let animationSampleRealTime = 0;
  let animationSampleVirtualTime = 0;

  const resetAnimationSample = () => {
    animationSampleRealTime = 0;
    animationSampleVirtualTime = 0;
  };

  const resetAnimationTiming = () => {
    previousNativeFrameTime = null;
    virtualAnimationFrameTime = null;
    animationFrameAccumulator = 0;
    pendingVirtualFrameTime = 0;
    resetAnimationSample();
  };

  const resetAnimationMeasurements = () => {
    achievedAnimationSpeed = null;
    frameAnimationReports.clear();
    resetAnimationSample();
  };

  // Report virtual animation time delivered per real elapsed time. This
  // reflects both deliberately dropped work and a slow physical frame rate.
  const recordAnimationProgress = (realElapsed, virtualElapsed) => {
    if (!config.requestAnimationFrame) return;

    animationSampleRealTime += realElapsed;
    animationSampleVirtualTime += virtualElapsed;
    if (animationSampleRealTime < ANIMATION_SAMPLE_MS) return;

    const achieved = animationSampleVirtualTime / animationSampleRealTime;
    achievedAnimationSpeed = achieved;
    resetAnimationSample();

    if (isTopWindow) {
      renderPanel();
      return;
    }

    try {
      window.top.postMessage({
        channel: FRAME_MESSAGE_CHANNEL,
        type: 'animation-stats',
        speed: config.speed,
        achieved
      }, '*');
    } catch {
      // The top frame may have navigated while this sample was collected.
    }
  };

  const getAchievedAnimationSpeed = () => {
    const now = native.performanceNow();
    const values = achievedAnimationSpeed === null
      ? []
      : [achievedAnimationSpeed];

    for (const [source, report] of frameAnimationReports) {
      if (now - report.receivedAt > ANIMATION_REPORT_MAX_AGE_MS) {
        frameAnimationReports.delete(source);
      } else {
        values.push(report.achieved);
      }
    }

    return values.length === 0 ? null : Math.min(...values);
  };

  const reportAnimationError = error => {
    native.setTimeout(() => {
      throw error;
    }, 0);
  };

  const scheduleAnimationPump = () => {
    if (
      animationPumpRunning
      || nativeAnimationFrameId !== null
      || animationCallbacks.size === 0
    ) return;

    nativeAnimationFrameId = native.requestAnimationFrame(runAnimationPump);
  };

  const runAnimationPump = nativeTimestamp => {
    nativeAnimationFrameId = null;
    animationPumpRunning = true;
    const workStartedAt = native.performanceNow();

    const elapsed = previousNativeFrameTime === null
      ? DEFAULT_FRAME_DURATION
      : Math.max(0, nativeTimestamp - previousNativeFrameTime);
    const multiplier = config.requestAnimationFrame ? config.speed : 1;
    const timestampMultiplier = config.performanceNow || config.requestAnimationFrame
      ? config.speed
      : 1;

    previousNativeFrameTime = nativeTimestamp;
    animationFrameAccumulator += multiplier;
    pendingVirtualFrameTime += elapsed * timestampMultiplier;

    let ticks = Math.floor(animationFrameAccumulator);
    if (ticks > MAX_RAF_TICKS_PER_FRAME) {
      ticks = MAX_RAF_TICKS_PER_FRAME;
      animationFrameAccumulator = 0;
    } else {
      animationFrameAccumulator -= ticks;
    }

    if (virtualAnimationFrameTime === null) {
      virtualAnimationFrameTime = performanceClock.read() - pendingVirtualFrameTime;
    }

    let deliveredVirtualTime = 0;
    if (ticks > 0) {
      const timePerTick = pendingVirtualFrameTime / ticks;
      pendingVirtualFrameTime = 0;

      for (let tick = 0; tick < ticks && animationCallbacks.size > 0; tick += 1) {
        virtualAnimationFrameTime += timePerTick;
        const callbacks = [...animationCallbacks.entries()];
        animationCallbacks.clear();
        callbacks.forEach(([id]) => inFlightAnimationCallbacks.add(id));

        let callbackRan = false;
        for (const [id, callback] of callbacks) {
          if (!inFlightAnimationCallbacks.delete(id)) continue;
          callbackRan = true;

          try {
            callback(virtualAnimationFrameTime);
          } catch (error) {
            reportAnimationError(error);
          }
        }

        if (callbackRan) deliveredVirtualTime += timePerTick;

        // Never let a large requested multiplier monopolize the UI thread.
        // Unfinished logical frames are dropped instead of creating a backlog.
        if (native.performanceNow() - workStartedAt >= MAX_RAF_WORK_MS) break;
      }
    }

    recordAnimationProgress(elapsed, deliveredVirtualTime);
    animationPumpRunning = false;

    if (animationCallbacks.size > 0) {
      scheduleAnimationPump();
    } else {
      resetAnimationTiming();
    }
  };

  window.requestAnimationFrame = callback => {
    if (typeof callback !== 'function') {
      throw new TypeError('requestAnimationFrame callback must be a function');
    }

    // Most pages pay only one branch while both animation overrides are off.
    if (!config.requestAnimationFrame && !config.performanceNow) {
      return native.requestAnimationFrame(callback);
    }

    const id = allocateLogicalId();
    animationCallbacks.set(id, callback);
    scheduleAnimationPump();
    return id;
  };

  window.cancelAnimationFrame = id => {
    const logicalId = Number(id);
    const deletedPending = animationCallbacks.delete(logicalId);
    const deletedInFlight = inFlightAnimationCallbacks.delete(logicalId);

    if (!deletedPending && !deletedInFlight) {
      native.cancelAnimationFrame(id);
      return;
    }

    if (animationCallbacks.size === 0 && nativeAnimationFrameId !== null) {
      native.cancelAnimationFrame(nativeAnimationFrameId);
      nativeAnimationFrameId = null;
      resetAnimationTiming();
    }
  };

  // Frame messages are best-effort because a target may navigate or disappear
  // after it was discovered.
  const postFrameMessage = (targetWindow, type, details = {}) => {
    try {
      targetWindow.postMessage({
        channel: FRAME_MESSAGE_CHANNEL,
        type,
        ...details
      }, '*');
      return true;
    } catch {
      return false;
    }
  };

  // Direct children relay messages to their descendants, covering deeply
  // nested games without violating the browser's same-origin policy.
  const broadcastFrameMessage = (type, details = {}) => {
    for (const frame of document.querySelectorAll('iframe, frame')) {
      if (frame.contentWindow) postFrameMessage(frame.contentWindow, type, details);
    }
  };

  const sendConfigToFrame = targetWindow => {
    postFrameMessage(targetWindow, 'config', { config });
  };

  const broadcastConfigToFrames = () => {
    broadcastFrameMessage('config', { config });
  };

  const applyConfig = (nextConfig, persist = isTopWindow) => {
    performanceClock.rebase();
    dateClock.rebase();

    for (const timer of timers.values()) rebaseTimer(timer);
    const normalizedConfig = normalizeConfig(nextConfig);
    const animationMeasurementChanged = normalizedConfig.speed !== config.speed
      || normalizedConfig.requestAnimationFrame !== config.requestAnimationFrame;
    config = normalizedConfig;
    for (const timer of timers.values()) scheduleTimer(timer);

    resetAnimationTiming();
    if (animationMeasurementChanged) resetAnimationMeasurements();

    if (persist && isTopWindow) storeConfig(config);
    broadcastConfigToFrames();
    renderPanel();
  };

  const detectionState = {
    phase: 'idle',
    status: 'Select a visible counter to test the timing methods.',
    results: [],
    best: null,
    originalConfig: null,
    selectedText: ''
  };
  const pendingCounterReads = new Map();
  let selectedCounterElement = null;
  let highlightedCounterElement = null;
  let highlightedCounterStyle = null;
  let counterSelectionActive = false;
  let detectionSource = null;
  let detectionRunId = 0;
  let nextCounterReadId = 0;

  // Counters containing one clock value (for example 01:23) or one numeric
  // value are accepted. Ambiguous elements are rejected so the user can click
  // a smaller, more precise part of the page.
  const parseCounterText = text => {
    const normalizedText = String(text ?? '')
      .replace(/\u2212/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalizedText) {
      return { ok: false, error: 'That element has no visible text.' };
    }

    const timeMatches = normalizedText.match(
      /[+-]?\d+(?::\d{1,2}){1,2}(?:[.,]\d+)?/g
    ) || [];
    if (timeMatches.length === 1) {
      const remainingText = normalizedText.replace(timeMatches[0], '');
      if (!/\d/.test(remainingText)) {
        const sign = timeMatches[0].startsWith('-') ? -1 : 1;
        const parts = timeMatches[0]
          .replace(/^[+-]/, '')
          .replace(',', '.')
          .split(':')
          .map(Number);
        const value = parts.reduce((total, part) => (total * 60) + part, 0);
        return { ok: Number.isFinite(value), value: value * sign, text: normalizedText };
      }
    }

    const numberMatches = normalizedText.match(
      /[+-]?(?:\d[\d.,'’]*\d|\d)/g
    ) || [];
    if (numberMatches.length !== 1) {
      return {
        ok: false,
        error: 'Select an element containing exactly one number or clock value.'
      };
    }

    const rawNumber = numberMatches[0];
    const sign = rawNumber.startsWith('-') ? -1 : 1;
    const unsigned = rawNumber.replace(/^[+-]/, '').replace(/['’]/g, '');
    const decimalIndex = Math.max(unsigned.lastIndexOf('.'), unsigned.lastIndexOf(','));
    const normalizedNumber = decimalIndex < 0
      ? unsigned
      : `${unsigned.slice(0, decimalIndex).replace(/[.,]/g, '')}.${unsigned.slice(decimalIndex + 1)}`;
    const value = Number(normalizedNumber) * sign;

    return Number.isFinite(value)
      ? { ok: true, value, text: normalizedText }
      : { ok: false, error: 'The selected value could not be parsed.' };
  };

  const readCounterElement = element => {
    if (!(element instanceof Element) || element.isConnected === false) {
      return { ok: false, error: 'The selected counter is no longer on the page.' };
    }

    const text = typeof element.innerText === 'string'
      ? element.innerText
      : element.textContent;
    return parseCounterText(text);
  };

  const findCounterElement = startElement => {
    let element = startElement;
    for (let depth = 0; depth < 5 && element instanceof Element; depth += 1) {
      if (element.id === PANEL_HOST_ID) break;
      const result = readCounterElement(element);
      if (result.ok) return { element, result };
      element = element.parentElement;
    }

    return {
      element: null,
      result: { ok: false, error: 'Select an element containing exactly one number or clock value.' }
    };
  };

  const clearCounterHighlight = () => {
    if (highlightedCounterElement && highlightedCounterStyle) {
      highlightedCounterElement.style.outline = highlightedCounterStyle.outline;
      highlightedCounterElement.style.outlineOffset = highlightedCounterStyle.outlineOffset;
    }
    highlightedCounterElement = null;
    highlightedCounterStyle = null;
  };

  const highlightCounter = element => {
    if (element === highlightedCounterElement) return;
    clearCounterHighlight();
    if (!element) return;

    highlightedCounterElement = element;
    highlightedCounterStyle = {
      outline: element.style.outline,
      outlineOffset: element.style.outlineOffset
    };
    element.style.outline = '2px solid #1976d2';
    element.style.outlineOffset = '2px';
  };

  const reportCounterSelectionError = error => {
    if (isTopWindow) {
      detectionState.status = error;
      renderPanel();
    } else {
      postFrameMessage(window.top, 'counter-selection-error', { error });
    }
  };

  const handleCounterPointer = event => {
    if (!counterSelectionActive) return;
    highlightCounter(findCounterElement(event.target).element);
  };

  const stopCounterSelectionLocal = (release = false) => {
    if (counterSelectionActive) {
      document.removeEventListener('pointerover', handleCounterPointer, true);
      document.removeEventListener('click', handleCounterClick, true);
    }
    counterSelectionActive = false;
    clearCounterHighlight();
    if (release) selectedCounterElement = null;
  };

  const handleCounterClick = event => {
    if (!counterSelectionActive) return;
    // Let the top-level selection prompt handle its own Cancel button.
    if (event.target instanceof Element && event.target.id === PANEL_HOST_ID) return;
    const selection = findCounterElement(event.target);
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (!selection.element) {
      reportCounterSelectionError(selection.result.error);
      return;
    }

    selectedCounterElement = selection.element;
    stopCounterSelectionLocal();
    if (isTopWindow) {
      finishCounterSelection(window, selection.result.text);
    } else {
      postFrameMessage(window.top, 'counter-selected', {
        text: selection.result.text
      });
    }
  };

  const startCounterSelectionLocal = () => {
    stopCounterSelectionLocal(true);
    counterSelectionActive = true;
    document.addEventListener('pointerover', handleCounterPointer, true);
    document.addEventListener('click', handleCounterClick, true);
  };

  const releaseCounterSelection = () => {
    stopCounterSelectionLocal(true);
    broadcastFrameMessage('counter-selection-release');
    detectionSource = null;
  };

  const clearPendingCounterReads = () => {
    for (const pending of pendingCounterReads.values()) {
      native.clearTimeout(pending.timeoutId);
      pending.reject(new Error('Detection cancelled.'));
    }
    pendingCounterReads.clear();
  };

  const requestSelectedCounter = () => {
    if (detectionSource === window) {
      return Promise.resolve(readCounterElement(selectedCounterElement));
    }
    if (!detectionSource) {
      return Promise.reject(new Error('The selected counter frame is unavailable.'));
    }

    nextCounterReadId += 1;
    const requestId = nextCounterReadId;
    return new Promise((resolve, reject) => {
      const timeoutId = native.setTimeout(() => {
        pendingCounterReads.delete(requestId);
        reject(new Error('The selected counter did not respond.'));
      }, COUNTER_READ_TIMEOUT_MS);
      pendingCounterReads.set(requestId, {
        source: detectionSource,
        resolve,
        reject,
        timeoutId
      });

      if (!postFrameMessage(detectionSource, 'counter-read', { requestId })) {
        native.clearTimeout(timeoutId);
        pendingCounterReads.delete(requestId);
        reject(new Error('The selected counter frame is unavailable.'));
      }
    });
  };

  const waitRealTime = milliseconds => new Promise(resolve => {
    native.setTimeout(resolve, milliseconds);
  });

  const measureSelectedCounter = async runId => {
    const start = await requestSelectedCounter();
    if (!start.ok) throw new Error(start.error);
    await waitRealTime(DETECTION_SAMPLE_MS);
    if (runId !== detectionRunId) throw new Error('Detection cancelled.');
    const end = await requestSelectedCounter();
    if (!end.ok) throw new Error(end.error);

    return { delta: Math.abs(end.value - start.value) };
  };

  const updateDetectionProgress = (status, results = detectionState.results) => {
    detectionState.status = status;
    detectionState.results = results;
    renderPanel();
  };

  const runCounterDetection = async () => {
    const runId = detectionRunId;
    const originalConfig = { ...config };
    detectionState.originalConfig = originalConfig;
    let finalPhase = 'error';
    let finalStatus = 'Detection failed.';
    let finalBest = null;

    try {
      updateDetectionProgress(
        `Measuring the 2-second baseline for “${detectionState.selectedText}”…`,
        []
      );
      applyConfig(DEFAULT_CONFIG, false);
      await waitRealTime(DETECTION_SETTLE_MS);
      if (runId !== detectionRunId) return;
      const baseline = await measureSelectedCounter(runId);
      const results = [];

      for (let index = 0; index < TIMING_METHODS.length; index += 1) {
        const method = TIMING_METHODS[index];
        updateDetectionProgress(
          `Testing ${method.label} for 2 seconds (${index + 1}/${TIMING_METHODS.length})…`,
          results
        );
        applyConfig({ ...DEFAULT_CONFIG, speed: DETECTION_SPEED, [method.key]: true }, false);
        await waitRealTime(DETECTION_SETTLE_MS);
        if (runId !== detectionRunId) return;
        const measurement = await measureSelectedCounter(runId);
        const ratio = baseline.delta > Number.EPSILON
          ? measurement.delta / baseline.delta
          : measurement.delta > Number.EPSILON ? Infinity : 0;
        results.push({ ...method, ...measurement, ratio });
      }

      const ranked = [...results].sort((a, b) => b.ratio - a.ratio);
      const winner = ranked[0];
      const confident = winner && (
        winner.ratio === Infinity
        || (winner.ratio >= 1.5 && winner.delta > baseline.delta)
      );
      finalPhase = 'complete';
      finalBest = confident ? winner : null;
      finalStatus = confident
        ? `Likely method: ${winner.label}. It changed the counter ${winner.ratio === Infinity ? 'from stationary' : `${Math.round(winner.ratio * 10) / 10}× faster`} during the probe.`
        : 'No clear winner. Try selecting a counter that updates continuously.';
      detectionState.results = ranked;
    } catch (error) {
      if (runId !== detectionRunId) return;
      finalStatus = error instanceof Error ? error.message : 'Detection failed.';
    }

    if (runId !== detectionRunId) return;
    applyConfig(originalConfig, false);
    releaseCounterSelection();
    detectionState.phase = finalPhase;
    detectionState.status = finalStatus;
    detectionState.best = finalBest;
    detectionState.originalConfig = null;
    renderPanel();
    openPanel();
  };

  const finishCounterSelection = (source, selectedText) => {
    if (!isTopWindow || detectionState.phase !== 'selecting') return;
    detectionSource = source;
    detectionState.phase = 'running';
    detectionState.selectedText = String(selectedText || '').slice(0, 80);
    stopCounterSelectionLocal();
    broadcastFrameMessage('counter-selection-stop');
    openPanel();
    renderPanel();
    void runCounterDetection();
  };

  const beginCounterDetection = () => {
    if (!isTopWindow) return;
    detectionRunId += 1;
    clearPendingCounterReads();
    releaseCounterSelection();
    detectionState.phase = 'selecting';
    detectionState.status = 'Click a visible counter, or use Cancel.';
    detectionState.results = [];
    detectionState.best = null;
    detectionState.selectedText = '';
    startCounterSelectionLocal();
    broadcastFrameMessage('counter-selection-start');
    renderPanel();
  };

  const cancelCounterDetection = () => {
    if (!isTopWindow || !['selecting', 'running'].includes(detectionState.phase)) return;
    const originalConfig = detectionState.originalConfig;
    detectionRunId += 1;
    clearPendingCounterReads();
    releaseCounterSelection();
    if (originalConfig) applyConfig(originalConfig, false);
    detectionState.phase = 'idle';
    detectionState.status = 'Detection cancelled. Select a counter to try again.';
    detectionState.results = [];
    detectionState.best = null;
    detectionState.originalConfig = null;
    renderPanel();
    openPanel();
  };

  const applyDetectedMethod = () => {
    if (!isTopWindow || !detectionState.best) return;
    const method = detectionState.best;
    applyConfig({ ...DEFAULT_CONFIG, speed: config.speed, [method.key]: true });
    detectionState.phase = 'applied';
    detectionState.status = `${method.label} is enabled at ${config.speed}×.`;
    detectionState.best = null;
    renderPanel();
  };

  window.addEventListener('storage', event => {
    if (!isTopWindow || event.key !== STORAGE_KEY || !event.newValue) return;

    try {
      applyConfig(JSON.parse(event.newValue), false);
    } catch {
      // Ignore malformed values written by another tab or page script.
    }
  });

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || message.channel !== FRAME_MESSAGE_CHANNEL) return;

    if (
      message.type === 'counter-selection-start'
      && !isTopWindow
      && event.source === window.parent
    ) {
      startCounterSelectionLocal();
      broadcastFrameMessage('counter-selection-start');
      return;
    }

    if (
      message.type === 'counter-selection-stop'
      && !isTopWindow
      && event.source === window.parent
    ) {
      stopCounterSelectionLocal();
      broadcastFrameMessage('counter-selection-stop');
      return;
    }

    if (
      message.type === 'counter-selection-release'
      && !isTopWindow
      && event.source === window.parent
    ) {
      stopCounterSelectionLocal(true);
      broadcastFrameMessage('counter-selection-release');
      return;
    }

    if (message.type === 'counter-selected' && isTopWindow && event.source) {
      finishCounterSelection(event.source, message.text);
      return;
    }

    if (message.type === 'counter-selection-error' && isTopWindow) {
      if (detectionState.phase === 'selecting') {
        detectionState.status = String(message.error || 'That counter could not be read.');
        renderPanel();
      }
      return;
    }

    if (
      message.type === 'counter-read'
      && !isTopWindow
      && event.source === window.top
    ) {
      postFrameMessage(window.top, 'counter-value', {
        requestId: message.requestId,
        result: readCounterElement(selectedCounterElement)
      });
      return;
    }

    if (message.type === 'counter-value' && isTopWindow && event.source) {
      const pending = pendingCounterReads.get(message.requestId);
      if (pending && pending.source === event.source) {
        native.clearTimeout(pending.timeoutId);
        pendingCounterReads.delete(message.requestId);
        pending.resolve(message.result && typeof message.result === 'object'
          ? message.result
          : { ok: false, error: 'The counter returned an invalid value.' });
      }
      return;
    }

    if (message.type === 'request-config' && event.source) {
      sendConfigToFrame(event.source);
      return;
    }

    if (
      message.type === 'animation-stats'
      && isTopWindow
      && event.source
      && message.speed === config.speed
      && Number.isFinite(message.achieved)
      && message.achieved >= 0
    ) {
      frameAnimationReports.set(event.source, {
        achieved: message.achieved,
        receivedAt: native.performanceNow()
      });
      renderPanel();
      return;
    }

    if (
      message.type === 'config'
      && !isTopWindow
      && event.source === window.parent
    ) {
      applyConfig(message.config, false);
    }
  });

  // Shadow DOM keeps host-page styles from changing the controls (and vice
  // versa). Frames run the timing engine but never create duplicate panels.
  const installPanel = () => {
    if (!isTopWindow || document.getElementById(PANEL_HOST_ID)) return;

    const host = document.createElement('div');
    host.id = PANEL_HOST_ID;
    const shadow = host.attachShadow({ mode: 'closed' });

    shadow.innerHTML = `
      <style>
        :host { all: initial; color-scheme: light dark; }
        * { box-sizing: border-box; }
        .usc-launcher, .usc-panel, button, input { font-family: system-ui, sans-serif; }
        .usc-launcher {
          position: fixed; top: 12px; right: 12px; z-index: 2147483647;
          border: 1px solid rgba(127, 127, 127, .35); border-radius: 999px;
          padding: 6px 10px; color: #fff; background: rgba(20, 94, 176, .92);
          box-shadow: 0 2px 10px rgba(0, 0, 0, .25); cursor: pointer;
          font-size: 12px; font-weight: 700; line-height: 1.2;
        }
        .usc-panel {
          position: fixed; top: 48px; right: 12px; z-index: 2147483647;
          width: min(340px, calc(100vw - 24px)); padding: 16px;
          border: 1px solid rgba(127, 127, 127, .35); border-radius: 12px;
          color: #18212f; background: rgba(255, 255, 255, .98);
          box-shadow: 0 12px 36px rgba(0, 0, 0, .28);
          font-size: 14px; line-height: 1.35;
        }
        .usc-panel[hidden] { display: none; }
        .usc-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .usc-title { margin: 0; font-size: 17px; color: #145eb0; }
        .usc-close, .usc-reset, .usc-preset, .usc-detect, .usc-apply-detection {
          border: 1px solid #b8c2cf; border-radius: 7px; color: #243143;
          background: #f5f7fa; cursor: pointer;
        }
        button:disabled, input:disabled { cursor: not-allowed; opacity: .55; }
        .usc-close { width: 28px; height: 28px; font-size: 18px; }
        .usc-speed-row { display: grid; grid-template-columns: 1fr 58px; gap: 10px; margin: 16px 0 10px; }
        .usc-slider { width: 100%; accent-color: #1976d2; }
        .usc-output { font-variant-numeric: tabular-nums; font-weight: 700; text-align: right; }
        .usc-presets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
        .usc-preset { padding: 4px 8px; font-size: 12px; }
        .usc-options { display: grid; gap: 8px; padding: 12px 0; border-block: 1px solid #d9dfe7; }
        .usc-option { display: flex; align-items: center; gap: 9px; cursor: pointer; }
        .usc-option input { width: 17px; height: 17px; margin: 0; accent-color: #1976d2; }
        .usc-detection { padding: 11px 0; border-bottom: 1px solid #d9dfe7; }
        .usc-detection-actions { display: flex; flex-wrap: wrap; gap: 7px; }
        .usc-detect, .usc-apply-detection { padding: 5px 9px; font-size: 12px; }
        .usc-detection-status { margin: 8px 0 0; color: #5d6877; font-size: 12px; }
        .usc-detection-results { margin: 7px 0 0; padding-left: 20px; font-size: 11px; }
        .usc-selection-hint {
          position: fixed; top: 12px; left: 50%; z-index: 2147483647;
          transform: translateX(-50%); max-width: calc(100vw - 24px); padding: 8px 12px;
          border-radius: 8px; color: #fff; background: rgba(20, 94, 176, .96);
          box-shadow: 0 3px 14px rgba(0, 0, 0, .3);
          font: 700 13px/1.3 system-ui, sans-serif; text-align: center;
        }
        .usc-selection-cancel {
          margin-left: 8px; padding: 3px 7px; border: 1px solid rgba(255, 255, 255, .7);
          border-radius: 5px; color: #fff; background: transparent; cursor: pointer;
        }
        .usc-selection-hint[hidden] { display: none; }
        .usc-animation-status { margin: 10px 0 0; color: #5d6877; font-size: 12px; }
        .usc-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; }
        .usc-help { color: #5d6877; font-size: 11px; }
        .usc-reset { padding: 5px 9px; font-size: 12px; }
        @media (prefers-color-scheme: dark) {
          .usc-panel { color: #edf2f7; background: rgba(28, 34, 43, .98); }
          .usc-title { color: #68aef9; }
          .usc-close, .usc-reset, .usc-preset, .usc-detect, .usc-apply-detection { color: #edf2f7; background: #303947; border-color: #596679; }
          .usc-options, .usc-detection { border-color: #4b5666; }
          .usc-help, .usc-animation-status, .usc-detection-status { color: #aeb8c6; }
        }
      </style>
      <button class="usc-launcher" type="button" title="Universal Speed Control">1× · 0 active</button>
      <div class="usc-selection-hint" hidden>
        <span class="usc-selection-hint-text">Click a visible counter.</span>
        <button class="usc-selection-cancel" type="button">Cancel</button>
      </div>
      <section class="usc-panel" aria-label="Universal Speed Control" hidden>
        <div class="usc-heading">
          <h2 class="usc-title">Universal Speed Control</h2>
          <button class="usc-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="usc-speed-row">
          <input class="usc-slider" type="range" min="${MIN_SPEED}" max="${MAX_SPEED}" step="0.1" aria-label="Speed multiplier">
          <output class="usc-output">1×</output>
        </div>
        <div class="usc-presets" aria-label="Speed presets">
          ${[0.5, 1, 2, 3, 5, 10, 20, 50, 100]
            .map(speed => `<button class="usc-preset" type="button" data-speed="${speed}">${speed}×</button>`)
            .join('')}
        </div>
        <div class="usc-options">
          ${TIMING_METHODS.map(method => `
            <label class="usc-option"><input type="checkbox" data-setting="${method.key}"> ${method.label}</label>
          `).join('')}
        </div>
        <div class="usc-detection">
          <div class="usc-detection-actions">
            <button class="usc-detect" type="button">Detect method</button>
            <button class="usc-apply-detection" type="button" hidden>Use detected method</button>
          </div>
          <p class="usc-detection-status">Select a visible counter to test the timing methods.</p>
          <ol class="usc-detection-results" hidden></ol>
        </div>
        <p class="usc-animation-status">Animation speed: requestAnimationFrame is off.</p>
        <div class="usc-footer">
          <span class="usc-help">Settings are saved for this site.</span>
          <button class="usc-reset" type="button">Reset</button>
        </div>
      </section>
    `;

    const launcher = shadow.querySelector('.usc-launcher');
    const panel = shadow.querySelector('.usc-panel');
    const slider = shadow.querySelector('.usc-slider');
    const output = shadow.querySelector('.usc-output');
    const selectionHint = shadow.querySelector('.usc-selection-hint');
    const selectionHintText = shadow.querySelector('.usc-selection-hint-text');
    const detectButton = shadow.querySelector('.usc-detect');
    const applyDetectionButton = shadow.querySelector('.usc-apply-detection');
    const detectionStatus = shadow.querySelector('.usc-detection-status');
    const detectionResults = shadow.querySelector('.usc-detection-results');
    const animationStatus = shadow.querySelector('.usc-animation-status');
    let pendingSpeed = null;
    let pendingSpeedApplyId = null;

    const togglePanel = force => {
      panel.hidden = typeof force === 'boolean' ? !force : !panel.hidden;
    };
    openPanel = () => togglePanel(true);

    renderPanel = () => {
      const activeCount = TIMING_METHODS.filter(method => config[method.key]).length;
      const detectionBusy = ['selecting', 'running'].includes(detectionState.phase);

      launcher.textContent = `${config.speed}× · ${activeCount} active`;
      launcher.hidden = detectionState.phase === 'selecting';
      selectionHint.hidden = detectionState.phase !== 'selecting';
      selectionHintText.textContent = detectionState.status;
      if (detectionState.phase === 'selecting') panel.hidden = true;
      const displayedSpeed = pendingSpeed ?? config.speed;
      slider.value = String(displayedSpeed);
      output.value = `${displayedSpeed}×`;

      detectButton.textContent = detectionBusy ? 'Cancel detection' : 'Detect method';
      detectionStatus.textContent = detectionState.status;
      applyDetectionButton.hidden = !detectionState.best;
      detectionResults.hidden = detectionState.results.length === 0;
      detectionResults.innerHTML = detectionState.results.map(result => {
        const comparison = result.ratio === Infinity
          ? 'moved from a stationary baseline'
          : `${Math.round(result.ratio * 10) / 10}× baseline rate`;
        return `<li>${result.label}: ${comparison}</li>`;
      }).join('');

      if (!config.requestAnimationFrame) {
        animationStatus.textContent = 'Animation speed: requestAnimationFrame is off.';
      } else {
        const achieved = getAchievedAnimationSpeed();
        animationStatus.textContent = achieved === null
          ? `Animation speed: measuring… (${config.speed}× requested)`
          : `Animation speed: ~${Math.round(achieved * 10) / 10}× achieved / ${config.speed}× requested`;
      }

      for (const checkbox of shadow.querySelectorAll('[data-setting]')) {
        checkbox.checked = config[checkbox.dataset.setting];
        checkbox.disabled = detectionBusy;
      }
      slider.disabled = detectionBusy;
      shadow.querySelector('.usc-reset').disabled = detectionBusy;
      for (const preset of shadow.querySelectorAll('[data-speed]')) {
        preset.disabled = detectionBusy;
      }
    };

    launcher.addEventListener('click', () => togglePanel());
    shadow.querySelector('.usc-close').addEventListener('click', () => togglePanel(false));
    shadow.querySelector('.usc-selection-cancel').addEventListener('click', cancelCounterDetection);
    detectButton.addEventListener('click', () => {
      if (['selecting', 'running'].includes(detectionState.phase)) {
        cancelCounterDetection();
      } else {
        beginCounterDetection();
      }
    });
    applyDetectionButton.addEventListener('click', applyDetectedMethod);

    const cancelPendingSpeed = () => {
      if (pendingSpeedApplyId !== null) native.clearTimeout(pendingSpeedApplyId);
      pendingSpeedApplyId = null;
      pendingSpeed = null;
    };

    const commitConfig = nextConfig => {
      cancelPendingSpeed();
      applyConfig(nextConfig);
    };

    shadow.querySelector('.usc-reset').addEventListener('click', () => {
      commitConfig(DEFAULT_CONFIG);
    });

    slider.addEventListener('input', () => {
      pendingSpeed = slider.value;
      output.value = `${pendingSpeed}×`;
      if (pendingSpeedApplyId !== null) native.clearTimeout(pendingSpeedApplyId);
      pendingSpeedApplyId = native.setTimeout(() => {
        const speed = pendingSpeed;
        pendingSpeedApplyId = null;
        pendingSpeed = null;
        applyConfig({ ...config, speed });
      }, SLIDER_APPLY_DELAY_MS);
    });

    for (const preset of shadow.querySelectorAll('[data-speed]')) {
      preset.addEventListener('click', () => {
        commitConfig({ ...config, speed: preset.dataset.speed });
      });
    }

    for (const checkbox of shadow.querySelectorAll('[data-setting]')) {
      checkbox.addEventListener('change', () => {
        commitConfig({ ...config, [checkbox.dataset.setting]: checkbox.checked });
      });
    }

    document.documentElement.append(host);
    renderPanel();
  };

  if (document.documentElement) {
    installPanel();
  } else {
    document.addEventListener('readystatechange', installPanel, { once: true });
  }

  // The load broadcast catches frames already present; newly injected frames
  // request the current configuration as soon as their script starts.
  if (isTopWindow) {
    window.addEventListener('load', broadcastConfigToFrames, { once: true });
  } else {
    window.parent.postMessage({
      channel: FRAME_MESSAGE_CHANNEL,
      type: 'request-config'
    }, '*');
  }
})();
