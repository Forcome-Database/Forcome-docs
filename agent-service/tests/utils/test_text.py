from app.utils.text import count_words, count_words_by_section


def test_count_words_chinese():
    assert count_words("你好世界") == 4


def test_count_words_english():
    assert count_words("hello world foo") == 3


def test_count_words_mixed():
    text = "这是一个test文档，包含English和中文"
    count = count_words(text)
    # 这(1) 是(2) 一(3) 个(4) 文(5) 档(6) 包(7) 含(8) 和(9) 中(10) 文(11) + test(1) English(2) = 13
    assert count == 13


def test_count_words_empty():
    assert count_words("") == 0
    assert count_words("   ") == 0


def test_count_words_by_section():
    text = """# 简介
这是简介部分，有一些内容。

## 正文
正文部分包含更多的内容和详细说明。

## 结论
最终总结。
"""
    sections = count_words_by_section(text)
    assert "简介" in sections
    assert "正文" in sections
    assert "结论" in sections
    assert sections["简介"] > 0
    assert sections["正文"] > sections["结论"]
