import { withTimeout } from "../../utils/async-timeout.js";
import { buildErrorDiagnostic } from "../../utils/error-diagnostics.js";
import {
  resolveSubmitReadiness,
  SUBMIT_BLOCK_REASONS,
} from "../../contracts/submit-readiness-contract.js";
import { APP_EVENTS } from "../../contracts/app-contract.js";

export const DEEPSEEK_BALANCE_CHECK_TIMEOUT_MS = 12000;

/** DeepSeek 余额/预算快照（workflow budget 侧）。 */
export interface BudgetStateSnapshot {
  visible?: boolean;
  blocking?: boolean;
  balanceChecked?: boolean;
  balanceUnsupported?: boolean;
  message?: string;
}

export interface AppActionsConfigPort {
  isMock?: () => boolean;
  apiBaseLabel?: (() => string) | string;
}

export interface SubmitReadinessSnapshot {
  ready?: boolean;
  reason?: string;
}

export interface JobPayload {
  job_id?: string;
}

export interface DeepSeekBalanceCheckResult {
  status?: string;
  ok?: boolean;
}

export interface OcrCredentialCheckResult {
  summary?: string;
  ok?: boolean;
  status?: string;
}

export interface LibraryEventPortLike {
  publishJobCreated?: (job?: unknown) => void;
  requestRefresh?: (options?: { delay?: number; force?: boolean }) => void;
}

export interface DocumentRefLike {
  defaultView?: { CustomEvent?: typeof CustomEvent } | null;
  dispatchEvent?: (event: Event | { type: string }) => boolean;
}

export interface WindowRefLike {
  setTimeout?: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => number;
}

/** setText 接收 string 或 diagnostic 对象（error-box 侧再格式化）。 */
export type SetTextFn = (id: string, text?: unknown) => void;

export interface NeedsDeepSeekBudgetCheckOptions {
  workflow?: string;
  workflowNeedsUpload?: (workflow?: string) => boolean | unknown;
  currentBudgetState?: (workflow?: string) => BudgetStateSnapshot | null | undefined | unknown;
}

export interface EnsureDeepSeekBudgetReadyOptions extends NeedsDeepSeekBudgetCheckOptions {
  refreshDeepSeekBalance?: (options?: {
    silent?: boolean;
  }) => Promise<DeepSeekBalanceCheckResult | null | undefined | unknown> | DeepSeekBalanceCheckResult | null | undefined | unknown;
  setText?: SetTextFn;
  timeoutMs?: number;
}

export interface CurrentSubmitReadinessOptions {
  workflow?: string;
  configPort?: AppActionsConfigPort;
  desktopMode?: boolean;
  desktopConfigured?: boolean;
  uploadId?: string;
  currentRenderSourceJobId?: () => string | unknown;
  hasBrowserCredentials?: () => boolean | unknown;
  workflowNeedsUpload?: (workflow?: string) => boolean | unknown;
  workflowNeedsCredentials?: (workflow?: string) => boolean | unknown;
  currentBudgetState?: (workflow?: string) => BudgetStateSnapshot | null | undefined | unknown;
}

export interface HandleSubmitReadinessBlockOptions {
  readiness?: SubmitReadinessSnapshot | null;
  openSetupDialog?: () => void;
  openBrowserCredentialsDialog?: (options?: unknown) => void;
  currentBudgetState?: (workflow?: string) => BudgetStateSnapshot | null | undefined | unknown;
  setText?: SetTextFn;
}

export interface EnsureOcrCredentialsForSubmitOptions {
  workflow?: string;
  desktopMode?: boolean;
  workflowNeedsCredentials?: (workflow?: string) => boolean | unknown;
  ensureOcrCredentialsReady?: (options?: {
    onMissingToken?: () => void;
    onInvalidToken?: (result?: OcrCredentialCheckResult) => void;
  }) => Promise<boolean | unknown> | boolean | unknown;
  openBrowserCredentialsDialog?: (options?: unknown) => void;
  setText?: SetTextFn;
}

export interface PublishSubmitSuccessOptions {
  payload?: JobPayload | null | unknown;
  state?: unknown;
  renderJob?: (payload?: unknown) => void;
  syncCurrentJobSnapshot?: (
    state: unknown,
    payload: unknown,
    jobId: string,
    meta?: { startedAt?: string },
  ) => void;
  startJobPolling?: (jobId?: string) => void;
  libraryEventPort?: LibraryEventPortLike;
  documentRef?: DocumentRefLike | Document | null;
  windowRef?: WindowRefLike | Window | null;
  now?: () => string;
}

export interface RunSubmitFlowOptions {
  workflow?: string;
  desktopMode?: boolean;
  configPort?: AppActionsConfigPort;
  state?: unknown;
  apiPrefix?: string;
  uploadId?: string;
  desktopConfigured?: boolean;
  openSetupDialog?: () => void;
  openBrowserCredentialsDialog?: (options?: unknown) => void;
  setText?: SetTextFn;
  submitJobRequest?: (apiPrefix?: unknown, payload?: unknown) => Promise<unknown> | unknown;
  workflowNeedsUpload?: (workflow?: string) => boolean | unknown;
  workflowNeedsCredentials?: (workflow?: string) => boolean | unknown;
  currentRenderSourceJobId?: () => string | unknown;
  currentBudgetState?: (workflow?: string) => BudgetStateSnapshot | null | undefined | unknown;
  collectRunPayload?: () => unknown;
  validateBeforeSubmit?: () => boolean | unknown;
  ensureOcrCredentialsReady?: EnsureOcrCredentialsForSubmitOptions["ensureOcrCredentialsReady"];
  hasBrowserCredentials?: () => boolean | unknown;
  refreshDeepSeekBalance?: EnsureDeepSeekBudgetReadyOptions["refreshDeepSeekBalance"];
  syncCurrentJobSnapshot?: PublishSubmitSuccessOptions["syncCurrentJobSnapshot"];
  renderJob?: (payload?: unknown) => void;
  startJobPolling?: (jobId?: string) => void;
  libraryEventPort?: LibraryEventPortLike;
  isMissingUploadError?: (error: unknown) => boolean;
  handleMissingUploadError?: () => void;
  documentRef?: DocumentRefLike | Document | null;
  windowRef?: WindowRefLike | Window | null;
  now?: () => string;
}

function asBudgetState(value: unknown): BudgetStateSnapshot | null | undefined {
  if (value == null || typeof value !== "object") {
    return value as null | undefined;
  }
  return value as BudgetStateSnapshot;
}

function asJobPayload(value: unknown): JobPayload | null | undefined {
  if (value == null || typeof value !== "object") {
    return value as null | undefined;
  }
  return value as JobPayload;
}

function asBalanceResult(value: unknown): DeepSeekBalanceCheckResult | null | undefined {
  if (value == null || typeof value !== "object") {
    return value as null | undefined;
  }
  return value as DeepSeekBalanceCheckResult;
}

export function needsDeepSeekBudgetCheck({
  workflow,
  workflowNeedsUpload,
  currentBudgetState,
}: NeedsDeepSeekBudgetCheckOptions = {}) {
  const budget = asBudgetState(currentBudgetState?.());
  return Boolean(workflowNeedsUpload?.(workflow)) && Boolean(budget?.visible);
}

export async function ensureDeepSeekBudgetReady({
  workflow,
  workflowNeedsUpload,
  currentBudgetState,
  refreshDeepSeekBalance,
  setText,
  timeoutMs = DEEPSEEK_BALANCE_CHECK_TIMEOUT_MS,
}: EnsureDeepSeekBudgetReadyOptions = {}) {
  if (!needsDeepSeekBudgetCheck({ workflow, workflowNeedsUpload, currentBudgetState })) {
    return true;
  }
  setText("error-box", "正在检测 DeepSeek 余额…");
  let balanceResult: DeepSeekBalanceCheckResult | null | undefined = null;
  try {
    balanceResult = asBalanceResult(await withTimeout(
      refreshDeepSeekBalance?.({ silent: true }) || Promise.resolve(null),
      timeoutMs,
      "DeepSeek 余额检测超时，请稍后重试或在接口设置中检测。",
    ));
    if (balanceResult?.status === "missing_key") {
      setText("error-box", "请先填写 DeepSeek API Key。");
      return false;
    }
    if (balanceResult?.status === "network_error") {
      setText("error-box", "DeepSeek 余额检测失败，请稍后重试或在接口设置中检测。");
      return false;
    }
  } catch (error) {
    setText("error-box", (error as { message?: string })?.message || "DeepSeek 余额检测失败，请稍后重试。");
    return false;
  }
  const budget = asBudgetState(currentBudgetState?.());
  if (budget?.blocking) {
    setText("error-box", `余额不足：${budget.message}。请充值后再提交。`);
    return false;
  }
  if (budget?.balanceUnsupported || balanceResult?.status === "unsupported_provider") {
    setText("error-box", "当前接口不支持余额查询，请确认余额充足后提交。");
    return true;
  }
  if (budget?.visible && !budget.balanceChecked) {
    setText("error-box", "无法确认 DeepSeek 余额，请先在接口设置中完成检测。");
    return false;
  }
  return true;
}

export function currentSubmitReadiness({
  workflow,
  configPort,
  desktopMode,
  desktopConfigured,
  uploadId,
  currentRenderSourceJobId,
  hasBrowserCredentials,
  workflowNeedsUpload,
  workflowNeedsCredentials,
  currentBudgetState,
}: CurrentSubmitReadinessOptions = {}) {
  return resolveSubmitReadiness({
    workflow,
    isMock: Boolean(configPort?.isMock?.()),
    desktopMode,
    desktopConfigured,
    uploadId,
    renderSourceJobId: currentRenderSourceJobId?.(),
    hasBrowserCredentials: Boolean(hasBrowserCredentials?.()),
    needsUpload: workflowNeedsUpload?.(workflow),
    needsCredentials: workflowNeedsCredentials?.(workflow),
    budgetBlocking: Boolean(asBudgetState(currentBudgetState?.())?.blocking),
  });
}

export function handleSubmitReadinessBlock({
  readiness,
  openSetupDialog,
  openBrowserCredentialsDialog,
  currentBudgetState,
  setText,
}: HandleSubmitReadinessBlockOptions = {}) {
  switch (readiness?.reason) {
    case SUBMIT_BLOCK_REASONS.DESKTOP_NOT_CONFIGURED:
      openSetupDialog?.();
      setText("error-box", "请先完成首次配置。");
      return true;
    case SUBMIT_BLOCK_REASONS.MISSING_CREDENTIALS:
      setText("error-box", "请先填写当前 OCR Provider 凭证。");
      openBrowserCredentialsDialog?.();
      return true;
    case SUBMIT_BLOCK_REASONS.MISSING_UPLOAD:
      setText("error-box", "请先选择并上传 PDF 文件");
      return true;
    case SUBMIT_BLOCK_REASONS.MISSING_RENDER_SOURCE:
      setText("error-box", "请先在开发者设置里填写 Render 源任务 ID。");
      return true;
    case SUBMIT_BLOCK_REASONS.BUDGET_BLOCKING: {
      const budget = asBudgetState(currentBudgetState?.());
      setText("error-box", `余额不足：${budget?.message || "请充值后再提交"}。请充值后再提交。`);
      return true;
    }
    default:
      return false;
  }
}

export async function ensureOcrCredentialsForSubmit({
  workflow,
  desktopMode,
  workflowNeedsCredentials,
  ensureOcrCredentialsReady,
  openBrowserCredentialsDialog,
  setText,
}: EnsureOcrCredentialsForSubmitOptions = {}) {
  if (!workflowNeedsCredentials?.(workflow)) {
    return true;
  }
  return Boolean(await ensureOcrCredentialsReady?.({
    onMissingToken: () => {
      setText("error-box", "请先填写当前 OCR Provider 凭证。");
      if (!desktopMode) {
        openBrowserCredentialsDialog?.();
      }
    },
    onInvalidToken: (result) => {
      setText("error-box", result.summary || "OCR Provider 凭证校验未通过。");
      if (!desktopMode) {
        openBrowserCredentialsDialog?.();
      }
    },
  }));
}

export function publishSubmitSuccess({
  payload,
  state,
  renderJob,
  syncCurrentJobSnapshot,
  startJobPolling,
  libraryEventPort,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  now = () => new Date().toISOString(),
}: PublishSubmitSuccessOptions = {}) {
  // 创建事件已 insert+hydrate；不再 200/1500/4000 三次 force 整页刷（叠乘闪烁）
  libraryEventPort?.publishJobCreated?.(payload);
  // 单次延迟 soft 对齐文档投影（soft reset 保留旧 items；不 force 绕过 workflow suspend）
  windowRef?.setTimeout?.(() => {
    libraryEventPort?.requestRefresh?.({ delay: 0, force: false });
  }, 800);
  const EventCtor = documentRef?.defaultView?.CustomEvent || globalThis.CustomEvent;
  const openWorkflowEvent = typeof EventCtor === "function"
    ? new EventCtor(APP_EVENTS.openTranslationWorkflow)
    : { type: APP_EVENTS.openTranslationWorkflow };
  documentRef?.dispatchEvent?.(openWorkflowEvent as Event);
  const job = asJobPayload(payload);
  syncCurrentJobSnapshot?.(state, payload, job?.job_id || "", {
    startedAt: now(),
  });
  renderJob?.(payload);
  startJobPolling?.(job?.job_id);
}

export async function runSubmitFlow({
  workflow,
  desktopMode,
  configPort,
  state,
  apiPrefix,
  uploadId,
  desktopConfigured,
  openSetupDialog,
  openBrowserCredentialsDialog,
  setText,
  submitJobRequest,
  workflowNeedsUpload,
  workflowNeedsCredentials,
  currentRenderSourceJobId,
  currentBudgetState,
  collectRunPayload,
  validateBeforeSubmit,
  ensureOcrCredentialsReady,
  hasBrowserCredentials,
  refreshDeepSeekBalance,
  syncCurrentJobSnapshot,
  renderJob,
  startJobPolling,
  libraryEventPort,
  isMissingUploadError,
  handleMissingUploadError,
  documentRef,
  windowRef,
  now,
}: RunSubmitFlowOptions = {}) {
  if (configPort?.isMock?.()) {
    setText("error-box", "-");
    const payload = await submitJobRequest(apiPrefix, { workflow, source: {}, mock: true });
    publishSubmitSuccess({
      payload,
      state,
      renderJob,
      syncCurrentJobSnapshot,
      startJobPolling,
      libraryEventPort,
      documentRef,
      windowRef,
      now,
    });
    return { status: "submitted", payload, mock: true };
  }

  const readiness = currentSubmitReadiness({
    workflow,
    configPort,
    desktopMode,
    desktopConfigured,
    uploadId,
    currentRenderSourceJobId,
    hasBrowserCredentials,
    workflowNeedsUpload,
    workflowNeedsCredentials,
    currentBudgetState,
  });
  if (!readiness.ready) {
    handleSubmitReadinessBlock({
      readiness,
      openSetupDialog,
      openBrowserCredentialsDialog,
      currentBudgetState,
      setText,
    });
    return { status: "blocked", readiness };
  }
  if (!validateBeforeSubmit?.()) {
    return { status: "invalid_page_ranges" };
  }
  if (!(await ensureDeepSeekBudgetReady({
    workflow,
    workflowNeedsUpload,
    currentBudgetState,
    refreshDeepSeekBalance,
    setText,
  }))) {
    return { status: "budget_not_ready" };
  }
  if (!(await ensureOcrCredentialsForSubmit({
    workflow,
    desktopMode,
    workflowNeedsCredentials,
    ensureOcrCredentialsReady,
    openBrowserCredentialsDialog,
    setText,
  }))) {
    return { status: "ocr_credentials_not_ready" };
  }

  setText("error-box", "-");

  try {
    const runPayload = collectRunPayload?.();
    const payload = await submitJobRequest(apiPrefix, runPayload);
    publishSubmitSuccess({
      payload,
      state,
      renderJob,
      syncCurrentJobSnapshot,
      startJobPolling,
      libraryEventPort,
      documentRef,
      windowRef,
      now,
    });
    return { status: "submitted", payload, mock: false };
  } catch (err) {
    if (isMissingUploadError?.(err)) {
      handleMissingUploadError?.();
      return { status: "missing_upload", error: err };
    }
    setText("error-box", buildErrorDiagnostic(err, {
      operation: "提交 PDF 任务",
      url: `${apiPrefix || ""}/jobs`,
      details: {
        workflow,
        upload_id: uploadId,
        render_source_job_id: currentRenderSourceJobId?.(),
      },
    }));
    return { status: "error", error: err };
  }
}
