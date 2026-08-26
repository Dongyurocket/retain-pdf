import {
  BROWSER_CONFIG_STORAGE_KEY,
  DEVELOPER_CONFIG_STORAGE_KEY,
} from "./storage-keys.js";
import { normalizeOcrOptionsMap, normalizeOcrProvider } from "./providers.js";

/** Per-provider OCR options keyed by provider id (paddle/mineru). */
export type OcrOptionsMap = Record<string, Record<string, string | boolean>>;

/** Browser-local credential / OCR settings (localStorage + desktop shadow). */
export interface BrowserStoredConfig {
  ocrProvider: string;
  paddleToken: string;
  mineruToken: string;
  ocrOptions: OcrOptionsMap;
  modelApiKey: string;
  [key: string]: unknown;
}

/** Developer model overrides (optional model / baseUrl plus future keys). */
export interface DeveloperStoredConfig {
  model?: string;
  baseUrl?: string;
  [key: string]: unknown;
}

/**
 * Merged runtime config applied to the running frontend
 * (window.__FRONT_RUNTIME_CONFIG__ + browser + developer overlays).
 */
export interface RuntimeConfig {
  ocrProvider?: string;
  paddleToken?: string;
  mineruToken?: string;
  modelApiKey?: string;
  model?: string;
  baseUrl?: string;
  apiBase?: string;
  xApiKey?: string;
  paddleApiUrl?: string;
  developerConfig?: DeveloperStoredConfig;
  [key: string]: unknown;
}

/**
 * Keep boolean (not a type predicate) so callers that pass `any` /
 * loose JSON retain assignability — narrowing to Record would cascade
 * `unknown` through desktop-persistence and other config consumers.
 */
export function isObject(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

export function readStoredConfig(key: string): Record<string, unknown> {
  if (typeof window.localStorage === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return isObject(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch (_err) {
    return {};
  }
}

export function writeStoredConfig(key: string, payload: object = {}): void {
  if (typeof window.localStorage === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch (_err) {
    // Ignore storage quota / privacy mode failures.
  }
}

export function normalizeBrowserStoredConfig(
  payload: Partial<BrowserStoredConfig> | object | null | undefined = {},
): BrowserStoredConfig {
  const source = (isObject(payload) ? payload : {}) as Partial<BrowserStoredConfig> & Record<string, unknown>;
  return {
    ocrProvider: normalizeOcrProvider(source.ocrProvider),
    paddleToken: typeof source.paddleToken === "string" ? source.paddleToken : "",
    mineruToken: typeof source.mineruToken === "string" ? source.mineruToken : "",
    ocrOptions: normalizeOcrOptionsMap(source.ocrOptions) as OcrOptionsMap,
    modelApiKey: typeof source.modelApiKey === "string" ? source.modelApiKey : "",
  };
}

export function normalizeDeveloperStoredConfig(
  payload: Partial<DeveloperStoredConfig> | object | null | undefined = {},
): DeveloperStoredConfig {
  return isObject(payload) ? { ...(payload as DeveloperStoredConfig) } : {};
}

export function desktopRuntimeToBrowserConfig(
  runtime: Partial<RuntimeConfig> | object | null | undefined = {},
): BrowserStoredConfig {
  const source = (isObject(runtime) ? runtime : {}) as Partial<RuntimeConfig> & Record<string, unknown>;
  return normalizeBrowserStoredConfig({
    ocrProvider: source.ocrProvider as string | undefined,
    paddleToken: source.paddleToken as string | undefined,
    mineruToken: source.mineruToken as string | undefined,
    ocrOptions: source.ocrOptions,
    modelApiKey: source.modelApiKey as string | undefined,
  });
}

export function buildRuntimeConfig(
  browserConfig: Partial<BrowserStoredConfig> | object | null | undefined = {},
  developerConfig: Partial<DeveloperStoredConfig> | object | null | undefined = {},
  baseRuntimeConfig: Partial<RuntimeConfig> | object | null | undefined = {},
): RuntimeConfig {
  const nextBrowserConfig = normalizeBrowserStoredConfig(browserConfig);
  const nextDeveloperConfig = normalizeDeveloperStoredConfig(developerConfig);
  const nextRuntimeConfig: RuntimeConfig = {
    ...(isObject(baseRuntimeConfig) ? (baseRuntimeConfig as RuntimeConfig) : {}),
    ocrProvider: nextBrowserConfig.ocrProvider,
    paddleToken: nextBrowserConfig.paddleToken,
    mineruToken: nextBrowserConfig.mineruToken,
    modelApiKey: nextBrowserConfig.modelApiKey,
    developerConfig: nextDeveloperConfig,
  };
  if (typeof nextDeveloperConfig.model === "string" && nextDeveloperConfig.model.trim()) {
    nextRuntimeConfig.model = nextDeveloperConfig.model.trim();
  }
  if (typeof nextDeveloperConfig.baseUrl === "string" && nextDeveloperConfig.baseUrl.trim()) {
    nextRuntimeConfig.baseUrl = nextDeveloperConfig.baseUrl.trim();
  }
  return nextRuntimeConfig;
}

export function readBrowserStoredConfig(): Record<string, unknown> {
  return readStoredConfig(BROWSER_CONFIG_STORAGE_KEY);
}

export function writeBrowserStoredConfig(
  payload: Partial<BrowserStoredConfig> | object = {},
): void {
  writeStoredConfig(BROWSER_CONFIG_STORAGE_KEY, normalizeBrowserStoredConfig(payload));
}

export function readDeveloperStoredConfig(): Record<string, unknown> {
  return readStoredConfig(DEVELOPER_CONFIG_STORAGE_KEY);
}

export function writeDeveloperStoredConfig(
  payload: Partial<DeveloperStoredConfig> | object = {},
): void {
  writeStoredConfig(DEVELOPER_CONFIG_STORAGE_KEY, normalizeDeveloperStoredConfig(payload));
}
