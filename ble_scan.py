import argparse
import asyncio
import sys

from bleak import BleakClient, BleakScanner


def parse_args():
    parser = argparse.ArgumentParser(description="Scan BLE devices and list writable characteristics")
    parser.add_argument("--name-filter", default="", help="Device name contains filter")
    parser.add_argument("--timeout", type=float, default=10.0, help="Scan timeout seconds")
    parser.add_argument("--connect-timeout", type=float, default=15.0, help="Connect timeout seconds")
    return parser.parse_args()


async def run_scan(args):
    print("Scanning for BLE devices...")
    devices = await BleakScanner.discover(timeout=args.timeout)

    if not devices:
        print("No BLE devices found.")
        return

    filtered = [d for d in devices if not args.name_filter or (args.name_filter.lower() in (d.name or "").lower())]

    if not filtered:
        print(f"No devices matching filter '{args.name_filter}'")
        return

    print(f"\nFound {len(filtered)} device(s):\n")

    for device in filtered:
        print(f"Device: {device.name} ({device.address})")

        try:
            async with BleakClient(device, timeout=args.connect_timeout) as client:
                if hasattr(client, "get_services"):
                    services = await client.get_services()
                else:
                    services = client.services

                if not services:
                    print("  No services found")
                    continue

                for service in services:
                    print(f"  Service: {service.uuid}")

                    for char in service.characteristics:
                        props = ", ".join(char.properties)
                        writable = "write" in char.properties or "write-without-response" in char.properties
                        marker = " [WRITABLE]" if writable else ""
                        print(f"    Characteristic: {char.uuid}{marker}")
                        print(f"      Properties: {props}")

        except Exception as exc:
            print(f"  Error connecting: {exc}")

        print()


def main():
    args = parse_args()
    try:
        asyncio.run(run_scan(args))
    except Exception as exc:
        print(f"Scan failed: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
