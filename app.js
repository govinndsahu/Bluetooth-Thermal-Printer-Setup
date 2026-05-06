import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const getEscPosPayload = (order) =>
  Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x0a]),
    Buffer.from(`NEW ORDER\n${order.id}\n`),
  ]);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const bleScriptPath = path.join(scriptDir, "ble_print.py");

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

const printViaComPort = async (order, options = {}) => {
  const portPath = options.portPath || process.env.PRINTER_COM_PORT || "COM5";
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

      const payload = getEscPosPayload(order);

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

const printViaBleBridge = (order, options = {}) => {
  const payload = getEscPosPayload(order).toString("base64");
  const args = [
    bleScriptPath,
    "--data-b64",
    payload,
    "--name",
    options.bleName || process.env.PRINTER_BLE_NAME || "PSF588",
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

// Print to a paired Bluetooth printer exposed as a Windows COM (RFCOMM) port.
// Preferable on Windows: pair the PSF588 printer in OS Bluetooth settings
// and note the outgoing COM port (e.g. COM5). Then call `printToPSF588(order, { portPath: 'COM5' })`.
export const printToPSF588 = (order, options = {}) => {
  const transport = options.transport || process.env.PRINTER_TRANSPORT || "ble";

  if (transport === "ble") {
    return printViaBleBridge(order, options);
  }

  return printViaComPort(order, options);
};
