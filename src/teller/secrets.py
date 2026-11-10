from __future__ import annotations

import os

SERVICE_NAME = "teller"


def get_api_key(provider: str, env_name: str) -> str | None:
    value = os.environ.get(env_name)
    if value:
        return value
    try:
        import keyring
    except ImportError:
        return None
    try:
        return keyring.get_password(SERVICE_NAME, provider)
    except keyring.errors.KeyringError:
        return None


def store_api_key(provider: str, api_key: str) -> bool:
    try:
        import keyring
    except ImportError:
        return False
    try:
        keyring.set_password(SERVICE_NAME, provider, api_key)
    except keyring.errors.KeyringError:
        return False
    return True
