import { getOcrProviderDefinition, normalizeOcrOptions, normalizeOcrProvider } from "../../config/providers.js";

/** Developer/workflow config fields consumed by payload builders. */
export interface WorkflowDeveloperConfig {
  workflow?: string;
  renderSourceJobId?: string;
  mathMode?: string;
  model?: string;
  baseUrl?: string;
  glossaryId?: string;
  workers?: number;
  batchSize?: number;
  classifyBatchSize?: number;
  compileWorkers?: number;
  timeoutSeconds?: number;
  translateTitles?: boolean;
  [key: string]: unknown;
}

/** Constant bag used when assembling OCR / translation / render payloads. */
export interface WorkflowPayloadConstants {
  DEFAULT_MODEL_VERSION?: string;
  DEFAULT_LANGUAGE?: string;
  DEFAULT_MODE?: string;
  DEFAULT_RULE_PROFILE?: string;
  DEFAULT_RENDER_MODE?: string;
  DEFAULT_TYPST_FONT_FAMILY?: string;
  DEFAULT_PDF_COMPRESS_DPI?: number;
  DEFAULT_TRANSLATED_PDF_NAME?: string;
  DEFAULT_BODY_FONT_SIZE_FACTOR?: number;
  DEFAULT_BODY_LEADING_FACTOR?: number;
  DEFAULT_INNER_BBOX_SHRINK_X?: number;
  DEFAULT_INNER_BBOX_SHRINK_Y?: number;
  DEFAULT_INNER_BBOX_DENSE_SHRINK_X?: number;
  DEFAULT_INNER_BBOX_DENSE_SHRINK_Y?: number;
  DEFAULT_FONT_UNIFY_MODE?: string;
  [key: string]: unknown;
}

export interface BuildSourcePayloadOptions {
  workflow: string;
  developerConfig: Pick<WorkflowDeveloperConfig, "renderSourceJobId"> | WorkflowDeveloperConfig;
  uploadId?: string;
  workflowNeedsUpload: (workflow?: string) => boolean;
}

export interface BuildOcrPayloadOptions {
  pageRanges?: string;
  ocrProvider?: string;
  ocrToken?: string;
  /** { [providerId]: { [optionKey]: string | boolean } } — 来自凭据设置的 provider 选项 */
  ocrOptions?: Record<string, Record<string, string | boolean>>;
  defaultPaddleApiUrl: () => string;
  constants: WorkflowPayloadConstants;
}

export interface BuildTranslationPayloadOptions {
  developerConfig: WorkflowDeveloperConfig;
  modelApiKey?: string;
  selectedGlossaryId?: string;
  constants: WorkflowPayloadConstants;
}

export interface BuildRenderPayloadOptions {
  developerConfig: Pick<WorkflowDeveloperConfig, "compileWorkers"> | WorkflowDeveloperConfig;
  constants: WorkflowPayloadConstants;
}

export function buildSourcePayload({
  workflow,
  developerConfig,
  uploadId,
  workflowNeedsUpload,
}: BuildSourcePayloadOptions) {
  return workflowNeedsUpload(workflow)
    ? { upload_id: uploadId }
    : { artifact_job_id: developerConfig.renderSourceJobId };
}

export function buildOcrPayload({
  pageRanges,
  ocrProvider,
  ocrToken,
  ocrOptions,
  defaultPaddleApiUrl,
  constants,
}: BuildOcrPayloadOptions) {
  const provider = normalizeOcrProvider(ocrProvider);
  const definition = getOcrProviderDefinition(provider);
  const options = normalizeOcrOptions(provider, ocrOptions?.[provider]);
  const payload: Record<string, unknown> = {
    provider,
    [definition.tokenField]: ocrToken || "",
    page_ranges: pageRanges,
  };
  if (definition.id === "paddle") {
    // paddle 沿用既有线行为（model_version/language 常量）,另加可配置的
    // paddle_api_url / paddle_model(后端 normalize_paddle_model_name 收口)。
    payload.model_version = constants.DEFAULT_MODEL_VERSION;
    payload.language = constants.DEFAULT_LANGUAGE;
    payload.paddle_api_url = `${options.paddleApiUrl || ""}`.trim()
      || defaultPaddleApiUrl()
      || "https://paddleocr.aistudio-app.com";
    payload.paddle_model = options.paddleModel;
    return payload;
  }
  payload.model_version = options.modelVersion;
  payload.language = options.language;
  payload.disable_formula = Boolean(options.disableFormula);
  payload.disable_table = Boolean(options.disableTable);
  return payload;
}

export function buildTranslationPayload({
  developerConfig,
  modelApiKey,
  selectedGlossaryId,
  constants,
}: BuildTranslationPayloadOptions) {
  return {
    mode: constants.DEFAULT_MODE,
    math_mode: developerConfig.mathMode,
    model: developerConfig.model,
    base_url: developerConfig.baseUrl,
    api_key: modelApiKey || "",
    workers: developerConfig.workers,
    batch_size: developerConfig.batchSize,
    classify_batch_size: developerConfig.classifyBatchSize,
    rule_profile_name: constants.DEFAULT_RULE_PROFILE,
    custom_rules_text: "",
    glossary_id: selectedGlossaryId || developerConfig.glossaryId || "",
    glossary_entries: [],
    skip_title_translation: !developerConfig.translateTitles,
  };
}

export function buildRenderPayload({ developerConfig, constants }: BuildRenderPayloadOptions) {
  return {
    render_mode: constants.DEFAULT_RENDER_MODE,
    compile_workers: developerConfig.compileWorkers,
    typst_font_family: constants.DEFAULT_TYPST_FONT_FAMILY,
    pdf_compress_dpi: constants.DEFAULT_PDF_COMPRESS_DPI,
    translated_pdf_name: constants.DEFAULT_TRANSLATED_PDF_NAME,
    body_font_size_factor: constants.DEFAULT_BODY_FONT_SIZE_FACTOR,
    body_leading_factor: constants.DEFAULT_BODY_LEADING_FACTOR,
    inner_bbox_shrink_x: constants.DEFAULT_INNER_BBOX_SHRINK_X,
    inner_bbox_shrink_y: constants.DEFAULT_INNER_BBOX_SHRINK_Y,
    inner_bbox_dense_shrink_x: constants.DEFAULT_INNER_BBOX_DENSE_SHRINK_X,
    inner_bbox_dense_shrink_y: constants.DEFAULT_INNER_BBOX_DENSE_SHRINK_Y,
    font_unify_mode: constants.DEFAULT_FONT_UNIFY_MODE,
  };
}
