// 清理占用后端端口的残留 rust_api 进程。
// 场景：升级安装或异常退出后，旧版 rust_api.exe 仍占用 41000，
// 导致新版桌面端启动时报"端口已被占用"，过去只能重启电脑解决。
// 这里定位监听进程，确认它是 rust_api 后优雅终止，让本次启动走全新实例。

const { execFile } = require("child_process");

const STALE_BACKEND_NAME_PATTERN = /^rust_api(\.exe)?$/i;

function runCommand(command, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout) => {
        resolve({ ok: !error, stdout: String(stdout || "") });
      },
    );
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 返回 [{ pid, name, path }]，仅包含真实监听该端口的进程。
async function listPortListeners(port) {
  if (process.platform === "win32") {
    const script = [
      `$conns = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
      "$items = @()",
      "foreach ($c in $conns) {",
      "  $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue",
      "  if ($p) { $items += [pscustomobject]@{ pid = $p.Id; name = $p.ProcessName; path = $p.Path } }",
      "}",
      "if ($items.Count -eq 0) { '[]' } else { $items | ConvertTo-Json -Compress }",
    ].join("; ");
    const { ok, stdout } = await runCommand("powershell", ["-NoProfile", "-Command", script]);
    if (!ok || !stdout.trim()) {
      return [];
    }
    try {
      const parsed = JSON.parse(stdout.trim());
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.filter((item) => item && typeof item.pid === "number" && item.pid > 4);
    } catch (_err) {
      return [];
    }
  }

  // macOS / Linux：lsof 取监听 PID，再用 ps 校验进程名。
  const { ok, stdout } = await runCommand("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  if (!ok || !stdout.trim()) {
    return [];
  }
  const pids = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line))
    .map(Number)
    .filter((pid) => pid > 4);
  const listeners = [];
  for (const pid of pids) {
    const nameResult = await runCommand("ps", ["-p", String(pid), "-o", "comm="]);
    const name = nameResult.stdout.trim();
    listeners.push({ pid, name, path: name });
  }
  return listeners;
}

async function killProcess(pid) {
  if (process.platform === "win32") {
    const { ok } = await runCommand("taskkill", ["/F", "/T", "/PID", String(pid)]);
    return ok;
  }
  const { ok } = await runCommand("kill", ["-TERM", String(pid)]);
  return ok;
}

async function waitForPortFree(canConnectToPort, host, port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const busy = await canConnectToPort(host, port);
    if (!busy) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

/**
 * 尝试终止监听指定端口的残留 rust_api 进程。
 * 只动进程名匹配 rust_api 的监听者，其他进程一律不碰。
 * @returns {Promise<{cleaned: boolean, reason: string, listeners: Array}>}
 */
async function stopStaleBackendOnPort(port, { canConnectToPort, host = "127.0.0.1", logger = console } = {}) {
  const listeners = await listPortListeners(port);
  if (listeners.length === 0) {
    // 端口显示被占用但找不到监听进程（可能在 TIME_WAIT 等瞬态），等待其自动释放。
    const freed = await waitForPortFree(canConnectToPort, host, port, 5000);
    return { cleaned: freed, reason: freed ? "port freed without kill" : "no listener found", listeners: [] };
  }

  const staleBackends = listeners.filter((item) => STALE_BACKEND_NAME_PATTERN.test(item.name || ""));
  const outsiders = listeners.filter((item) => !STALE_BACKEND_NAME_PATTERN.test(item.name || ""));
  if (outsiders.length > 0) {
    logger.warn?.(
      `[desktop] port ${port} is held by non-rust_api process(es): ${outsiders
        .map((item) => `${item.name}(pid=${item.pid})`)
        .join(", ")}; refusing to kill`,
    );
    return { cleaned: false, reason: "port held by unrelated process", listeners };
  }

  for (const item of staleBackends) {
    logger.log?.(`[desktop] stopping stale backend ${item.name}(pid=${item.pid}) path=${item.path || "<unknown>"}`);
    await killProcess(item.pid);
  }

  const freed = await waitForPortFree(canConnectToPort, host, port, 10000);
  if (!freed) {
    return { cleaned: false, reason: "port still busy after kill", listeners };
  }
  return { cleaned: true, reason: "stale backend stopped", listeners };
}

module.exports = {
  listPortListeners,
  stopStaleBackendOnPort,
  waitForPortFree,
};
