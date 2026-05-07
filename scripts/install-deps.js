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
  const localVenvCandidates =
    process.platform === "win32"
      ? [
          {
            cmd: path.join(scriptDir, ".venv", "Scripts", "python.exe"),
            args: [],
          },
          { cmd: path.join(scriptDir, ".venv", "Scripts", "python"), args: [] },
        ]
      : [
          { cmd: path.join(scriptDir, ".venv", "bin", "python"), args: [] },
          { cmd: path.join(scriptDir, ".venv", "bin", "python3"), args: [] },
        ];

  const systemCandidates =
    process.platform === "win32"
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

  const candidates = [
    ...localVenvCandidates.filter((candidate) => existsSync(candidate.cmd)),
    ...systemCandidates,
  ];

  for (const candidate of candidates) {
    try {
      const result = spawnSync(
        candidate.cmd,
        [...candidate.args, "--version"],
        {
          encoding: "utf8",
          stdio: "pipe",
          timeout: 2000,
          shell: false,
        },
      );

      // Skip if command failed or timed out
      if (result.status !== 0 || result.error) {
        continue;
      }

      const version = `${result.stdout || ""}${result.stderr || ""}`.trim();
      // Check if Python 3.9+
      const match = version.match(/Python (\d+)\.(\d+)/);
      if (match) {
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        if (major > 3 || (major === 3 && minor >= 9)) {
          console.log(
            `✓ Found ${candidate.cmd} ${candidate.args.join(" ")} (${version})`,
          );
          return candidate;
        }
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
    const result = spawnSync(
      pythonCmd.cmd,
      [...pythonCmd.args, "-m", "pip", "install", "bleak"],
      {
        encoding: "utf8",
        stdio: "inherit",
        timeout: 120000,
        shell: false,
      },
    );
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
    console.error(
      "\nPlease install Python from https://www.python.org/downloads/",
    );
    console.error("After installing Python, run: npm install again\n");
    process.exit(1);
  }

  console.log(`   Using: ${pythonCmd}\n`);

  // Step 2: Install bleak
  console.log("2️⃣  Checking bleak dependency...");
  try {
    const importCheck = spawnSync(
      pythonCmd.cmd,
      [...pythonCmd.args, "-c", "import bleak"],
      {
        stdio: "pipe",
        timeout: 2000,
        shell: false,
      },
    );
    if (importCheck.status !== 0) {
      throw new Error("bleak import check failed");
    }
    console.log("✓ bleak already installed\n");
  } catch {
    const installed = installBleak(pythonCmd);
    if (!installed) {
      console.error("\n⚠ Manual installation required:");
      console.error(
        `   ${pythonCmd.cmd} ${pythonCmd.args.join(" ")} -m pip install bleak\n`,
      );
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
    console.log(
      "   📋 Windows detected - Ensure Bluetooth drivers are installed\n",
    );
  }

  console.log("✅ Setup complete! You can now use node-thermal-printer-js\n");
};

main().catch((err) => {
  console.error("Error during setup:", err.message);
  process.exit(1);
});
