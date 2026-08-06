const PROTOCOL_VERSION = "1.3";
const RELATED_DOMAINS = {
  "ke.renrenjiang.cn": [
    "ke.renrenjiang.cn",
    "qcloudvod.renrenjiang.cn",
    "playvideo.vodplayvideo.net"
  ]
};

let session = freshSession();

function freshSession() {
  return {
    running: false,
    tabId: null,
    title: "视频",
    courseName: "未分类",
    isCourse: false,
    videos: [],
    completedResults: [],
    exportFailures: [],
    pageHost: "",
    allowedHosts: [],
    responses: new Map(),
    captured: new Map(),
    errors: [],
    startedAt: null
  };
}

function target(tabId = session.tabId) {
  return { tabId };
}

function sendCommand(method, params = {}) {
  return chrome.debugger.sendCommand(target(), method, params);
}

function isAllowed(urlText) {
  try {
    const host = new URL(urlText).hostname;
    return session.allowedHosts.some(item => host === item || host.endsWith("." + item));
  } catch {
    return false;
  }
}

function isMediaCandidate(params) {
  const url = params.response?.url || "";
  const mime = (params.response?.mimeType || "").toLowerCase();
  const type = params.type || "";
  return /\.m3u8(?:\?|$)|\.ts(?:\?|$)|\.m4s(?:\?|$)|\.mp4(?:\?|$)/i.test(url) ||
    /mpegurl|mp2t|video\/mp4|iso\.segment/i.test(mime) ||
    type === "Media";
}

function isCourseMetadataURL(url) {
  return /^https:\/\/api\.renrenjiang\.cn\/api\/v2\/columns\/\d+(?:\?|$)/i.test(url);
}

async function readPageTitle() {
  const expression = `(() => {
    const element = document.querySelector('h1.detail-video-title') ||
      document.querySelector('.column-under-activity-title') ||
      document.querySelector('h1');
    return (element?.textContent || document.title || '视频').trim();
  })()`;
  const result = await sendCommand("Runtime.evaluate", { expression, returnByValue: true });
  return result?.result?.value || "视频";
}

async function readCourseContext() {
  const expression = `(() => {
    const url = new URL(location.href);
    const hashQuery = location.hash.includes('?') ? location.hash.split('?')[1] : '';
    const hashParams = new URLSearchParams(hashQuery);
    const columnId = url.searchParams.get('id') || hashParams.get('id');
    const lessonCount = document.querySelectorAll('.column-under-activity-title').length;
    return { isCourse: Boolean(columnId && lessonCount > 1), columnId };
  })()`;
  const result = await sendCommand("Runtime.evaluate", { expression, returnByValue: true });
  return result?.result?.value || { isCourse: false, columnId: null };
}

function extractCourseName(payload) {
  const candidates = [
    payload?.data?.title,
    payload?.data?.name,
    payload?.data?.column_name,
    payload?.data?.column_title,
    payload?.data?.column?.title,
    payload?.data?.column?.name,
    payload?.title,
    payload?.name
  ];
  return candidates.find(value => typeof value === "string" && value.trim().length > 1)?.trim() || null;
}

async function startCapture() {
  if (session.running) return snapshot();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("没有可捕获的当前标签页。");
  const pageURL = new URL(tab.url);
  const allowedHosts = RELATED_DOMAINS[pageURL.hostname] || [pageURL.hostname];

  session = freshSession();
  session.tabId = tab.id;
  session.pageHost = pageURL.hostname;
  session.allowedHosts = allowedHosts;
  session.startedAt = Date.now();

  await chrome.debugger.attach(target(), PROTOCOL_VERSION);
  try {
    await sendCommand("Network.enable", {
      maxTotalBufferSize: 256 * 1024 * 1024,
      maxResourceBufferSize: 16 * 1024 * 1024,
      maxPostDataSize: 0
    });
    await sendCommand("Runtime.enable");
    session.title = await readPageTitle();
    const course = await readCourseContext();
    session.isCourse = Boolean(course.isCourse);
    session.courseName = session.isCourse && course.columnId ? `人人讲课程-${course.columnId}` : "未分类";
    session.running = true;
    return snapshot();
  } catch (error) {
    await chrome.debugger.detach(target()).catch(() => {});
    session = freshSession();
    throw error;
  }
}

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (!session.running || source.tabId !== session.tabId) return;
  if (method === "Network.responseReceived") {
    if (isCourseMetadataURL(params.response.url)) {
      session.responses.set(params.requestId, {
        url: params.response.url,
        mimeType: params.response.mimeType || "application/json",
        type: "CourseMetadata",
        status: params.response.status
      });
      return;
    }
    if (isAllowed(params.response.url) && isMediaCandidate(params)) {
      session.responses.set(params.requestId, {
        url: params.response.url,
        mimeType: params.response.mimeType || "",
        type: params.type || "",
        status: params.response.status
      });
    }
    return;
  }
  if (method === "Network.loadingFinished" && session.responses.has(params.requestId)) {
    const metadata = session.responses.get(params.requestId);
    try {
      const body = await sendCommand("Network.getResponseBody", { requestId: params.requestId });
      if (metadata.type === "CourseMetadata") {
        try {
          const text = body.base64Encoded ? new TextDecoder().decode(bytesFromCapture(body)) : body.body;
          const name = extractCourseName(JSON.parse(text));
          if (name) {
            session.courseName = name;
            session.isCourse = true;
          }
        } catch (error) {
          session.errors.push(`课程名称解析失败: ${error.message}`);
        }
        session.responses.delete(params.requestId);
        return;
      }
      const capturedItem = {
        ...metadata,
        body: body.body,
        base64Encoded: Boolean(body.base64Encoded),
        encodedDataLength: params.encodedDataLength || 0
      };
      session.captured.set(metadata.url, capturedItem);
      if (/\.m3u8(?:\?|$)/i.test(metadata.url) || /mpegurl/i.test(metadata.mimeType)) {
        const playlistText = textFromCapture(capturedItem);
        if (playlistText.includes("#EXTM3U") && playlistText.includes("#EXTINF")) {
          const exists = session.videos.some(video => video.playlistURL === metadata.url);
          if (!exists) {
            const previousVideo = session.videos.at(-1);
            if (previousVideo && previousVideo.exportState !== "exported") {
              await new Promise(resolve => setTimeout(resolve, 500));
              await exportTrackedVideo(previousVideo);
            }
            let lessonTitle = session.title;
            await new Promise(resolve => setTimeout(resolve, 150));
            try { lessonTitle = await readPageTitle(); } catch {}
            session.title = lessonTitle;
            session.videos.push({
              playlistURL: metadata.url,
              segmentURLs: orderedSegments(metadata.url, playlistText),
              title: lessonTitle,
              detectedAt: Date.now(),
              exportState: "pending",
              exportError: null
            });
          }
        }
      }
    } catch (error) {
      session.errors.push(`${metadata.url}: ${error.message}`);
    } finally {
      session.responses.delete(params.requestId);
    }
  }
});

chrome.debugger.onDetach.addListener(source => {
  if (source.tabId === session.tabId) session.running = false;
});

function snapshot() {
  return {
    running: session.running,
    title: session.title,
    courseName: session.courseName,
    isCourse: session.isCourse,
    targetLocked: session.videos.length > 0,
    videoCount: session.videos.length,
    exportedCount: session.completedResults.length,
    failedVideoCount: session.exportFailures.length,
    currentVideoTitle: session.videos.at(-1)?.title || session.title,
    pageHost: session.pageHost,
    allowedHosts: session.allowedHosts,
    capturedCount: session.captured.size,
    pendingCount: session.responses.size,
    errorCount: session.errors.length,
    startedAt: session.startedAt
  };
}

function textFromCapture(item) {
  if (!item.base64Encoded) return item.body;
  return new TextDecoder().decode(bytesFromCapture(item));
}

function bytesFromCapture(item) {
  if (!item.base64Encoded) return new TextEncoder().encode(item.body);
  const raw = atob(item.body);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function sanitizeFilename(value) {
  return (value || "视频").replace(/[\\/:*?"<>|]/g, "_").trim() || "视频";
}

function outputPath(filename) {
  const folder = session.isCourse ? sanitizeFilename(session.courseName) : "未分类";
  return `outputs/${folder}/${filename}`;
}

function mediaPlaylists() {
  return [...session.captured.values()]
    .filter(item => /\.m3u8(?:\?|$)/i.test(item.url) || /mpegurl/i.test(item.mimeType))
    .map(item => ({ item, text: textFromCapture(item) }))
    .filter(entry => entry.text.includes("#EXTM3U") && entry.text.includes("#EXTINF"));
}

function orderedSegments(playlistURL, playlistText) {
  return playlistText.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    .map(line => new URL(line, playlistURL).href);
}

function playlistDuration(playlistText) {
  return [...playlistText.matchAll(/#EXTINF:([0-9.]+)/gi)]
    .reduce((sum, match) => sum + Number(match[1] || 0), 0);
}

async function fetchSmallMissingSet(missing, totalCount) {
  const maximum = Math.min(5, Math.max(1, Math.floor(totalCount * 0.2)));
  if (missing.length > maximum) {
    const capturedCount = totalCount - missing.length;
    throw new Error(`分片不完整：总数 ${totalCount}，已捕获 ${capturedCount}，缺少 ${missing.length}，补片上限 ${maximum}。`);
  }
  for (const url of missing) {
    if (!isAllowed(url)) throw new Error("缺失分片位于未经允许的域名。");
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`补片失败：HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    session.captured.set(url, {
      url,
      mimeType: response.headers.get("content-type") || "video/mp2t",
      type: "Media",
      status: response.status,
      body: bytesToBase64(bytes),
      base64Encoded: true,
      encodedDataLength: bytes.byteLength,
      supplemented: true
    });
  }
  return missing.length;
}

async function exportPlaylistVideo(video, playlists) {
  const selected = playlists.find(entry => entry.item.url === video.playlistURL);
  if (!selected) throw new Error("播放列表响应体不可用。");
  if (/#EXT-X-KEY/i.test(selected.text) || /widevine|fairplay|playready/i.test(selected.text)) {
    throw new Error("检测到 HLS 加密或 DRM。");
  }
  const segmentURLs = video.segmentURLs.length
    ? video.segmentURLs
    : orderedSegments(selected.item.url, selected.text);
  if (segmentURLs.some(url => /\.m3u8(?:\?|$)/i.test(url))) {
    throw new Error("暂不处理多清晰度主播放列表。");
  }
  const missing = segmentURLs.filter(url => !session.captured.has(url));
  const supplementedCount = missing.length
    ? await fetchSmallMissingSet(missing, segmentURLs.length)
    : 0;
  const parts = segmentURLs.map(url => bytesFromCapture(session.captured.get(url)));
  if (parts.some(part => part.byteLength === 0)) {
    throw new Error("存在空分片，无法通过完整性检查。");
  }
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }
  const baseTitle = sanitizeFilename(video.title);
  const token = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const filename = `${baseTitle}.__vda_${token}.ts`;
  const metadataFilename = `${baseTitle}.__vda_${token}.capture.json`;
  const verification = {
    schemaVersion: 1,
    title: video.title,
    courseName: session.courseName,
    playlistURL: video.playlistURL,
    expectedSegments: segmentURLs.length,
    capturedSegments: segmentURLs.length - supplementedCount,
    supplementedSegments: supplementedCount,
    expectedDuration: playlistDuration(selected.text),
    totalBytes: total,
    createdAt: new Date().toISOString()
  };
  await chrome.downloads.download({
    url: `data:video/mp2t;base64,${bytesToBase64(combined)}`,
    filename: outputPath(filename),
    conflictAction: "uniquify",
    saveAs: false
  });
  const metadataBytes = new TextEncoder().encode(JSON.stringify(verification, null, 2));
  await chrome.downloads.download({
    url: `data:application/json;base64,${bytesToBase64(metadataBytes)}`,
    filename: outputPath(metadataFilename),
    conflictAction: "uniquify",
    saveAs: false
  });
  return {
    filename: `${baseTitle}.mp4`,
    temporaryFilename: filename,
    segmentCount: parts.length,
    bytes: total,
    supplementedCount,
    expectedDuration: verification.expectedDuration
  };
}

async function exportTrackedVideo(video) {
  if (video.exportState === "exported" || video.exportState === "exporting") return null;
  video.exportState = "exporting";
  try {
    const result = await exportPlaylistVideo(video, mediaPlaylists());
    video.exportState = "exported";
    video.exportError = null;
    session.completedResults.push(result);
    session.exportFailures = session.exportFailures.filter(item => item.playlistURL !== video.playlistURL);
    return result;
  } catch (error) {
    video.exportState = "failed";
    video.exportError = error.message;
    session.exportFailures = session.exportFailures.filter(item => item.playlistURL !== video.playlistURL);
    session.exportFailures.push({ playlistURL: video.playlistURL, title: video.title, error: error.message });
    return null;
  }
}

async function exportCapture() {
  if (!session.tabId) throw new Error("尚未开始捕获。");
  session.running = false;
  await chrome.debugger.detach(target()).catch(() => {});

  if (session.videos.length) {
    for (const video of session.videos) {
      if (video.exportState !== "exported") await exportTrackedVideo(video);
    }
    if (!session.completedResults.length) {
      const details = session.exportFailures.map(item => `${item.title}: ${item.error}`).join("；");
      throw new Error(`没有视频成功导出。${details}`);
    }
    return { results: session.completedResults, failures: session.exportFailures };
  }

  const direct = [...session.captured.values()].find(item => /\.mp4(?:\?|$)/i.test(item.url) || /video\/mp4/i.test(item.mimeType));
  if (direct) {
    const bytes = bytesFromCapture(direct);
    const filename = `${sanitizeFilename(session.title)}.mp4`;
    await chrome.downloads.download({
      url: `data:video/mp4;base64,${bytesToBase64(bytes)}`,
      filename: outputPath(filename),
      conflictAction: "uniquify",
      saveAs: false
    });
    return { results: [{ filename, segmentCount: 1, bytes: bytes.byteLength }], failures: [] };
  }
  throw new Error("没有捕获到可导出的完整非加密媒体。");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "start") return { ok: true, data: await startCapture() };
    if (message.type === "status") return { ok: true, data: snapshot() };
    if (message.type === "stop") return { ok: true, data: await exportCapture() };
    throw new Error("未知操作。");
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
