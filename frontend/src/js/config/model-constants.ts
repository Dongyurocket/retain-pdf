export const DEFAULT_MODEL = "deepseek-v4-flash";
export const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
export const DEFAULT_MODEL_URL = "";
export const DEFAULT_MODEL_VERSION = "vlm";

export const DEFAULT_TEMPERATURE = 0.2;
export const DEFAULT_TOP_P = 1.0;
export const DEFAULT_TIMEOUT_SECONDS = 120;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_REASONING_EFFORT = "auto";
export const DEFAULT_TRANSLATION_MODE = "sci";
export const DEFAULT_MATH_MODE = "direct_typst";
export const DEFAULT_WORKERS = 0;
export const DEFAULT_CONTEXT_MODE = "needed";
export const DEFAULT_GLOSSARY_MODE = "matched";

export const TEMPERATURE_OPTIONS = [
  { value: "0.0", label: "0.0 (严谨保真，适合科技学术)" },
  { value: "0.2", label: "0.2 (默认推荐，平衡准确与通顺)" },
  { value: "0.5", label: "0.5 (适度自然)" },
  { value: "0.7", label: "0.7 (意译润色，适合泛阅读)" },
  { value: "1.0", label: "1.0 (高多样性)" },
];

export const TOP_P_OPTIONS = [
  { value: "1.0", label: "1.0 (全量候选，默认)" },
  { value: "0.95", label: "0.95 (轻度截断)" },
  { value: "0.9", label: "0.9 (高质量过滤)" },
  { value: "0.8", label: "0.8 (严格聚焦)" },
];

export const TIMEOUT_OPTIONS = [
  { value: "60", label: "60 秒 (快速响应)" },
  { value: "120", label: "120 秒 (默认推荐)" },
  { value: "180", label: "180 秒 (长文/复杂公式)" },
  { value: "300", label: "300 秒 (深度推理)" },
];

export const RETRY_OPTIONS = [
  { value: "0", label: "0 次 (不重试)" },
  { value: "1", label: "1 次 (轻度重试)" },
  { value: "2", label: "2 次 (默认推荐)" },
  { value: "3", label: "3 次 (高可靠)" },
  { value: "5", label: "5 次 (深度容错)" },
];

export const REASONING_EFFORT_OPTIONS = [
  { value: "auto", label: "auto (模型默认)" },
  { value: "disabled", label: "disabled (普通/不思考)" },
  { value: "low", label: "low (轻度思考)" },
  { value: "medium", label: "medium (中度思考)" },
  { value: "high", label: "high (深度思考)" },
];

export const TRANSLATION_MODE_OPTIONS = [
  { value: "sci", label: "sci (学术科技专业模式，默认)" },
  { value: "fast", label: "fast (快速通用模式)" },
];

export const MATH_MODE_OPTIONS = [
  { value: "direct_typst", label: "直出公式 (direct_typst，默认推荐)" },
  { value: "placeholder", label: "占位保护 (placeholder)" },
];

export const WORKERS_OPTIONS = [
  { value: "0", label: "0 (自动并发，默认)" },
  { value: "1", label: "1 (单线程串行)" },
  { value: "2", label: "2 (轻度并发)" },
  { value: "4", label: "4 (推荐并发)" },
  { value: "8", label: "8 (高并发)" },
];

export const CONTEXT_MODE_OPTIONS = [
  { value: "needed", label: "needed (按需上下文，默认推荐)" },
  { value: "none", label: "none (独立翻译，无上下文)" },
  { value: "full", label: "full (篇章完整上下文)" },
];

export const GLOSSARY_MODE_OPTIONS = [
  { value: "matched", label: "matched (智能匹配注入，默认)" },
  { value: "all", label: "all (全量注入词表)" },
  { value: "none", label: "none (不注入词表)" },
];
