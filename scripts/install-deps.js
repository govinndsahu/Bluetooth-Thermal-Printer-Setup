#!/usr/bin/env node
/**
 * Postinstall script to verify and auto-install Python dependencies
 * Runs: npm install --> postinstall hook
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const findPythonCmd = () => {
    const localVenvCandidates = process.platform === "win32"
        ? [
            path.join(scriptDir, ".venv", "Scripts", "python.exe"),
            path.join(scriptDir, ".venv", "Scripts", "python"),
        ]
        : [
            path.join(scriptDir, ".venv", "bin", "python"),
            path.join(scriptDir, ".venv", "bin", "python3"),
        ];

    const candidates = [
        ...localVenvCandidates.filter((candidate) => existsSync(candidate)),
        ...(process.platform === "win32"
            ? ["py", "python3", "python"]
            : ["python3", "python", "py"]),
    ];

    for (const cmd of candidates) {
        try {
            const result = spawnSync(cmd, ["--version"], {
                encoding: "utf8",
                stdio: "pipe",
                timeout: 2000,
                shell: false,
            });
            const version = `${result.stdout || ""}${result.stderr || ""}`.trim();
            // Check if Python 3.9+
            const match = version.match(/Python (\d+\.\d+)/);
            if (match && parseFloat(match[1]) >= 3.9) {
                console.log(`✓ Found ${cmd} (${version})`);
                return cmd;
            }
        } catch {
            // Continue to next candidate
        }
    }

    return null;
};

const installBleak = (pythonCmd) => {
    console.log(`\n📦 Installing bleak Python package...`);
    try {
        const result = spawnSync(pythonCmd, ["-m", "pip", "install", "bleak"], {
            encoding: "utf8",
            stdio: "inherit",
            timeout: 120000,
            shell: false,
        });
        if (result.status !== 0) {
            throw new Error(`pip exited with code ${result.status ?? "unknown"}`);
        }
        console.log("✓ bleak installed successfully");
        return true;
    } catch (err) {
        console.warn("⚠ Could not auto-install bleak");
        return false;
    }
};

const main = async () => {
    console.log("\n🔧 node-thermal-printer postinstall setup\n");

    // Step 1: Find Python
    console.log("1️⃣  Checking Python installation...");
    const pythonCmd = findPythonCmd();

    if (!pythonCmd) {
        console.error("\n❌ ERROR: Python 3.9+ not found!");
        console.error("\nPlease install Python from https://www.python.org/downloads/");
        console.error("After installing Python, run: npm install again\n");
        process.exit(1);
    }

    console.log(`   Using: ${pythonCmd}\n`);

    // Step 2: Install bleak
    console.log("2️⃣  Checking bleak dependency...");
    try {
        const importCheck = spawnSync(pythonCmd, ["-c", "import bleak"], {
            stdio: "pipe",
            timeout: 2000,
            shell: false,
        });
        if (importCheck.status !== 0) {
            throw new Error("bleak import check failed");
        }
        console.log("✓ bleak already installed\n");
    } catch {
        const installed = installBleak(pythonCmd);
        if (!installed) {
            console.error("\n⚠ Manual installation required:");
            console.error(`   ${pythonCmd} -m pip install bleak\n`);
        }
    }

    // Step 3: Platform-specific notes
    console.log("3️⃣  Platform-specific requirements:");
    const platform = process.platform;
    if (platform === "linux") {
        console.log("   📋 Linux detected - BLE requires group permissions:");
        console.log("      sudo usermod -a -G dialout,plugdev $USER");
        console.log("      (Log out and back in for changes to take effect)\n");
    } else if (platform === "darwin") {
        console.log("   📋 macOS detected - Ensure Bluetooth is enabled\n");
    } else if (platform === "win32") {
        console.log("   📋 Windows detected - Ensure Bluetooth drivers are installed\n");
    }

    console.log("✅ Setup complete! You can now use node-thermal-printer-js\n");
};

main().catch((err) => {
    console.error("Error during setup:", err.message);
    process.exit(1);
});
