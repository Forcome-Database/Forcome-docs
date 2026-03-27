from unittest.mock import patch, MagicMock


def test_vlm_describe_batch_parses_numbered_list():
    from app.tools.vlm_understand import vlm_describe_batch

    mock_response = MagicMock()
    mock_response.content = "1. PC端Clash配置界面\n2. 代理模式选择截图\n3. 系统代理启动界面"

    mock_llm = MagicMock()
    mock_llm.invoke.return_value = mock_response

    with patch("app.tools.vlm_understand._get_vlm", return_value=mock_llm):
        results = vlm_describe_batch([
            ("base64data1", "image/png"),
            ("base64data2", "image/jpeg"),
            ("base64data3", "image/png"),
        ])

    assert len(results) == 3
    assert "Clash配置" in results[0]
    assert "代理" in results[1]


def test_vlm_describe_batch_empty_input():
    from app.tools.vlm_understand import vlm_describe_batch
    assert vlm_describe_batch([]) == []
