# node-thermal-printer-js

Public npm package for sending ESC/POS print jobs to a PSF588 printer over BLE or classic Bluetooth COM port.

## ⚠️ Installation Requirements (READ FIRST)

### Required Software
- **Node.js**: 16.0.0 or higher
- **Python**: 3.9 or higher (downloads: https://www.python.org/downloads/)
- **pip**: Python package manager (usually included with Python)

### Required Python Library
- **bleak**: BLE client library for Python
  - Auto-installed during `npm install` (see postinstall)
  - Or manually: `pip install bleak`

### Platform-Specific Requirements

#### Windows
- Python 3.9+ with pip
- Bluetooth drivers (usually included with Windows 10+)
- No special permissions needed

#### macOS
- Python 3.9+ with pip
- Ensure Bluetooth is enabled in System Preferences
- May require granting Terminal/Node.js permission to use Bluetooth

#### Linux
- Python 3.9+ with pip
- **Required group permissions**:
  ```bash
  sudo usermod -a -G dialout,plugdev $USER
  ```
  Then log out and back in for changes to take effect.
  Without this, BLE operations will fail with permission errors.

## Quick Start

### 1. Install Package
```bash
npm install node-thermal-printer-js
```

The postinstall script will:
- ✅ Check for Python 3.9+
- ✅ Verify/install bleak library
- ✅ Display platform-specific setup instructions

### 2. Create `.env` Configuration (Optional)
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

### 3. Use in Code
```js
import { printData, startPrinterServer, stopPrinterServer } from "node-thermal-printer-js";

// Option 1: Fast persistent server (recommended)
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

// Option 3: COM port (Windows)
await printData("Hello World", { 
  transport: "com",
  portPath: "COM3"
});
```

## API Reference

### `printData(data, options?)`
Print ESC/POS data to thermal printer.

**Parameters:**
- `data` (string): ESC/POS data to print
- `options` (object, optional):
  - `transport` (string): "ble-server", "ble", or "com" - default: "ble-server"
  - `bleName` (string): Printer name for BLE discovery
  - `bleAddress` (string): MAC address (e.g., "C8:47:8C:1F:72:34")
  - `charUUID` (string): BLE characteristic UUID for write operations
  - `portPath` (string): COM port path (e.g., "COM3") for COM transport
  - `scanTimeout` (number): BLE scan timeout in seconds (default: 10)
  - `connectTimeout` (number): BLE connection timeout in seconds (default: 15)
  - `requestTimeoutMs` (number): Server request timeout in ms (default: 40000)

**Returns:** Promise<{ok: boolean, bytes_sent: number}>

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

### `startPrinterServer(options?)`
Start persistent BLE server for faster multi-print performance. The server stays running to eliminate connection overhead.

**Parameters:** Same as `printData` options

**Returns:** Promise<void>

**Example:**
```js
await startPrinterServer({ 
  bleName: "PSF588",
  connectTimeout: 20 
});
console.log("Server ready for fast printing");
```

### `stopPrinterServer()`
Stop the running BLE server and clean up resources.

**Returns:** Promise<void>

### `getPrinterServerStatus()`
Get status of running BLE server.

**Returns:**
```js
{
  running: boolean,
  host: string,
  port: number,
  processInfo: ChildProcess | null
}
```

## Troubleshooting

### "Python 3.9+ not found"
**Solution:**
1. Install Python from https://www.python.org/downloads/
2. Ensure Python is in system PATH:
   - Windows: Check "Add Python to PATH" during installation
   - Mac/Linux: Verify `python3` works in terminal
3. Set environment variable:
   ```bash
   export PRINTER_PYTHON_CMD=python3  # or python, py.exe, etc.
   ```
4. Run: `npm install` again

### "bleak module not found"
**Solution:**
```bash
pip install bleak
# or with Python 3 explicitly:
python3 -m pip install bleak
```

### "Address already in use" (Port 5555)
**Solution:**
This happens if a previous BLE server crashed. The package auto-detects and cleans up stale processes, but manual cleanup:
```bash
# Windows
netstat -ano | findstr :5555
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:5555 | xargs kill -9
```

### "Device not found" or connection timeouts
**Solutions:**
1. Ensure printer is powered on and in BLE discoverable mode
2. Increase timeouts:
   ```js
   await printData(data, { scanTimeout: 20, connectTimeout: 25 });
   ```
3. Try specifying MAC address (faster than name discovery):
   ```js
   await printData(data, { bleAddress: "C8:47:8C:1F:72:34" });
   ```
4. On Linux, verify group permissions: `id $USER` should show `dialout` and `plugdev` groups

### "Permission denied" (Linux)
**Solution:**
```bash
# Add user to required groups
sudo usermod -a -G dialout,plugdev $USER

# Apply immediately (or log out/in)
su - $USER
```

### Print job times out
**Solutions:**
1. Increase timeout:
   ```js
   await printData(data, { requestTimeoutMs: 60000 });
   ```
2. Check printer is still connected and responsive
3. Try legacy BLE transport:
   ```js
   await printData(data, { transport: "ble" });  // No persistent server
   ```

## Performance

### Transport Modes Comparison

| Mode | Speed | Resource Use | Recommended For |
|------|-------|--------------|-----------------|
| `ble-server` | **100-200ms** ✓ | Low (persistent) | Multiple prints, APIs |
| `ble` | 1-2s | Medium (spawn/connect each time) | Single prints, testing |
| `com` | Variable | Low | Windows paired COM port |

### Why `ble-server` is Fast
- Reuses single BLE connection for multiple prints
- Eliminates per-print connection overhead (1s)
- Persistent Python daemon handles I/O

## Development

### Local Development
```bash
# Clone and setup
git clone <repo>
cd Printer
npm install

# Run tests
npm test

# Watch mode
npm run dev
```

### Requirements for development
```bash
# Install Python dev dependencies
pip install -r requirements.txt
```

## Architecture

### Components
1. **app.js** (Node.js): Express-compatible export module, socket IPC client
2. **ble_server.py** (Python): Long-running BLE daemon, accepts print requests over TCP
3. **ble_print.py** (Python): Fallback legacy BLE bridge (process per print)
4. **scripts/install-deps.js** (Node.js): Postinstall hook for dependency verification

### Data Flow
```
printData(data)
  ↓
[ble-server mode]
  ↓
sendToBleServer() → TCP socket to ble_server.py
  ↓
ble_server.py connects to PSF588 printer (reused)
  ↓
Writes ESC/POS data via BLE characteristic write
  ↓
Response sent back over socket

[ble mode - fallback]
  ↓
Spawn new ble_print.py process
  ↓
Process connects to printer, prints, exits (slower)
```

## License

ISC


If you plan to use `transport: "ble"`, you need a Python 3.11+ environment with the `bleak` library (the repo includes `ble_print.py` and `ble_scan.py`). Follow the steps for your platform.

- Windows (recommended using the Python launcher):

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
# or: pip install bleak
```

- macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# or: pip install bleak
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
