from pathlib import Path

src = Path("/mnt/data/粘贴的文本 (1)(3).txt")
text = src.read_text(encoding="utf-8")

old = """const currentStart =
    Number.isFinite(
      Number(
        currentSentenceData?.start_time
      )
    )
      ? Number(
          currentSentenceData.start_time
        )
      : null;

  const currentEnd =
    Number.isFinite(
      Number(
        currentSentenceData?.end_time
      )
    )
      ? Number(
          currentSentenceData.end_time
        )
      : null;"""

new = """const currentStart =
    currentSentenceData?.start_time !== null &&
    currentSentenceData?.start_time !== undefined &&
    currentSentenceData?.start_time !== "" &&
    Number.isFinite(
      Number(currentSentenceData.start_time)
    )
      ? Number(currentSentenceData.start_time)
      : null;

  const currentEnd =
    currentSentenceData?.end_time !== null &&
    currentSentenceData?.end_time !== undefined &&
    currentSentenceData?.end_time !== "" &&
    Number.isFinite(
      Number(currentSentenceData.end_time)
    )
      ? Number(currentSentenceData.end_time)
      : null;"""

if old not in text:
    raise ValueError("未找到需要修复的代码。")

out = Path("/mnt/data/App_fixed_v4.jsx")
out.write_text(text.replace(old, new, 1), encoding="utf-8")
print(out)
