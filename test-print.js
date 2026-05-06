#!/usr/bin/env node
import { printToPSF588 } from "./app.js";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const scanScriptPath = path.join(scriptDir, "ble_scan.py");

const runScan = (args) => {
    const pythonCmd = process.env.PRINTER_PYTHON_CMD || "py";
    const cmdArgs = pythonCmd === "py" ? ["-3.11"] : [];
    const child = spawn(pythonCmd, [...cmdArgs, scanScriptPath, ...args], {
        stdio: "inherit",
    });

    return new Promise((resolve, reject) => {
        child.on("error", (err) => reject(err));
        child.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Scan failed with code ${code}`));
        });
    });
};

const transport = process.argv[2] || process.env.PRINTER_TRANSPORT || "ble";
const orderId = process.argv[3] || `TEST-${Date.now()}`;

if (transport === "scan") {
    const nameFilter = process.argv[3] || "";
    runScan(nameFilter ? ["--name-filter", nameFilter] : [])
        .catch((err) => {
            console.error("Scan error:", err.message || err);
            process.exit(1);
        });
    process.exit(0);
}

const options = { transport };

if (transport === "com") {
    options.portPath = process.argv[4] || process.env.PRINTER_COM_PORT || "COM5";
    options.baudRate = parseInt(process.argv[5], 10) || 9600;
}

if (transport === "ble") {
    options.bleName = process.argv[4] || process.env.PRINTER_BLE_NAME || "PSF588";
    options.bleAddress = process.argv[5] || process.env.PRINTER_BLE_ADDRESS;
    options.charUUID = process.argv[6] || process.env.PRINTER_BLE_CHAR_UUID;
}

printToPSF588({ id: orderId }, options)
    .then((result) => {
        if (result) console.log(result);
        console.log(`Print sent using ${transport.toUpperCase()} transport`);
    })
    .catch((err) => {
        console.error("Print failed:", err.message || err);
        process.exit(1);
    });
