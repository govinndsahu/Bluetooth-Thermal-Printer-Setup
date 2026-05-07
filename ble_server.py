"""
Persistent BLE Printer Server
Maintains a long-running connection pool to avoid reconnection overhead.
Listens for print jobs over a local socket and sends them optimally.
"""

import argparse
import asyncio
import base64
import json
import sys
import traceback
from typing import Optional

from bleak import BleakClient, BleakScanner


class BLEPrinterServer:
    def __init__(self, device_name: str = "PSF588", device_address: Optional[str] = None,
                 char_uuid: str = "49535343-8841-43f4-a8d4-ecbe34729bb3",
                 chunk_size: int = 244, delay_ms: int = 0, pair: bool = False,
                 connect_timeout: float = 15.0, scan_timeout: float = 10.0,
                 port: int = 5555, host: str = "127.0.0.1"):
        self.device_name = device_name
        self.device_address = device_address
        self.char_uuid = char_uuid
        self.chunk_size = max(20, min(chunk_size, 512))
        self.delay_sec = max(0, delay_ms) / 1000.0
        self.pair = pair
        self.connect_timeout = connect_timeout
        self.scan_timeout = scan_timeout
        self.port = port
        self.host = host
        self.client: Optional[BleakClient] = None
        self.response_required = False
        self.is_running = True

    def _resolve_characteristic_mode(self, services, preferred_uuid: Optional[str]) -> tuple[Optional[str], bool]:
        """Resolve characteristic UUID and whether response is required."""
        if preferred_uuid:
            preferred_uuid_l = preferred_uuid.lower()
            for service in services:
                for char in service.characteristics:
                    if (char.uuid or "").lower() == preferred_uuid_l:
                        props = set(char.properties)
                        if "write-without-response" in props:
                            print(
                                f"[SERVER] Using configured characteristic: {char.uuid} (response_required=False)",
                                flush=True,
                            )
                            return char.uuid, False
                        if "write" in props:
                            print(
                                f"[SERVER] Using configured characteristic: {char.uuid} (response_required=True)",
                                flush=True,
                            )
                            return char.uuid, True
                        raise RuntimeError(
                            f"Configured characteristic {preferred_uuid} is not writable"
                        )

            raise RuntimeError(
                f"Configured characteristic {preferred_uuid} not found on target device"
            )

        return self._pick_characteristic(services)

    async def find_device(self) -> tuple[Optional[str], Optional[str]]:
        """Find BLE device by name or use cached address."""
        if self.device_address:
            return self.device_address, None

        print(f"[SERVER] Scanning for device: {self.device_name}", flush=True)
        devices = await BleakScanner.discover(timeout=self.scan_timeout)
        name_filter = (self.device_name or "").lower()

        for device in devices:
            name = (device.name or "").lower()
            if name_filter and name_filter in name:
                print(f"[SERVER] Found device: {device.name} ({device.address})", flush=True)
                return device.address, device.name

        raise RuntimeError(
            f"No BLE device found for name filter '{self.device_name}'. "
            "Try setting --address explicitly."
        )

    async def connect_to_printer(self):
        """Establish and maintain BLE connection."""
        if self.client and self.client.is_connected:
            return

        address, found_name = await self.find_device()
        self.device_address = address

        print(f"[SERVER] Connecting to {address}...", flush=True)
        self.client = BleakClient(
            address,
            timeout=self.connect_timeout,
            pair=self.pair,
            winrt={"use_cached_services": False},
        )

        await self.client.connect()
        print(f"[SERVER] Connected to {address}", flush=True)

        # Get services and pick writable characteristic
        if hasattr(self.client, "get_services"):
            services = await self.client.get_services()
        else:
            services = self.client.services

        self.char_uuid, self.response_required = self._resolve_characteristic_mode(
            services, self.char_uuid
        )
        if not self.char_uuid:
            raise RuntimeError("No writable BLE characteristic found on target device")

        print(f"[SERVER] Using characteristic: {self.char_uuid} (response_required={self.response_required})", flush=True)

    def _pick_characteristic(self, services) -> tuple[Optional[str], bool]:
        """Prefer write-without-response characteristics."""
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
                print(f"[SERVER] Selected write-without-response characteristic: {uuid}", flush=True)
                return uuid, response_required

        for uuid, response_required in candidates:
            print(f"[SERVER] Selected write characteristic (requires response): {uuid}", flush=True)
            return uuid, response_required

        return None, None

    async def send_print_data(self, payload: bytes) -> dict:
        """Send print data to connected printer."""
        try:
            # Ensure connection is alive
            if not self.client or not self.client.is_connected:
                print(f"[SERVER] Device not connected, attempting to connect...", flush=True)
                try:
                    await self.connect_to_printer()
                except Exception as conn_err:
                    return {"ok": False, "error": f"Failed to connect to printer: {str(conn_err)}"}

            print(f"[SERVER] Sending {len(payload)} bytes in chunks of {self.chunk_size}...", flush=True)
            bytes_sent = 0

            for idx in range(0, len(payload), self.chunk_size):
                chunk = payload[idx : idx + self.chunk_size]
                await asyncio.wait_for(
                    self.client.write_gatt_char(
                        self.char_uuid, chunk, response=self.response_required
                    ),
                    timeout=8.0,
                )
                bytes_sent += len(chunk)
                if self.delay_sec:
                    await asyncio.sleep(self.delay_sec)

            print(f"[SERVER] Print sent successfully ({bytes_sent} bytes)", flush=True)
            return {"ok": True, "bytes_sent": bytes_sent}

        except Exception as exc:
            print(f"[SERVER] Send failed: {repr(exc)}", file=sys.stderr, flush=True)
            self.client = None  # Reset connection on error
            return {"ok": False, "error": str(exc)}

    async def handle_client(self, reader, writer):
        """Handle incoming print requests from app.js."""
        addr = writer.get_extra_info("peername")
        print(f"[SERVER] Client connected: {addr}", flush=True)

        try:
            # One request per connection to avoid stream deadlocks.
            print("[SERVER] Waiting for request line...", flush=True)
            try:
                line = await asyncio.wait_for(reader.readline(), timeout=20.0)
            except asyncio.TimeoutError:
                print("[SERVER] Request read timed out", flush=True)
                response = {"ok": False, "error": "Timed out waiting for request"}
                writer.write((json.dumps(response) + "\n").encode("utf-8"))
                await writer.drain()
                return

            if not line:
                print("[SERVER] Connection closed before request payload", flush=True)
                return

            print(f"[SERVER] Received raw line bytes: {len(line)}", flush=True)

            try:
                request = json.loads(line.decode("utf-8"))
                command = request.get("command")

                if command == "print":
                    print("[SERVER] Handling print command", flush=True)
                    payload_b64 = request.get("data_b64")
                    if not payload_b64:
                        response = {"ok": False, "error": "Missing data_b64"}
                    else:
                        try:
                            payload = base64.b64decode(payload_b64)
                            response = await self.send_print_data(payload)
                        except Exception as e:
                            response = {"ok": False, "error": f"Decode error: {str(e)}"}

                elif command == "status":
                    is_connected = self.client and self.client.is_connected
                    response = {
                        "ok": True,
                        "connected": is_connected,
                        "device_address": self.device_address,
                        "char_uuid": self.char_uuid,
                    }

                elif command == "ping":
                    response = {"ok": True, "message": "pong"}

                else:
                    response = {"ok": False, "error": f"Unknown command: {command}"}

                writer.write((json.dumps(response) + "\n").encode("utf-8"))
                await writer.drain()
                print(f"[SERVER] Response sent: {response}", flush=True)

            except json.JSONDecodeError as e:
                response = {"ok": False, "error": f"JSON decode error: {str(e)}"}
                writer.write((json.dumps(response) + "\n").encode("utf-8"))
                await writer.drain()

        except Exception as exc:
            print(f"[SERVER] Client error: {repr(exc)}", file=sys.stderr, flush=True)
        finally:
            writer.close()
            await writer.wait_closed()
            print(f"[SERVER] Client disconnected: {addr}", flush=True)

    async def start_server(self):
        """Start the socket server."""
        print(f"[SERVER] Starting BLE server on {self.host}:{self.port}", flush=True)

        try:
            # Initial connection to printer (non-blocking, will retry on first request)
            await self.connect_to_printer()
        except Exception as exc:
            print(f"[SERVER] Initial connection failed: {repr(exc)}", file=sys.stderr, flush=True)
            print("[SERVER] Will retry on first client request", flush=True)

        async def client_handler(reader, writer):
            await self.handle_client(reader, writer)

        try:
            # Enable SO_REUSEADDR to allow reusing the port immediately
            server = await asyncio.start_server(
                client_handler, self.host, self.port,
                reuse_address=True
            )
        except OSError as e:
            if "already in use" in str(e) or "10048" in str(e):
                print(f"[SERVER] Port {self.port} still in TIME_WAIT, retrying in 2 seconds...", file=sys.stderr, flush=True)
                await asyncio.sleep(2)
                server = await asyncio.start_server(
                    client_handler, self.host, self.port,
                    reuse_address=True
                )
            else:
                raise

        print(f"[SERVER] Server ready. Listening on {self.host}:{self.port}", flush=True)
        sys.stdout.flush()
        sys.stderr.flush()
        
        async with server:
            await server.serve_forever()

    async def shutdown(self):
        """Gracefully shutdown."""
        self.is_running = False
        if self.client:
            await self.client.disconnect()
            print("[SERVER] Disconnected from printer", flush=True)


def parse_args():
    parser = argparse.ArgumentParser(description="Persistent BLE Printer Server")
    parser.add_argument("--name", default="PSF588", help="BLE device name filter")
    parser.add_argument("--address", default=None, help="BLE MAC/address (skips scan)")
    parser.add_argument(
        "--char-uuid",
        default="49535343-8841-43f4-a8d4-ecbe34729bb3",
        help="Writable characteristic UUID",
    )
    parser.add_argument("--chunk-size", type=int, default=244, help="Write chunk size (default: 244)")
    parser.add_argument("--delay-ms", type=int, default=0, help="Delay between chunks in ms")
    parser.add_argument("--pair", action="store_true", help="Request OS pairing")
    parser.add_argument("--connect-timeout", type=float, default=15.0, help="Connect timeout seconds")
    parser.add_argument("--scan-timeout", type=float, default=10.0, help="Scan timeout seconds")
    parser.add_argument("--port", type=int, default=5555, help="Server port")
    parser.add_argument("--host", default="127.0.0.1", help="Server host")
    return parser.parse_args()


def main():
    args = parse_args()
    # Set unbuffered/line-buffered output immediately
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, write_through=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, write_through=True)
    
    print("[SERVER] Starting BLE server...", flush=True)
    try:
        server = BLEPrinterServer(
            device_name=args.name,
            device_address=args.address,
            char_uuid=args.char_uuid,
            chunk_size=args.chunk_size,
            delay_ms=args.delay_ms,
            pair=args.pair,
            connect_timeout=args.connect_timeout,
            scan_timeout=args.scan_timeout,
            port=args.port,
            host=args.host,
        )
        asyncio.run(server.start_server())
    except KeyboardInterrupt:
        print("\n[SERVER] Shutting down...", flush=True)
    except Exception as exc:
        print(f"Server error: {repr(exc)}", file=sys.stderr, flush=True)
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
