const pages = document.querySelector("#pages");
const media = document.querySelector("#media");
const folder = document.querySelector("#folder");
const status = document.querySelector("#status");
const save = document.querySelector("button[type=submit]");
const lines = value => value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

CaptureSettings.load().then(settings => {
  pages.value = settings.pageOrigins.join("\n");
  media.value = settings.mediaOrigins.join("\n");
  folder.value = settings.outputFolder;
}).catch(error => { status.textContent = error.message; });

document.querySelector("#settings").addEventListener("submit", async event => {
  event.preventDefault();
  save.disabled = true;
  try {
    const settings = CaptureSettings.normalize({ pageOrigins: lines(pages.value),
      mediaOrigins: lines(media.value), outputFolder: folder.value });
    if (!settings.pageOrigins.length) throw new Error("请至少配置一个允许捕获的页面域名。");
    const granted = await chrome.permissions.request({ origins: CaptureSettings.permissionOrigins(settings) });
    if (!granted) throw new Error("未获得域名访问权限，设置未保存。");
    await chrome.storage.local.set({ captureSettings: settings });
    status.textContent = "已保存；下一次捕获生效。请同步调整 macOS 助手的 Chrome 输入目录。";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    save.disabled = false;
  }
});
