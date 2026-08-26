import { normalizeOcrOptions, normalizeOcrProvider } from "../../config/providers.js";
import { createCredentialDialogElementsPort } from "./dialog-elements-port.js";

function syncOptionInputs(optionInputs: any = {}, ocrOptions: any = {}) {
  for (const [providerId, inputs] of Object.entries(optionInputs || {})) {
    const saved = normalizeOcrOptions(providerId, (ocrOptions || {})[providerId]);
    for (const [key, node] of Object.entries(inputs || {})) {
      if (!node) {
        continue;
      }
      const value = saved[key];
      if ((node as HTMLInputElement).type === "checkbox") {
        (node as HTMLInputElement).checked = Boolean(value);
      } else if (value !== undefined) {
        (node as HTMLInputElement).value = `${value}`;
      }
    }
  }
}

export function syncCredentialDialogFields({
  credentials,
  taskOptions = {},
  defaultModelBaseUrl,
  defaultModelApiKey,
  elementsPort = createCredentialDialogElementsPort(),
}: any) {
  const {
    paddleInput,
    mineruInput,
    optionInputs,
    apiKeyInput,
    modelBaseUrlInput,
    modelNameInput,
    mathModeSelect,
  } = elementsPort.elements();

  if (paddleInput) {
    paddleInput.value = credentials.paddleToken || "";
  }
  if (mineruInput) {
    mineruInput.value = credentials.mineruToken || "";
  }
  syncOptionInputs(optionInputs, credentials.ocrOptions);
  if (apiKeyInput) {
    // 只展示设置里已存的 Key，不从 runtime 回填（避免「设置空白却仍能问答」）
    void defaultModelApiKey;
    apiKeyInput.value = `${credentials.modelApiKey || ""}`.trim();
  }
  if (modelBaseUrlInput) {
    modelBaseUrlInput.value = taskOptions.baseUrl || defaultModelBaseUrl?.() || "";
  }
  if (modelNameInput) {
    modelNameInput.value = taskOptions.model || "";
  }
  if (mathModeSelect) {
    mathModeSelect.value = taskOptions.mathMode === "placeholder" ? "placeholder" : "direct_typst";
  }
  elementsPort.syncOcrProviderControls(normalizeOcrProvider(credentials.ocrProvider));
}
