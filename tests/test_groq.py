import json
import pytest
from unittest.mock import MagicMock, patch
from teller.providers.llm_groq import GroqLLM


@pytest.mark.asyncio
async def test_groq_llm_generate_success() -> None:
    llm = GroqLLM(api_key="gsk_test123", model="llama-3.3-70b-versatile")
    fake_response = {
        "choices": [
            {
                "message": {
                    "content": json.dumps({"assignments": [], "characters": []})
                }
            }
        ]
    }

    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps(fake_response).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    with patch("urllib.request.urlopen", return_value=mock_resp):
        res = await llm.generate("test prompt", schema={})
        assert "assignments" in res


@pytest.mark.asyncio
async def test_groq_llm_missing_api_key() -> None:
    with pytest.raises(RuntimeError, match="Groq API key is required"):
        GroqLLM(api_key="")

