import "dotenv/config";
import { spawn, spawnSync, execSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const getEscPosPayload = (data) =>
  Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x0a]),
    Buffer.from(`${data}\n\n\n\n\n`, "utf-8"),
  ]);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const bleScriptPath = path.join(scriptDir, "ble_print.py");
const bleServerPath = path.join(scriptDir, "ble_server.py");

// Global server process reference
let bleServerProcess = null;
let bleServerHost = null;
let bleServerPort = null;

/**
 * Find an available Python 3.9+ executable on the system.
 * Tries local venv first, then versioned launcher probes on Windows, then system Python.
 * @returns {{ cmd: string, args: string[] }|null} Command descriptor if found, null otherwise
 */
const findPythonCmd = () => {
  const candidates = getPythonLaunchCandidates();

  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate.cmd, [...candidate.args, "--version"], {
        encoding: "utf8",
        timeout: 2000,
        shell: false,
      });

      const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
      const match = output.match(/Python (\d+)\.(\d+)/);
      if (match) {
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        // Check if Python 3.9+
        if (major > 3 || (major === 3 && minor >= 9)) {
          console.log(`[BLE] ✓ Detected Python: ${candidate.cmd} ${candidate.args.join(" ")} (${output})`);
          return candidate;
        }
      }
    } catch {
      // Continue to next candidate
    }
  }
  return null;
};

const getPythonLaunchCandidates = () => {
  const localVenvCandidates = process.platform === "win32"
    ? [
      { cmd: path.join(scriptDir, ".venv", "Scripts", "python.exe"), args: [] },
      { cmd: path.join(scriptDir, ".venv", "Scripts", "python"), args: [] },
    ]
    : [
      { cmd: path.join(scriptDir, ".venv", "bin", "python"), args: [] },
      { cmd: path.join(scriptDir, ".venv", "bin", "python3"), args: [] },
    ];

  const systemCandidates = process.platform === "win32"
    ? [
      { cmd: "py", args: ["-3.11"] },
      { cmd: "py", args: ["-3"] },
      { cmd: "py", args: [] },
      { cmd: "python3", args: [] },
      { cmd: "python", args: [] },
    ]
    : [
      { cmd: "python3", args: [] },
      { cmd: "python", args: [] },
      { cmd: "py", args: [] },
    ];

  return [
    ...localVenvCandidates.filter((candidate) => existsSync(candidate.cmd)),
    ...systemCandidates,
  ];
};

/**
 * Kill any stale BLE server processes still bound to a port.
 * Prevents "Address already in use" errors on reinstall or crash recovery.
 * @param {number} port Port number to clean up
 * @param {number} timeout Timeout in ms for the operation
 */
const killStaleProcesses = async (port, timeout = 3000) => {
  const platformCmd = process.platform === "win32"
    ? `netstat -ano | findstr :${port}`
    : `lsof -ti:${port}`;

  try {
    const result = execSync(platformCmd, {
      encoding: "utf8",
      stdio: "pipe",
      timeout,
      shell: true,
    }).trim();

    if (!result) {
      console.log(`[BLE] Port ${port} is clean`);
      return;
    }

    console.warn(`[BLE] ⚠ Found stale process on port ${port}, cleaning up...`);

    if (process.platform === "win32") {
      // Extract PID from netstat output: "TCP    127.0.0.1:5555    0.0.0.0:0    LISTENING    12345"
      const lines = result.split("\n");
      const pids = new Set();
      lines.forEach((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length > 0) {
          const pid = parts[parts.length - 1];
          if (/^\d+$/.test(pid)) pids.add(pid);
        }
      });

      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { timeout: 2000, stdio: "pipe" });
          console.log(`[BLE] ✓ Killed PID ${pid}`);
        } catch (e) {
          console.warn(`[BLE] Could not kill PID ${pid}:`, e.message);
        }
      }
    } else {
      // On Unix-like systems, lsof returns just the PID
      const pids = result.split("\n").filter((p) => p);
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid}`, { timeout: 2000, stdio: "pipe" });
          console.log(`[BLE] ✓ Killed PID ${pid}`);
        } catch (e) {
          console.warn(`[BLE] Could not kill PID ${pid}:`, e.message);
        }
      }
    }
  } catch (err) {
    // If netstat/lsof fails, not critical - just log and continue
    console.debug(`[BLE] Could not check for stale processes: ${err.message}`);
  }
};

const findBindablePort = (host, preferredPort, strictPreferred = false) =>
  new Promise((resolve, reject) => {
    const probe = createServer();

    const finishWithEphemeral = () => {
      const fallback = createServer();
      fallback.once("error", reject);
      fallback.listen(0, host, () => {
        const address = fallback.address();
        const port =
          typeof address === "object" && address ? address.port : null;
        fallback.close(() => {
          if (!port) {
            reject(
              new Error("Unable to resolve an ephemeral port for BLE server"),
            );
            return;
          }
          resolve(port);
        });
      });
    };

    probe.once("error", (err) => {
      if (strictPreferred || !preferredPort) {
        reject(err);
        return;
      }
      finishWithEphemeral();
    });

    probe.listen(preferredPort || 0, host, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : null;
      probe.close(() => {
        if (!port) {
          reject(new Error("Unable to resolve a bindable port for BLE server"));
          return;
        }
        resolve(port);
      });
    });
  });

const runPythonProcess = ({ cmd, cmdArgs, scriptArgs }) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, [...cmdArgs, ...scriptArgs], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`Launch error for ${cmd}: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          ok: true,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          code,
          cmd,
          cmdArgs,
        });
        return;
      }

      resolve({
        ok: false,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code,
        cmd,
        cmdArgs,
      });
    });
  });

const startBleServer = async (options = {}) => {
  if (bleServerProcess) {
    console.log("[BLE] Server already running");
    return;
  }

  const detectedPythonCmd = findPythonCmd();
  if (!detectedPythonCmd) {
    console.warn(
      "[BLE] Python auto-detection did not find a preferred launcher. Trying fallback candidates, including the project virtualenv if present.",
    );
  }

  const host =
    options.host || process.env.PRINTER_BLE_SERVER_HOST || "127.0.0.1";
  const configuredPort = options.port || process.env.PRINTER_BLE_SERVER_PORT;
  const preferredPort = configuredPort ? Number(configuredPort) : 5555;
  const strictPreferred = Boolean(configuredPort);

  // Clean up any stale processes before trying to bind
  if (!strictPreferred) {
    await killStaleProcesses(preferredPort, 3000).catch((err) => {
      console.debug("[BLE] Stale process cleanup warning:", err.message);
    });
  }

  const selectedPort = await findBindablePort(
    host,
    preferredPort,
    strictPreferred,
  );

  if (selectedPort !== preferredPort && !strictPreferred) {
    console.warn(
      `[BLE] Port ${preferredPort} busy. Switching BLE server to free port ${selectedPort}.`,
    );
  }

  bleServerHost = host;
  bleServerPort = selectedPort;

  const args = [
    bleServerPath,
    "--name",
    options.bleName || process.env.PRINTER_BLE_NAME || "PSF588",
    "--port",
    String(selectedPort),
    "--host",
    host,
  ];

  if (options.bleAddress || process.env.PRINTER_BLE_ADDRESS) {
    args.push(
      "--address",
      options.bleAddress || process.env.PRINTER_BLE_ADDRESS,
    );
  }

  if (options.charUUID || process.env.PRINTER_BLE_CHAR_UUID) {
    args.push(
      "--char-uuid",
      options.charUUID || process.env.PRINTER_BLE_CHAR_UUID,
    );
  }

  if (options.chunkSize || process.env.PRINTER_BLE_CHUNK_SIZE) {
    args.push(
      "--chunk-size",
      String(options.chunkSize || process.env.PRINTER_BLE_CHUNK_SIZE),
    );
  }

  if (
    options.delayMs !== undefined ||
    process.env.PRINTER_BLE_DELAY_MS !== undefined
  ) {
    args.push(
      "--delay-ms",
      String(options.delayMs ?? process.env.PRINTER_BLE_DELAY_MS ?? 0),
    );
  }

  if (options.connectTimeout || process.env.PRINTER_BLE_CONNECT_TIMEOUT) {
    args.push(
      "--connect-timeout",
      String(options.connectTimeout || process.env.PRINTER_BLE_CONNECT_TIMEOUT),
    );
  }

  if (options.scanTimeout || process.env.PRINTER_BLE_SCAN_TIMEOUT) {
    args.push(
      "--scan-timeout",
      String(options.scanTimeout || process.env.PRINTER_BLE_SCAN_TIMEOUT),
    );
  }

  if (options.pair || process.env.PRINTER_BLE_PAIR === "1") {
    args.push("--pair");
  }

  const envCmd = options.pythonCmd || process.env.PRINTER_PYTHON_CMD;
  const candidates = envCmd
    ? [{ cmd: envCmd, cmdArgs: ["-u"] }] // -u for unbuffered output
    : [
      ...(detectedPythonCmd ? [{ cmd: detectedPythonCmd.cmd, cmdArgs: [...detectedPythonCmd.args, "-u"] }] : []),
      ...getPythonLaunchCandidates().map((cmd) => ({ cmd, cmdArgs: ["-u"] })),
    ];

  return new Promise((resolve, reject) => {
    let lastError;
    let serverReady = false;

    const tryStart = (index) => {
      if (index >= candidates.length) {
        return reject(
          new Error(
            `Failed to start BLE server. Errors: ${lastError?.message}`,
          ),
        );
      }

      const candidate = candidates[index];
      console.log(
        `[BLE] Attempting to start server with: ${candidate.cmd} ${candidate.cmdArgs.join(" ")} ...`,
      );

      const child = spawn(candidate.cmd, [...candidate.cmdArgs, ...args], {
        stdio: "pipe",
        detached: false,
        shell: false,
      });

      console.log(`[BLE] Process spawned with PID ${child.pid}`);

      child.on("error", (err) => {
        lastError = new Error(
          `Launch error for ${candidate.cmd}: ${err.message}`,
        );
        console.error(`[BLE] ${lastError.message}`);
        tryStart(index + 1);
      });

      let stdoutBuffer = "";
      let stderrBuffer = "";

      child.stdout.on("data", (data) => {
        const chunk = data.toString();
        stdoutBuffer += chunk;
        process.stdout.write(`[BLE-OUT] ${chunk}`);

        if (chunk.includes("Server ready") && chunk.includes("Listening on")) {
          if (!serverReady) {
            serverReady = true;
            bleServerProcess = child;
            console.log(
              `[BLE] ✓ Server ready and listening on ${bleServerHost}:${bleServerPort}!`,
            );
            resolve();
          }
        }
      });

      child.stderr.on("data", (data) => {
        const chunk = data.toString();
        stderrBuffer += chunk;
        process.stderr.write(`[BLE-ERR] ${chunk}`);

        if (chunk.includes("Server ready") && chunk.includes("Listening on")) {
          if (!serverReady) {
            serverReady = true;
            bleServerProcess = child;
            console.log(
              `[BLE] ✓ Server ready and listening on ${bleServerHost}:${bleServerPort}!`,
            );
            resolve();
          }
        }
      });

      child.on("close", (code) => {
        if (!serverReady) {
          lastError = new Error(
            `Server exited with code ${code}. Stdout: ${stdoutBuffer}. Stderr: ${stderrBuffer}`,
          );
          console.error(`[BLE] ${lastError.message}`);
          tryStart(index + 1);
        }
      });

      // Hard timeout: if server doesn't report ready in 20 seconds, fail
      const timeoutId = setTimeout(() => {
        if (!serverReady) {
          console.error("[BLE] Server startup timeout (20s) - killing process");
          lastError = new Error(
            "Server startup timeout (no 'Server ready' message received)",
          );
          try {
            child.kill("SIGTERM");
          } catch (e) {
            console.error("[BLE] Error killing process:", e.message);
          }
          setTimeout(() => tryStart(index + 1), 500);
        }
      }, 20000);

      // Cleanup timeout if server becomes ready
      child.once("close", () => clearTimeout(timeoutId));
    };

    tryStart(0);
  });
};

const stopBleServer = async () => {
  if (bleServerProcess) {
    bleServerProcess.kill();
    bleServerProcess = null;
    bleServerHost = null;
    bleServerPort = null;
    console.log("[BLE] Server stopped");
  }
};

const sendToBleServer = (request, options = {}) => {
  const host =
    options.host ||
    bleServerHost ||
    process.env.PRINTER_BLE_SERVER_HOST ||
    "127.0.0.1";
  const port =
    options.port ||
    bleServerPort ||
    process.env.PRINTER_BLE_SERVER_PORT ||
    5555;
  const timeoutMs = Number(
    options.requestTimeoutMs ||
    process.env.PRINTER_BLE_REQUEST_TIMEOUT_MS ||
    40000,
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    let responseBuffer = "";

    const settleResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const socket = createConnection({ host, port }, () => {
      console.log(`[BLE] Socket connected to ${host}:${port}`);
      const message = JSON.stringify(request) + "\n";
      socket.end(message);
      console.log(`[BLE] Sent request: ${JSON.stringify(request)}`);
    });

    socket.on("data", (data) => {
      responseBuffer += data.toString("utf-8");

      const newlineIndex = responseBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const responseLine = responseBuffer.slice(0, newlineIndex).trim();
      if (!responseLine) {
        return;
      }

      try {
        const response = JSON.parse(responseLine);
        console.log(`[BLE] Received response: ${JSON.stringify(response)}`);
        socket.end();
        if (response.ok) {
          settleResolve(response);
        } else {
          settleReject(
            new Error(response.error || "Unknown error from server"),
          );
        }
      } catch (err) {
        socket.end();
        settleReject(
          new Error(`Failed to parse server response: ${err.message}`),
        );
      }
    });

    socket.on("error", (err) => {
      console.error(`[BLE] Socket error: ${err.message}`);
      settleReject(new Error(`Socket connection failed: ${err.message}`));
    });

    socket.on("close", () => {
      console.log("[BLE] Socket closed");
    });

    socket.setTimeout(timeoutMs, () => {
      console.error("[BLE] Socket timeout waiting for server response");
      socket.destroy();
      settleReject(
        new Error(`BLE server request timeout after ${timeoutMs}ms`),
      );
    });
  });
};

const printViaComPort = async (data, options = {}) => {
  const portPath = options.portPath || process.env.PRINTER_COM_PORT;
  const baudRate = options.baudRate || 9600;

  // Dynamically import `serialport` only when COM transport is requested.
  let SerialPortModule;
  try {
    SerialPortModule = await import("serialport");
  } catch (e) {
    return Promise.reject(
      new Error(`serialport module not available: ${e.message}`),
    );
  }

  const SerialPortCtor =
    SerialPortModule.default || SerialPortModule.SerialPort || SerialPortModule;

  const port = new SerialPortCtor({
    path: portPath,
    baudRate,
    autoOpen: false,
  });

  return new Promise((resolve, reject) => {
    port.open((err) => {
      if (err)
        return reject(new Error(`Failed to open ${portPath}: ${err.message}`));

      const payload = getEscPosPayload(data);

      port.write(payload, (writeErr) => {
        if (writeErr) {
          port.close(() => reject(writeErr));
          return;
        }

        port.drain((drainErr) => {
          port.close(() => {
            if (drainErr) return reject(drainErr);
            resolve();
          });
        });
      });
    });
  });
};

const printViaBleBridge = (data, options = {}) => {
  const payload = getEscPosPayload(data).toString("base64");
  const args = [
    bleScriptPath,
    "--data-b64",
    payload,
    "--name",
    options.bleName || process.env.PRINTER_BLE_NAME,
  ];

  if (options.bleAddress || process.env.PRINTER_BLE_ADDRESS) {
    args.push(
      "--address",
      options.bleAddress || process.env.PRINTER_BLE_ADDRESS,
    );
  }

  if (options.charUUID || process.env.PRINTER_BLE_CHAR_UUID) {
    args.push(
      "--char-uuid",
      options.charUUID || process.env.PRINTER_BLE_CHAR_UUID,
    );
  }

  if (options.connectTimeout || process.env.PRINTER_BLE_CONNECT_TIMEOUT) {
    args.push(
      "--connect-timeout",
      String(options.connectTimeout || process.env.PRINTER_BLE_CONNECT_TIMEOUT),
    );
  }

  if (options.scanTimeout || process.env.PRINTER_BLE_SCAN_TIMEOUT) {
    args.push(
      "--scan-timeout",
      String(options.scanTimeout || process.env.PRINTER_BLE_SCAN_TIMEOUT),
    );
  }

  if (options.pair || process.env.PRINTER_BLE_PAIR === "1") {
    args.push("--pair");
  }

  const envCmd = options.pythonCmd || process.env.PRINTER_PYTHON_CMD;
  const candidates = envCmd
    ? [{ cmd: envCmd, cmdArgs: [] }]
    : [
      { cmd: "py", cmdArgs: ["-3.11"] },
      { cmd: "py", cmdArgs: ["-3"] },
      { cmd: "python", cmdArgs: [] },
    ];

  return new Promise(async (resolve, reject) => {
    const failures = [];

    for (const candidate of candidates) {
      // Try multiple launchers because Windows py default can point to a missing runtime.
      const result = await runPythonProcess({
        cmd: candidate.cmd,
        cmdArgs: candidate.cmdArgs,
        scriptArgs: args,
      });

      if (result.ok) {
        resolve(result.stdout);
        return;
      }

      failures.push(
        `${result.cmd} ${result.cmdArgs.join(" ")} -> code ${result.code}: ${result.stderr || result.stdout || "no output"}`,
      );
    }

    reject(
      new Error(
        `BLE bridge failed for all Python launchers. ${failures.join(" | ")}`,
      ),
    );
  });
};

const printViaBleServer = async (data, options = {}) => {
  const payload = getEscPosPayload(data).toString("base64");

  // Start server if not already running
  if (!bleServerProcess && options.autoStart !== false) {
    try {
      await startBleServer(options);
      // Give the server a moment to fully stabilize after reporting ready
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      console.warn(
        "[BLE] Failed to auto-start server, falling back to legacy method:",
        err.message,
      );
      return printViaBleBridge(data, options);
    }
  }

  // Send print request to server
  const request = {
    command: "print",
    data_b64: payload,
  };

  try {
    return await sendToBleServer(request, {
      host: options.host || process.env.PRINTER_BLE_SERVER_HOST,
      port: options.port || process.env.PRINTER_BLE_SERVER_PORT,
      requestTimeoutMs:
        options.requestTimeoutMs || process.env.PRINTER_BLE_REQUEST_TIMEOUT_MS,
    });
  } catch (err) {
    console.warn(
      "[BLE] Server print failed, falling back to legacy method:",
      err.message,
    );
    return printViaBleBridge(data, options);
  }
};

// Print to a paired Bluetooth printer exposed as a Windows COM (RFCOMM) port.
// Preferable on Windows: pair the PSF588 printer in OS Bluetooth settings
// and note the outgoing COM port (e.g. COM5). Then call `printToPSF588(data, { portPath: 'COM5' })`.
export const printData = (data, options = {}) => {
  const transport =
    options.transport || process.env.PRINTER_TRANSPORT || "ble-server";

  if (transport === "ble-server") {
    // New: Use persistent BLE server (faster, recommended)
    return printViaBleServer(data, options);
  }

  if (transport === "ble") {
    // Legacy: Spawn process for each print (slower)
    return printViaBleBridge(data, options);
  }

  // Default: COM port
  return printViaComPort(data, options);
};

// Lifecycle management exports
export const startPrinterServer = (options = {}) => startBleServer(options);
export const stopPrinterServer = () => stopBleServer();
export const getPrinterServerStatus = () => {
  return {
    running: !!bleServerProcess,
    processInfo: bleServerProcess,
    host: bleServerHost,
    port: bleServerPort,
  };
};
