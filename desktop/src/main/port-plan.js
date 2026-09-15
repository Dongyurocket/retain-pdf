// 桌面端三类本地端口的候选清单（纯函数，便于单测）。
//
// 背景：Windows Hyper-V/WSL2/Docker Desktop 的 HNS 会在开机时成块保留动态端口
// （实测一次为 41890-45985，起点每次开机变化，且不出现在
// `netsh int ipv4 show excludedportrange` 中）。任何固定端口都可能在某次开机后
// 被内核保留块吞掉，表现为 bind 报 10048 但 netstat 查不到占用。
// 因此三个端口都按候选顺序做真实 bind 探测（见 port-availability.js），
// 第一个可绑定的端口胜出，而不是钉死单个数字。

const DEFAULT_API_PORT = 41000;
// 回退段避开 simple 口回退段（41001-41004）与 AI 默认口（41100）。
const API_PORT_FALLBACKS = [41200, 41201, 41202, 41203];

const DEFAULT_SIMPLE_PORT = 42000;
const SIMPLE_PORT_FALLBACKS = [41001, 41002, 41003, 41004];

const DEFAULT_AI_PORT = 41100;
const AI_PORT_FALLBACKS = [41300, 41301, 41302];

function parsePortOverride(value) {
  const parsed = Number.parseInt(`${value || ""}`, 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
    return parsed;
  }
  return null;
}

function isValidPort(value) {
  return Number.isInteger(value) && value > 0 && value < 65536;
}

function dedupe(ports) {
  const seen = new Set();
  const result = [];
  for (const port of ports) {
    if (!isValidPort(port) || seen.has(port)) {
      continue;
    }
    seen.add(port);
    result.push(port);
  }
  return result;
}

// 主 API 口。环境变量显式指定时只试该端口（失败即报错，不静默换口）。
// lastPort 是上一次运行时写入 runtime-ports.json 的端口：排在默认口之后，
// 这样默认口恢复可用时会回到默认口，默认口仍被保留时优先回到上次成功的端口。
function resolveApiPortCandidates(options = {}) {
  const env = options.env || process.env;
  const override = parsePortOverride(env.RETAINPDF_DESKTOP_API_PORT);
  if (override !== null) {
    return [override];
  }
  return dedupe([DEFAULT_API_PORT, options.lastPort, ...API_PORT_FALLBACKS]);
}

// multipart 提交口。没有前端/MCP 硬编码依赖，保留现有回退顺序。
function resolveSimplePortCandidates(options = {}) {
  const env = options.env || process.env;
  const override = parsePortOverride(env.RETAINPDF_DESKTOP_SIMPLE_PORT);
  if (override !== null) {
    return [override];
  }
  return [DEFAULT_SIMPLE_PORT, ...SIMPLE_PORT_FALLBACKS];
}

// retainpdf-ai 口。Rust 通过 RUST_API_AI_SERVICE_BASE 反代到该端口，
// 两端都由 buildBackendEnv 从同一解析结果注入，因此可以安全回退。
function resolveAiPortCandidates(options = {}) {
  const env = options.env || process.env;
  const override = parsePortOverride(env.RETAINPDF_DESKTOP_AI_PORT);
  if (override !== null) {
    return [override];
  }
  return [DEFAULT_AI_PORT, ...AI_PORT_FALLBACKS];
}

module.exports = {
  AI_PORT_FALLBACKS,
  API_PORT_FALLBACKS,
  DEFAULT_AI_PORT,
  DEFAULT_API_PORT,
  DEFAULT_SIMPLE_PORT,
  SIMPLE_PORT_FALLBACKS,
  resolveAiPortCandidates,
  resolveApiPortCandidates,
  resolveSimplePortCandidates,
};
