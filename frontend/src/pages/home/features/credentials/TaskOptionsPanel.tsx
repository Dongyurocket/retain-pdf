// 任务选项 tab（对照并扩展原有的任务选项——增加自定义翻译模型参数，包括温度、核采样、
// 超时、重试、思考链、翻译模式、并发线程、上下文模式、词表模式及自定义系统提示词，
// 每项均带有清晰的默认选项和默认值，并提供一键恢复默认按钮）。

import { useCredentialsController } from "./useCredentialsController.js";
import { CREDENTIAL_DOM_IDS } from "./credentials-dom-ids.js";
import {
  CONTEXT_MODE_OPTIONS,
  DEFAULT_CONTEXT_MODE,
  DEFAULT_GLOSSARY_MODE,
  DEFAULT_MATH_MODE,
  DEFAULT_MAX_RETRIES,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_TEMPERATURE,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_TOP_P,
  DEFAULT_TRANSLATION_MODE,
  DEFAULT_WORKERS,
  GLOSSARY_MODE_OPTIONS,
  MATH_MODE_OPTIONS,
  REASONING_EFFORT_OPTIONS,
  RETRY_OPTIONS,
  TEMPERATURE_OPTIONS,
  TIMEOUT_OPTIONS,
  TOP_P_OPTIONS,
  TRANSLATION_MODE_OPTIONS,
  WORKERS_OPTIONS,
} from "../../composition/external.js";

const { browser: BROWSER_IDS } = CREDENTIAL_DOM_IDS;

export function TaskOptionsPanel({ hidden = false } = {}) {
  const { elementsRef } = useCredentialsController();

  function handleResetDefaults() {
    if (elementsRef.mathModeSelect) {
      elementsRef.mathModeSelect.value = DEFAULT_MATH_MODE;
    }
    if (elementsRef.temperatureSelect) {
      elementsRef.temperatureSelect.value = `${DEFAULT_TEMPERATURE}`;
    }
    if (elementsRef.topPSelect) {
      elementsRef.topPSelect.value = `${DEFAULT_TOP_P}`;
    }
    if (elementsRef.timeoutSelect) {
      elementsRef.timeoutSelect.value = `${DEFAULT_TIMEOUT_SECONDS}`;
    }
    if (elementsRef.maxRetriesSelect) {
      elementsRef.maxRetriesSelect.value = `${DEFAULT_MAX_RETRIES}`;
    }
    if (elementsRef.reasoningEffortSelect) {
      elementsRef.reasoningEffortSelect.value = DEFAULT_REASONING_EFFORT;
    }
    if (elementsRef.translationModeSelect) {
      elementsRef.translationModeSelect.value = DEFAULT_TRANSLATION_MODE;
    }
    if (elementsRef.workersSelect) {
      elementsRef.workersSelect.value = `${DEFAULT_WORKERS}`;
    }
    if (elementsRef.contextModeSelect) {
      elementsRef.contextModeSelect.value = DEFAULT_CONTEXT_MODE;
    }
    if (elementsRef.glossaryModeSelect) {
      elementsRef.glossaryModeSelect.value = DEFAULT_GLOSSARY_MODE;
    }
    if (elementsRef.customRulesInput) {
      elementsRef.customRulesInput.value = "";
    }
  }

  return (
    <section
      className={`credential-card credential-panel${hidden ? "" : " is-active"}`}
      data-credential-panel="task"
      role="tabpanel"
      hidden={hidden}
    >
      <div className="credential-card-grid credential-card-grid-compact">
        {/* 模型推理参数 */}
        <section className="credential-card">
          <div className="credential-card-head">
            <h3>模型推理与采样参数</h3>
            <p className="credential-dialog-note">控制大模型生成过程的随机性、超时与容错策略。</p>
          </div>

          <label className="credential-option-field">
            <span className="developer-label">
              <span>采样温度 (Temperature)</span>
            </span>
            <select
              id={BROWSER_IDS.temperature}
              aria-label="采样温度"
              defaultValue={`${DEFAULT_TEMPERATURE}`}
              ref={(node) => { elementsRef.temperatureSelect = node || null; }}
            >
              {TEMPERATURE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="credential-option-field">
            <span className="developer-label">
              <span>核采样 (Top P)</span>
            </span>
            <select
              id={BROWSER_IDS.topP}
              aria-label="核采样"
              defaultValue={`${DEFAULT_TOP_P}`}
              ref={(node) => { elementsRef.topPSelect = node || null; }}
            >
              {TOP_P_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="credential-option-field">
            <span className="developer-label">
              <span>单次请求超时</span>
            </span>
            <select
              id={BROWSER_IDS.timeoutSeconds}
              aria-label="单次请求超时"
              defaultValue={`${DEFAULT_TIMEOUT_SECONDS}`}
              ref={(node) => { elementsRef.timeoutSelect = node || null; }}
            >
              {TIMEOUT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="credential-option-field">
            <span className="developer-label">
              <span>网络错误重试次数</span>
            </span>
            <select
              id={BROWSER_IDS.maxRetries}
              aria-label="网络错误重试次数"
              defaultValue={`${DEFAULT_MAX_RETRIES}`}
              ref={(node) => { elementsRef.maxRetriesSelect = node || null; }}
            >
              {RETRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="credential-option-field">
            <span className="developer-label">
              <span>思考/推理模式 (Reasoning Effort)</span>
            </span>
            <select
              id={BROWSER_IDS.reasoningEffort}
              aria-label="思考/推理模式"
              defaultValue={DEFAULT_REASONING_EFFORT}
              ref={(node) => { elementsRef.reasoningEffortSelect = node || null; }}
            >
              {REASONING_EFFORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        {/* 流水线策略 */}
        <section className="credential-card">
          <div className="credential-card-head">
            <h3>流水线与排版策略</h3>
            <p className="credential-dialog-note">控制公式输出、上下文注入、术语表及并发执行方式。</p>
          </div>

          <label className="credential-option-field">
            <span className="developer-label">
              <span>公式模式 (Math Mode)</span>
            </span>
            <select
              id={BROWSER_IDS.mathMode}
              aria-label="公式模式"
              defaultValue={DEFAULT_MATH_MODE}
              ref={(node) => { elementsRef.mathModeSelect = node || null; }}
            >
              {MATH_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="credential-option-field">
            <span className="developer-label">
              <span>翻译专业模式 (Translation Mode)</span>
            </span>
            <select
              id={BROWSER_IDS.translationMode}
              aria-label="翻译专业模式"
              defaultValue={DEFAULT_TRANSLATION_MODE}
              ref={(node) => { elementsRef.translationModeSelect = node || null; }}
            >
              {TRANSLATION_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="credential-option-field">
            <span className="developer-label">
              <span>并发工作线程 (Workers)</span>
            </span>
            <select
              id={BROWSER_IDS.workers}
              aria-label="并发工作线程"
              defaultValue={`${DEFAULT_WORKERS}`}
              ref={(node) => { elementsRef.workersSelect = node || null; }}
            >
              {WORKERS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="credential-option-field">
            <span className="developer-label">
              <span>前文上下文策略 (Context Mode)</span>
            </span>
            <select
              id={BROWSER_IDS.contextMode}
              aria-label="前文上下文策略"
              defaultValue={DEFAULT_CONTEXT_MODE}
              ref={(node) => { elementsRef.contextModeSelect = node || null; }}
            >
              {CONTEXT_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="credential-option-field">
            <span className="developer-label">
              <span>术语词表注入策略 (Glossary Mode)</span>
            </span>
            <select
              id={BROWSER_IDS.glossaryMode}
              aria-label="术语词表注入策略"
              defaultValue={DEFAULT_GLOSSARY_MODE}
              ref={(node) => { elementsRef.glossaryModeSelect = node || null; }}
            >
              {GLOSSARY_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        {/* 自定义系统规则/提示词 */}
        <section className="credential-card">
          <div className="credential-card-head">
            <h3>自定义翻译规则与提示词 (Prompt Guidance)</h3>
            <p className="credential-dialog-note">
              可输入专用的翻译风格要求、特定术语约定或保留词规则，将直接注入大模型系统指令中。
            </p>
          </div>

          <label className="credential-option-field">
            <textarea
              id={BROWSER_IDS.customRulesText}
              aria-label="自定义翻译规则与提示词"
              placeholder="例如：专有名词保持英文原词；严谨直译科技定义，避免口语化过度意译。"
              rows={3}
              defaultValue=""
              ref={(node) => { elementsRef.customRulesInput = node || null; }}
            />
          </label>

          <div className="credential-card-actions">
            <button
              id={BROWSER_IDS.resetOptionsBtn}
              type="button"
              className="app-button secondary"
              onClick={handleResetDefaults}
            >
              重置翻译参数为默认值
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
