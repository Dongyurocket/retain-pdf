import {
  TRANSLATION_PROVIDER_DEFINITION,
  isOfficialDeepSeekEndpoint,
} from "../../config/providers.js";
import {
  runDeepSeekBalanceCheck,
  runDeepSeekConnectivityCheck,
  summarizeDeepSeekBalance,
} from "./validation.js";
import { defaultCredentialsStatePort } from "./default-state-port.js";

const DEEPSEEK_LOW_BALANCE_THRESHOLD = 2;

function deepSeekBalanceAmount(result) {
  const infos = Array.isArray(result?.balance_infos) ? result.balance_infos : [];
  return infos.reduce((sum, item) => {
    const raw = `${item?.total_balance ?? ""}`.replace(/[^\d.-]/g, "");
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

export async function handleBrowserDeepSeekValidate({
  apiPrefix,
  state,
  defaultModelApiKey,
  validateDeepSeekToken,
  queryDeepSeekBalance,
  onBalanceChange,
  silent = false,
  credentialsStatePort = defaultCredentialsStatePort,
  viewPort,
  modelEndpoint = "",
}: any) {
  const elements = viewPort.elements?.() || {};
  const {
    apiKeyInput,
    modelBaseUrlInput,
  } = elements;
  const storedCredentials = credentialsStatePort.getCredentials?.() || {};
  const modelApiKey = apiKeyInput?.value?.trim() || storedCredentials.modelApiKey || defaultModelApiKey?.() || "";
  if (apiKeyInput && !apiKeyInput.value && modelApiKey) {
    apiKeyInput.value = modelApiKey;
  }
  const baseUrl = `${modelEndpoint || modelBaseUrlInput?.value?.trim() || ""}`.trim();
  credentialsStatePort.resetDeepSeekBalance?.();
  onBalanceChange?.();
  if (!modelApiKey) {
    return { ok: false, status: "missing_key" };
  }
  viewPort.setTopUpVisible(false);
  if (!isOfficialDeepSeekEndpoint(baseUrl)) {
    // 非官方接口：不做 /models 连通性探测，也不请求官方余额端点。
    credentialsStatePort.setDeepSeekBalance?.(null, false, true);
    onBalanceChange?.();
    if (!silent) {
      viewPort.setValidationMessage("自定义接口已跳过 API 检测与余额查询，请自行确认额度", "valid");
    }
    return {
      ok: true,
      status: "unsupported_provider",
      summary: "自定义接口无需余额检测",
    };
  }
  if (!silent) {
    viewPort.setValidationMessage("正在检测 DeepSeek 和余额…");
  }
  const result = await runDeepSeekConnectivityCheck({
    apiPrefix,
    apiKey: modelApiKey,
    baseUrl,
    validateDeepSeekToken,
    setDeepSeekValidationMessage: viewPort.setValidationMessage,
    showResult: false,
  });
  if (result.ok) {
    const balance = await runDeepSeekBalanceCheck({
      apiPrefix,
      apiKey: modelApiKey,
      baseUrl,
      queryDeepSeekBalance,
    });
    if (balance.status === "unsupported_provider") {
      credentialsStatePort.setDeepSeekBalance?.(null, false, true);
      onBalanceChange?.();
      if (!silent) {
        viewPort.setValidationMessage("DeepSeek 可用，余额需自行确认", "valid");
      }
      return balance;
    }
    if (balance.status === "network_error") {
      if (!silent) {
        viewPort.setValidationMessage("DeepSeek 可用，余额查询失败", "valid");
      }
      return balance;
    }
    const balanceSummary = summarizeDeepSeekBalance(balance);
    const balanceAmount = deepSeekBalanceAmount(balance);
    credentialsStatePort.setDeepSeekBalance?.(balanceAmount, true);
    onBalanceChange?.();
    const shouldTopUp = balanceAmount < DEEPSEEK_LOW_BALANCE_THRESHOLD;
    viewPort.setTopUpVisible(shouldTopUp);
    viewPort.setValidationMessage(
      `DeepSeek 可用，${balanceSummary}${shouldTopUp ? "，余额低于 2 元" : ""}`,
      balance.is_available ? "valid" : "error",
    );
    return balance;
  }
  viewPort.setTopUpVisible(false);
  if (!silent) {
    viewPort.setValidationMessage(
      result.summary || TRANSLATION_PROVIDER_DEFINITION.validationNetworkMessage,
      "error",
    );
  }
  return result;
}
