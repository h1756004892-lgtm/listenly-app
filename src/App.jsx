import React, { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createClient } from "@supabase/supabase-js";
import "./style.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

const AUDIO_BUCKET = "listenly-audio";
const PDF_BUCKET = "listenly-pdf";

const DICT_API =
  "https://api.dictionaryapi.dev/api/v2/entries/en/";

const TRANSLATE_API =
  "https://api.mymemory.translated.net/get";

function splitSentences(text) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 1);
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanWord(word) {
  return word
    .toLowerCase()
    .replace(/^[^a-z'-]+|[^a-z'-]+$/gi, "");
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "00:00";

  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secondsPart = total % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    secondsPart
  ).padStart(2, "0")}`;
}

function similarity(a, b) {
  const aa = new Set(normalizeText(a).split(" ").filter(Boolean));
  const bb = new Set(normalizeText(b).split(" ").filter(Boolean));

  if (!aa.size || !bb.size) return 0;

  let same = 0;

  aa.forEach((word) => {
    if (bb.has(word)) same++;
  });

  return same / Math.max(aa.size, bb.size);
}

export default function App() {
  const audioRef = useRef(null);
  const audioInputRef = useRef(null);
  const pdfInputRef = useRef(null);

  const [page, setPage] = useState("library");

  const [materials, setMaterials] = useState([]);
  const [activeMaterial, setActiveMaterial] = useState(null);

  const [materialName, setMaterialName] = useState("");

  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState("");

  const [pdfFile, setPdfFile] = useState(null);
  const [pdfText, setPdfText] = useState("");

  const [sentences, setSentences] = useState([]);

  const [currentSentence, setCurrentSentence] = useState(0);

  const [playing, setPlaying] = useState(false);

  const [currentTime, setCurrentTime] = useState(0);

  const [duration, setDuration] = useState(0);

  const [speed, setSpeed] = useState(1);

  const [dictation, setDictation] = useState("");

  const [dictationChecked, setDictationChecked] =
    useState(false);

  const [lookup, setLookup] = useState(null);

  const [lookupLoading, setLookupLoading] =
    useState(false);

  const [vocabulary, setVocabulary] =
    useState([]);

  const [loading, setLoading] = useState(false);

  const [message, setMessage] = useState("");

  const [error, setError] = useState("");

  const currentSentenceText =
    sentences[currentSentence]?.text || "";

  useEffect(() => {
    loadMaterials();
    loadVocabulary();
  }, []);

  useEffect(() => {
    if (!audioRef.current) return;

    audioRef.current.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  async function loadMaterials() {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("materials")
      .select("*")
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error(error);
      return;
    }

    setMaterials(data || []);
  }

  async function loadVocabulary() {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("vocabulary")
      .select("*")
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error(error);
      return;
    }

    setVocabulary(data || []);
  }

  function notify(text) {
    setMessage(text);

    setTimeout(() => {
      setMessage("");
    }, 3000);
  }

  async function extractPdf(file) {
    setPdfFile(file);

    setLoading(true);
    setError("");

    try {
      const buffer = await file.arrayBuffer();

      const pdf =
        await pdfjsLib.getDocument({
          data: buffer,
        }).promise;

      let pages = [];

      for (
        let pageNumber = 1;
        pageNumber <= pdf.numPages;
        pageNumber++
      ) {
        const page =
          await pdf.getPage(pageNumber);

        const content =
          await page.getTextContent();

        const text = content.items
          .map((item) => item.str || "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        pages.push(text);
      }

      const fullText = pages.join("\n");

      /*
       * 很多 BBC Learning English PDF
       * 的结构是：
       *
       * Questions
       * Answers
       * Vocabulary
       * Transcript
       *
       * 所以优先截取 Transcript 后面的内容。
       */

      const transcriptIndex =
        fullText.toLowerCase().lastIndexOf(
          "transcript"
        );

      let transcript = fullText;

      if (transcriptIndex >= 0) {
        transcript = fullText
          .slice(transcriptIndex + 10)
          .trim();
      }

      /*
       * 去掉 PDF 页脚
       */
      transcript = transcript
        .replace(
          /The Listening Room ©British Broadcasting Corporation 2026/gi,
          ""
        )
        .replace(
          /bbclearningenglish\.com/gi,
          ""
        )
        .replace(
          /Page \d+ of \d+/gi,
          ""
        )
        .trim();

      const list =
        splitSentences(transcript);

      setPdfText(transcript);

      setSentences(
        list.map((text, index) => ({
          index,
          text,
          start_time: null,
          end_time: null,
          asr_text: "",
        }))
      );

      notify(
        `PDF 读取完成，共 ${list.length} 句`
      );
    } catch (err) {
      console.error(err);

      setError(
        "PDF 读取失败，请确认 PDF 是正常文件。"
      );
    } finally {
      setLoading(false);
    }
  }

  function selectAudio(file) {
    if (!file) return;

    if (!file.type.startsWith("audio/")) {
      setError(
        "请选择 MP3、WAV、M4A 等音频文件。"
      );
      return;
    }

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }

    const url =
      URL.createObjectURL(file);

    setAudioFile(file);
    setAudioUrl(url);

    notify("音频已加载");
  }

  /*
   * 重要：
   * 这里故意不自动播放。
   *
   * 用户按播放：
   *     播放
   *
   * 用户按暂停：
   *     停止
   *
   * 用户再按播放：
   *     从暂停位置继续
   *
   * 不会自动跳下一句。
   */

  async function playAudio() {
    if (!audioRef.current) {
      notify("请先上传音频");
      return;
    }

    try {
      await audioRef.current.play();
    } catch (err) {
      console.error(err);
      notify("播放失败");
    }
  }

  function pauseAudio() {
    if (!audioRef.current) return;

    audioRef.current.pause();
  }

  function togglePlay() {
    if (!audioRef.current) {
      notify("请先上传音频");
      return;
    }

    if (audioRef.current.paused) {
      playAudio();
    } else {
      pauseAudio();
    }
  }

  /*
   * 当前版本：
   * 如果已有真实 start_time/end_time，
   * 就严格按照真实时间播放。
   *
   * 没有时间戳时暂时不假装精准匹配。
   */

  function getSentenceRange(index) {
    const item = sentences[index];

    if (
      item &&
      Number.isFinite(item.start_time) &&
      Number.isFinite(item.end_time)
    ) {
      return {
        start: item.start_time,
        end: item.end_time,
      };
    }

    return null;
  }

  function replayCurrentSentence() {
    const range =
      getSentenceRange(
        currentSentence
      );

    if (!audioRef.current) {
      notify("请先上传音频");
      return;
    }

    if (!range) {
      notify(
        "当前句还没有真实音频时间戳，请完成音频匹配后再使用逐句播放。"
      );
      return;
    }

    audioRef.current.currentTime =
      range.start;

    audioRef.current.play().catch(() => {});
  }

  function goNextSentence() {
    setCurrentSentence((value) =>
      Math.min(
        sentences.length - 1,
        value + 1
      )
    );

    setDictation("");
    setDictationChecked(false);
  }

  function goPreviousSentence() {
    setCurrentSentence((value) =>
      Math.max(0, value - 1)
    );

    setDictation("");
    setDictationChecked(false);
  }

  /*
   * 如果有真实时间戳：
   * 播放到这一句结束时自动暂停。
   *
   * 但不会自动进入下一句。
   */

  function handleTimeUpdate() {
    const audio = audioRef.current;

    if (!audio) return;

    setCurrentTime(
      audio.currentTime
    );

    const range =
      getSentenceRange(
        currentSentence
      );

    if (
      range &&
      !audio.paused &&
      audio.currentTime >= range.end
    ) {
      audio.pause();

      audio.currentTime =
        range.end;
    }
  }

  function handleLoadedMetadata(event) {
    setDuration(
      event.currentTarget.duration || 0
    );
  }

  function handlePlay() {
    setPlaying(true);
  }

  function handlePause() {
    setPlaying(false);
  }

  async function lookupWord(rawWord) {
    const word =
      cleanWord(rawWord);

    if (!word || word.length < 2) {
      return;
    }

    setLookupLoading(true);

    setLookup({
      word,
      phonetic: "",
      partOfSpeech: "",
      definition: "",
      chineseMeaning: "",
      example: currentSentenceText,
    });

    try {
      const response =
        await fetch(
          `${DICT_API}${encodeURIComponent(
            word
          )}`
        );

      if (!response.ok) {
        throw new Error(
          "dictionary failed"
        );
      }

      const data =
        await response.json();

      const entry = data?.[0];

      const phonetic =
        entry?.phonetic ||
        entry?.phonetics?.find(
          (item) => item.text
        )?.text ||
        "";

      const meaning =
        entry?.meanings?.find(
          (item) =>
            item.definitions?.length
        );

      const definition =
        meaning?.definitions?.[0]
          ?.definition || "";

      const partOfSpeech =
        meaning?.partOfSpeech || "";

      let chineseMeaning = "";

      try {
        const params =
          new URLSearchParams({
            q: definition || word,
            langpair: "en|zh-CN",
          });

        const translationResponse =
          await fetch(
            `${TRANSLATE_API}?${params.toString()}`
          );

        if (
          translationResponse.ok
        ) {
          const translation =
            await translationResponse.json();

          chineseMeaning =
            translation
              ?.responseData
              ?.translatedText || "";
        }
      } catch (translationError) {
        console.error(
          translationError
        );
      }

      /*
       * 如果 PDF 本身有 Vocabulary，
       * 后面可以优先使用 PDF 的词汇解释。
       *
       * 当前先使用：
       * 英文词典定义
       * +
       * 中文翻译
       * +
       * 当前句语境
       */

      setLookup({
        word,
        phonetic,
        partOfSpeech,
        definition,
        chineseMeaning,
        example:
          currentSentenceText,
      });
    } catch (err) {
      console.error(err);

      setLookup({
        word,
        phonetic: "",
        partOfSpeech: "",
        definition: "",
        chineseMeaning:
          "暂时无法查询这个单词。",
        example:
          currentSentenceText,
      });
    } finally {
      setLookupLoading(false);
    }
  }

  async function saveVocabulary() {
    if (!lookup?.word) return;

    if (
      vocabulary.some(
        (item) =>
          item.word === lookup.word
      )
    ) {
      notify("这个单词已经在生词本里");
      return;
    }

    if (!supabase) {
      notify("Supabase 尚未连接");
      return;
    }

    const { data, error } =
      await supabase
        .from("vocabulary")
        .insert({
          word: lookup.word,
          phonetic:
            lookup.phonetic || "",
          part_of_speech:
            lookup.partOfSpeech || "",
          definition:
            lookup.definition || "",
          chinese_meaning:
            lookup.chineseMeaning ||
            "",
          example_sentence:
            lookup.example || "",
          material_id:
            activeMaterial?.id ||
            null,
        })
        .select()
        .single();

    if (error) {
      console.error(error);
      notify(
        "加入生词本失败"
      );
      return;
    }

    setVocabulary((items) => [
      data,
      ...items,
    ]);

    notify(
      `${lookup.word} 已加入生词本`
    );
  }

  async function deleteVocabulary(id) {
    if (!supabase) return;

    await supabase
      .from("vocabulary")
      .delete()
      .eq("id", id);

    setVocabulary((items) =>
      items.filter(
        (item) =>
          item.id !== id
      )
    );
  }

  async function createMaterial() {
    if (!materialName.trim()) {
      setError(
        "请先给这份听力材料命名。"
      );
      return;
    }

    if (!audioFile) {
      setError(
        "请先上传音频。"
      );
      return;
    }

    if (!pdfFile) {
      setError(
        "请先上传 PDF 文稿。"
      );
      return;
    }

    if (!supabase) {
      setError(
        "Supabase 连接没有配置成功。"
      );
      return;
    }

    setLoading(true);
    setError("");

    try {
      const materialId =
        crypto.randomUUID();

      /*
       * 这里先创建材料记录。
       *
       * 下一步建立 Storage Bucket 后，
       * 再把 audioFile / pdfFile 真正上传到
       * Supabase Storage。
       */

      const { data, error } =
        await supabase
          .from("materials")
          .insert({
            id: materialId,
            name:
              materialName.trim(),
            audio_filename:
              audioFile.name,
            pdf_filename:
              pdfFile.name,
            transcript:
              pdfText,
            segments:
              sentences,
            current_segment: 0,
            progress: 0,
          })
          .select()
          .single();

      if (error) {
        console.error(error);

        throw error;
      }

      setMaterials((items) => [
        data,
        ...items,
      ]);

      setActiveMaterial(data);

      notify(
        "学习材料已经建立"
      );

      setPage("practice");
    } catch (err) {
      console.error(err);

      setError(
        "材料保存失败，请检查 Supabase 连接。"
      );
    } finally {
      setLoading(false);
    }
  }

  async function openMaterial(material) {
    setActiveMaterial(material);

    const savedSentences =
      Array.isArray(
        material.segments
      )
        ? material.segments
        : [];

    setSentences(
      savedSentences.map(
        (item, index) => ({
          ...item,
          index,
        })
      )
    );

    setPdfText(
      material.transcript || ""
    );

    setMaterialName(
      material.name || ""
    );

    setCurrentSentence(
      material.current_segment || 0
    );

    /*
     * 这里以后从 Supabase Storage
     * 获取真正保存的音频 URL。
     */

    setPage("practice");

    notify(
      `已打开：${material.name}`
    );
  }

  function renderWords(text) {
    return text
      .split(/(\s+)/)
      .map((part, index) => {
        if (/^\s+$/.test(part)) {
          return (
            <span key={index}>
              {part}
            </span>
          );
        }

        const word =
          cleanWord(part);

        if (!word) {
          return (
            <span key={index}>
              {part}
            </span>
          );
        }

        return (
          <button
            key={index}
            className="word"
            onClick={() =>
              lookupWord(word)
            }
          >
            {part}
          </button>
        );
      });
  }

  const progress =
    duration > 0
      ? Math.min(
          100,
          (currentTime /
            duration) *
            100
        )
      : 0;

  const currentRange =
    getSentenceRange(
      currentSentence
    );

  return (
    <div className="app">
      {message && (
        <div className="toast">
          {message}
        </div>
      )}

      <header className="topbar">
        <button
          className="brand"
          onClick={() =>
            setPage("library")
          }
        >
          <span className="brand-logo">
            L
          </span>

          <span>
            <strong>
              Listenly
            </strong>

            <small>
              英语精听学习室
            </small>
          </span>
        </button>

        <nav>
          <button
            className={
              page === "library"
                ? "active"
                : ""
            }
            onClick={() =>
              setPage("library")
            }
          >
            我的听力
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
        {page === "library" && (
          <>
            <section className="hero">
              <span className="eyebrow">
                ENGLISH LISTENING LAB
              </span>

              <h1>
                听懂每一句，
                <br />
                <em>
                  真正学会英语。
                </em>
              </h1>

              <p>
                上传音频和 PDF
                文稿，建立属于自己的英语精听资料库。
              </p>
            </section>

            <section className="card create-card">
              <h2>
                新建听力材料
              </h2>

              <p className="sub">
                一份音频 + 一份 PDF
                文稿 = 一个完整学习材料
              </p>

              <input
                className="name-input"
                value={materialName}
                onChange={(event) =>
                  setMaterialName(
                    event.target.value
                  )
                }
                placeholder="给这份材料起个名字，例如：BBC｜咖啡脱咖啡因"
              />

              <div className="upload-grid">
                <button
                  className="upload-box"
                  onClick={() =>
                    audioInputRef.current?.click()
                  }
                >
                  <span>
                    🎧
                  </span>

                  <strong>
                    {audioFile
                      ? audioFile.name
                      : "上传英语音频"}
                  </strong>

                  <small>
                    MP3 · WAV · M4A
                  </small>
                </button>

                <button
                  className="upload-box"
                  onClick={() =>
                    pdfInputRef.current?.click()
                  }
                >
                  <span>
                    📄
                  </span>

                  <strong>
                    {pdfFile
                      ? pdfFile.name
                      : "上传 PDF 文稿"}
                  </strong>

                  <small>
                    自动寻找 Transcript
                  </small>
                </button>
              </div>

              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                hidden
                onChange={(event) =>
                  selectAudio(
                    event.target.files?.[0]
                  )
                }
              />

              <input
                ref={pdfInputRef}
                type="file"
                accept=".pdf,application/pdf"
                hidden
                onChange={(event) =>
                  extractPdf(
                    event.target.files?.[0]
                  )
                }
              />

              {loading && (
                <div className="loading">
                  正在处理……
                </div>
              )}

              {error && (
                <div className="error">
                  {error}
                </div>
              )}

              <button
                className="primary large"
                onClick={
                  createMaterial
                }
                disabled={loading}
              >
                保存到我的听力 →
              </button>
            </section>

            <section className="library-section">
              <div className="section-title">
                <div>
                  <span className="eyebrow">
                    MY LISTENING
                  </span>

                  <h2>
                    我的听力
                  </h2>
                </div>

                <span>
                  {materials.length} 个材料
                </span>
              </div>

              {materials.length === 0 ? (
                <div className="card empty-library">
                  <div>
                    🎧
                  </div>

                  <h3>
                    还没有学习材料
                  </h3>

                  <p>
                    上传你的第一份音频和 PDF
                    吧。
                  </p>
                </div>
              ) : (
                <div className="material-grid">
                  {materials.map(
                    (material) => (
                      <button
                        key={
                          material.id
                        }
                        className="material-card"
                        onClick={() =>
                          openMaterial(
                            material
                          )
                        }
                      >
                        <div className="material-icon">
                          🎧
                        </div>

                        <div>
                          <h3>
                            {
                              material.name
                            }
                          </h3>

                          <p>
                            {
                              material.audio_filename
                            }
                          </p>

                          <small>
                            {
                              material.pdf_filename
                            }
                          </small>
                        </div>

                        <span>
                          →
                        </span>
                      </button>
                    )
                  )}
                </div>
              )}
            </section>
          </>
        )}

        {(page === "practice" ||
          page === "dictation") && (
          <>
            <section className="workspace-head">
              <button
                className="back"
                onClick={() =>
                  setPage("library")
                }
              >
                ← 我的听力
              </button>

              <span className="eyebrow">
                LISTENING PRACTICE
              </span>

              <h1>
                {activeMaterial?.name ||
                  materialName ||
                  "精听"}
              </h1>
            </section>

            <section className="card player-card">
              <audio
                ref={audioRef}
                src={audioUrl}
                onLoadedMetadata={
                  handleLoadedMetadata
                }
                onTimeUpdate={
                  handleTimeUpdate
                }
                onPlay={handlePlay}
                onPause={handlePause}
              />

              <div className="player-title">
                <div>
                  <span>
                    当前材料
                  </span>

                  <strong>
                    {activeMaterial?.name ||
                      materialName}
                  </strong>
                </div>

                <span>
                  {sentences.length} 句
                </span>
              </div>

              <div className="time">
                <span>
                  {formatTime(
                    currentTime
                  )}
                </span>

                <span>
                  {formatTime(
                    duration
                  )}
                </span>
              </div>

              <input
                className="progress"
                type="range"
                min="0"
                max={
                  duration || 0
                }
                value={
                  currentTime
                }
                step="0.01"
                style={{
                  "--progress": `${progress}%`,
                }}
                onChange={(event) => {
                  if (
                    audioRef.current
                  ) {
                    audioRef.current.currentTime =
                      Number(
                        event.target
                          .value
                      );
                  }
                }}
              />

              <div className="player-controls">
                <button
                  className="primary round"
                  onClick={
                    togglePlay
                  }
                >
                  {playing
                    ? "Ⅱ"
                    : "▶"}
                </button>

                <button
                  className="secondary"
                  onClick={
                    replayCurrentSentence
                  }
                >
                  ↻ 重播本句
                </button>

                <button
                  className="secondary"
                  onClick={
                    goPreviousSentence
                  }
                >
                  ← 上一句
                </button>

                <button
                  className="secondary"
                  onClick={
                    goNextSentence
                  }
                >
                  下一句 →
                </button>

                <select
                  value={speed}
                  onChange={(event) =>
                    setSpeed(
                      Number(
                        event.target
                          .value
                      )
                    )
                  }
                >
                  <option value="0.75">
                    0.75×
                  </option>

                  <option value="1">
                    1×
                  </option>

                  <option value="1.25">
                    1.25×
                  </option>

                  <option value="1.5">
                    1.5×
                  </option>
                </select>
              </div>

              <div className="player-tip">
                {currentRange
                  ? "当前句已经有真实时间轴：播放到句尾会自动暂停；不会自动跳到下一句。"
                  : "当前材料还没有真实时间轴。完成音频识别与文稿匹配后，才能精准逐句播放。"}
              </div>
            </section>

            <div className="practice-grid">
              <section className="card transcript-card">
                <div className="tabs">
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
                  <div className="empty">
                    没有检测到 Transcript。
                  </div>
                ) : (
                  <div className="sentences">
                    {sentences.map(
                      (
                        item,
                        index
                      ) => (
                        <button
                          key={
                            index
                          }
                          className={`sentence ${
                            index ===
                            currentSentence
                              ? "current"
                              : ""
                          }`}
                          onClick={() => {
                            setCurrentSentence(
                              index
                            );

                            setDictation(
                              ""
                            );

                            setDictationChecked(
                              false
                            );

                            const range =
                              getSentenceRange(
                                index
                              );

                            if (
                              range &&
                              audioRef.current
                            ) {
                              audioRef.current.currentTime =
                                range.start;
                            }
                          }}
                        >
                          <span>
                            {String(
                              index +
                                1
                            ).padStart(
                              2,
                              "0"
                            )}
                          </span>

                          <p>
                            {renderWords(
                              item.text
                            )}
                          </p>
                        </button>
                      )
                    )}
                  </div>
                )}

                {page ===
                  "dictation" &&
                  currentSentenceText && (
                    <div className="dictation">
                      <span className="eyebrow">
                        DICTATION
                      </span>

                      <h3>
                        第{" "}
                        {currentSentence +
                          1}{" "}
                        句
                      </h3>

                      <p>
                        先播放当前句，再输入你听到的英文。
                      </p>

                      <textarea
                        value={
                          dictation
                        }
                        onChange={(
                          event
                        ) => {
                          setDictation(
                            event
                              .target
                              .value
                          );

                          setDictationChecked(
                            false
                          );
                        }}
                        placeholder="输入你听到的英文……"
                      />

                      <button
                        className="primary"
                        onClick={() =>
                          setDictationChecked(
                            true
                          )
                        }
                      >
                        检查答案
                      </button>

                      {dictationChecked && (
                        <div className="result">
                          <strong>
                            {normalizeText(
                              dictation
                            ) ===
                            normalizeText(
                              currentSentenceText
                            )
                              ? "✓ 完全正确"
                              : "再听一次"}
                          </strong>

                          <p>
                            正确答案：
                            {
                              currentSentenceText
                            }
                          </p>
                        </div>
                      )}
                    </div>
                  )}
              </section>

              <aside>
                {lookup ? (
                  <section className="card lookup">
                    <span className="eyebrow">
                      WORD LOOKUP
                    </span>

                    <h2>
                      {lookup.word}
                    </h2>

                    {lookup.phonetic && (
                      <div className="phonetic">
                        {
                          lookup.phonetic
                        }
                      </div>
                    )}

                    {lookupLoading ? (
                      <p>
                        正在查询……
                      </p>
                    ) : (
                      <>
                        <div className="chinese">
                          {lookup.chineseMeaning ||
                            "暂无中文释义"}
                        </div>

                        {lookup.partOfSpeech && (
                          <div className="pos">
                            {
                              lookup.partOfSpeech
                            }
                          </div>
                        )}

                        <p className="definition">
                          {
                            lookup.definition
                          }
                        </p>

                        <div className="context">
                          <span>
                            原文语境
                          </span>

                          <p>
                            {
                              lookup.example
                            }
                          </p>
                        </div>

                        <button
                          className="primary full"
                          onClick={
                            saveVocabulary
                          }
                        >
                          ＋ 加入生词本
                        </button>
                      </>
                    )}
                  </section>
                ) : (
                  <section className="card lookup-empty">
                    <span className="eyebrow">
                      WORD LOOKUP
                    </span>

                    <h3>
                      点击句子里的英文单词
                    </h3>

                    <p>
                      查看音标、词性、英文定义和中文释义。
                    </p>
                  </section>
                )}

                <section className="card mini-vocab">
                  <div className="mini-title">
                    <span>
                      VOCABULARY
                    </span>

                    <button
                      onClick={() =>
                        setPage(
                          "vocabulary"
                        )
                      }
                    >
                      查看全部 →
                    </button>
                  </div>

                  {vocabulary
                    .slice(0, 5)
                    .map((item) => (
                      <div
                        className="mini-word"
                        key={
                          item.id
                        }
                      >
                        <strong>
                          {
                            item.word
                          }
                        </strong>

                        <span>
                          {
                            item.chinese_meaning
                          }
                        </span>
                      </div>
                    ))}
                </section>
              </aside>
            </div>
          </>
        )}

        {page ===
          "vocabulary" && (
          <>
            <section className="workspace-head">
              <span className="eyebrow">
                MY VOCABULARY
              </span>

              <h1>
                我的生词本
              </h1>

              <p>
                所有收藏的单词都会保存到 Supabase。
              </p>
            </section>

            <section className="card vocab-page">
              {vocabulary.length ===
              0 ? (
                <div className="empty">
                  还没有生词。
                </div>
              ) : (
                vocabulary.map(
                  (item) => (
                    <div
                      className="vocab-row"
                      key={item.id}
                    >
                      <div>
                        <h3>
                          {
                            item.word
                          }
                        </h3>

                        <small>
                          {
                            item.phonetic
                          }
                        </small>

                        <p>
                          {
                            item.chinese_meaning
                          }
                        </p>

                        <span>
                          {
                            item.definition
                          }
                        </span>
                      </div>

                      <button
                        className="secondary"
                        onClick={() =>
                          deleteVocabulary(
                            item.id
                          )
                        }
                      >
                        删除
                      </button>
                    </div>
                  )
                )
              )}
            </section>
          </>
        )}
      </main>

      <footer>
        Listenly · 英语精听学习室
      </footer>
    </div>
  );
}
