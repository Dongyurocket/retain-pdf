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
    modelUrlInput,
    mathModeSelect,
    temperatureSelect,
    topPSelect,
    timeoutSelect,
    maxRetriesSelect,
    reasoningEffortSelect,
    translationModeSelect,
    workersSelect,
    contextModeSelect,
    glossaryModeSelect,
    customRulesInput,
  } = elementsPort.elements();

  const translationOpts = credentials?.translationOptions || {};

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
    modelBaseUrlInput.value = taskOptions.baseUrl || credentials.baseUrl || defaultModelBaseUrl?.() || "";
  }
  if (modelNameInput) {
    modelNameInput.value = taskOptions.model || credentials.model || "";
  }
  if (modelUrlInput) {
    modelUrlInput.value = taskOptions.url || credentials.url || "";
  }
  if (mathModeSelect) {
    const mathMode = taskOptions.mathMode || translationOpts.mathMode;
    mathModeSelect.value = mathMode === "placeholder" ? "placeholder" : "direct_typst";
  }
  if (temperatureSelect) {
    const temp = taskOptions.temperature ?? translationOpts.temperature;
    temperatureSelect.value = temp !== undefined && temp !== null ? `${temp}` : "0.2";
  }
  if (topPSelect) {
    const topP = taskOptions.topP ?? translationOpts.topP;
    topPSelect.value = topP !== undefined && topP !== null ? `${topP}` : "1.0";
  }
  if (timeoutSelect) {
    const timeout = taskOptions.timeoutSeconds ?? translationOpts.timeoutSeconds;
    timeoutSelect.value = timeout !== undefined && timeout !== null ? `${timeout}` : "120";
  }
  if (maxRetriesSelect) {
    const retries = taskOptions.maxRetries ?? translationOpts.maxRetries;
    maxRetriesSelect.value = retries !== undefined && retries !== null ? `${retries}` : "2";
  }
  if (reasoningEffortSelect) {
    reasoningEffortSelect.value = taskOptions.reasoningEffort || translationOpts.reasoningEffort || "auto";
  }
  if (translationModeSelect) {
    translationModeSelect.value = taskOptions.translationMode || translationOpts.translationMode || "sci";
  }
  if (workersSelect) {
    const workers = taskOptions.workers ?? translationOpts.workers;
    workersSelect.value = workers !== undefined && workers !== null ? `${workers}` : "0";
  }
  if (contextModeSelect) {
    contextModeSelect.value = taskOptions.contextMode || translationOpts.contextMode || "needed";
  }
  if (glossaryModeSelect) {
    glossaryModeSelect.value = taskOptions.glossaryMode || translationOpts.glossaryMode || "matched";
  }
  if (customRulesInput) {
    customRulesInput.value = taskOptions.customRulesText || translationOpts.customRulesText || "";
  }
  elementsPort.syncOcrProviderControls(normalizeOcrProvider(credentials.ocrProvider));
}
