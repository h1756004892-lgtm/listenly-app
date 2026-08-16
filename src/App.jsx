import React, { useEffect, useRef, useState } from "react";

const DICT_API =
  "https://api.dictionaryapi.dev/api/v2/entries/en/";

const TRANSLATE_API =
  "https://api.mymemory.translated.net/get";

function splitTranscript(text) {
  const cleaned = text.replace(/\r/g, "").trim();

  if (!cleaned) return [];

  const lines = cleaned
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  // 支持：
  // [00:00] Hello world.
  // [00:00-00:04] Hello world.
  const timestamped = lines.map((line) => {
    const match = line.match(
      /^\[(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?\]\s*(.*)$/
    );

    if (!match) return null;

    const start =
      Number(match[1]) * 60 + Number(match[2]);

    const end = match[3]
      ? Number(match[3]) * 60 + Number(match[4])
      : null;

    return {
      text: match[5],
      start,
      end,
    };
  });

  if (timestamped.length && timestamped.every(Boolean)) {
    return timestamped;
  }

  // 普通 TXT 文稿自动按句号、问号、感叹号分句
  return cleaned
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text) => ({
      text,
      start: null,
      end: null,
    }));
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return "00:00";
  }

  const value = Math.max(0, Math.floor(seconds));

  const minutes = Math.floor(value / 60);
  const secondsPart = value % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    secondsPart
  ).padStart(2, "0")}`;
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[“”"'.,!?;:()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return (
    text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []
  );
}

export default function App() {
  const audioRef = useRef(null);

  const [page, setPage] = useState("home");

  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState("");

  const [transcriptFile, setTranscriptFile] =
    useState(null);

  const [transcript, setTranscript] = useState("");

  const [sentences, setSentences] = useState([]);

  const [currentSentence, setCurrentSentence] =
    useState(0);

  const [playing, setPlaying] = useState(false);

  const [speed, setSpeed] = useState(1);

  const [hideText, setHideText] = useState(false);

  const [audioDuration, setAudioDuration] =
    useState(0);

  const [audioTime, setAudioTime] = useState(0);

  const [answer, setAnswer] = useState("");

  const [checked, setChecked] = useState(false);

  const [notice, setNotice] = useState("");

  const [lookup, setLookup] = useState(null);

  const [lookupLoading, setLookupLoading] =
    useState(false);

  const [savedWords, setSavedWords] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem("listenly-vocab") ||
          "[]"
      );
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(
      "listenly-vocab",
      JSON.stringify(savedWords)
    );
  }, [savedWords]);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) return;

    const updateTime = () => {
      setAudioTime(audio.currentTime);
    };

    const loaded = () => {
      setAudioDuration(audio.duration || 0);
    };

    const ended = () => {
      setPlaying(false);
    };

    audio.addEventListener(
      "timeupdate",
      updateTime
    );

    audio.addEventListener(
      "loadedmetadata",
      loaded
    );

    audio.addEventListener("ended", ended);

    return () => {
      audio.removeEventListener(
        "timeupdate",
        updateTime
      );

      audio.removeEventListener(
        "loadedmetadata",
        loaded
      );

      audio.removeEventListener(
        "ended",
        ended
      );
    };
  }, [audioUrl]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  const sentence =
    sentences[currentSentence] || null;

  function showNotice(message) {
    setNotice(message);

    setTimeout(() => {
      setNotice("");
    }, 2500);
  }

  function uploadAudio(file) {
    if (!file) return;

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }

    const url = URL.createObjectURL(file);

    setAudioFile(file);
    setAudioUrl(url);

    showNotice("音频上传成功");
  }

  async function uploadTranscript(file) {
    if (!file) return;

    try {
      const text = await file.text();

      const list = splitTranscript(text);

      setTranscriptFile(file);
      setTranscript(text);
      setSentences(list);
      setCurrentSentence(0);

      showNotice(
        `文稿上传成功，共 ${list.length} 句`
      );

      setPage("practice");
    } catch {
      showNotice("文稿读取失败");
    }
  }

  async function playFullAudio() {
    if (!audioRef.current || !audioUrl) {
      showNotice("请先上传音频");
      return;
    }

    try {
      if (playing) {
        audioRef.current.pause();
        setPlaying(false);
      } else {
        await audioRef.current.play();
        setPlaying(true);
      }
    } catch {
      showNotice("音频播放失败");
    }
  }

  function calculateSentenceRange(index) {
    if (!sentences.length || !audioDuration) {
      return {
        start: 0,
        end: audioDuration || 0,
      };
    }

    const item = sentences[index];

    // 如果文稿有时间戳，直接使用
    if (item.start !== null) {
      return {
        start: item.start,
        end:
          item.end !== null
            ? item.end
            : Math.min(
                audioDuration,
                item.start + 8
              ),
      };
    }

    // 没有时间戳时，根据句子字符长度估算
    const totalLength =
      sentences.reduce(
        (sum, item) =>
          sum + item.text.length,
        0
      ) || 1;

    const previousLength =
      sentences
        .slice(0, index)
        .reduce(
          (sum, item) =>
            sum + item.text.length,
          0
        );

    const start =
      (previousLength / totalLength) *
      audioDuration;

    const end =
      ((previousLength +
        item.text.length) /
        totalLength) *
      audioDuration;

    return {
      start,
      end,
    };
  }

  async function playSentence(index) {
    if (!audioRef.current || !audioUrl) {
      showNotice("请先上传音频");
      return;
    }

    if (!sentences[index]) {
      return;
    }

    const range =
      calculateSentenceRange(index);

    setCurrentSentence(index);

    audioRef.current.currentTime =
      Math.max(0, range.start);

    audioRef.current.playbackRate = speed;

    try {
      await audioRef.current.play();

      setPlaying(true);

      const stopAt = () => {
        if (
          audioRef.current.currentTime >=
          range.end - 0.05
        ) {
          audioRef.current.pause();

          setPlaying(false);

          audioRef.current.removeEventListener(
            "timeupdate",
            stopAt
          );
        }
      };

      audioRef.current.addEventListener(
        "timeupdate",
        stopAt
      );
    } catch {
      showNotice("当前句播放失败");
    }
  }

  function previousSentence() {
    setCurrentSentence((value) =>
      Math.max(0, value - 1)
    );

    setAnswer("");
    setChecked(false);
  }

  function nextSentence() {
    setCurrentSentence((value) =>
      Math.min(
        sentences.length - 1,
        value + 1
      )
    );

    setAnswer("");
    setChecked(false);
  }

  function checkAnswer() {
    setChecked(true);
  }

  const isCorrect =
    checked &&
    sentence &&
    normalize(answer) ===
      normalize(sentence.text);

  function saveWord(word, meaning = "") {
    const clean = word
      .toLowerCase()
      .trim();

    if (!clean) return;

    setSavedWords((previous) => {
      if (
        previous.some(
          (item) => item.word === clean
        )
      ) {
        return previous;
      }

      return [
        {
          word: clean,
          meaning,
          createdAt: Date.now(),
        },
        ...previous,
      ];
    });

    showNotice(
      `${clean} 已加入生词本`
    );
  }

  async function lookupWord(word) {
    const clean = word
      .toLowerCase()
      .trim();

    if (!clean) return;

    setLookupLoading(true);

    setLookup({
      word: clean,
      phonetic: "",
      meaning: "正在查询中文释义……",
      definitions: [],
    });

    try {
      // 第一步：英文词典
      const dictionaryResponse =
        await fetch(
          `${DICT_API}${encodeURIComponent(
            clean
          )}`
        );

      if (!dictionaryResponse.ok) {
        throw new Error(
          "Dictionary API error"
        );
      }

      const dictionaryData =
        await dictionaryResponse.json();

      const entry =
        dictionaryData[0];

      const phonetic =
        entry?.phonetic ||
        entry?.phonetics?.find(
          (item) => item.text
        )?.text ||
        "";

      const meanings =
        entry?.meanings || [];

      const englishDefinitions =
        meanings
          .flatMap((meaning) =>
            (meaning.definitions || [])
              .slice(0, 2)
              .map((definition) => ({
                partOfSpeech:
                  meaning.partOfSpeech ||
                  "",
                definition:
                  definition.definition ||
                  "",
                example:
                  definition.example ||
                  "",
              }))
          )
          .slice(0, 5);

      // 第二步：英文释义 → 中文
      const chineseDefinitions =
        await Promise.all(
          englishDefinitions.map(
            async (item) => {
              try {
                const params =
                  new URLSearchParams({
                    q: item.definition,
                    langpair: "en|zh-CN",
                  });

                const response =
                  await fetch(
                    `${TRANSLATE_API}?${params.toString()}`
                  );

                if (!response.ok) {
                  return {
                    ...item,
                    chinese:
                      item.definition,
                  };
                }

                const data =
                  await response.json();

                return {
                  ...item,
                  chinese:
                    data?.responseData
                      ?.translatedText ||
                    item.definition,
                };
              } catch {
                return {
                  ...item,
                  chinese:
                    item.definition,
                };
              }
            }
          )
        );

      const mainMeaning =
        chineseDefinitions[0]
          ?.chinese ||
        "暂无中文释义";

      setLookup({
        word: clean,
        phonetic,
        meaning: mainMeaning,
        definitions:
          chineseDefinitions,
      });
    } catch (error) {
      console.error(error);

      setLookup({
        word: clean,
        phonetic: "",
        meaning:
          "暂时查不到中文释义，你可以先收藏这个单词。",
        definitions: [],
      });
    } finally {
      setLookupLoading(false);
    }
  }

  function renderSentenceWords(text) {
    const parts = text.split(
      /(\s+)/
    );

    return parts.map((part, index) => {
      if (/^\s+$/.test(part)) {
        return (
          <span key={index}>
            {part}
          </span>
        );
      }

      const clean = part.replace(
        /[^A-Za-z'-]/g,
        ""
      );

      if (!clean) {
        return (
          <span key={index}>
            {part}
          </span>
        );
      }

      const prefix =
        part.match(/^[^A-Za-z]+/)?.[0] ||
        "";

      const suffix =
        part.match(/[^A-Za-z'-]+$/)?.[0] ||
        "";

      return (
        <span key={index}>
          {prefix}

          <button
            className="sentence-word"
            onClick={() =>
              lookupWord(clean)
            }
          >
            {clean}
          </button>

          {suffix}
        </span>
      );
    });
  }

  return (
    <div className="app">
      {notice && (
        <div className="notice">
          {notice}
        </div>
      )}

      <header className="header">
        <button
          className="logo"
          onClick={() =>
            setPage("home")
          }
        >
          <small>
            ENGLISH LISTENING LAB
          </small>

          <h1>
            LISTENLY
            <span> 听着</span>
          </h1>
        </button>

        <nav className="nav">
          <button
            className={
              page === "home"
                ? "active"
                : ""
            }
            onClick={() =>
              setPage("home")
            }
          >
            首页
          </button>

          <button
            className={
              page === "practice"
                ? "active"
                : ""
            }
            onClick={() =>
              setPage("practice")
            }
          >
            精听
          </button>

          <button
            className={
              page === "dictation"
                ? "active"
                : ""
            }
            onClick={() =>
              setPage("dictation")
            }
          >
            听写
          </button>

          <button
            className={
              page === "vocabulary"
                ? "active"
                : ""
            }
            onClick={() =>
              setPage("vocabulary")
            }
          >
            生词本
          </button>
        </nav>
      </header>

      <main className="container">
        {page === "home" && (
          <>
            <section className="hero">
              <div className="hero-eyebrow">
                ENGLISH LISTENING LAB
              </div>

              <h2>
                听懂每一句，
                <br />
                <span>
                  真正学会英语。
                </span>
              </h2>

              <p>
                上传你自己的英语音频和文稿，
                开始逐句精听、听写和生词学习。
              </p>
            </section>

            <section className="card upload-card">
              <label className="upload-zone">
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.webm"
                  onChange={(event) =>
                    uploadAudio(
                      event.target.files?.[0]
                    )
                  }
                />

                <div className="upload-content">
                  <div className="upload-icon">
                    ♪
                  </div>

                  <h3>
                    {audioFile
                      ? "音频已上传"
                      : "上传英语音频"}
                  </h3>

                  <p>
                    {audioFile
                      ? audioFile.name
                      : "支持 MP3、WAV、M4A、WebM"}
                  </p>

                  <span className="upload-button">
                    {audioFile
                      ? "重新选择音频"
                      : "选择音频"}
                  </span>
                </div>
              </label>

              <div className="document-card card">
                <div className="document-header">
                  <div>
                    <h3>
                      上传英文文稿
                    </h3>

                    <p>
                      支持 TXT / MD 文稿，
                      会自动生成真实句子列表。
                    </p>
                  </div>

                  <label className="document-button">
                    <input
                      type="file"
                      accept=".txt,.md,text/plain"
                      style={{
                        display: "none",
                      }}
                      onChange={(event) =>
                        uploadTranscript(
                          event.target.files?.[0]
                        )
                      }
                    />

                    选择文稿
                  </label>
                </div>

                {transcriptFile && (
                  <div className="document-name">
                    📄{" "}
                    {transcriptFile.name}
                    <br />
                    <small>
                      已识别{" "}
                      {sentences.length}{" "}
                      句
                    </small>
                  </div>
                )}
              </div>

              {audioFile &&
                transcriptFile && (
                  <button
                    className="upload-button"
                    style={{
                      marginTop: 20,
                    }}
                    onClick={() =>
                      setPage("practice")
                    }
                  >
                    开始精听 →
                  </button>
                )}
            </section>
          </>
        )}

        {(page === "practice" ||
          page === "dictation") && (
          <>
            <section>
              <div className="hero">
                <div className="hero-eyebrow">
                  LISTENING PRACTICE
                </div>

                <h2>
                  {page === "practice"
                    ? "逐句精听"
                    : "听写训练"}
                </h2>

                <p>
                  {audioFile
                    ? `当前音频：${audioFile.name}`
                    : "还没有上传音频"}
                  <br />
                  {transcriptFile
                    ? `当前文稿：${transcriptFile.name}`
                    : "还没有上传文稿"}
                </p>
              </div>

              <div className="card player-card">
                <audio
                  ref={audioRef}
                  src={audioUrl}
                  style={{
                    display: "none",
                  }}
                  onLoadedMetadata={(event) =>
                    setAudioDuration(
                      event.currentTarget
                        .duration || 0
                    )
                  }
                />

                <div className="audio-title">
                  {audioFile?.name ||
                    "未上传音频"}
                </div>

                <div className="time-row">
                  <span>
                    {formatTime(
                      audioTime
                    )}
                  </span>

                  <span>
                    {formatTime(
                      audioDuration
                    )}
                  </span>
                </div>

                <input
                  className="progress"
                  type="range"
                  min="0"
                  max={audioDuration || 0}
                  step="0.1"
                  value={audioTime}
                  onChange={(event) => {
                    if (
                      audioRef.current
                    ) {
                      audioRef.current.currentTime =
                        Number(
                          event.target.value
                        );
                    }
                  }}
                />

                <div className="audio-controls">
                  <button
                    className="play-button"
                    onClick={
                      playFullAudio
                    }
                  >
                    {playing
                      ? "Ⅱ"
                      : "▶"}
                  </button>

                  <button
                    className="secondary-button"
                    onClick={() =>
                      playSentence(
                        currentSentence
                      )
                    }
                  >
                    ↻ 重播本句
                  </button>

                  <select
                    className="speed-select"
                    value={speed}
                    onChange={(event) =>
                      setSpeed(
                        Number(
                          event.target.value
                        )
                      )
                    }
                  >
                    <option value="0.75">
                      0.75×
                    </option>

                    <option value="1">
                      1× 正常
                    </option>

                    <option value="1.25">
                      1.25×
                    </option>

                    <option value="1.5">
                      1.5×
                    </option>
                  </select>
                </div>
              </div>

              <div className="practice-layout">
                <div className="card practice-card">
                  <div className="mode-tabs">
                    <button
                      className={
                        page ===
                        "practice"
                          ? "active"
                          : ""
                      }
                      onClick={() =>
                        setPage(
                          "practice"
                        )
                      }
                    >
                      精听
                    </button>

                    <button
                      className={
                        page ===
                        "dictation"
                          ? "active"
                          : ""
                      }
                      onClick={() =>
                        setPage(
                          "dictation"
                        )
                      }
                    >
                      听写
                    </button>
                  </div>

                  {sentences.length ===
                  0 ? (
                    <div className="empty-vocabulary">
                      还没有文稿。
                      <br />
                      请回到首页上传 TXT
                      英文文稿。
                    </div>
                  ) : (
                    <>
                      <div className="sentence-list">
                        {sentences.map(
                          (
                            item,
                            index
                          ) => (
                            <button
                              key={
                                index
                              }
                              className={`sentence-item ${
                                index ===
                                currentSentence
                                  ? "active"
                                  : ""
                              }`}
                              onClick={() => {
                                setCurrentSentence(
                                  index
                                );
                                setAnswer(
                                  ""
                                );
                                setChecked(
                                  false
                                );
                              }}
                            >
                              <b>
                                {String(
                                  index +
                                    1
                                ).padStart(
                                  2,
                                  "0"
                                )}
                              </b>{" "}
                              {item.text}
                            </button>
                          )
                        )}
                      </div>

                      {sentence && (
                        <>
                          <div className="sentence">
                            {page ===
                            "practice" ? (
                              <div
                                className={`sentence-text ${
                                  hideText
                                    ? "hidden"
                                    : ""
                                }`}
                              >
                                {hideText
                                  ? "原文已隐藏"
                                  : renderSentenceWords(
                                      sentence.text
                                    )}
                              </div>
                            ) : (
                              <div className="dictation">
                                <div className="hint">
                                  先听当前句，
                                  然后把听到的英文写下来。
                                </div>

                                <button
                                  className="big-play"
                                  onClick={() =>
                                    playSentence(
                                      currentSentence
                                    )
                                  }
                                >
                                  ▶ 播放当前句
                                </button>

                                <textarea
                                  value={
                                    answer
                                  }
                                  onChange={(
                                    event
                                  ) => {
                                    setAnswer(
                                      event
                                        .target
                                        .value
                                    );

                                    setChecked(
                                      false
                                    );
                                  }}
                                  placeholder="输入你听到的英文……"
                                />

                                <button
                                  className="check-button"
                                  onClick={
                                    checkAnswer
                                  }
                                >
                                  检查答案
                                </button>

                                {checked && (
                                  <div className="answer-result">
                                    <strong>
                                      {isCorrect
                                        ? "✓ 完全正确"
                                        : "需要再听一遍"}
                                    </strong>

                                    {!isCorrect && (
                                      <p>
                                        参考答案：
                                        {
                                          sentence.text
                                        }
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="sentence-controls">
                            <button
                              className="secondary-button"
                              onClick={
                                previousSentence
                              }
                            >
                              ← 上一句
                            </button>

                            <button
                              className="play-button"
                              onClick={() =>
                                playSentence(
                                  currentSentence
                                )
                              }
                            >
                              ▶
                            </button>

                            <button
                              className="secondary-button"
                              onClick={
                                nextSentence
                              }
                            >
                              下一句 →
                            </button>

                            {page ===
                              "practice" && (
                              <button
                                className="secondary-button"
                                onClick={() =>
                                  setHideText(
                                    (value) =>
                                      !value
                                  )
                                }
                              >
                                {hideText
                                  ? "显示原文"
                                  : "隐藏原文"}
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>

                <aside className="card vocabulary-card">
                  <h3>
                    查生词
                  </h3>

                  {lookupLoading ? (
                    <div className="empty-vocabulary">
                      正在查询中文释义……
                    </div>
                  ) : lookup ? (
                    <>
                      <div
                        className="vocabulary-word"
                        style={{
                          fontSize: 28,
                          marginTop: 18,
                        }}
                      >
                        {lookup.word}
                      </div>

                      {lookup.phonetic && (
                        <div className="vocabulary-meaning">
                          {lookup.phonetic}
                        </div>
                      )}

                      {lookup.definitions?.length >
                      0 ? (
                        <div className="vocabulary-list">
                          {lookup.definitions.map(
                            (
                              item,
                              index
                            ) => (
                              <div
                                className="vocabulary-item"
                                key={
                                  index
                                }
                              >
                                <b>
                                  {
                                    item.partOfSpeech
                                  }
                                </b>

                                <div className="vocabulary-meaning">
                                  {
                                    item.chinese
                                  }
                                </div>

                                <small>
                                  {
                                    item.definition
                                  }
                                </small>

                                {item.example && (
                                  <div className="vocabulary-meaning">
                                    例句：
                                    {
                                      item.example
                                    }
                                  </div>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      ) : (
                        <p>
                          {lookup.meaning}
                        </p>
                      )}

                      <button
                        className="upload-button"
                        onClick={() =>
                          saveWord(
                            lookup.word,
                            lookup.meaning
                          )
                        }
                      >
                        ＋ 加入生词本
                      </button>
                    </>
                  ) : (
                    <div className="word-empty">
                      在上面的英文句子中，
                      <br />
                      点击任意单词即可查中文释义。
                    </div>
                  )}
                </aside>
              </div>
            </section>
          </>
        )}

        {page === "vocabulary" && (
          <section>
            <div className="hero">
              <div className="hero-eyebrow">
                MY VOCABULARY
              </div>

              <h2>我的生词本</h2>

              <p>
                收藏的单词会保存在当前浏览器。
              </p>
            </div>

            <div className="card vocabulary-card">
              {savedWords.length ===
              0 ? (
                <div className="empty-vocabulary">
                  还没有收藏生词。
                  <br />
                  去「精听」页面点击英文单词吧。
                </div>
              ) : (
                <div className="vocabulary-list">
                  {savedWords.map(
                    (item) => (
                      <div
                        className="vocabulary-item"
                        key={item.word}
                      >
                        <div>
                          <div className="vocabulary-word">
                            {item.word}
                          </div>

                          <div className="vocabulary-meaning">
                            {item.meaning ||
                              "暂无释义"}
                          </div>
                        </div>

                        <div className="word-actions">
                          <button
                            onClick={() =>
                              lookupWord(
                                item.word
                              )
                            }
                          >
                            查词
                          </button>

                          <button
                            onClick={() =>
                              setSavedWords(
                                (words) =>
                                  words.filter(
                                    (word) =>
                                      word.word !==
                                      item.word
                                  )
                              )
                            }
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {lookup && page === "vocabulary" && (
        <div className="dictionary-panel">
          <button
            className="dictionary-close"
            onClick={() =>
              setLookup(null)
            }
          >
            ×
          </button>

          <h3>
            {lookup.word}
          </h3>

          <p>
            {lookup.meaning}
          </p>
        </div>
      )}

      <footer>
        Listenly · 听着 · 英语精听学习工具
      </footer>
    </div>
  );
}
