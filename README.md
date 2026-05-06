# node-thermal-printer-js

Public npm package for sending ESC/POS print jobs to a PSF588 printer over BLE or classic Bluetooth COM port.

## Install

```bash
npm install node-thermal-printer-js
```

## Import

```js
import { printData } from "node-thermal-printer-js";

await printData("Hello from npm!");
```

## Local Development

This project can print ESC/POS data to PSF588 using either:
- BLE via Python bridge (`ble_print.py` + `bleak`)
- Classic Bluetooth Serial (COM port) via `serialport`

## Install Dependencies

```bash
npm install
py -3.11 -m pip install -r requirements.txt
```

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

