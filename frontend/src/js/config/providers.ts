export const DEFAULT_OCR_PROVIDER = "paddle";

/**
 * OCR provider 选项默认值（与 backend/config/ocr_providers.json 的
 * options.default 对齐）。本项目核心场景是扫描/图片型 PDF + 行内公式，
 * 因此 MinerU 默认开公式/表格识别（disable_* = false）、vlm 模型、中文；
 * PaddleOCR 默认 PaddleOCR-VL-1.6，api url 留空时提交链路回落到公共端点。
 */
export const OCR_PROVIDER_OPTION_DEFAULTS = {
  paddle: {
    paddleApiUrl: "",
    paddleModel: "PaddleOCR-VL-1.6",
  },
  mineru: {
    modelVersion: "vlm",
    language: "ch",
    disableFormula: false,
    disableTable: false,
  },
};

export const OCR_PROVIDER_DEFINITIONS = [
  {
    id: "paddle",
    label: "PaddleOCR",
    description: "在线 OCR（默认）。",
    tokenField: "paddle_token",
    runtimeConfigKey: "paddleToken",
    tokenLabel: "Paddle Access Token",
    tokenPlaceholder: "Paddle Access Token",
    validationButtonLabel: "检测 Paddle",
    validationIdleMessage: "未检测",
    validationMissingMessage: "请先填写 Paddle Access Token。",
    validationUnavailableMessage: "",
    docsUrl: "https://aistudio.baidu.com/account/accessToken",
    docsLabel: "获取 Token",
    supportsValidation: true,
    options: [
      {
        key: "paddleApiUrl",
        label: "API 地址",
        type: "text",
        placeholder: "https://paddleocr.aistudio-app.com",
        hint: "留空使用默认公共端点。",
      },
      {
        key: "paddleModel",
        label: "模型",
        type: "select",
        choices: [
          { value: "PaddleOCR-VL-1.6", label: "PaddleOCR-VL-1.6（默认）" },
          { value: "PaddleOCR-VL-1.5", label: "PaddleOCR-VL-1.5" },
          { value: "PP-StructureV3", label: "PP-StructureV3" },
        ],
      },
    ],
  },
  {
    id: "mineru",
    label: "MinerU",
    description: "在线 OCR。",
    tokenField: "mineru_token",
    runtimeConfigKey: "mineruToken",
    tokenLabel: "MinerU API Token",
    tokenPlaceholder: "MinerU API Token",
    validationButtonLabel: "检测 MinerU",
    validationIdleMessage: "未检测",
    validationMissingMessage: "请先填写 MinerU API Token。",
    validationUnavailableMessage: "",
    docsUrl: "https://mineru.net/apiManage",
    docsLabel: "获取 Token",
    supportsValidation: true,
    options: [
      {
        key: "modelVersion",
        label: "模型版本",
        type: "select",
        choices: [
          { value: "vlm", label: "vlm（默认，推荐）" },
          { value: "pipeline", label: "pipeline" },
        ],
      },
      {
        key: "language",
        label: "文档语言",
        type: "select",
        choices: [
          { value: "ch", label: "中文（默认）" },
          { value: "en", label: "English" },
          { value: "japan", label: "日文" },
          { value: "korean", label: "韩文" },
          { value: "chinese_cht", label: "繁体中文" },
        ],
      },
      {
        key: "disableFormula",
        label: "禁用公式识别",
        type: "checkbox",
        hint: "本项目主打行内公式渲染，默认保持开启识别（不勾选）。",
      },
      {
        key: "disableTable",
        label: "禁用表格识别",
        type: "checkbox",
        hint: "默认保持开启识别（不勾选）。",
      },
    ],
  },
];

export const TRANSLATION_PROVIDER_DEFINITION = {
  id: "deepseek",
  label: "DeepSeek",
  keyLabel: "DeepSeek Key",
  keyPlaceholder: "DeepSeek API Key",
  description: "翻译模型。",
  docsUrl: "https://platform.deepseek.com/api_keys",
  docsLabel: "获取 Key",
  validationButtonLabel: "检测 DeepSeek",
  validationIdleMessage: "未检测",
  validationMissingMessage: "请先填写 DeepSeek Key。",
  validationSuccessMessage: "DeepSeek 接口连接成功。",
  validationNetworkMessage: "DeepSeek 接口检测失败，请检查网络或浏览器跨域限制。",
  validationUnauthorizedMessage: "DeepSeek Key 无效或已过期。",
};

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeOcrProvider(value) {
  const provider = `${value || ""}`.trim().toLowerCase();
  return OCR_PROVIDER_DEFINITIONS.some((item) => item.id === provider) ? provider : DEFAULT_OCR_PROVIDER;
}

export function getOcrProviderDefinition(provider) {
  return OCR_PROVIDER_DEFINITIONS.find((item) => item.id === normalizeOcrProvider(provider)) || OCR_PROVIDER_DEFINITIONS[0];
}

export function defaultOcrOptions(provider): Record<string, string | boolean> {
  const id = normalizeOcrProvider(provider);
  const defaults: Record<string, string | boolean> = (OCR_PROVIDER_OPTION_DEFAULTS as Record<string, Record<string, string | boolean>>)[id] || {};
  return { ...defaults };
}

/**
 * 合并用户配置与默认值。未知 provider 一律归一到默认 provider；
 * 只保留默认值里声明过的键，避免把脏数据带进提交 payload。
 */
export function normalizeOcrOptions(provider, options = {}): Record<string, string | boolean> {
  const defaults: Record<string, string | boolean> = defaultOcrOptions(provider);
  const source = isObject(options) ? options : {};
  const normalized: Record<string, string | boolean> = {};
  for (const key of Object.keys(defaults)) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof defaults[key] === "boolean") {
      normalized[key] = typeof value === "boolean" ? value : defaults[key];
      continue;
    }
    normalized[key] = typeof value === "string" && value.trim() ? value.trim() : defaults[key];
  }
  return normalized;
}

/** 归一化整份 ocrOptions 映射：{ [providerId]: { ...options } }。 */
export function normalizeOcrOptionsMap(source = {}): Record<string, Record<string, string | boolean>> {
  const map = isObject(source) ? source : {};
  const normalized: Record<string, Record<string, string | boolean>> = {};
  for (const definition of OCR_PROVIDER_DEFINITIONS) {
    normalized[definition.id] = normalizeOcrOptions(definition.id, (map as Record<string, unknown>)[definition.id]);
  }
  return normalized;
}
