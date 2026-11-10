from pathlib import Path
import pytest


@pytest.fixture(autouse=True)
def isolate_teller_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    test_config = tmp_path / "test_config.toml"
    monkeypatch.setenv("TELLER_CONFIG", str(test_config))

