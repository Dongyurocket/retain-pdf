const fs = require("fs");
const path = require("path");

const DEFAULT_OCR_PROVIDER = "paddle";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";

function createDesktopConfigStore(app, options = {}) {
  const desktopApiKey = options.desktopApiKey || "";

  function createDefaultDesktopConfig() {
    return {
      firstRunCompleted: false,
      ocrProvider: DEFAULT_OCR_PROVIDER,
      mineruToken: "",
      paddleToken: "",
      ocrOptions: {},
      modelApiKey: "",
      model: DEFAULT_MODEL,
      baseUrl: DEFAULT_BASE_URL,
      url: "",
      translationOptions: {},
      developerConfig: {},
      closeToTrayHintShown: false,
    };
  }

  function resolveDesktopConfigPath() {
    return path.join(app.getPath("userData"), "desktop-config.json");
  }

  function loadDesktopConfig() {
    const configPath = resolveDesktopConfigPath();
    if (!fs.existsSync(configPath)) {
      return createDefaultDesktopConfig();
    }
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      return normalizeDesktopConfig(JSON.parse(raw));
    } catch (error) {
      console.error(`[desktop] failed to load desktop config: ${error?.message || error}`);
      return createDefaultDesktopConfig();
    }
  }

  function saveDesktopConfig(payload = {}) {
    const nextConfig = mergeDesktopConfig(loadDesktopConfig(), payload);
    const configPath = resolveDesktopConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
    return nextConfig;
  }

  function buildDesktopRuntimeConfig(config) {
    return {
      apiBase: "http://127.0.0.1:41000",
      xApiKey: desktopApiKey,
      ...buildBrowserConfig(config),
      model: config.model || DEFAULT_MODEL,
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
      url: config.url || "",
      translationOptions: config.translationOptions || {},
      developerConfig: config.developerConfig || {},
    };
  }

  function buildDesktopConfigResponse(config) {
    return {
      firstRunCompleted: config.firstRunCompleted,
      closeToTrayHintShown: config.closeToTrayHintShown,
      browserConfig: buildBrowserConfig(config),
      developerConfig: config.developerConfig || {},
      runtimeConfig: buildDesktopRuntimeConfig(config),
    };
  }

  return {
    buildBrowserConfig,
    buildDesktopConfigResponse,
    buildDesktopRuntimeConfig,
    createDefaultDesktopConfig,
    loadDesktopConfig,
    resolveDesktopConfigPath,
    saveDesktopConfig,
  };
}

function buildBrowserConfig(config) {
  return {
    ocrProvider: config.ocrProvider || DEFAULT_OCR_PROVIDER,
    mineruToken: config.mineruToken || "",
    paddleToken: config.paddleToken || "",
    ocrOptions: normalizeOcrOptions(config.ocrOptions),
    modelApiKey: config.modelApiKey || "",
    model: config.model || DEFAULT_MODEL,
    baseUrl: config.baseUrl || DEFAULT_BASE_URL,
    url: config.url || "",
    translationOptions: config.translationOptions || {},
  };
}

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function normalizeOcrProvider(value) {
  return value === "mineru" || value === "paddle" ? value : DEFAULT_OCR_PROVIDER;
}

function normalizeOcrOptions(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const normalized = {};
  for (const [providerId, options] of Object.entries(value)) {
    if (typeof options === "object" && options !== null && !Array.isArray(options)) {
      normalized[providerId] = { ...options };
    }
  }
  return normalized;
}

function normalizeTrimmedString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeDesktopConfig(raw = {}) {
  const defaults = {
    mineruToken: "",
    paddleToken: "",
    ocrOptions: {},
    modelApiKey: "",
    model: DEFAULT_MODEL,
    baseUrl: DEFAULT_BASE_URL,
    url: "",
    translationOptions: {},
  };
  return {
    firstRunCompleted: !!raw.firstRunCompleted,
    ocrProvider: normalizeOcrProvider(raw.ocrProvider),
    mineruToken: normalizeTrimmedString(raw.mineruToken, defaults.mineruToken),
    paddleToken: normalizeTrimmedString(raw.paddleToken, defaults.paddleToken),
    ocrOptions: normalizeOcrOptions(raw.ocrOptions),
    modelApiKey: normalizeTrimmedString(raw.modelApiKey, defaults.modelApiKey),
    model: normalizeTrimmedString(raw.model, defaults.model),
    baseUrl: normalizeTrimmedString(raw.baseUrl, defaults.baseUrl),
    url: normalizeTrimmedString(raw.url, defaults.url),
    translationOptions: typeof raw.translationOptions === "object" && raw.translationOptions !== null && !Array.isArray(raw.translationOptions)
      ? { ...raw.translationOptions }
      : {},
    developerConfig: typeof raw.developerConfig === "object" && raw.developerConfig !== null
      ? { ...raw.developerConfig }
      : {},
    closeToTrayHintShown: !!raw.closeToTrayHintShown,
  };
}

function mergeDesktopConfig(currentConfig, payload = {}) {
  const merged = { ...currentConfig };
  const runtimeConfig = typeof payload.runtimeConfig === "object" && payload.runtimeConfig !== null
    ? payload.runtimeConfig
    : {};
  const keys = [
    "ocrProvider",
    "mineruToken",
    "paddleToken",
    "ocrOptions",
    "modelApiKey",
    "model",
    "baseUrl",
    "url",
    "translationOptions",
    "closeToTrayHintShown",
  ];
  for (const key of keys) {
    if (hasOwn(payload, key)) {
      merged[key] = payload[key];
      continue;
    }
    if (hasOwn(runtimeConfig, key)) {
      merged[key] = runtimeConfig[key];
    }
  }
  if (typeof payload.developerConfig === "object" && payload.developerConfig !== null) {
    merged.developerConfig = { ...payload.developerConfig };
  }
  if (hasOwn(payload, "firstRunCompleted")) {
    merged.firstRunCompleted = !!payload.firstRunCompleted;
  }
  return normalizeDesktopConfig(merged);
}

module.exports = {
  createDesktopConfigStore,
};
