import { normalizeOcrOptions, normalizeOcrProvider } from "../../config/providers.js";
import { createCredentialDialogElementsPort } from "./dialog-elements-port.js";

/** Values read from the browser credential dialog inputs. */
export interface CredentialDialogValues {
  paddleToken: string;
  mineruToken: string;
  /** { [providerId]: { [optionKey]: string | boolean } } — OCR provider 选项草稿 */
  ocrOptions: Record<string, Record<string, string | boolean>>;
  modelApiKey: string;
  modelBaseUrl: string;
  modelName: string;
  modelUrl: string;
  mathMode: string;
  temperature: string;
  topP: string;
  timeoutSeconds: string;
  maxRetries: string;
  reasoningEffort: string;
  translationMode: string;
  workers: string;
  contextMode: string;
  glossaryMode: string;
  customRulesText: string;
}

export interface CredentialDialogElementsLike {
  paddleInput?: { value?: string } | null;
  mineruInput?: { value?: string } | null;
  /** { [providerId]: { [optionKey]: HTMLInputElement | HTMLSelectElement | null } } */
  optionInputs?: Record<string, Record<string, { value?: string; checked?: boolean; type?: string } | null>>;
  apiKeyInput?: { value?: string } | null;
  modelBaseUrlInput?: { value?: string } | null;
  modelNameInput?: { value?: string } | null;
  modelUrlInput?: { value?: string } | null;
  mathModeSelect?: { value?: string } | null;
  temperatureSelect?: { value?: string } | null;
  topPSelect?: { value?: string } | null;
  timeoutSelect?: { value?: string } | null;
  maxRetriesSelect?: { value?: string } | null;
  reasoningEffortSelect?: { value?: string } | null;
  translationModeSelect?: { value?: string } | null;
  workersSelect?: { value?: string } | null;
  contextModeSelect?: { value?: string } | null;
  glossaryModeSelect?: { value?: string } | null;
  customRulesInput?: { value?: string } | null;
}

export interface ReadCredentialDialogValuesOptions {
  elementsPort?: {
    elements: () => CredentialDialogElementsLike;
  };
}

export interface BuildBrowserCredentialConfigOptions {
  values: Pick<
    CredentialDialogValues,
    | "paddleToken"
    | "mineruToken"
    | "ocrOptions"
    | "modelApiKey"
    | "modelName"
    | "modelBaseUrl"
    | "modelUrl"
    | "temperature"
    | "topP"
    | "timeoutSeconds"
    | "maxRetries"
    | "reasoningEffort"
    | "translationMode"
    | "mathMode"
    | "workers"
    | "contextMode"
    | "glossaryMode"
    | "customRulesText"
  >;
  currentOcrProvider: () => string;
  defaultModelApiKey?: () => string;
}

export interface BuildTaskOptionsFromDialogValuesOptions {
  values: Pick<
    CredentialDialogValues,
    | "modelName"
    | "modelBaseUrl"
    | "modelUrl"
    | "mathMode"
    | "temperature"
    | "topP"
    | "timeoutSeconds"
    | "maxRetries"
    | "reasoningEffort"
    | "translationMode"
    | "workers"
    | "contextMode"
    | "glossaryMode"
    | "customRulesText"
  >;
  defaultModelBaseUrl?: () => string;
}

function readOptionInputs(
  optionInputs: CredentialDialogElementsLike["optionInputs"] = {},
): Record<string, Record<string, string | boolean>> {
  const values: Record<string, Record<string, string | boolean>> = {};
  for (const [providerId, inputs] of Object.entries(optionInputs || {})) {
    const draft: Record<string, string | boolean> = {};
    for (const [key, node] of Object.entries(inputs || {})) {
      if (!node) {
        continue;
      }
      if (node.type === "checkbox") {
        draft[key] = Boolean(node.checked);
      } else if (typeof node.value === "string") {
        draft[key] = node.value.trim();
      }
    }
    values[providerId] = normalizeOcrOptions(providerId, draft);
  }
  return values;
}

export function readCredentialDialogValues({
  elementsPort = createCredentialDialogElementsPort(),
}: ReadCredentialDialogValuesOptions = {}): CredentialDialogValues {
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
  return {
    paddleToken: paddleInput?.value?.trim() || "",
    mineruToken: mineruInput?.value?.trim() || "",
    ocrOptions: readOptionInputs(optionInputs),
    modelApiKey: apiKeyInput?.value?.trim() || "",
    modelBaseUrl: modelBaseUrlInput?.value?.trim() || "",
    modelName: modelNameInput?.value?.trim() || "",
    modelUrl: modelUrlInput?.value?.trim() || "",
    mathMode: mathModeSelect?.value || "direct_typst",
    temperature: temperatureSelect?.value ?? "0.2",
    topP: topPSelect?.value ?? "1.0",
    timeoutSeconds: timeoutSelect?.value ?? "120",
    maxRetries: maxRetriesSelect?.value ?? "2",
    reasoningEffort: reasoningEffortSelect?.value || "auto",
    translationMode: translationModeSelect?.value || "sci",
    workers: workersSelect?.value ?? "0",
    contextMode: contextModeSelect?.value || "needed",
    glossaryMode: glossaryModeSelect?.value || "matched",
    customRulesText: customRulesInput?.value || "",
  };
}

export function buildBrowserCredentialConfig({
  values,
  currentOcrProvider,
  // defaultModelApiKey 保留参数兼容调用方，但不再静默写入设置（密钥只认对话框/用户输入）
  defaultModelApiKey: _defaultModelApiKey,
}: BuildBrowserCredentialConfigOptions) {
  return {
    ocrProvider: currentOcrProvider(),
    paddleToken: values.paddleToken,
    mineruToken: values.mineruToken,
    ocrOptions: values.ocrOptions,
    modelApiKey: `${values.modelApiKey || ""}`.trim(),
    model: values.modelName,
    baseUrl: values.modelBaseUrl,
    url: values.modelUrl,
    translationOptions: {
      temperature: parseFloat(values.temperature || "0.2"),
      topP: parseFloat(values.topP || "1.0"),
      timeoutSeconds: parseInt(values.timeoutSeconds || "120", 10),
      maxRetries: parseInt(values.maxRetries || "2", 10),
      reasoningEffort: values.reasoningEffort || "auto",
      translationMode: values.translationMode || "sci",
      mathMode: values.mathMode || "direct_typst",
      workers: parseInt(values.workers || "0", 10),
      contextMode: values.contextMode || "needed",
      glossaryMode: values.glossaryMode || "matched",
      customRulesText: values.customRulesText || "",
    },
  };
}

export function buildTaskOptionsFromDialogValues({
  values,
  defaultModelBaseUrl,
}: BuildTaskOptionsFromDialogValuesOptions) {
  return {
    model: values.modelName,
    baseUrl: values.modelBaseUrl || defaultModelBaseUrl?.() || "",
    url: values.modelUrl || "",
    mathMode: values.mathMode,
    temperature: parseFloat(values.temperature || "0.2"),
    topP: parseFloat(values.topP || "1.0"),
    timeoutSeconds: parseInt(values.timeoutSeconds || "120", 10),
    maxRetries: parseInt(values.maxRetries || "2", 10),
    reasoningEffort: values.reasoningEffort || "auto",
    translationMode: values.translationMode || "sci",
    workers: parseInt(values.workers || "0", 10),
    contextMode: values.contextMode || "needed",
    glossaryMode: values.glossaryMode || "matched",
    customRulesText: values.customRulesText || "",
    translateTitles: true,
  };
}

/** 按 provider 取对话框里的 OCR token（缺省按 paddle 兼容旧调用）。 */
export function ocrTokenFromDialogValues(
  values: Partial<Pick<CredentialDialogValues, "paddleToken" | "mineruToken">> = {},
  providerId = "",
) {
  return normalizeOcrProvider(providerId) === "mineru"
    ? values.mineruToken
    : values.paddleToken;
}
