# node-thermal-printer-js

Public npm package for sending ESC/POS print jobs to a PSF588 printer over BLE or classic Bluetooth COM port.

## Installation

```bash
npm install node-thermal-printer-js
```

That's it! No validation, no postinstall hooks. Just a clean package.

---

## Runtime Requirements

To use this package, your environment needs:

- **Node.js**: 16.0.0 or higher
- **Python**: 3.9 or higher
- **Python package**: `bleak` (BLE client library)

### For End Users (.exe Applications)

If you're distributing this as an `.exe`, include the `setup-runtime.bat` script:

```bash
setup-runtime.bat
```

This script automatically:
1. ✅ Checks and installs Node.js (if missing)
2. ✅ Checks and installs Python 3.11 (if missing)
3. ✅ Installs the `bleak` library
4. ✅ Shows timing for each step

**Usage:**
- Unzip your application
- Double-click `setup-runtime.bat`
- Wait for completion
- Run your `.exe`

---

## Quick Start (Development)

### 1. Install Package

```bash
npm install node-thermal-printer-js
```

### 2. Ensure Python & Bleak are Available

```bash
python -m pip install bleak
# or
python3 -m pip install bleak
```

### 3. Use in Your Code

```js
import { printData, startPrinterServer, stopPrinterServer } from "node-thermal-printer-js";

// Option 1: Fast persistent server (recommended for multiple prints)
await startPrinterServer({ bleName: "PSF588" });
await printData("Hello World");
await printData("Second print (faster)");
await stopPrinterServer();

// Option 2: Simple one-off print
await printData("Hello World", { 
  transport: "ble", 
  bleName: "PSF588",
  scanTimeout: 10,
  connectTimeout: 15
});

// Option 3: Windows COM port
await printData("Hello World", { 
  transport: "com",
  portPath: "COM3"
});
```

---

## Configuration (.env)

Create a `.env` file to customize behavior:

```env
# Transport: "ble-server" (recommended), "ble", or "com"
PRINTER_TRANSPORT=ble-server

# BLE Configuration
PRINTER_BLE_NAME=PSF588
PRINTER_BLE_ADDRESS=C8:47:8C:1F:72:34
PRINTER_BLE_CHAR_UUID=49535343-8841-43f4-a8d4-ecbe34729bb3

# Server Configuration
PRINTER_BLE_SERVER_HOST=127.0.0.1
PRINTER_BLE_SERVER_PORT=5555
PRINTER_BLE_REQUEST_TIMEOUT_MS=40000

# COM Port (for Windows COM transport)
PRINTER_COM_PORT=COM3

# Python Command (if auto-detection fails)
PRINTER_PYTHON_CMD=python3
```

---

## API Reference

### `printData(data, options?)`

Print ESC/POS data to thermal printer.

**Parameters:**
- `data` (string): ESC/POS data to print
- `options` (object, optional):
  - `transport` (string): `"ble-server"`, `"ble"`, or `"com"` — default: `"ble-server"`
  - `bleName` (string): Printer BLE device name
  - `bleAddress` (string): BLE MAC address (e.g., `"C8:47:8C:1F:72:34"`)
  - `charUUID` (string): BLE characteristic UUID
  - `portPath` (string): COM port path for Windows (e.g., `"COM3"`)
  - `scanTimeout` (number): BLE scan timeout in seconds (default: 10)
  - `connectTimeout` (number): BLE connection timeout in seconds (default: 15)
  - `requestTimeoutMs` (number): Server request timeout in milliseconds (default: 40000)

**Returns:** `Promise<{ok: boolean, bytes_sent: number}>`

**Example:**
```js
try {
  const result = await printData("Test print", { 
    bleName: "PSF588",
    scanTimeout: 15
  });
  console.log(`✓ Sent ${result.bytes_sent} bytes`);
} catch (err) {
  console.error("Print failed:", err.message);
}
```

---

### `startPrinterServer(options?)`

Start persistent BLE server for faster multi-print performance.

**Parameters:** Same as `printData` options

**Returns:** `Promise<void>`

**Example:**
```js
await startPrinterServer({ 
  bleName: "PSF588",
  connectTimeout: 20 
});
console.log("Server ready for fast printing");
```

---

### `stopPrinterServer()`

Stop the running BLE server and clean up resources.

**Returns:** `Promise<void>`

---

### `getPrinterServerStatus()`

Get status of the running BLE server.

**Returns:**
```js
{
  running: boolean,
  host: string,
  port: number,
  processInfo: ChildProcess | null
}
```

---

## Transport Modes

| Mode | Speed | Best For |
|------|-------|----------|
| `ble-server` | 100-200ms | Multiple prints, APIs, production |
| `ble` | 1-2s | Single prints, testing, fallback |
| `com` | Variable | Windows paired COM port, fallback |

**Recommendation:** Use `ble-server` (default) for best performance.

---

## Troubleshooting

### Python or Bleak Not Found

**For Developers:**
```bash
# Install Python from: https://www.python.org/downloads/ (3.9+)
# Then install bleak:
pip install bleak
```

**For End Users (.exe):**
- Run `setup-runtime.bat` to auto-install everything

### "Device not found" or Connection Timeouts

1. Ensure printer is powered on and in BLE discoverable mode
2. Increase timeouts:
   ```js
   await printData(data, { scanTimeout: 20, connectTimeout: 25 });
   ```
3. Try specifying MAC address (faster than discovery):
   ```js
   await printData(data, { bleAddress: "C8:47:8C:1F:72:34" });
   ```

### "Address already in use" (Port 5555)

This happens if a previous BLE server crashed. Restart your terminal or kill the process:

**Windows:**
```bash
netstat -ano | findstr :5555
taskkill /PID <PID> /F
```

**Mac/Linux:**
```bash
lsof -ti:5555 | xargs kill -9
```

### Print Job Times Out

1. Increase timeout:
   ```js
   await printData(data, { requestTimeoutMs: 60000 });
   ```
2. Check printer is still connected
3. Try fallback transport:
   ```js
   await printData(data, { transport: "ble" });
   ```

---

## Architecture

### Components

1. **app.js** — Main Node.js module with BLE client logic
2. **ble_server.py** — Persistent Python BLE daemon (optional, for ble-server mode)
3. **ble_print.py** — Legacy BLE bridge (one process per print)
4. **ble_scan.py** — Device discovery utility

### Data Flow (ble-server mode - Recommended)

```
printData(data, options)
  ↓
startBleServer() [if not running]
  ↓
Node.js spawns ble_server.py (persistent)
  ↓
Send TCP request to server with ESC/POS data
  ↓
ble_server.py connects to PSF588 via BLE
  ↓
Writes data via BLE characteristic
  ↓
Response returned to Node.js
```

### Data Flow (ble mode - Fallback)

```
printData(data, options)
  ↓
Spawn ble_print.py process
  ↓
Connect to printer, send data, exit
  ↓
Response returned to Node.js
```

---

## Development

### Local Setup

```bash
git clone <repo>
cd Printer
npm install

# Install Python dependencies
pip install bleak

# Run tests
npm test

# Watch mode
npm run dev
```

---

## License

ISC

```

Verify the Python BLE dependency is available:

```bash
python -c "import bleak; print('bleak', bleak.__version__)"
# or on Windows: py -3.11 -c "import bleak; print('bleak', bleak.__version__)"
```

Notes:

- If you do not want to create a virtual environment you can install `bleak` system-wide with `pip install bleak`, but a venv is recommended.
- The Node `serialport` path/COM mode does not require Python.

## Test Print

### BLE (recommended when no COM port exists)

Default PSF588 setup (auto-detects printer and uses correct characteristic):

```bash
node test-print.js ble
```

Or with explicit order ID:

```bash
node test-print.js ble ORDER123
```

### BLE with custom device/UUID

```bash
node test-print.js ble ORDER123 PSF588 "AA:BB:CC:DD:EE:FF" "49535343-8841-43f4-a8d4-ecbe34729bb3"
```

Args order for BLE:

1. `ble`
2. `orderId` (optional)
3. `bleName` (optional, default: `PSF588`)
4. `bleAddress` (optional, auto-detected if not provided)
5. `charUUID` (optional, default: `49535343-8841-43f4-a8d4-ecbe34729bb3` for PSF588)

### Scan for BLE devices

```bash
node test-print.js scan
node test-print.js scan PSF588
```

Output shows all available characteristics and their write permissions.

### COM mode

```bash
node test-print.js com ORDER123 COM5 9600
```

## Environment Variables

- `PRINTER_TRANSPORT=ble|com` (default: `ble`)
- `PRINTER_COM_PORT=COM5` (default: `COM5` for COM mode)
- `PRINTER_BLE_NAME=PSF588` (default: `PSF588`)
- `PRINTER_BLE_ADDRESS=AA:BB:CC:DD:EE:FF` (optional, auto-detected)
- `PRINTER_BLE_CHAR_UUID=49535343-8841-43f4-a8d4-ecbe34729bb3` (default for PSF588)
- `PRINTER_BLE_CONNECT_TIMEOUT=15` (seconds)
- `PRINTER_BLE_SCAN_TIMEOUT=10` (seconds)
- `PRINTER_BLE_PAIR=1` (set to enable OS pairing before connect)
- `PRINTER_PYTHON_CMD=py` (Python launcher)

## Publish Checklist

Before publishing, make sure the package name is unique on npm and then run:

```bash
npm pack --dry-run
npm publish --access public
```

## PSF588 Printer Info

- **Characteristic for printing:** `49535343-8841-43f4-a8d4-ecbe34729bb3`
- **Properties:** write-without-response, write
- **Data format:** ESC/POS (raw binary)

## Troubleshooting

- **"Access Denied" on write:** Characteristic doesn't support writes. Use `node test-print.js scan PSF588` to find a writable one.
- **Connection timeout:** Keep printer in pairing mode, disconnect from other devices, ensure Bluetooth is enabled on Windows.
- **Python not found:** Install Python 3.11+ and ensure it's on PATH, or set `PRINTER_PYTHON_CMD=py -3.11`.
