# ruff: noqa: E402,I001

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from teller.cli import app  # noqa: E402


if __name__ == "__main__":
    app()
