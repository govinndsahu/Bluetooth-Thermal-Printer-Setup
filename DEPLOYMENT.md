# NPM Package Deployment Guide

This guide covers the 6 critical fixes for safely publishing `node-thermal-printer-js` to npm registry.

## 1. ✅ Python Runtime Detection

**Problem**: `spawn("py", ...)` fails if Python is not installed or not in PATH.

**Fix Implemented**: `findPythonCmd()` function in `app.js`
- Detects Python 3.9+ on Windows, macOS, Linux
- Platform-aware: tries `py` first on Windows, `python3` first on Unix
- Caches result to avoid repeated detection
- Throws clear error if not found with install instructions

**Code Location**: [app.js](app.js#L24-L43)

**Usage**:
```javascript
const pythonCmd = findPythonCmd();
if (!pythonCmd) {
  throw new Error("Python 3.9+ not found. Install from...");
}
```

---

## 2. ✅ Automatic Bleak Installation

**Problem**: BLE mode fails with `ModuleNotFoundError: No module named 'bleak'` on fresh install.

**Fix Implemented**: Postinstall script `scripts/install-deps.js`
- Runs automatically after `npm install`
- Detects Python and verifies version
- Auto-installs bleak library via pip
- Provides platform-specific setup instructions
- Gracefully handles failures with helpful error messages

**Files**:
- `scripts/install-deps.js` - Main postinstall hook
- `package.json` - Added `"postinstall"` script entry

**Postinstall Output**:
```
🔧 node-thermal-printer postinstall setup

1️⃣  Checking Python installation...
   ✓ Found python3 (Python 3.11.7)

2️⃣  Checking bleak dependency...
   ✓ bleak already installed

3️⃣  Platform-specific requirements:
   📋 Linux detected - BLE requires group permissions:
      sudo usermod -a -G dialout,plugdev $USER
      (Log out and back in for changes to take effect)

✅ Setup complete! You can now use node-thermal-printer-js
```

---

## 3. ✅ Stale Process Cleanup

**Problem**: Previous crashed `ble_server.py` processes remain bound to port 5555, blocking new installs with `EADDRINUSE`.

**Fix Implemented**: `killStaleProcesses(port)` function in `app.js`
- Runs before server startup to clean existing listeners
- Platform-aware: uses `netstat` on Windows, `lsof` on Unix
- Gracefully handles errors (not blocking if cleanup fails)
- Logs detailed output for debugging

**Code Location**: [app.js](app.js#L46-L90)

**Calls**:
- Automatic during `startBleServer()` before port binding
- Manual via: `await killStaleProcesses(5555)`

**Example Output**:
```
[BLE] ⚠ Found stale process on port 5555, cleaning up...
[BLE] ✓ Killed PID 12345
[BLE] ✓ Server ready and listening on 127.0.0.1:49331
```

---

## 4. ✅ Dynamic Port Allocation

**Problem**: Hard-coded port 5555 conflicts on systems with occupied ports or multiple instances.

**Fix Implemented**: Already in place from previous debugging
- Uses `findBindablePort()` to find free port
- Falls back to ephemeral port (0) if preferred unavailable
- Stores runtime port in `bleServerPort` global
- Logs warning if port changed

**Related**: Works with stale cleanup (Fix #3) to minimize port conflicts

---

## 5. ✅ Package.json Updates

**Problem**: `ble_server.py` not included in npm package, causing `ENOENT` on users' machines.

**Fix Implemented**: Updated `package.json` files array

**Before**:
```json
"files": [
  "app.js",
  "ble_print.py",
  "ble_scan.py",
  "README.md"
]
```

**After**:
```json
"files": [
  "app.js",
  "ble_print.py",
  "ble_scan.py",
  "ble_server.py",           // ← Added (new persistent server)
  "scripts/install-deps.js",  // ← Added (postinstall hook)
  "README.md"
],
"scripts": {
  "postinstall": "node scripts/install-deps.js",  // ← Added
  ...
},
"engines": {
  "node": ">=16.0.0"  // ← Added (Node.js version requirement)
}
```

---

## 6. ✅ Enhanced Documentation

**Problem**: Users don't know about Python requirement, bleak library, or platform-specific setup.

**Fix Implemented**: Comprehensive README and `.env.example`

### README.md Updates
- **Installation Requirements** section (Windows/macOS/Linux)
- **Postinstall Verification** section
- **Platform-Specific Setup** section with Linux group permissions
- **Quick Start** walkthrough with code examples
- **API Reference** (printData, startPrinterServer, stopPrinterServer)
- **Troubleshooting** section covering:
  - "Python not found" solution
  - "bleak module not found" solution
  - "Address already in use" solution (port conflict)
  - "Device not found" solutions
  - "Permission denied" (Linux) solutions
  - Print timeout solutions
- **Performance** comparison table
- **Architecture** section explaining data flow

### .env.example Updates
- Clear transport mode descriptions with performance notes
- Python auto-detection documentation
- Bleak server configuration comments
- Performance tips

---

## Pre-Release Checklist

Before publishing v2.0.0+ to npm:

- [ ] Run `npm pack --dry-run` to verify file inclusion
  ```bash
  npm run pack:dry
  ```
  Verify output includes:
  - `app.js` ✓
  - `ble_server.py` ✓
  - `ble_print.py` ✓
  - `scripts/install-deps.js` ✓
  - `README.md` ✓

- [ ] Test on clean machine (fresh Node install):
  ```bash
  npm install node-thermal-printer-js
  # Verify postinstall runs and displays correct messages
  ```

- [ ] Test Python detection on different setups:
  - Python 3.9 (minimum)
  - Python 3.10+
  - No Python (should show install instructions)
  - Non-default Python path (set `PRINTER_PYTHON_CMD`)

- [ ] Test postinstall on each platform:
  - Windows (py.exe preferred)
  - macOS (python3 preferred)
  - Linux (python3 preferred)

- [ ] Verify port conflict handling:
  ```bash
  # Start one instance, verify it binds to 5555
  node test.js
  
  # Start another instance, verify it auto-detects and uses different port
  node test.js  # Should use 5556 or next available
  ```

- [ ] Run full test suite:
  ```bash
  npm test
  ```

- [ ] Update CHANGELOG.md with v2.0.0 summary:
  ```markdown
  ## [2.0.0] - 2026-05-07
  
  ### Added
  - Persistent BLE server architecture (5-10x faster printing)
  - Python runtime auto-detection with error guidance
  - Automatic bleak library installation via postinstall
  - Stale process cleanup to prevent "Address already in use" errors
  - Dynamic port allocation to avoid conflicts
  - Comprehensive troubleshooting guide in README
  - Platform-specific setup instructions (Windows/macOS/Linux)
  
  ### Changed
  - Default transport changed to "ble-server" (was "ble")
  - Node.js minimum version: 16.0.0
  - README completely rewritten with installation guide
  
  ### Fixed
  - Port 5555 conflicts on reinstall
  - Python detection failures on non-standard installs
  - Missing ble_server.py in distributed package
  ```

---

## Runtime Behavior

### On First `npm install`
1. Dependencies install (dotenv, serialport)
2. Postinstall hook runs `scripts/install-deps.js`
3. Python is detected (or install instructions shown)
4. Bleak is verified/installed
5. Platform warnings displayed
6. User ready to import and use

### On First `printData()` Call (ble-server mode)
1. `startBleServer()` called automatically
2. Checks for Python 3.9+ (from Fix #1)
3. Kills stale processes on preferred port (Fix #3)
4. Finds bindable port (Fix #4)
5. Spawns `ble_server.py` with detected Python (Fix #1)
6. Waits for "Server ready" message
7. Socket connection to server for print requests

### On Subsequent `printData()` Calls
1. Reuses existing server connection
2. ~100-200ms per print (vs. 1-2s per spawn)

### On Process Exit
1. `stopPrinterServer()` called (usually automatic)
2. Server process killed cleanly
3. Resources released

---

## Migration Guide (Users of v1.x → v2.0.0)

### What Changed
- **New default transport**: `ble-server` (persistent server, 5-10x faster)
- **Python now required**: Detected automatically
- **New environment variables**: `PRINTER_BLE_SERVER_*`
- **New API**: `startPrinterServer()`, `stopPrinterServer()`

### Update Steps
```js
// Old code (still works, but slower)
import { printData } from "node-thermal-printer-js";
await printData("Hello", { transport: "ble" });  // ~1-2s

// New code (recommended)
import { printData, startPrinterServer, stopPrinterServer } from "node-thermal-printer-js";

// Once at startup
await startPrinterServer({ bleName: "PSF588" });

// Multiple prints now use persistent connection
await printData("Hello");      // ~100-200ms
await printData("World");      // ~100-200ms
await printData("Fast!");      // ~100-200ms

// Once at shutdown
await stopPrinterServer();
```

### Backwards Compatibility
- Old code continues to work without changes
- Set `PRINTER_TRANSPORT=ble` to use legacy mode if needed
- No breaking changes to API (only new methods added)

---

## Troubleshooting for Package Maintainers

### Issue: Postinstall script fails silently
**Debug**:
```bash
npm install --verbose
# Or force rerun:
npm run postinstall
```

### Issue: Python detection keeps trying `py.exe`
**Debug**:
```js
// In Node console
import { findPythonCmd } from "./app.js";
console.log(findPythonCmd());
```

**Fix**:
```bash
export PRINTER_PYTHON_CMD=python3
npm install
```

### Issue: Port cleanup doesn't work on Linux
**Debug**:
```bash
# Check if lsof is available
which lsof

# Manual cleanup
lsof -ti:5555 | xargs kill -9
```

### Issue: Users report "Module not found: bleak"
**Cause**: Postinstall didn't run or user skipped it
**Solution**: Document explicit installation:
```bash
pip install bleak
# Then retry:
npm install node-thermal-printer-js
```

---

## Version Notes

- **v2.0.0+**: Uses all 6 fixes, persistent server, auto-detection
- **v1.x**: Legacy per-print process spawning (still available in `ble` transport mode)

---

## Questions?

See [README.md](README.md) for API documentation and troubleshooting steps.
