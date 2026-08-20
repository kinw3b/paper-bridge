const PROTOCOL = "1.3";
const NAV_BREAKPOINTS = [
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

function tabSend(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function inject(tabId) {
  try {
    const pong = await tabSend(tabId, { type: "HC_PING" });
    if (pong?.ok) return { ok: true, reused: true };
  } catch { /* inject below */ }

  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["content/capture.css"],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/targeting.js", "content/nav-breakpoints.js", "content/capture.js"],
  });
  return { ok: true, reused: false };
}

function attach(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, PROTOCOL, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function detach(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => resolve());
  });
}

function cdp(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

async function hoverPair(tabId, captureId) {
  let attached = false;
  try {
    await attach(tabId);
    attached = true;
    await cdp(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 2,
      y: 2,
      buttons: 0,
      pointerType: "mouse",
    });
    await sleep(280);
    const prepared = await tabSend(tabId, { type: "HC_PREPARE_TARGET", captureId });
    if (!prepared?.ok) throw new Error(prepared?.error || "Target is no longer visible");
    const fallbackPoint = prepared.point;
    await cdp(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 2,
      y: 2,
      buttons: 0,
      pointerType: "mouse",
    });
    await sleep(220);
    const before = await tabSend(tabId, {
      type: "HC_SERIALIZE_TARGET",
      captureId,
      state: "default",
    });
    if (!before?.ok) throw new Error(before?.error || "Default state could not be serialized");
    const point = before.point || fallbackPoint;
    await cdp(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      buttons: 0,
      pointerType: "mouse",
    });
    await sleep(850);
    const after = await tabSend(tabId, {
      type: "HC_SERIALIZE_TARGET",
      captureId,
      state: "hover",
    });
    if (!after?.ok) throw new Error(after?.error || "Hover state could not be serialized");
    return {
      ok: true,
      capture: {
        ...before.capture,
        mode: "hover",
        defaultHtml: before.capture.html,
        hoverHtml: after.capture.html,
        html: undefined,
      },
    };
  } finally {
    if (attached) await detach(tabId);
  }
}

async function autoHover(tabId) {
  const listed = await tabSend(tabId, { type: "HC_AUTO_TARGETS", mode: "hover" });
  const targets = listed?.targets || [];
  const captures = [];
  for (const target of targets.slice(0, 8)) {
    const result = await hoverPair(tabId, target.captureId);
    if (result.ok) captures.push(result.capture);
  }
  return { ok: true, captures, scanned: targets.length };
}

function waitForTabComplete(tabId, expectedUrl, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Responsive Navbar tab timed out")), timeout);
    const finish = (error) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (error) reject(error);
      else resolve();
    };
    const onUpdated = (updatedId, change, tab) => {
      if (updatedId !== tabId || change.status !== "complete") return;
      if (expectedUrl && tab.url && !tab.url.startsWith(expectedUrl)) return;
      finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete" && (!expectedUrl || tab.url?.startsWith(expectedUrl))) finish();
    }).catch(finish);
  });
}

async function captureNavBreakpoint(url, fingerprint, spec) {
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  let attached = false;
  try {
    await attach(tab.id);
    attached = true;
    await cdp(tab.id, "Emulation.setDeviceMetricsOverride", {
      width: spec.width,
      height: spec.height,
      screenWidth: spec.width,
      screenHeight: spec.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await chrome.tabs.update(tab.id, { url, active: false });
    await waitForTabComplete(tab.id, url);
    await sleep(1200);
    await inject(tab.id);
    const result = await tabSend(tab.id, {
      type: "HC_CAPTURE_NAV_BREAKPOINT",
      fingerprint,
      spec,
    });
    if (!result?.ok || !result.capture) {
      throw new Error(result?.error || `Navbar ${spec.width} capture failed`);
    }
    return result.capture;
  } finally {
    if (attached) await detach(tab.id);
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function captureNavBreakpoints(url, fingerprint) {
  if (!url || !fingerprint) throw new Error("Desktop Navbar fingerprint is missing");
  const captures = [];
  const errors = [];
  for (const spec of NAV_BREAKPOINTS) {
    chrome.runtime.sendMessage({
      type: "HC_NAV_BREAKPOINT_PROGRESS", breakpoint: spec.name, phase: "capturing",
    }).catch(() => {});
    try {
      captures.push(await captureNavBreakpoint(url, fingerprint, spec));
      chrome.runtime.sendMessage({
        type: "HC_NAV_BREAKPOINT_PROGRESS", breakpoint: spec.name, phase: "captured",
      }).catch(() => {});
    } catch (error) {
      errors.push(`${spec.width}: ${error.message}`);
      chrome.runtime.sendMessage({
        type: "HC_NAV_BREAKPOINT_PROGRESS", breakpoint: spec.name, phase: "failed",
      }).catch(() => {});
    }
  }
  return { ok: errors.length === 0, captures, errors };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "HC_INJECT") {
    inject(message.tabId).then(sendResponse, (error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message.type === "HC_HOVER_TARGET") {
    const tabId = sender.tab?.id;
    if (!tabId) return false;
    hoverPair(tabId, message.captureId).then((result) => {
      chrome.runtime.sendMessage({ type: "HC_TAKE_READY", ...result }).catch(() => {});
    }, (error) => {
      chrome.runtime.sendMessage({
        type: "HC_TAKE_READY",
        ok: false,
        error: error.message,
      }).catch(() => {});
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "HC_AUTO_HOVER") {
    autoHover(message.tabId).then(sendResponse, (error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message.type === "HC_CAPTURE_NAV_BREAKPOINTS") {
    captureNavBreakpoints(message.url, message.fingerprint).then(sendResponse, (error) => {
      sendResponse({ ok: false, captures: [], errors: [error.message] });
    });
    return true;
  }

  if (message.type === "HC_CLOSE_PANEL") {
    const tabId = message.tabId;
    if (typeof chrome.sidePanel.close === "function" && Number.isInteger(tabId)) {
      chrome.sidePanel.close({ tabId }).catch(() => {});
    }
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
