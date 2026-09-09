const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  canConnectToPort,
  createBackendStartupDiagnostics,
  waitForPort,
} = require("./src/main/backend-startup-diagnostics");
const { buildBackendEnv } = require("./src/main/backend-env");
const { createBackendHttp } = require("./src/main/backend-http");
const { createBackendRuntime } = require("./src/main/backend-runtime");
const { createDesktopConfigStore } = require("./src/main/desktop-config");
const { createDesktopLogger } = require("./src/main/desktop-logging");
const { createDesktopWindows } = require("./src/main/desktop-windows");
const { createPortOccupant } = require("./src/main/port-occupant");
const { stopStaleBackendOnPort } = require("./src/main/stale-backend-cleanup");

const desktopLogger = createDesktopLogger(app);
const {
  appendDesktopLog,
  getDesktopLogPath,
  logDesktop,
  logDesktopError,
  resolveDesktopLogPath,
  setDesktopLogPath,
} = desktopLogger;
const backendStartupDiagnostics = createBackendStartupDiagnostics({ getDesktopLogPath });
const backendRuntime = createBackendRuntime(app, { appRoot: __dirname });
const {
  bundledPythonImportPaths,
  preparePythonRuntime,
  resolveBackendBinary,
  resolveBackendRoot,
  resolveBundledPythonHome,
  resolvePythonRuntime,
  resolveTypstBinary,
} = backendRuntime;

const DESKTOP_API_KEY = "retain-pdf-desktop";
const backendHttp = createBackendHttp({
  desktopApiKey: DESKTOP_API_KEY,
  logger: console,
});
const { canReuseExistingBackend, requestJson } = backendHttp;
const portOccupant = createPortOccupant({ canConnectToPort, logger: console });
const { killProcessTreeSync, reclaimPortIfOwnResidual, describeOccupant } = portOccupant;
const desktopConfigStore = createDesktopConfigStore(app, { desktopApiKey: DESKTOP_API_KEY });
const {
  buildDesktopConfigResponse,
  loadDesktopConfig,
  saveDesktopConfig,
} = desktopConfigStore;
let backendChild = null;
let aiServiceChild = null;
let backendStopping = false;
let splashWindow = null;
let usingExternalBackend = false;
let isQuitting = false;
const AI_SERVICE_PORT = 41100;

function updateSplashProgress(progress, title, detail) {
  if (!splashWindow || splashWindow.isDestroyed()) {
    return;
  }
  splashWindow.webContents.send("startup-progress", {
    progress,
    title,
    detail,
  });
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

const desktopWindows = createDesktopWindows(app, {
  appRoot: __dirname,
  closeSplashWindow,
  isQuitting: () => isQuitting,
  loadDesktopConfig,
  logDesktop,
  logDesktopError,
  markQuitting: () => {
    isQuitting = true;
  },
  saveDesktopConfig,
  updateSplashProgress,
});
const {
  createTray,
  createWindow,
  hasLiveMainWindow,
  resolveWindowIcon,
  setCloseToTrayHintShown,
  showExistingDesktopWindow,
  showMainWindow,
} = desktopWindows;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    logDesktop("[desktop] second instance requested; restoring existing window");
    showExistingDesktopWindow(splashWindow);
  });
}

async function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 520,
    height: 360,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    center: true,
    backgroundColor: "#f5f5f7",
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  await splashWindow.loadFile(path.join(__dirname, "splash.html"));
  updateSplashProgress(6, "正在准备运行环境", "正在检查桌面组件与本地资源");
}

// 查询占用端口的后端是否仍有任务在执行；查不到时按 0 处理，允许清理残留进程。
async function getBackendRunningJobCount(apiPort) {
  try {
    const payload = await requestJson(`http://127.0.0.1:${apiPort}/health`, {}, 2000);
    const running = payload?.data?.running_jobs;
    return typeof running === "number" ? running : 0;
  } catch (_err) {
    return 0;
  }
}

async function startBundledBackend() {
  updateSplashProgress(18, "正在检查运行文件", "正在校验后端、Python 和脚本资源");
  const backendRoot = resolveBackendRoot();
  const backendBin = resolveBackendBinary(backendRoot);
  let pythonRuntime = resolvePythonRuntime(backendRoot);
  const scriptsDir = path.join(backendRoot, "scripts");
  const typstBin = resolveTypstBinary(backendRoot);
  const bundledFontPath = path.join(backendRoot, "fonts", "SourceHanSerifSC-Regular.otf");
  const bundledTitleBoldFontPath = path.join(backendRoot, "fonts", "SourceHanSerifSC-Bold.otf");
  const bundledTypstFontDir = path.join(backendRoot, "fonts");
  const dataRoot = path.join(app.getPath("userData"), "data");
  const rustApiRoot = path.join(dataRoot, "rust_api");
  const typstPackagePath = path.join(backendRoot, "typst-packages");
  const typstPackageCachePath = path.join(dataRoot, "typst-package-cache");
  const apiPort = 41000;
  const simplePort = 42000;
  const aiServicePort = AI_SERVICE_PORT;
  // packaged: backend/ai_service；开发未 prepare 时可回退仓库 backend/ai_service
  let aiServiceRoot = path.join(backendRoot, "ai_service");
  if (!fs.existsSync(path.join(aiServiceRoot, "retainpdf_ai", "__main__.py"))) {
    const repoAi = path.join(appRoot, "..", "backend", "ai_service");
    if (fs.existsSync(path.join(repoAi, "retainpdf_ai", "__main__.py"))) {
      aiServiceRoot = repoAi;
    }
  }

  logDesktop(
    [
      "[desktop] starting bundled backend",
      `platform=${process.platform}`,
      `packaged=${app.isPackaged}`,
      `backendRoot=${backendRoot}`,
      `backendBin=${backendBin}`,
      `python=${pythonRuntime.command || "<missing>"}`,
      `pythonHome=${pythonRuntime.bundledHome || "<system>"}`,
      `scriptsDir=${scriptsDir}`,
      `aiServiceRoot=${aiServiceRoot}`,
      `typst=${typstBin || "<missing>"}`,
      `log=${getDesktopLogPath() || "<unavailable>"}`,
    ].join(" "),
  );

  if (!fs.existsSync(backendBin)) {
    throw new Error(`missing bundled backend binary: ${backendBin}`);
  }
  if (!pythonRuntime.command) {
    throw new Error("missing python runtime");
  }
  if (!fs.existsSync(scriptsDir)) {
    throw new Error(`missing bundled scripts directory: ${scriptsDir}`);
  }
  if (app.isPackaged && !typstBin) {
    throw new Error(`missing bundled typst runtime under ${path.join(backendRoot, "typst")}`);
  }

  pythonRuntime = await preparePythonRuntime(pythonRuntime, {
    updateSplashProgress,
  });
  if (app.isPackaged && !pythonRuntime.bundledHome) {
    throw new Error(
      `missing bundled python runtime under ${path.join(backendRoot, "python")}`,
    );
  }

  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(rustApiRoot, { recursive: true });
  fs.mkdirSync(typstPackageCachePath, { recursive: true });
  updateSplashProgress(34, "正在准备工作目录", "正在初始化本地数据目录");

  const apiPortBusy = await canConnectToPort("127.0.0.1", apiPort);
  logDesktop(`[desktop] port ${apiPort} busy=${apiPortBusy}`);
  if (apiPortBusy) {
    const allowExternalBackend = process.env.RETAINPDF_DESKTOP_ALLOW_EXTERNAL_BACKEND === "1";
    if (app.isPackaged && !allowExternalBackend) {
      // 升级安装或异常退出后，旧版 rust_api 可能仍占用端口。
      // 先尝试自动清理残留进程并启动全新实例，而不是要求用户重启电脑。
      const runningJobs = await getBackendRunningJobCount(apiPort);
      if (runningJobs > 0) {
        throw new Error(
          [
            `端口 ${apiPort} 被另一个仍在执行任务的 RetainPDF 后端占用（${runningJobs} 个任务进行中）。`,
            "请先关闭另一个 RetainPDF 实例或等待任务完成，再启动新版本。",
          ].join("\n"),
        );
      }
      updateSplashProgress(38, "检测到残留的旧版服务", "正在清理旧后端进程并重新启动");
      const cleanup = await stopStaleBackendOnPort(apiPort, {
        canConnectToPort,
        logger: { log: logDesktop, warn: logDesktopError },
      });
      logDesktop(`[desktop] stale backend cleanup: cleaned=${cleanup.cleaned} reason=${cleanup.reason}`);
      if (!cleanup.cleaned) {
        throw new Error(
          [
            `端口 ${apiPort} 已被占用，且无法自动清理残留进程（${cleanup.reason}）。`,
            "请关闭其他 RetainPDF、旧版桌面端后再启动；或在命令行执行 taskkill /F /IM rust_api.exe。",
          ].join("\n"),
        );
      }
      logDesktop("[desktop] stale backend cleaned; continuing with fresh backend startup");
    } else if (await canReuseExistingBackend(apiPort)) {
      usingExternalBackend = true;
      logDesktop(`[desktop] reusing existing backend on port ${apiPort}`);
      updateSplashProgress(52, "检测到已有本地服务", "桌面端将直接复用当前后端");
      await waitForPort("127.0.0.1", apiPort, 5000);
      // 仍尝试拉起 AI（若 41100 空闲）；复用的 Rust 会反代到本机 AI
      const reuseEnv = buildBackendEnv({
        apiPort,
        aiServicePort,
        aiServiceRoot,
        backendRoot,
        bundledFontPath,
        bundledPythonHome: resolveBundledPythonHome(pythonRuntime.bundledHome),
        bundledPythonImportPaths: bundledPythonImportPaths(pythonRuntime.bundledHome),
        bundledTitleBoldFontPath,
        bundledTypstFontDir,
        dataRoot,
        desktopApiKey: DESKTOP_API_KEY,
        inheritHostPythonPath: !app.isPackaged,
        pythonRuntime,
        rustApiRoot,
        scriptsDir,
        simplePort,
        typstBin,
        typstPackageCachePath,
        typstPackagePath,
      });
      await startRetainpdfAiService({
        aiServicePort,
        aiServiceRoot,
        env: reuseEnv,
        pythonCommand: pythonRuntime.command,
      });
      updateSplashProgress(92, "本地服务已就绪", "正在加载主界面");
      return;
    } else {
      throw new Error(
        `端口 ${apiPort} 已被其他进程占用，且不是可复用的 RetainPDF 后端。请先关闭占用进程后再启动桌面端。`,
      );
    }
  }

  const simplePortBusy = await canConnectToPort("127.0.0.1", simplePort);
  logDesktop(`[desktop] port ${simplePort} busy=${simplePortBusy}`);
  if (simplePortBusy) {
    throw new Error(`端口 ${simplePort} 已被其他进程占用，请先释放后再启动桌面端。`);
  }

  const bundledPythonHome = resolveBundledPythonHome(pythonRuntime.bundledHome);
  const env = buildBackendEnv({
    apiPort,
    aiServicePort,
    aiServiceRoot,
    backendRoot,
    bundledFontPath,
    bundledPythonHome,
    bundledPythonImportPaths: bundledPythonImportPaths(pythonRuntime.bundledHome),
    bundledTitleBoldFontPath,
    bundledTypstFontDir,
    dataRoot,
    desktopApiKey: DESKTOP_API_KEY,
    inheritHostPythonPath: !app.isPackaged,
    pythonRuntime,
    rustApiRoot,
    scriptsDir,
    simplePort,
    typstBin,
    typstPackageCachePath,
    typstPackagePath,
  });

  updateSplashProgress(52, "正在启动本地服务", "Rust API 与 AI 服务正在启动");
  logDesktop(`[desktop] spawning backend: ${backendBin}`);
  backendStartupDiagnostics.reset(backendBin, backendRoot);
  backendChild = spawn(backendBin, [], {
    cwd: backendRoot,
    env,
    windowsHide: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  backendChild.stdout.on("data", (chunk) => {
    backendStartupDiagnostics.rememberOutput("stdout", chunk);
    const message = `[rust_api] ${chunk}`;
    process.stdout.write(message);
    appendDesktopLog(message.trimEnd());
  });
  backendChild.stderr.on("data", (chunk) => {
    backendStartupDiagnostics.rememberOutput("stderr", chunk);
    const message = `[rust_api] ${chunk}`;
    process.stderr.write(message);
    appendDesktopLog(message.trimEnd());
  });

  backendChild.once("exit", (code, signal) => {
    backendChild = null;
    if (backendStopping) {
      return;
    }
    const detail = `code=${code ?? "null"} signal=${signal ?? "null"}`;
    backendStartupDiagnostics.markExit(detail);
    logDesktopError(`[desktop] Rust API worker crashed: ${detail}`);
    dialog.showErrorBox("Rust API worker crashed", detail);
  });

  // retainpdf-ai：与 Rust 同生命周期；LLM key 由前端按请求传入
  await startRetainpdfAiService({
    aiServicePort,
    aiServiceRoot,
    env,
    pythonCommand: pythonRuntime.command,
  });

  let waitingProgress = 58;
  const waitingTimer = setInterval(() => {
    waitingProgress = Math.min(waitingProgress + 3, 88);
    updateSplashProgress(
      waitingProgress,
      "正在连接本地服务",
      "首次启动可能稍慢，请稍候",
    );
  }, 500);
  const backendReadyTimeoutMs = app.isPackaged ? 90000 : 30000;
  logDesktop(`[desktop] waiting for backend port ${apiPort} timeoutMs=${backendReadyTimeoutMs}`);
  await backendStartupDiagnostics.waitForBackendReady("127.0.0.1", apiPort, backendReadyTimeoutMs);
  clearInterval(waitingTimer);
  logDesktop(`[desktop] backend ready on port ${apiPort}`);
  updateSplashProgress(92, "本地服务已就绪", "正在加载主界面");
}

async function startRetainpdfAiService({
  aiServicePort,
  aiServiceRoot,
  env,
  pythonCommand,
}) {
  if (!fs.existsSync(path.join(aiServiceRoot, "retainpdf_ai", "__main__.py"))) {
    logDesktopError(`[desktop] retainpdf-ai package missing under ${aiServiceRoot}; AI ask will return 502`);
    return;
  }

  const aiBusy = await canConnectToPort("127.0.0.1", aiServicePort);
  if (aiBusy) {
    logDesktop(`[desktop] AI service port ${aiServicePort} already in use; reusing`);
    return;
  }

  logDesktop(`[desktop] spawning retainpdf-ai: ${pythonCommand} -m retainpdf_ai (port ${aiServicePort})`);
  aiServiceChild = spawn(pythonCommand, ["-m", "retainpdf_ai"], {
    cwd: aiServiceRoot,
    env,
    windowsHide: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  aiServiceChild.stdout.on("data", (chunk) => {
    const message = `[retainpdf_ai] ${chunk}`;
    process.stdout.write(message);
    appendDesktopLog(message.trimEnd());
  });
  aiServiceChild.stderr.on("data", (chunk) => {
    const message = `[retainpdf_ai] ${chunk}`;
    process.stderr.write(message);
    appendDesktopLog(message.trimEnd());
  });
  aiServiceChild.once("exit", (code, signal) => {
    aiServiceChild = null;
    if (backendStopping || isQuitting) {
      return;
    }
    logDesktopError(
      `[desktop] retainpdf-ai exited unexpectedly: code=${code ?? "null"} signal=${signal ?? "null"}`,
    );
  });

  const aiReadyTimeoutMs = app.isPackaged ? 60000 : 20000;
  try {
    await waitForPort("127.0.0.1", aiServicePort, aiReadyTimeoutMs);
    logDesktop(`[desktop] retainpdf-ai ready on port ${aiServicePort}`);
  } catch (error) {
    // 不阻断主程序：翻译流水线仍可用，仅 AI 问答会 502
    logDesktopError(
      `[desktop] retainpdf-ai failed to become ready: ${error && error.message ? error.message : error}`,
    );
  }
}

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    setDesktopLogPath(resolveDesktopLogPath());
    appendDesktopLog("========== RetainPDF desktop startup ==========");
    logDesktop(`[desktop] app ready version=${app.getVersion()} packaged=${app.isPackaged} userData=${app.getPath("userData")}`);
    setCloseToTrayHintShown(loadDesktopConfig().closeToTrayHintShown);
    createSplashWindow()
      .then(() => startBundledBackend())
      .then(() => {
        createTray();
        createWindow();
        app.on("activate", () => {
          if (!hasLiveMainWindow()) {
            createWindow();
            return;
          }
          showMainWindow();
        });
      })
      .catch((error) => {
        const detail = String(error && error.stack ? error.stack : error && error.message ? error.message : error);
        logDesktopError(`[desktop] startup failed: ${detail}`);
        const desktopLogPath = getDesktopLogPath();
        const dialogDetail = [
          String(error && error.message ? error.message : error),
          desktopLogPath ? `\n完整日志: ${desktopLogPath}` : "",
        ].filter(Boolean).join("\n");
        dialog.showErrorBox("RetainPDF startup failed", dialogDetail);
        app.quit();
      });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  backendStopping = true;
  // Synchronously terminate whole process trees: plain ChildProcess.kill()
  // only kills the direct child, leaving supervised grandchildren
  // (ai service, workers) orphaned and holding ports.
  if (aiServiceChild && !aiServiceChild.killed && aiServiceChild.pid) {
    killProcessTreeSync(aiServiceChild.pid);
    aiServiceChild = null;
  } else {
    aiServiceChild = null;
  }
  if (!usingExternalBackend && backendChild && !backendChild.killed && backendChild.pid) {
    killProcessTreeSync(backendChild.pid);
  }
});

ipcMain.handle("desktop:invoke", async (_event, command, args = {}) => {
  switch (command) {
    case "load_desktop_config": {
      const config = loadDesktopConfig();
      return buildDesktopConfigResponse(config);
    }
    case "save_desktop_config": {
      const config = saveDesktopConfig(args?.payload || {});
      return buildDesktopConfigResponse(config);
    }
    case "open_output_directory": {
      const outputDir = path.join(app.getPath("userData"), "data", "jobs");
      fs.mkdirSync(outputDir, { recursive: true });
      const result = await shell.openPath(outputDir);
      if (result) {
        throw new Error(result);
      }
      return { ok: true, outputDir };
    }
    default:
      throw new Error(`unsupported desktop command: ${command}`);
  }
});

ipcMain.on("desktop:renderer-issue", (_event, payload = {}) => {
  const type = payload?.type || "unknown";
  const message = payload?.message || "unknown renderer issue";
  const filename = payload?.filename || "";
  const lineno = payload?.lineno || 0;
  const colno = payload?.colno || 0;
  logDesktopError(`[desktop][renderer-issue] type=${type} file=${filename} line=${lineno} col=${colno} message=${message}`);
});
