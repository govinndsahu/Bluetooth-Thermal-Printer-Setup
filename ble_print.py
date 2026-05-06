import argparse
import asyncio
import base64
import sys
import traceback

from bleak import BleakClient, BleakScanner


def parse_args():
    parser = argparse.ArgumentParser(description="Send ESC/POS bytes to a BLE printer")
    parser.add_argument("--name", default="PSF588", help="BLE device name contains filter")
    parser.add_argument("--address", default=None, help="BLE MAC/address to connect directly")
    parser.add_argument(
        "--char-uuid",
        default="49535343-8841-43f4-a8d4-ecbe34729bb3",
        help="Writable characteristic UUID (default works for PSF588)",
    )
    parser.add_argument("--data-b64", required=True, help="Base64 payload bytes")
    parser.add_argument("--scan-timeout", type=float, default=10.0, help="Scan timeout seconds")
    parser.add_argument("--connect-timeout", type=float, default=15.0, help="Connect timeout seconds")
    parser.add_argument("--chunk-size", type=int, default=180, help="Write chunk size")
    parser.add_argument("--delay-ms", type=int, default=20, help="Delay between chunks in ms")
    parser.add_argument("--pair", action="store_true", help="Request OS pairing before connect")
    parser.add_argument("--connect-retries", type=int, default=2, help="Connect retry attempts")
    return parser.parse_args()


async def find_device(name_filter: str, timeout: float):
    devices = await BleakScanner.discover(timeout=timeout)
    name_filter = (name_filter or "").lower()

    for device in devices:
        name = (device.name or "").lower()
        if name_filter and name_filter in name:
            return device, device.address, device.name

    return None, None, None


def pick_writable_characteristic(services):
    # Prefer write-without-response characteristics (more reliable for bulk data)
    candidates = []

    for service in services:
        for char in service.characteristics:
            props = set(char.properties)
            if "write-without-response" in props:
                candidates.append((char.uuid, False))
            elif "write" in props:
                candidates.append((char.uuid, True))

    # Return first write-without-response, then first write
    for uuid, response_required in candidates:
        if not response_required:
            print(f"[DEBUG] Selected write-without-response characteristic: {uuid}")
            return uuid, response_required

    for uuid, response_required in candidates:
        print(f"[DEBUG] Selected write characteristic (requires response): {uuid}")
        return uuid, response_required

    print("[DEBUG] No writable characteristics found")
    return None, None


async def run_print(args):
    payload = base64.b64decode(args.data_b64)

    address = args.address
    device = None
    device_name = args.name

    if not address:
        device, address, found_name = await find_device(device_name, args.scan_timeout)
        if not address:
            raise RuntimeError(
                f"No BLE device found for name filter '{device_name}'. "
                "Try setting --address explicitly."
            )
        print(f"Found device: {found_name} ({address})")

    target = device if device is not None else address

    last_error = None
    for attempt in range(1, max(1, args.connect_retries) + 1):
        try:
            async with BleakClient(
                target,
                timeout=args.connect_timeout,
                pair=args.pair,
                winrt={"use_cached_services": False},
            ) as client:
                if not client.is_connected:
                    raise RuntimeError(f"Failed to connect to {address}")

                if hasattr(client, "get_services"):
                    services = await client.get_services()
                else:
                    services = client.services

                char_uuid = args.char_uuid
                response_required = False

                if not char_uuid:
                    # Re-scan services fresh and pick writable characteristic
                    char_uuid, response_required = pick_writable_characteristic(services)
                    if not char_uuid:
                        raise RuntimeError("No writable BLE characteristic found on target device")

                print(f"Using characteristic: {char_uuid} (response_required={response_required})")

                chunk_size = max(20, min(args.chunk_size, 512))
                delay_sec = max(0, args.delay_ms) / 1000.0

                bytes_sent = 0
                for idx in range(0, len(payload), chunk_size):
                    chunk = payload[idx : idx + chunk_size]
                    print(f"[DEBUG] Writing {len(chunk)} bytes to {char_uuid}...")
                    await client.write_gatt_char(char_uuid, chunk, response=response_required)
                    bytes_sent += len(chunk)
                    if delay_sec:
                        await asyncio.sleep(delay_sec)

                print(f"BLE print sent successfully ({bytes_sent} bytes)")
                return
        except Exception as exc:
            last_error = exc
            print(f"Connect/write attempt {attempt} failed: {repr(exc)}", file=sys.stderr)
            if attempt < max(1, args.connect_retries):
                await asyncio.sleep(1)
    raise last_error if last_error else RuntimeError("BLE print failed without a specific error")


def main():
    args = parse_args()
    try:
        asyncio.run(run_print(args))
    except Exception as exc:
        detail = str(exc) or repr(exc)
        print(f"BLE print failed: {detail}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
