# Listenly 中文 PDF 精听版

功能：
- 上传 MP3 / WAV / M4A 音频
- 直接上传 PDF 英文文稿
- 浏览器提取 PDF 文字并自动分句
- 精听 / 听写模式
- 点击英文单词查词
- 中文释义、音标、英文定义
- 生词本保存在浏览器 localStorage
- 逐句播放目前按句子长度估算时间

注意：
1. 扫描图片型 PDF 没有文字层时，需要后续接 OCR。
2. 任意音频 + 任意 PDF 的精准逐句对齐，需要后续接语音识别/时间戳服务。
3. 查词使用 Dictionary API 和 MyMemory Translation API，需要浏览器联网。
