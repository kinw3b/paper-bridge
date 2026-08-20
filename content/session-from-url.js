(() => {
  function readSession(href) {
    try {
      const url = new URL(href);
      const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
      const paperFileId = (url.searchParams.get("paperFileId") || hash.get("paperFileId") || "").trim();
      const projectRoot = (url.searchParams.get("projectRoot") || hash.get("projectRoot") || "").trim();
      const paperEndpoint = (url.searchParams.get("paperEndpoint") || hash.get("paperEndpoint") || "").trim();
      if (!paperFileId && !projectRoot) return null;
      const session = { paperFileId, projectRoot, captureAutostart: true };
      if (paperEndpoint) session.paperEndpoint = paperEndpoint;
      return session;
    } catch {
      return null;
    }
  }

  const session = readSession(location.href);
  if (session) chrome.storage.local.set(session);
})();
