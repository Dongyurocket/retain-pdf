// credentials 特性 + dialog stores。

import {
  API_PREFIX,
  defaultMineruToken,
  defaultModelApiKey,
  defaultModelBaseUrl,
  defaultPaddleApiUrl,
  defaultPaddleToken,
  normalizeOcrProvider,
  saveBrowserStoredConfig,
  savePersistedBrowserStoredConfig,
  savePersistedDeveloperStoredConfig,
  getDeveloperConfig,
  setDeveloperConfig,
  setDesktopConfigured,
  readHiddenCredentialDomInputs,
  createCredentialRuntimeEnvPort,
  mountBrowserCredentialsFeature,
  validateMineruToken,
  validatePaddleToken,
} from "./external.js";
import { createCredentialsViewFeature } from "../features/credentials/credentials-view-store.js";
import { createCredentialsDialogStore } from "../features/credentials/credentials-dialog-store.js";
import { createSettingsHubDialogStore } from "../features/settings/settings-hub-dialog-store.js";
import type {
  AsyncFn,
  BrowserCredentialsFeature,
  CredentialsStatePort,
  CredentialsViewBag,
  HomeFeatures,
  UploadStatePort,
} from "./types.js";
import type { DialogStore } from "../state/dialog-store.js";

type CreateCredentialsArgs = {
  features: HomeFeatures;
  legacyState: Record<string, unknown>;
  credentialsStatePort: CredentialsStatePort;
  uploadStatePort: UploadStatePort;
  validateOcrTokenOverride?: AsyncFn | null;
  validateDeepSeekTokenOverride?: AsyncFn;
  queryDeepSeekBalanceOverride?: AsyncFn;
  checkApiConnectivityOverride?: AsyncFn | null;
  saveDesktopConfigOverride?: AsyncFn | null;
};

export function createCredentials({
  features,
  legacyState,
  credentialsStatePort,
  uploadStatePort,
  validateOcrTokenOverride,
  validateDeepSeekTokenOverride,
  queryDeepSeekBalanceOverride,
  checkApiConnectivityOverride,
  saveDesktopConfigOverride,
}: CreateCredentialsArgs): {
  browserCredentialsFeature: BrowserCredentialsFeature;
  credentialsView: CredentialsViewBag;
  credentialsDialogStore: DialogStore;
  settingsHubDialogStore: DialogStore;
} {
  const credentialsDialogStore = createCredentialsDialogStore();
  const settingsHubDialogStore = createSettingsHubDialogStore();
  const credentialsView = createCredentialsViewFeature({ dialogStore: credentialsDialogStore });

  function saveCredentialTaskOptions(options: Record<string, unknown> = {}) {
    setDeveloperConfig(legacyState, { ...getDeveloperConfig(legacyState), ...options });
    void savePersistedDeveloperStoredConfig(getDeveloperConfig(legacyState));
  }

  async function saveDesktopCredentialConfig(
    browserConfig: Record<string, unknown> = {},
    afterSave?: () => unknown,
  ) {
    const source = (browserConfig && typeof browserConfig === "object") ? browserConfig : {};
    const persisted = await savePersistedBrowserStoredConfig({ ...source });
    setDeveloperConfig(legacyState, persisted.developerConfig || getDeveloperConfig(legacyState));
    credentialsStatePort.setCredentials(persisted.browserConfig || {});
    if (source.markConfigured) {
      setDesktopConfigured(legacyState, true);
    }
    await afterSave?.();
    return persisted;
  }

  async function validateCredentialOcrToken(
    apiPrefixArg: unknown,
    providerId: unknown,
    token: unknown,
    providerOptions: Record<string, string | boolean> | unknown = {},
  ) {
    const options = providerOptions && typeof providerOptions === "object"
      ? providerOptions as Record<string, unknown>
      : {};
    if (normalizeOcrProvider(providerId) === "mineru") {
      return validateMineruToken(apiPrefixArg, {
        mineru_token: token,
        model_version: `${options.modelVersion || ""}`.trim(),
      });
    }
    const paddleBaseUrl = `${options.paddleApiUrl || ""}`.trim()
      || defaultPaddleApiUrl()
      || "https://paddleocr.aistudio-app.com";
    return validatePaddleToken(apiPrefixArg, {
      paddle_token: token,
      base_url: paddleBaseUrl,
    });
  }

  // balance/legacy ports 在 mount 内有默认实现；下层签名仍标成必填。
  const browserCredentialsFeature = mountBrowserCredentialsFeature({
    apiPrefix: API_PREFIX,
    state: {},
    credentialsStatePort,
    applyHiddenCredentialInputs: credentialsStatePort.setCredentials,
    defaultPaddleToken,
    defaultMineruToken,
    defaultModelApiKey,
    defaultModelBaseUrl,
    getTaskOptions: () => features.workflowFeature.developerConfigWithDefaults() || {},
    saveTaskOptions: saveCredentialTaskOptions,
    saveBrowserStoredConfig,
    readHiddenCredentialInputs: readHiddenCredentialDomInputs,
    saveDesktopConfig: saveDesktopConfigOverride || saveDesktopCredentialConfig,
    checkApiConnectivity: checkApiConnectivityOverride || (() => Promise.resolve()),
    validateOcrToken: validateOcrTokenOverride || validateCredentialOcrToken,
    validateDeepSeekToken: validateDeepSeekTokenOverride,
    queryDeepSeekBalance: queryDeepSeekBalanceOverride,
    onCredentialStateChange: () => {
      features.workflowFeature.applyWorkflowMode();
      // 通知 AI 输入门禁等：仅认设置里的 modelApiKey
      try {
        // dynamic import path avoided — event is fire-and-forget string
        document.dispatchEvent(new CustomEvent("retainpdf:credentials-changed"));
      } catch {
        /* ignore */
      }
    },
    runtimeEnvPort: createCredentialRuntimeEnvPort(legacyState),
    uploadStatePort,
    viewPort: credentialsView.viewPort,
    dialogElementsPort: credentialsView.elementsPort,
    setupModePort: {
      currentSetupMode: () => credentialsView.store.getSnapshot().setupMode,
    },
  }) as BrowserCredentialsFeature;

  return {
    browserCredentialsFeature,
    credentialsView: credentialsView as CredentialsViewBag,
    credentialsDialogStore,
    settingsHubDialogStore,
  };
}
