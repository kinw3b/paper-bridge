import { parseHref } from "../shared/session-url.js";

const HOST_NAME = "com.kreativepro.paper_capture";

const STAGES = [
  {
    id: "dropdown",
    short: "DROPDOWN",
    title: "Dropdowns",
    copy: "Hover a menu open, then click the open dropdown once.",
    mode: "dropdown",
    kind: "dropdown",
  },
  {
    id: "buttons",
    short: "BUTTONS",
    title: "Buttons",
    copy: "Record one button for its default and hover states.",
    mode: "hover",
    kind: "hover",
  },
  {
    id: "components",
    short: "COMPONENTS",
    title: "Components",
    copy: "Capture any exact element as one object. Done writes the session receipt.",
    mode: "single",
    kind: "single",
  },
];

const ui = Object.fromEntries([
  "setup", "workspace", "complete", "connection", "paperFileId", "projectRoot", "paperEndpoint",
  "setupError", "startButton", "stageRail", "stepKicker", "stageTitle", "stageCopy", "autoMode",
  "recordButton", "recordTitle", "recordHelp", "activity", "takes", "captureError",
  "backButton", "continueButton", "doneButton",
].map((id) => [id, document.getElementById(id)]));

let port = null;
let requestSequence = 0;
let activeTab = null;
let sourceTabId = null;
let sourceUrl = "";
let stageIndex = 0;
let recording = false;
let pending = 0;
const requests = new Map();
const takes = [];
const retryPayloads = new Map();
let desktopViewport = null;

function setConnection(online, text = online ? "Connected" : "Offline") {
  ui.connection.classList.toggle("online", online);
  ui.connection.innerHTML = `<i></i> ${text}`;
}

function applySession(session, { overwrite = false } = {}) {
  if (!session || typeof session !== "object") return;
  for (const key of ["paperFileId", "projectRoot", "paperEndpoint"]) {
    const value = String(session[key] || "").trim();
    if (!value) continue;
    if (!overwrite && ui[key].value.trim()) continue;
    ui[key].value = value;
  }
}

async function sessionFromOpenTab() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    const session = parseHref(tab.url || "");
    if (session) return session;
  }
  return null;
}

function connectHost() {
  if (port) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("The native bridge did not answer. Run install-native-host.command, then restart Chrome."));
      }
    }, 3000);
    port.onMessage.addListener((message) => {
      const pendingRequest = requests.get(message.requestId);
      if (pendingRequest) {
        requests.delete(message.requestId);
        if (message.ok) pendingRequest.resolve(message);
        else pendingRequest.reject(new Error(message.error || "Native bridge request failed"));
      }
    });
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message || "Native bridge disconnected";
      port = null;
      setConnection(false);
      for (const waiter of requests.values()) waiter.reject(new Error(error));
      requests.clear();
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`${error}. Run install-native-host.command, then restart Chrome.`));
      }
    });
    const requestId = `connect-${Date.now()}`;
    requests.set(requestId, {
      resolve: (message) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          setConnection(true);
          resolve(message);
        }
      },
      reject: (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      },
    });
    port.postMessage({ requestId, type: "PING" });
  });
}

function nativeRequest(type, payload = {}) {
  if (!port) return Promise.reject(new Error("Native bridge is not connected"));
  const requestId = `request-${Date.now()}-${++requestSequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      requests.delete(requestId);
      reject(new Error(type === "COMMIT_TAKE"
        ? "Paper did not acknowledge this take within 130 seconds"
        : "The local bridge timed out"));
    }, type === "COMMIT_TAKE" ? 130000 : 30000);
    requests.set(requestId, {
      resolve: (message) => { clearTimeout(timer); resolve(message); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    port.postMessage({ requestId, type, ...payload });
  });
}

async function currentTab() {
  const queries = [
    { active: true, lastFocusedWindow: true },
    { active: true, currentWindow: true },
  ];
  for (const query of queries) {
    const [tab] = await chrome.tabs.query(query);
    if (tab?.id && /^(https?|file):/i.test(tab.url || "")) return tab;
  }
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((item) => /^(https?|file):/i.test(item.url || "") && parseHref(item.url || ""));
  if (tab?.id) return tab;
  throw new Error("Open the source URL in this tab before starting capture");
}

function rememberSourceTab(tab) {
  if (!tab?.id) return tab;
  activeTab = tab;
  sourceTabId = tab.id;
  sourceUrl = cleanSourceUrl(tab.url || sourceUrl || "");
  return tab;
}

async function resolveSourceTab() {
  if (sourceTabId) {
    try {
      const tab = await chrome.tabs.get(sourceTabId);
      if (tab?.id && !tab.discarded) return rememberSourceTab(tab);
    } catch { /* tab was closed or was a capture popup */ }
  }
  if (sourceUrl) {
    const tabs = await chrome.tabs.query({});
    const needle = sourceUrl.replace(/\/$/, "");
    const match = tabs.find((tab) => cleanSourceUrl(tab.url || "").replace(/\/$/, "") === needle);
    if (match?.id) return rememberSourceTab(match);
  }
  return rememberSourceTab(await currentTab());
}

function isMissingReceiver(error) {
  return /Receiving end does not exist|Could not establish connection/i.test(String(error?.message || error || ""));
}

async function ensureInjected(tabId) {
  const injected = await chrome.runtime.sendMessage({ type: "HC_INJECT", tabId });
  if (!injected?.ok) throw new Error(injected?.error || "Could not load Capture Tool on the source tab");
}

async function pageMessage(message) {
  const tab = await resolveSourceTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (!isMissingReceiver(error)) throw error;
    await ensureInjected(tab.id);
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

function cleanSourceUrl(href) {
  try {
    const url = new URL(href);
    for (const key of ["paperFileId", "projectRoot", "paperEndpoint", "paper-capture"]) {
      url.searchParams.delete(key);
    }
    const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
    for (const key of ["paperFileId", "projectRoot", "paperEndpoint", "paper-capture"]) {
      hash.delete(key);
    }
    url.hash = hash.toString();
    return url.href;
  } catch {
    return href;
  }
}

function stage() { return STAGES[stageIndex]; }

function captureMode() { return stage().mode; }

function currentKind() { return stage().kind; }

function renderStages() {
  ui.stageRail.innerHTML = "";
  STAGES.forEach((item, index) => {
    const button = document.createElement("button");
    button.className = `stage-dot${index === stageIndex ? " active" : ""}${index < stageIndex ? " complete" : ""}`;
    button.textContent = index < stageIndex ? "✓" : item.short;
    button.title = item.title;
    button.disabled = index === stageIndex || pending > 0;
    if (index !== stageIndex) button.addEventListener("click", () => changeStage(index));
    ui.stageRail.append(button);
  });
}

function renderTakes() {
  ui.takes.innerHTML = "";
  const visible = takes.filter((take) => take.stage === stage().id);
  for (const take of visible) {
    const row = document.createElement("div");
    row.className = `take ${take.status}`;
    const icon = take.status === "success" ? "✓" : take.status === "failed" ? "!" : take.status === "idle" ? "–" : "…";
    row.innerHTML = `<span class="take-icon">${icon}</span><strong></strong><em></em><p></p>`;
    row.querySelector("strong").textContent = take.sectionId
      ? `${take.sectionId} · ${take.label}`
      : take.label;
    row.querySelector("em").textContent = take.meta || (take.states > 1 ? `${take.states} states` : "");
    row.querySelector("p").textContent = take.note || (take.status === "success"
      ? `✓ added to Paper · ${take.board}`
      : take.status === "failed" ? take.error : "Sending to Paper…");
    if (take.status === "failed" && take.error) row.querySelector("p").title = take.error;
    if (take.status === "failed" && retryPayloads.has(take.id)) {
      const retry = document.createElement("button");
      retry.className = "retry";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => retryTake(take.id));
      row.append(retry);
    }
    ui.takes.append(row);
  }
}

function renderStage() {
  const item = stage();
  const last = item.id === "components";
  renderStages();
  ui.stepKicker.textContent = `STEP ${stageIndex + 1} OF ${STAGES.length}`;
  ui.stageTitle.textContent = item.title;
  ui.stageCopy.textContent = item.copy;
  ui.backButton.hidden = stageIndex === 0;
  ui.continueButton.hidden = last;
  ui.doneButton.hidden = !last;
  ui.continueButton.disabled = pending > 0;
  ui.continueButton.classList.remove("is-waiting");
  ui.continueButton.textContent = "Continue";
  const busy = pending > 0;
  ui.doneButton.disabled = busy;
  ui.recordButton.disabled = busy;
  ui.recordTitle.textContent = ui.autoMode.checked ? "Auto mode ready" : "Ready to record";
  ui.recordHelp.textContent = item.id === "dropdown"
    ? "Hover a menu open, then click the open dropdown once."
    : ui.autoMode.checked ? "Scan the page and choose safe matches." : "Choose an element. Use ↑/↓ to select its parent.";
  const recordLabel = ui.autoMode.checked ? "Auto" : "Record";
  ui.recordButton.innerHTML = `<span></span>${recordLabel}`;
  renderTakes();
  if (!activeTab?.id) return;
  pageMessage({
    type: "HC_SET_RECORDING",
    recording: false,
    mode: captureMode(),
    captureKind: currentKind(),
  }).catch(() => {});
}

async function lockDesktopViewport() {
  const tab = await resolveSourceTab();
  await ensureInjected(tab.id);
  const result = await chrome.runtime.sendMessage({ type: "HC_LOCK_DESKTOP_VIEWPORT", tabId: tab.id });
  desktopViewport = result;
  if (!result?.ok) {
    throw new Error(result?.error || "Could not lock the page to the 1600 desktop lander");
  }
  return result;
}

function setActivity(text, sending = false) {
  ui.activity.textContent = text;
  ui.activity.classList.toggle("sending", sending);
}

function setRecording(value) {
  recording = value;
  document.querySelector(".record-card").classList.toggle("recording", recording);
  ui.recordTitle.textContent = recording ? "Recording is on" : "Ready to record";
  ui.recordHelp.textContent = recording
    ? "Click the outlined element."
    : stage().id === "dropdown"
      ? "Hover a menu open, then click the open dropdown once."
      : "Choose an element. Use ↑/↓ to select its parent.";
  ui.recordButton.textContent = recording ? "Cancel" : ui.autoMode.checked ? "Auto" : "Record";
}

async function startCapture() {
  ui.setupError.textContent = "";
  ui.startButton.disabled = true;
  ui.startButton.textContent = "Connecting…";
  try {
    const paperFileId = ui.paperFileId.value.trim();
    const projectRoot = ui.projectRoot.value.trim();
    const paperEndpoint = ui.paperEndpoint.value.trim();
    if (!paperFileId) throw new Error("Paper file ID is required so writes cannot drift to another file");
    if (!projectRoot.startsWith("/")) throw new Error("Project folder must be an absolute path");
    activeTab = rememberSourceTab(await currentTab());
    await connectHost();
    const started = await nativeRequest("START_SESSION", {
      config: { paperFileId, projectRoot, paperEndpoint, sourceUrl: cleanSourceUrl(activeTab.url) },
    });
    await ensureInjected(activeTab.id);
    try {
      await lockDesktopViewport();
    } catch (error) {
      ui.captureError.textContent = `${error.message}. Buttons need the tab locked to 1600.`;
    }
    if (started?.paperSections?.length) {
      await pageMessage({ type: "HC_SET_PAPER_SECTIONS", sections: started.paperSections });
    }
    await chrome.storage.local.set({ paperFileId, projectRoot, paperEndpoint });
    ui.setup.hidden = true;
    ui.workspace.hidden = false;
    setConnection(true, "Paper ready");
    setActivity("Paper destinations are ready. Capture dropdowns first.");
    renderStage();
  } catch (error) {
    ui.setupError.textContent = error.message;
    setConnection(false);
  } finally {
    ui.startButton.disabled = false;
    ui.startButton.textContent = "Start capture";
  }
}

async function commitTake(payload) {
  const local = {
    id: payload.id || `take-${Date.now()}-${++requestSequence}`,
    label: payload.label || currentKind(),
    stage: stage().id,
    kind: payload.kind || currentKind(),
    breakpoint: payload.breakpoint,
    status: "sending",
  };
  takes.push(local);
  retryPayloads.set(local.id, { ...payload, id: local.id });
  pending += 1;
  setActivity("Sending to Paper…", true);
  renderStage();
  try {
    const receipt = await nativeRequest("COMMIT_TAKE", { take: retryPayloads.get(local.id) });
    local.status = "success";
    local.board = receipt.receipt.board;
    local.paperNodeId = receipt.receipt.paperNodeId;
    local.error = "";
    setActivity(`✓ ${local.label} added to Paper`);
  } catch (error) {
    local.status = "failed";
    local.error = error.message;
    setActivity("Paper did not accept this take. Retry it before continuing.");
  } finally {
    pending -= 1;
    renderStage();
  }
  return local;
}

async function retryTake(id) {
  const local = takes.find((take) => take.id === id);
  const payload = retryPayloads.get(id);
  if (!local || !payload) return;
  local.status = "sending";
  pending += 1;
  renderStage();
  try {
    const receipt = await nativeRequest("COMMIT_TAKE", { take: payload, retry: true });
    local.status = "success";
    local.board = receipt.receipt.board;
    local.paperNodeId = receipt.receipt.paperNodeId;
    local.error = "";
    setActivity(`✓ ${local.label} added to Paper`);
  } catch (error) {
    local.status = "failed";
    local.error = error.message;
  } finally {
    pending -= 1;
    renderStage();
  }
}

async function handleCapture(capture) {
  setRecording(false);
  ui.captureError.textContent = "";
  await commitTake(capture);
}

async function toggleRecord() {
  ui.captureError.textContent = "";
  try {
    if (ui.autoMode.checked) {
      await runAuto();
      return;
    }
    if (recording) {
      setRecording(false);
      await pageMessage({
        type: "HC_SET_RECORDING", recording: false, mode: captureMode(), captureKind: currentKind(),
      });
      return;
    }
    setRecording(true);
    await pageMessage({
      type: "HC_SET_RECORDING", recording: true, mode: captureMode(), captureKind: currentKind(),
    });
  } catch (error) {
    setRecording(false);
    ui.captureError.textContent = error.message;
    setActivity("");
  }
}

async function runAuto() {
  ui.recordButton.disabled = true;
  ui.captureError.textContent = "";
  setActivity(stage().id === "buttons"
    ? "Auto is walking every section for button hover pairs…"
    : "Auto is scanning visible candidates…", true);
  try {
    if (stage().id === "buttons") {
      const tab = await resolveSourceTab();
      await ensureInjected(tab.id);
      const result = await chrome.runtime.sendMessage({ type: "HC_AUTO_HOVER", tabId: tab.id });
      if (!result?.ok) throw new Error(result?.error || "Auto Buttons failed");
      for (const capture of result.captures || []) await commitTake(capture);
      if (!result.captures?.length) throw new Error("Auto did not find a safe button candidate");
      const sections = new Set((result.captures || []).map((take) => take.sectionId).filter(Boolean));
      setActivity(`✓ ${result.captures.length} button pairs across ${sections.size || 1} sections`);
      return;
    }
    if (stage().id === "dropdown") {
      throw new Error("Hover the dropdown open, then click it once");
    }
    const result = await pageMessage({
      type: "HC_AUTO_SINGLE", mode: captureMode(), captureKind: currentKind(),
    });
    if (!result?.ok) throw new Error(result?.error || "Auto did not find a safe candidate");
    await handleCapture(result.capture);
  } catch (error) {
    ui.captureError.textContent = error.message;
    setActivity("");
  } finally {
    ui.recordButton.disabled = false;
  }
}

function changeStage(index) {
  if (pending > 0 || index < 0 || index >= STAGES.length) return;
  stageIndex = index;
  setRecording(false);
  setActivity("");
  ui.captureError.textContent = "";
  renderStage();
}

async function finishSession() {
  if (pending > 0) return;
  ui.doneButton.disabled = true;
  setActivity("Closing capture session…", true);
  try {
    await chrome.runtime.sendMessage({ type: "HC_RELEASE_VIEWPORT" }).catch(() => {});
    await nativeRequest("COMPLETE_SESSION", {
      summary: {
        sourceUrl: activeTab.url,
        takeCount: takes.filter((take) => take.status === "success").length,
        boards: [...new Set(takes.filter((take) => take.board).map((take) => take.board))],
      },
    });
    await pageMessage({ type: "HC_DEACTIVATE" }).catch(() => {});
    ui.workspace.hidden = true;
    ui.complete.hidden = false;
    setConnection(true, "Complete");
  } catch (error) {
    ui.captureError.textContent = error.message;
    ui.doneButton.disabled = false;
    setActivity("Session remains open because the completion receipt failed.");
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.type !== "string") return;
  if (message.type === "HC_CAPTURED") {
    if (message.ok) handleCapture(message.capture);
    else ui.captureError.textContent = message.error || "Capture failed";
  }
  if (message.type === "HC_TAKE_READY") {
    setRecording(false);
    if (message.ok) commitTake(message.capture);
    else ui.captureError.textContent = message.error || "Button capture failed";
  }
  if (message.type === "HC_RECORDING_CHANGED") {
    setRecording(Boolean(message.recording));
  }
});

ui.startButton.addEventListener("click", startCapture);
ui.recordButton.addEventListener("click", toggleRecord);
ui.continueButton.addEventListener("click", () => changeStage(stageIndex + 1));
ui.backButton.addEventListener("click", () => changeStage(stageIndex - 1));
ui.doneButton.addEventListener("click", finishSession);
ui.autoMode.addEventListener("change", renderStage);

async function hydrateFromOpenTab() {
  const session = await sessionFromOpenTab();
  if (!session) return;
  applySession(session, { overwrite: true });
  await chrome.storage.local.set({
    paperFileId: session.paperFileId,
    projectRoot: session.projectRoot,
    captureAutostart: true,
    ...(session.paperEndpoint ? { paperEndpoint: session.paperEndpoint } : {}),
  });
}

let autoStarted = false;

async function maybeAutoStart() {
  if (autoStarted || ui.setup.hidden) return;
  const fromTab = await sessionFromOpenTab();
  const stored = await chrome.storage.local.get(["paperFileId", "projectRoot", "captureAutostart"]);
  if (!fromTab && !stored.captureAutostart) return;
  if (fromTab) applySession(fromTab, { overwrite: true });
  const paperFileId = ui.paperFileId.value.trim();
  const projectRoot = ui.projectRoot.value.trim();
  if (!paperFileId || !projectRoot.startsWith("/")) return;
  autoStarted = true;
  await chrome.storage.local.remove("captureAutostart");
  await startCapture();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  applySession({
    paperFileId: changes.paperFileId?.newValue,
    projectRoot: changes.projectRoot?.newValue,
    paperEndpoint: changes.paperEndpoint?.newValue,
  }, { overwrite: true });
  maybeAutoStart();
});

chrome.tabs.onUpdated.addListener(() => {
  hydrateFromOpenTab().then(maybeAutoStart);
});
chrome.tabs.onActivated.addListener(() => {
  hydrateFromOpenTab().then(maybeAutoStart);
});

chrome.storage.local.get(["paperFileId", "projectRoot", "paperEndpoint"]).then(async (saved) => {
  ui.paperEndpoint.value = saved.paperEndpoint || "http://127.0.0.1:29979/mcp";
  applySession(saved);
  await hydrateFromOpenTab();
  try {
    const ping = await connectHost();
    applySession(ping?.session);
  } catch (error) {
    ui.setupError.textContent = error.message;
  }
  await maybeAutoStart();
});
