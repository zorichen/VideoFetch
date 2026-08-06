const titleNode = document.querySelector("#title");
const courseNode = document.querySelector("#course");
const capturedNode = document.querySelector("#captured");
const pendingNode = document.querySelector("#pending");
const errorsNode = document.querySelector("#errors");
const lockNode = document.querySelector("#lock");
const statusNode = document.querySelector("#status");
const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");

async function message(type) {
  const response = await chrome.runtime.sendMessage({ type });
  if (!response?.ok) throw new Error(response?.error || "操作失败。");
  return response.data;
}

function render(data) {
  titleNode.textContent = data.title || "尚未开始";
  courseNode.textContent = data.courseName || "未分类";
  capturedNode.textContent = data.capturedCount || 0;
  pendingNode.textContent = data.pendingCount || 0;
  errorsNode.textContent = data.errorCount || 0;
  lockNode.textContent = data.targetLocked
    ? `已识别 ${data.videoCount} 个；已下载 ${data.exportedCount} 个；当前：${data.currentVideoTitle}`
    : "尚未识别到视频";
  startButton.disabled = Boolean(data.running);
  stopButton.disabled = !data.running;
  if (data.running) statusNode.textContent = `正在捕获：${data.allowedHosts.join(", ")}`;
}

startButton.addEventListener("click", async () => {
  statusNode.textContent = "正在附加当前标签页……";
  try {
    const data = await message("start");
    render(data);
    statusNode.textContent = "捕获已开始。现在正常播放视频，完成后点击结束并导出。";
  } catch (error) {
    statusNode.textContent = error.message;
  }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  statusNode.textContent = "正在结束捕获并收尾当前视频……";
  try {
    const result = await message("stop");
    const supplemented = result.results.reduce((sum, item) => sum + (item.supplementedCount || 0), 0);
    const failureText = result.failures.length ? `；${result.failures.length} 个视频失败` : "";
    statusNode.textContent = `捕获已结束：共下载 ${result.results.length} 个视频，补片 ${supplemented} 个${failureText}。`;
    startButton.disabled = false;
  } catch (error) {
    statusNode.textContent = error.message;
    startButton.disabled = false;
  }
});

async function refresh() {
  try { render(await message("status")); } catch {}
}

refresh();
setInterval(refresh, 1000);
