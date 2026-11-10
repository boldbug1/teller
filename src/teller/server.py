from __future__ import annotations

import argparse
import json
import os
import socket
import sys

import uvicorn

from teller.api import create_app


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def run_server(
    host: str = "127.0.0.1",
    port: int = 0,
    token: str | None = None,
) -> None:
    api_token = token or os.environ.get("TELLER_API_TOKEN", "")
    selected_port = port if port > 0 else find_free_port()

    app = create_app(api_token=api_token)

    # Print readiness event to stdout and flush immediately for Tauri to parse
    ready_event = {
        "event": "ready",
        "port": selected_port,
        "host": host,
    }
    sys.stdout.write(json.dumps(ready_event) + "\n")
    sys.stdout.flush()

    config = uvicorn.Config(
        app=app,
        host=host,
        port=selected_port,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    server.run()


def main() -> None:
    parser = argparse.ArgumentParser(description="Teller desktop sidecar API server")
    parser.add_argument("--host", default="127.0.0.1", help="Host loopback address")
    parser.add_argument("--port", type=int, default=0, help="Port to bind (0 for ephemeral)")
    parser.add_argument("--token", default=None, help="Bearer token for API authentication")

    args = parser.parse_args()
    run_server(host=args.host, port=args.port, token=args.token)


if __name__ == "__main__":
    main()
