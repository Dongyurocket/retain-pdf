// runtime-ports.json：桌面端把本次实际绑定的端口写到 userData 下，
// 供 MCP 桥等外部进程发现真实端口（端口已动态化，硬编码 41000 不可靠）。
//
// 文件只作为"发现线索"：消费者必须自行 health-check 验证可用性，
// 因为桌面端异常退出时文件可能残留。

const fs = require("fs");
const path = require("path");

const RUNTIME_PORTS_FILENAME = "runtime-ports.json";

function resolveRuntimePortsPath(app) {
  return path.join(app.getPath("userData"), RUNTIME_PORTS_FILENAME);
}

function normalizePort(value) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
    return parsed;
  }
  return null;
}

// 读取上一次运行记录的端口；文件缺失、损坏或字段非法时一律返回 null。
function readRuntimePorts(filePath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return null;
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const apiPort = normalizePort(raw.api_port);
  if (apiPort === null) {
    return null;
  }
  return {
    apiPort,
    simplePort: normalizePort(raw.simple_port),
    aiPort: normalizePort(raw.ai_port),
    apiBase: typeof raw.api_base === "string" ? raw.api_base : "",
    pid: Number.isInteger(raw.pid) ? raw.pid : null,
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : "",
  };
}

// 原子写：先写临时文件再 rename，避免消费者读到写了一半的 JSON。
function writeRuntimePorts(filePath, payload = {}) {
  const apiPort = normalizePort(payload.apiPort);
  if (apiPort === null) {
    throw new Error(`writeRuntimePorts requires a valid apiPort, got: ${payload.apiPort}`);
  }
  const body = {
    version: 1,
    pid: process.pid,
    updated_at: new Date().toISOString(),
    api_port: apiPort,
    simple_port: normalizePort(payload.simplePort),
    ai_port: normalizePort(payload.aiPort),
    api_base:
      typeof payload.apiBase === "string" && payload.apiBase.trim()
        ? payload.apiBase.trim()
        : `http://127.0.0.1:${apiPort}`,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
  return body;
}

// 退出时尽力清理；文件残留也可接受（消费者会 health-check 自行兜底）。
function removeRuntimePorts(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (_error) {
    // 文件不存在或暂时不可删都不影响退出流程。
  }
}

module.exports = {
  RUNTIME_PORTS_FILENAME,
  readRuntimePorts,
  removeRuntimePorts,
  resolveRuntimePortsPath,
  writeRuntimePorts,
};
