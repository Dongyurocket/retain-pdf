// 翻译模型与接口设置卡片（支持自定义模型名称、API 密钥、Base URL 与完整 URL，
// 对照旧 components/dialogs/browser-credentials-dialog.js 的 DeepSeek 区块并扩展）。

import { CREDENTIAL_DOM_IDS } from "./credentials-dom-ids.js";
import { useCredentialsController } from "./useCredentialsController.js";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  TRANSLATION_PROVIDER_DEFINITION,
} from "../../composition/external.js";

const { browser: BROWSER_IDS } = CREDENTIAL_DOM_IDS;

function validationIcon(tone = "", content = "") {
  if (!content) {
    return "";
  }
  if (tone === "valid") {
    return "✓";
  }
  if (tone === "error") {
    return "!";
  }
  return "…";
}

export function DeepSeekPanel() {
  const { view, handlers, elementsRef } = useCredentialsController();
  const validation = view.deepSeek || { message: "", tone: "" };
  const content = `${validation.message || ""}`.trim();
  const badgeClasses = [
    "token-inline-status",
    content ? "" : "hidden",
    validation.tone === "valid" ? "is-valid" : "",
    validation.tone === "error" ? "is-error" : "",
    content && !validation.tone ? "is-pending" : "",
  ].filter(Boolean).join(" ");

  return (
    <section className="credential-card">
      <div className="credential-card-head">
        <h3>翻译模型与接口</h3>
        <p className="credential-dialog-note">
          可自定义翻译模型、请求地址与密钥；默认使用 DeepSeek 官方接口。
        </p>
      </div>

      {/* 模型名称 */}
      <label className="credential-option-field">
        <span className="developer-label">
          <span>模型名称 (Model)</span>
        </span>
        <input
          id={BROWSER_IDS.modelName}
          name="model_name"
          type="text"
          autoComplete="off"
          placeholder={`例如 ${DEFAULT_MODEL}、deepseek-chat、gpt-4o 等`}
          defaultValue=""
          ref={(node) => { elementsRef.modelNameInput = node || null; }}
          onInput={() => handlers?.resetDeepSeekValidation?.()}
        />
      </label>

      {/* API 密钥 */}
      <label className="credential-option-field">
        <span className="developer-label">
          <span>API 密钥 (API Key)</span>
        </span>
        <span className="credential-input-row">
          <span className="credential-secret-field">
            <input
              id={BROWSER_IDS.apiKey}
              type="password"
              autoComplete="off"
              placeholder={TRANSLATION_PROVIDER_DEFINITION.keyPlaceholder}
              defaultValue=""
              ref={(node) => { elementsRef.apiKeyInput = node || null; }}
              onInput={() => handlers?.resetDeepSeekValidation?.()}
            />
          </span>
          <a
            className="credential-card-link"
            href={TRANSLATION_PROVIDER_DEFINITION.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {TRANSLATION_PROVIDER_DEFINITION.docsLabel}
          </a>
        </span>
      </label>

      {/* Base URL */}
      <label className="credential-option-field">
        <span className="developer-label">
          <span>基础 API 地址 (Base URL)</span>
        </span>
        <input
          id={BROWSER_IDS.modelBaseUrl}
          name="model_base_url"
          type="text"
          autoComplete="off"
          placeholder={`例如 ${DEFAULT_BASE_URL}`}
          defaultValue=""
          ref={(node) => { elementsRef.modelBaseUrlInput = node || null; }}
          onInput={() => handlers?.resetDeepSeekValidation?.()}
        />
        <span className="credential-option-hint muted">
          OpenAI 兼容基础地址，默认自动向该地址拼接 /chat/completions
        </span>
      </label>

      {/* 完整 URL (可选) */}
      <label className="credential-option-field">
        <span className="developer-label">
          <span>完整请求地址 (Full URL，可选)</span>
        </span>
        <input
          id={BROWSER_IDS.modelUrl}
          name="model_url"
          type="text"
          autoComplete="off"
          placeholder="可选，例如 https://my-gateway.com/v1/chat/completions"
          defaultValue=""
          ref={(node) => { elementsRef.modelUrlInput = node || null; }}
          onInput={() => handlers?.resetDeepSeekValidation?.()}
        />
        <span className="credential-option-hint muted">
          若填写则优先向该完整端点发送请求；留空则使用 Base URL
        </span>
      </label>

      <div className="credential-card-actions">
        <button
          id={BROWSER_IDS.deepSeekValidateButton}
          type="button"
          className="app-button secondary"
          onClick={() => handlers?.validateDeepSeek?.()}
        >
          {TRANSLATION_PROVIDER_DEFINITION.validationButtonLabel}
        </button>
        <span
          id={BROWSER_IDS.deepSeekValidation}
          className={badgeClasses}
          title={content || TRANSLATION_PROVIDER_DEFINITION.validationIdleMessage}
        >
          {validationIcon(validation.tone, content)}
        </span>
        <a
          id={BROWSER_IDS.deepSeekTopUpLink}
          className={`credential-top-up-link${view.deepSeekTopUpVisible ? "" : " hidden"}`}
          href="https://platform.deepseek.com/top_up"
          target="_blank"
          rel="noopener noreferrer"
        >
          充值
        </a>
      </div>
    </section>
  );
}
