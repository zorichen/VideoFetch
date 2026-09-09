/* Shared by the options page and the service worker. No network access. */
globalThis.CaptureSettings = (() => {
  const defaults = {
    pageOrigins: ["https://ke.renrenjiang.cn"],
    mediaOrigins: ["https://api.renrenjiang.cn", "https://qcloudvod.renrenjiang.cn", "https://playvideo.vodplayvideo.net"],
    outputFolder: "outputs"
  };

  function normalizeOrigin(value) {
    const input = String(value).trim();
    if (!input || /[\s*\\]/.test(input)) throw new Error(`无效域名：${input}`);
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) {
      throw new Error(`请只填写域名或 HTTP(S) 来源，不含路径、通配符或账号：${input}`);
    }
    return url.origin;
  }

  function normalizeFolder(value) {
    const folder = String(value).trim();
    if (!folder || folder.split("/").some(part => !part || part === "." || part === ".." ||
        /[\\:*?"<>|\u0000-\u001f]/.test(part) || /[. ]$/.test(part))) {
      throw new Error("输出子目录必须是下载目录内的相对路径，例如 outputs 或 research/videos；不能使用 .. 或绝对路径。");
    }
    return folder;
  }

  function normalize(raw = {}) {
    const origins = key => {
      const values = raw[key] ?? defaults[key];
      if (!Array.isArray(values)) throw new Error("域名配置必须是列表。");
      return [...new Set(values.map(normalizeOrigin))];
    };
    return { pageOrigins: origins("pageOrigins"), mediaOrigins: origins("mediaOrigins"),
      outputFolder: normalizeFolder(raw.outputFolder ?? defaults.outputFolder) };
  }

  function permissionOrigins(settings) {
    // Chrome host permissions cover a host's ports; capture still checks exact origins.
    return [...new Set([...settings.pageOrigins, ...settings.mediaOrigins].map(origin => {
      const url = new URL(origin);
      return `${url.protocol}//${url.hostname}/*`;
    }))];
  }

  async function load() {
    const data = await chrome.storage.local.get("captureSettings");
    return normalize(data.captureSettings ?? {});
  }

  return { defaults, normalizeOrigin, normalizeFolder, normalize, permissionOrigins, load };
})();
