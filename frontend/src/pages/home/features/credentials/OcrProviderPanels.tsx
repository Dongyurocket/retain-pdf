// OCR provider 卡片(对照旧 components/dialogs/browser-credentials-dialog.js
// 的 ocrProviderPanels 拼接 + features/credentials/validation-view.js 的
// 校验徽标语义,死文件不 import,这里用 JSX 结构化重写)。
//
// 面板按 OCR_PROVIDER_DEFINITIONS 配置数组渲染,不硬编码 provider id——
// 新增 provider 只需扩数组(config/providers.js)。token/选项输入都是非受控
// ref(见 credentials-view-store.js elementsRef),dialog-values.js/
// dialog-sync.js(kept)直接读写 .value/.checked。
//
// 顶部是引擎选择器(browser-ocr-provider-select):切换即写入
// credentialsStatePort(patchCredentials),面板随 store 重渲染;选项字段
// (API 地址/模型/语言/公式表格开关)随保存按钮一起落盘,默认值见
// OCR_PROVIDER_OPTION_DEFAULTS(适配本项目扫描 PDF + 行内公式场景)。

import {
  credentialTokenInputId,
  credentialValidateButtonId,
  credentialValidationId,
  CREDENTIAL_DOM_IDS,
} from "./credentials-dom-ids.js";
import { useCredentialsController } from "./useCredentialsController.js";
import { OCR_PROVIDER_DEFINITIONS } from "../../composition/external.js";

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

function renderOptionField(provider, option, savedValue, optionInputRef, onResetValidation) {
  const fieldId = `browser-${provider.id}-option-${option.key}`;
  if (option.type === "checkbox") {
    return (
      <label key={option.key} className="credential-option-field credential-option-checkbox">
        <span className="credential-input-row">
          <input
            id={fieldId}
            type="checkbox"
            defaultChecked={Boolean(savedValue)}
            ref={optionInputRef(provider.id, option.key)}
            onChange={() => onResetValidation?.(provider.id)}
          />
          <span>{option.label}</span>
        </span>
        {option.hint ? <span className="muted credential-option-hint">{option.hint}</span> : null}
      </label>
    );
  }
  if (option.type === "select") {
    return (
      <label key={option.key} className="credential-option-field">
        <span className="developer-label">
          <span>{option.label}</span>
        </span>
        <select
          id={fieldId}
          defaultValue={`${savedValue ?? ""}`}
          ref={optionInputRef(provider.id, option.key)}
          onChange={() => onResetValidation?.(provider.id)}
        >
          {(option.choices || []).map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label key={option.key} className="credential-option-field">
      <span className="developer-label">
        <span>{option.label}</span>
      </span>
      <input
        id={fieldId}
        type="text"
        autoComplete="off"
        placeholder={option.placeholder || ""}
        defaultValue={`${savedValue ?? ""}`}
        ref={optionInputRef(provider.id, option.key)}
        onInput={() => onResetValidation?.(provider.id)}
      />
      {option.hint ? <span className="muted credential-option-hint">{option.hint}</span> : null}
    </label>
  );
}

export function OcrProviderPanels() {
  const { credentials, view, handlers, tokenInputRef, optionInputRef } = useCredentialsController();
  const activeProvider = credentials.ocrProvider;

  return (
    <div className="credential-provider-panels">
      <label className="credential-option-field">
        <span className="developer-label">
          <span>OCR 引擎</span>
        </span>
        <select
          id={CREDENTIAL_DOM_IDS.browser.ocrProviderSelect}
          value={activeProvider}
          onChange={(event) => handlers?.changeProvider?.(event)}
        >
          {OCR_PROVIDER_DEFINITIONS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.id === "paddle" ? `${provider.label}（默认）` : provider.label}
            </option>
          ))}
        </select>
      </label>
      {OCR_PROVIDER_DEFINITIONS.map((provider) => {
        const active = provider.id === activeProvider;
        const validation = view.validations[provider.id] || { message: "", tone: "" };
        const content = `${validation.message || ""}`.trim();
        const savedOptions = credentials.ocrOptions?.[provider.id] || {};
        const badgeClasses = [
          "token-inline-status",
          content ? "" : "hidden",
          validation.tone === "valid" ? "is-valid" : "",
          validation.tone === "error" ? "is-error" : "",
          content && !validation.tone ? "is-pending" : "",
        ].filter(Boolean).join(" ");

        return (
          <section
            key={provider.id}
            className={`credential-panel credential-provider-panel${active ? " is-active" : ""}`}
            data-ocr-provider-panel={provider.id}
            role="tabpanel"
            hidden={!active}
          >
            <label>
              <span className="credential-input-row">
                <span className="credential-secret-field">
                  <input
                    id={credentialTokenInputId(provider.id)}
                    type="password"
                    autoComplete="off"
                    placeholder={provider.tokenPlaceholder}
                    defaultValue=""
                    ref={tokenInputRef(provider.id)}
                    onInput={() => handlers?.resetOcrValidation?.(provider.id)}
                  />
                </span>
                <a className="credential-card-link" href={provider.docsUrl} target="_blank" rel="noopener noreferrer">
                  {provider.docsLabel}
                </a>
              </span>
            </label>
            {(provider.options || []).map((option) =>
              renderOptionField(
                provider,
                option,
                savedOptions[option.key],
                optionInputRef,
                (providerId) => handlers?.resetOcrValidation?.(providerId),
              ))}
            <div className="credential-card-actions">
              {provider.supportsValidation ? (
                <button
                  id={credentialValidateButtonId(provider.id)}
                  type="button"
                  className="app-button secondary"
                  onClick={() => handlers?.validateOcr?.()}
                >
                  {provider.validationButtonLabel}
                </button>
              ) : null}
              <span id={credentialValidationId(provider.id)} className={badgeClasses} title={content || provider.validationIdleMessage}>
                {validationIcon(validation.tone, content)}
              </span>
            </div>
          </section>
        );
      })}
    </div>
  );
}
