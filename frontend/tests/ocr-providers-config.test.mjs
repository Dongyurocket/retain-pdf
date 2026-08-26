import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_OCR_PROVIDER,
  defaultOcrOptions,
  getOcrProviderDefinition,
  normalizeOcrOptions,
  normalizeOcrOptionsMap,
  normalizeOcrProvider,
  OCR_PROVIDER_DEFINITIONS,
} from "../src/js/config/providers.js";

test("paddle stays the default ocr provider", () => {
  assert.equal(DEFAULT_OCR_PROVIDER, "paddle");
  assert.equal(normalizeOcrProvider(""), "paddle");
  assert.equal(normalizeOcrProvider("unknown"), "paddle");
  assert.equal(normalizeOcrProvider(" MinerU "), "mineru");
  assert.equal(normalizeOcrProvider("paddle"), "paddle");
});

test("ocr provider definitions register paddle and mineru with token fields", () => {
  const ids = OCR_PROVIDER_DEFINITIONS.map((item) => item.id);
  assert.deepEqual(ids, ["paddle", "mineru"]);

  const paddle = getOcrProviderDefinition("paddle");
  assert.equal(paddle.tokenField, "paddle_token");
  assert.equal(paddle.supportsValidation, true);

  const mineru = getOcrProviderDefinition("mineru");
  assert.equal(mineru.tokenField, "mineru_token");
  assert.equal(mineru.supportsValidation, true);
  assert.ok(Array.isArray(mineru.options) && mineru.options.length > 0);
  assert.ok(Array.isArray(paddle.options) && paddle.options.length > 0);
});

test("ocr option defaults fit this project (paddle default, mineru vlm/ch, formula+table on)", () => {
  assert.deepEqual(defaultOcrOptions("paddle"), {
    paddleApiUrl: "",
    paddleModel: "PaddleOCR-VL-1.6",
  });
  assert.deepEqual(defaultOcrOptions("mineru"), {
    modelVersion: "vlm",
    language: "ch",
    disableFormula: false,
    disableTable: false,
  });
});

test("normalizeOcrOptions merges user values over defaults and drops unknown keys", () => {
  assert.deepEqual(normalizeOcrOptions("mineru", { language: "en", bogus: "x" }), {
    modelVersion: "vlm",
    language: "en",
    disableFormula: false,
    disableTable: false,
  });
  assert.deepEqual(normalizeOcrOptions("mineru", { disableFormula: true, disableTable: "yes" }), {
    modelVersion: "vlm",
    language: "ch",
    disableFormula: true,
    disableTable: false,
  });
  assert.deepEqual(normalizeOcrOptions("paddle", { paddleModel: " PaddleOCR-VL-1.5 " }), {
    paddleApiUrl: "",
    paddleModel: "PaddleOCR-VL-1.5",
  });
  // 非对象输入 / 未知 provider 一律回落默认
  assert.deepEqual(normalizeOcrOptions("nope", null), defaultOcrOptions("paddle"));
});

test("normalizeOcrOptionsMap fills every registered provider", () => {
  const map = normalizeOcrOptionsMap({ mineru: { language: "japan" } });
  assert.deepEqual(map.paddle, defaultOcrOptions("paddle"));
  assert.equal(map.mineru.language, "japan");
  assert.equal(map.mineru.modelVersion, "vlm");
});
