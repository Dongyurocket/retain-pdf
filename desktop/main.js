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
const {
  describeProbe,
  findBindablePort,
  probePort,
} = require("./src/main/port-availability");
const {
  DEFAULT_AI_PORT,
  DEFAULT_API_PORT,
  DEFAULT_SIMPLE_PORT,
  resolveAiPortCandidates,
  resolveApiPortCandidates,
  resolveSimplePortCandidates,
} = require("./src/main/port-plan");
const {
  readRuntimePorts,
  removeRuntimePorts,
  resolveRuntimePortsPath,
  writeRuntimePorts,
} = require("./src/main/runtime-ports");
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
const desktopConfigStore = createDesktopConfigStore(app, {
  desktopApiKey: DESKTOP_API_KEY,
  // 端口已动态化：渲染进程启动晚于后端，IPC 被调用时 resolvedApiPort 已就位。
  resolveApiBase: () => (resolvedApiPort ? `http://127.0.0.1:${resolvedApiPort}` : ""),
});
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
// 本次启动实际绑定的主 API 端口；在 startBundledBackend 解析后赋值。
let resolvedApiPort = null;
let cachedRuntimePortsPath = null;

function getRuntimePortsPath() {
  if (!cachedRuntimePortsPath) {
    cachedRuntimePortsPath = resolveRuntimePortsPath(app);
  }
  return cachedRuntimePortsPath;
}

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

// /health 无需鉴权；data.status === "up" 视为本项目的 rust_api，其他一律按无关进程处理。
async function getBackendIdentity(apiPort) {
  try {
    const payload = await requestJson(`http://127.0.0.1:${apiPort}/health`, {}, 2000);
    return payload?.data?.status === "up" ? "retainpdf" : "other";
  } catch (_err) {
    return "other";
  }
}

// retainpdf-ai 的 /healthz 无需鉴权，返回 {"ok": true, "version": ...}。
async function isRetainpdfAiService(port) {
  try {
    const payload = await requestJson(`http://127.0.0.1:${port}/healthz`, {}, 1500);
    return payload?.ok === true;
  } catch (_err) {
    return false;
  }
}

// AI 口解析：reserved 换候选；listening 时仅当确认是本项目的 retainpdf-ai 才复用，
// 被无关进程占用同样换候选；全部不可用时返回 null（AI 问答降级为 502，不阻断启动）。
async function resolveAiServicePort() {
  const candidates = resolveAiPortCandidates();
  for (const candidate of candidates) {
    const probe = await probePort("127.0.0.1", candidate, { canConnectToPort });
    logDesktop(
      `[desktop] AI port ${candidate} state=${probe.state}${probe.code ? ` code=${probe.code}` : ""}`,
    );
    if (probe.state === "reserved") {
      continue;
    }
    if (probe.state === "listening") {
      if (await isRetainpdfAiService(candidate)) {
        return { port: candidate, reuse: true };
      }
      logDesktop(`[desktop] AI port ${candidate} is held by an unrelated process; trying next candidate`);
      continue;
    }
    return { port: candidate, reuse: false };
  }
  return { port: null, reuse: false };
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
  // 三个端口都动态解析（真实 bind 探测 + 候选回退，见 port-plan.js），
  // 结果写入 runtime-ports.json 供 MCP 等外部进程发现，并注入前端 apiBase。
  let apiPort = null;
  let simplePort = DEFAULT_SIMPLE_PORT;
  let aiServicePort = DEFAULT_AI_PORT;
  let aiServiceReuse = false;
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

  // 主 API 口动态解析。真实 bind 试探：仅 connect 探测对“系统保留但无人监听”的端口会
  // 系统性误判为空闲。候选顺序见 port-plan.js：reserved（被系统保留块吞掉）或被无关进程
  // 监听时换下一个候选；只有被同项目的 rust_api 监听时才不换——同一 dataRoot 不允许第二个
  // 实例，此时按原有语义复用或清理残留。
  const previousPorts = readRuntimePorts(getRuntimePortsPath());
  const apiCandidates = resolveApiPortCandidates({ lastPort: previousPorts?.apiPort });
  const allowExternalBackend = process.env.RETAINPDF_DESKTOP_ALLOW_EXTERNAL_BACKEND === "1";
  const apiAttempts = [];
  for (const candidate of apiCandidates) {
    const probe = await probePort("127.0.0.1", candidate, { canConnectToPort });
    logDesktop(
      `[desktop] port ${candidate} state=${probe.state}${probe.code ? ` code=${probe.code}` : ""}`,
    );
    if (probe.state === "reserved") {
      apiAttempts.push({ port: candidate, probe, note: "系统保留" });
      continue;
    }
    if (probe.state === "listening") {
      const identity = await getBackendIdentity(candidate);
      if (identity !== "retainpdf") {
        logDesktop(`[desktop] port ${candidate} is held by an unrelated process; trying next candidate`);
        apiAttempts.push({ port: candidate, probe, note: "被无关进程占用" });
        continue;
      }
      if (app.isPackaged && !allowExternalBackend) {
        // 升级安装或异常退出后，旧版 rust_api 可能仍占用端口。
        // 先尝试自动清理残留进程并启动全新实例，而不是要求用户重启电脑。
        const runningJobs = await getBackendRunningJobCount(candidate);
        if (runningJobs > 0) {
          throw new Error(
            [
              `端口 ${candidate} 被另一个仍在执行任务的 RetainPDF 后端占用（${runningJobs} 个任务进行中）。`,
              "请先关闭另一个 RetainPDF 实例或等待任务完成，再启动新版本。",
            ].join("\n"),
          );
        }
        updateSplashProgress(38, "检测到残留的旧版服务", "正在清理旧后端进程并重新启动");
        const cleanup = await stopStaleBackendOnPort(candidate, {
          canConnectToPort,
          logger: { log: logDesktop, warn: logDesktopError },
        });
        logDesktop(`[desktop] stale backend cleanup: cleaned=${cleanup.cleaned} reason=${cleanup.reason}`);
        if (!cleanup.cleaned) {
          throw new Error(
            [
              `端口 ${candidate} 上的 RetainPDF 后端无法自动清理（${cleanup.reason}）。`,
              "同一数据目录不允许第二个后端实例。请关闭其他 RetainPDF、旧版桌面端后再启动；",
              "或在命令行执行 taskkill /F /IM rust_api.exe。",
            ].join("\n"),
          );
        }
        logDesktop("[desktop] stale backend cleaned; continuing with fresh backend startup");
        apiPort = candidate;
        break;
      }
      if (await canReuseExistingBackend(candidate)) {
        usingExternalBackend = true;
        apiPort = candidate;
        break;
      }
      throw new Error(
        [
          `端口 ${candidate} 上的 RetainPDF 后端无法复用（凭据或版本不匹配）。`,
          "同一数据目录不允许第二个后端实例，请先关闭该进程后再启动桌面端。",
        ].join("\n"),
      );
    }
    apiPort = candidate;
    break;
  }
  if (apiPort === null) {
    const detail = apiAttempts
      .map((attempt) => {
        const state = `端口 ${attempt.port}: ${attempt.probe.state}${attempt.probe.code ? ` (${attempt.probe.code})` : ""}`;
        return attempt.note ? `${state} ${attempt.note}` : state;
      })
      .join("\n");
    throw new Error(
      [
        `主 API 端口全部不可用（已尝试 ${apiCandidates.join("、")}）。`,
        detail,
        "可设置环境变量 RETAINPDF_DESKTOP_API_PORT 指定一个可用端口后重试。",
      ].filter(Boolean).join("\n"),
    );
  }
  resolvedApiPort = apiPort;
  if (!usingExternalBackend && apiPort !== DEFAULT_API_PORT) {
    logDesktop(`[desktop] main api port resolved to ${apiPort} (preferred ${DEFAULT_API_PORT} unavailable)`);
  }

  if (usingExternalBackend) {
    logDesktop(`[desktop] reusing existing backend on port ${apiPort}`);
    updateSplashProgress(52, "检测到已有本地服务", "桌面端将直接复用当前后端");
    await waitForPort("127.0.0.1", apiPort, 5000);
    // 复用的 rust_api 反代目标取决于它自己的启动环境；AI 口仍按候选解析并记录到端口文件。
    const aiResolution = await resolveAiServicePort();
    aiServicePort = aiResolution.port || DEFAULT_AI_PORT;
    aiServiceReuse = aiResolution.reuse;
    if (aiResolution.port && aiServicePort !== DEFAULT_AI_PORT) {
      logDesktop(
        `[desktop] AI service resolved to ${aiServicePort}; reused backend may still proxy to its own configured port`,
      );
    }
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
    if (aiResolution.port !== null) {
      await startRetainpdfAiService({
        aiServicePort,
        reuse: aiServiceReuse,
        aiServiceRoot,
        env: reuseEnv,
        pythonCommand: pythonRuntime.command,
      });
    } else {
      logDesktopError("[desktop] no bindable AI service port; skipping retainpdf-ai startup");
    }
    // simple 口归被复用的后端所有，这里如实记为未知。
    writeRuntimePorts(getRuntimePortsPath(), { apiPort, simplePort: null, aiPort: aiResolution.port });
    updateSplashProgress(92, "本地服务已就绪", "正在加载主界面");
    return;
  }

  // multipart 提交口没有硬编码消费者，被占用或被系统保留时自动换到相邻端口，
  // 而不是直接让整个桌面端起不来。显式指定 RETAINPDF_DESKTOP_SIMPLE_PORT 时只试该端口。
  const simpleCandidates = resolveSimplePortCandidates();
  const simpleResult = await findBindablePort("127.0.0.1", simpleCandidates, { canConnectToPort });
  for (const attempt of simpleResult.attempts) {
    logDesktop(
      `[desktop] port ${attempt.port} state=${attempt.state}${attempt.code ? ` code=${attempt.code}` : ""}`,
    );
  }
  if (simpleResult.port === null) {
    const lastAttempt = simpleResult.attempts[simpleResult.attempts.length - 1];
    throw new Error(
      [
        `multipart 提交端口全部不可用（已尝试 ${simpleCandidates.join("、")}）。`,
        describeProbe(lastAttempt?.port, lastAttempt),
        "可设置环境变量 RETAINPDF_DESKTOP_SIMPLE_PORT 指定一个可用端口后重试。",
      ].filter(Boolean).join("\n"),
    );
  }
  simplePort = simpleResult.port;
  if (simplePort !== DEFAULT_SIMPLE_PORT) {
    logDesktop(
      `[desktop] multipart api port fell back to ${simplePort} (default ${DEFAULT_SIMPLE_PORT} unavailable)`,
    );
  }

  // retainpdf-ai 口同样在启动前解析，结果经 buildBackendEnv 同时喂给 rust_api 反代与 AI 进程，
  // 两端天然一致。全部不可用时 AI 问答降级为 502，不阻断启动（与现有策略一致）。
  const aiResolution = await resolveAiServicePort();
  if (aiResolution.port === null) {
    logDesktopError("[desktop] no bindable AI service port; AI ask will return 502");
  } else if (aiResolution.port !== DEFAULT_AI_PORT) {
    logDesktop(
      `[desktop] AI service port fell back to ${aiResolution.port} (default ${DEFAULT_AI_PORT} unavailable)`,
    );
  }
  aiServicePort = aiResolution.port || DEFAULT_AI_PORT;
  aiServiceReuse = aiResolution.reuse;

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

  // retainpdf-ai：与 Rust 同生命周期；LLM key 由前端按请求传入。
  // 端口全部不可用时跳过启动，避免在注定绑不上的端口上空等就绪超时。
  if (aiResolution.port !== null) {
    await startRetainpdfAiService({
      aiServicePort,
      reuse: aiServiceReuse,
      aiServiceRoot,
      env,
      pythonCommand: pythonRuntime.command,
    });
  }

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
  writeRuntimePorts(getRuntimePortsPath(), {
    apiPort,
    simplePort,
    aiPort: aiResolution.port,
  });
  updateSplashProgress(92, "本地服务已就绪", "正在加载主界面");
}

async function startRetainpdfAiService({
  aiServicePort,
  reuse = false,
  aiServiceRoot,
  env,
  pythonCommand,
}) {
  if (!fs.existsSync(path.join(aiServiceRoot, "retainpdf_ai", "__main__.py"))) {
    logDesktopError(`[desktop] retainpdf-ai package missing under ${aiServiceRoot}; AI ask will return 502`);
    return;
  }

  // 端口已在启动前经真实 bind 探测解析；healthz 确认过的 retainpdf-ai 直接复用。
  if (reuse) {
    logDesktop(`[desktop] AI service port ${aiServicePort} already serves retainpdf-ai; reusing`);
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
  // 端口文件只代表本次运行；退出后由消费者自行 health-check 兑底。
  removeRuntimePorts(getRuntimePortsPath());
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
