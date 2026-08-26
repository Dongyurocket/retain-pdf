import { $ } from "../../dom/query.js";
import { DEFAULT_OCR_PROVIDER, normalizeOcrProvider } from "../../config/providers.js";
import { normalizeBrowserStoredConfig } from "../../config/storage.js";
import { CREDENTIAL_DOM_IDS } from "./credentials-dom-contract.js";
import type { CredentialsFields, CredentialsStatePort } from "./state.js";

const { hidden: HIDDEN_CREDENTIAL_IDS } = CREDENTIAL_DOM_IDS;

function hiddenInputValue(id = "") {
  if (typeof document === "undefined") {
    return "";
  }
  return ($(id) as HTMLInputElement | null)?.value || "";
}

export function readHiddenCredentialDomInputs(): Partial<CredentialsFields> {
  const normalized = normalizeBrowserStoredConfig({
    ocrProvider: hiddenInputValue(HIDDEN_CREDENTIAL_IDS.ocrProvider) || DEFAULT_OCR_PROVIDER,
    paddleToken: hiddenInputValue(HIDDEN_CREDENTIAL_IDS.paddleToken),
    mineruToken: hiddenInputValue(HIDDEN_CREDENTIAL_IDS.mineruToken),
    modelApiKey: hiddenInputValue(HIDDEN_CREDENTIAL_IDS.modelApiKey),
  }) as Partial<CredentialsFields>;
  // ocrOptions 不桥接隐藏 input：抹掉自动填充的默认值，让 store action 的
  // 「缺 ocrOptions 键则保留现有值」逻辑生效（见 credentials/state.ts）。
  delete normalized.ocrOptions;
  return normalized;
}

export function normalizeHiddenCredentialPayload(
  credentials: Partial<CredentialsFields> | string | null | undefined,
  legacyModelApiKey = "",
): Partial<CredentialsFields> {
  return typeof credentials === "object" && credentials
    ? credentials
    : {
        ocrProvider: DEFAULT_OCR_PROVIDER,
        paddleToken: "",
        mineruToken: "",
        modelApiKey: legacyModelApiKey,
      };
}

export function mirrorCredentialsToHiddenInputs(
  credentialsOrLegacy: Partial<CredentialsFields> | string | null | undefined,
  legacyModelApiKey = "",
) {
  if (typeof document === "undefined") {
    return;
  }
  const credentials = normalizeHiddenCredentialPayload(credentialsOrLegacy, legacyModelApiKey);
  const ocrProvider = normalizeOcrProvider(credentials.ocrProvider);
  const paddleToken = credentials.paddleToken || "";
  const mineruToken = credentials.mineruToken || "";
  const modelApiKey = credentials.modelApiKey || "";

  const providerInput = $(HIDDEN_CREDENTIAL_IDS.ocrProvider) as HTMLInputElement | null;
  const paddleInput = $(HIDDEN_CREDENTIAL_IDS.paddleToken) as HTMLInputElement | null;
  const mineruInput = $(HIDDEN_CREDENTIAL_IDS.mineruToken) as HTMLInputElement | null;
  const apiKeyInput = $(HIDDEN_CREDENTIAL_IDS.modelApiKey) as HTMLInputElement | null;
  if (providerInput) {
    providerInput.value = ocrProvider;
  }
  if (paddleInput) {
    paddleInput.value = paddleToken;
  }
  if (mineruInput) {
    mineruInput.value = mineruToken;
  }
  if (apiKeyInput) {
    apiKeyInput.value = modelApiKey;
  }
}

export function bindHiddenCredentialInputPersistence({
  credentialsStatePort,
  readCredentials = () => credentialsStatePort?.getCredentials?.() || {},
  saveBrowserStoredConfig,
}: {
  credentialsStatePort?: Pick<CredentialsStatePort, "getCredentials" | "setCredentials"> | null;
  readCredentials?: () => CredentialsFields | Partial<CredentialsFields>;
  saveBrowserStoredConfig?: (credentials: CredentialsFields | Partial<CredentialsFields>) => void;
} = {}) {
  const saveCurrentBrowserCredentials = () => {
    credentialsStatePort?.setCredentials?.(readHiddenCredentialDomInputs());
    saveBrowserStoredConfig?.(readCredentials());
  };
  $(HIDDEN_CREDENTIAL_IDS.ocrProvider)?.addEventListener("input", saveCurrentBrowserCredentials);
  $(HIDDEN_CREDENTIAL_IDS.paddleToken)?.addEventListener("input", saveCurrentBrowserCredentials);
  $(HIDDEN_CREDENTIAL_IDS.mineruToken)?.addEventListener("input", saveCurrentBrowserCredentials);
  $(HIDDEN_CREDENTIAL_IDS.modelApiKey)?.addEventListener("input", saveCurrentBrowserCredentials);
}
