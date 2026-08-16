import React, { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import "./style.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const STORAGE_KEY = "listenly-vocab-v3";

function splitSentences(text) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function cleanWord(word) {
  return word.toLowerCase().replace(/^[^a-z'-]+|[^a-z'-]+$/gi, "");
}

export default function App() {
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);
  const pdfInputRef = useRef(null);

  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [pdfFile, setPdfFile] = useState(null);
  const [documentText, setDocumentText] = useState("");
  const [sentences, setSentences] = useState([]);
  const [currentSentence, setCurrentSentence] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState("精听");
  const [showAnswer, setShowAnswer] = useState(true);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [message, setMessage] = useState("");
  const [vocab, setVocab] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [lookup, setLookup] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vocab));
  }, [vocab]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const progress = duration ? Math.min(100, (currentTime / duration) * 100) : 0;

  const currentSentenceText = sentences[currentSentence] || "";

  const estimatedStart = useMemo(() => {
    if (!duration || !sentences.length) return 0;
    const totalChars = sentences.reduce((n, s) => n + s.length, 0) || 1;
    const before = sentences.slice(0, currentSentence).reduce((n, s) => n + s.length, 0);
    return duration * (before / totalChars);
  }, [duration, sentences, currentSentence]);

  const estimatedEnd = useMemo(() => {
    if (!duration || !sentences.length) return 0;
    const totalChars = sentences.reduce((n, s) => n + s.length, 0) || 1;
    const before = sentences.slice(0, currentSentence + 1).reduce((n, s) => n + s.length, 0);
    return duration * (before / totalChars);
  }, [duration, sentences, currentSentence]);

  function handleAudio(file) {
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setMessage("请选择 MP3、WAV、M4A 等音频文件。");
      return;
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(file);
    setAudioFile(file);
    setAudioUrl(url);
    setCurrentTime(0);
    setCurrentSentence(0);
    setMessage("音频已加载，可以开始精听。");
  }

  async function handlePdf(file) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setMessage("请选择 PDF 文稿。");
      return;
    }

    setLoadingPdf(true);
    setMessage("正在读取 PDF 文稿……");
    setPdfFile(file);

    try {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      let fullText = "";

      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => item.str || "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        if (pageText) fullText += pageText + "\n";
      }

      const nextSentences = splitSentences(fullText);

      if (!nextSentences.length) {
        setDocumentText("");
        setSentences([]);
        setMessage("这个 PDF 没有检测到可复制的文字。它可能是扫描图片，需要 OCR 版本。");
      } else {
        setDocumentText(fullText);
        setSentences(nextSentences);
        setCurrentSentence(0);
        setMessage(`PDF 已读取：${pdf.numPages} 页，共 ${nextSentences.length} 句。`);
      }
    } catch (error) {
      console.error(error);
      setMessage("PDF 读取失败，请确认文件没有损坏。");
    } finally {
      setLoadingPdf(false);
    }
  }

  function togglePlay() {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  }

  function replaySentence() {
    if (!audioRef.current || !duration || !sentences.length) {
      setMessage("请先上传音频和 PDF 文稿。");
      return;
    }
    audioRef.current.currentTime = estimatedStart;
    audioRef.current.play().catch(() => {});
    setPlaying(true);
  }

  function nextSentence() {
    setCurrentSentence((i) => Math.min(sentences.length - 1, i + 1));
    setShowAnswer(mode !== "听写");
  }

  function prevSentence() {
    setCurrentSentence((i) => Math.max(0, i - 1));
  }

  function seekTo(value) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Number(value);
  }

  async function lookupWord(rawWord) {
    const word = cleanWord(rawWord);
    if (!word || word.length < 2) return;

    setLookupLoading(true);
    setLookup({ word });

    try {
      const [dictRes, transRes] = await Promise.all([
        fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`),
        fetch(
          `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
            word
          )}&langpair=en|zh-CN`
        ),
      ]);

      let definition = "";
      let phonetic = "";
      let translation = "";

      if (dictRes.ok) {
        const data = await dictRes.json();
        const entry = data?.[0];
        phonetic =
          entry?.phonetic ||
          entry?.phonetics?.find((p) => p.text)?.text ||
          "";
        definition =
          entry?.meanings?.[0]?.definitions?.[0]?.definition || "";
      }

      if (transRes.ok) {
        const data = await transRes.json();
        translation = data?.responseData?.translatedText || "";
      }

      setLookup({ word, phonetic, translation, definition });
    } catch (error) {
      console.error(error);
      setLookup({
        word,
        phonetic: "",
        translation: "暂时无法查询，请检查网络连接。",
        definition: "",
      });
    } finally {
      setLookupLoading(false);
    }
  }

  function addVocab() {
    if (!lookup?.word) return;
    if (vocab.some((v) => v.word === lookup.word)) return;
    setVocab((items) => [
      ...items,
      {
        word: lookup.word,
        translation: lookup.translation || "暂无中文释义",
        phonetic: lookup.phonetic || "",
        definition: lookup.definition || "",
        createdAt: Date.now(),
      },
    ]);
  }

  function removeVocab(word) {
    setVocab((items) => items.filter((v) => v.word !== word));
  }

  function renderSentence(text) {
    return text.split(/(\s+)/).map((part, index) => {
      if (/^\s+$/.test(part)) return part;
      const word = cleanWord(part);
      if (!word) return <span key={index}>{part}</span>;
      return (
        <button
          key={index}
          className="word"
          onClick={() => lookupWord(word)}
          title="点击查生词"
        >
          {part}
        </button>
      );
    });
  }

  function handleAudioTime() {
    const el = audioRef.current;
    if (!el) return;
    setCurrentTime(el.currentTime);

    if (sentences.length && duration) {
      const ratio = el.currentTime / duration;
      const totalChars = sentences.reduce((n, s) => n + s.length, 0) || 1;
      let accumulated = 0;
      const target = ratio * totalChars;

      for (let i = 0; i < sentences.length; i++) {
        accumulated += sentences[i].length;
        if (target <= accumulated) {
          setCurrentSentence(i);
          break;
        }
      }
    }
  }

  function handleAudioEnded() {
    setPlaying(false);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">L</span>
          <div>
            <strong>Listenly</strong>
            <small>英语精听学习室</small>
          </div>
        </div>

        <nav>
          <button className="nav-active">学习</button>
          <button onClick={() => setMode("精听")}>精听</button>
          <button onClick={() => setMode("听写")}>听写</button>
          <button onClick={() => setMode("生词本")}>生词本</button>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div>
            <span className="eyebrow">ENGLISH LISTENING LAB</span>
            <h1>听懂每一句，<em>真正学会英语。</em></h1>
            <p>上传音频和 PDF 文稿，逐句精听、听写、查生词，让一份学习材料真正被学会。</p>
          </div>
          <div className="hero-badge">
            <span>PDF</span>
            <span>+</span>
            <span>Audio</span>
          </div>
        </section>

        <section className="upload-grid">
          <div
            className="upload-card"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="upload-icon">🎧</div>
            <div>
              <h3>上传英语音频</h3>
              <p>MP3 · WAV · M4A</p>
              <small>{audioFile ? audioFile.name : "点击选择音频文件"}</small>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => handleAudio(e.target.files?.[0])}
            />
          </div>

          <div
            className="upload-card"
            onClick={() => pdfInputRef.current?.click()}
          >
            <div className="upload-icon">📄</div>
            <div>
              <h3>上传 PDF 文稿</h3>
              <p>直接上传，不需要转换 TXT</p>
              <small>{pdfFile ? pdfFile.name : "点击选择 PDF 文稿"}</small>
            </div>
            <input
              ref={pdfInputRef}
              type="file"
              accept=".pdf,application/pdf"
              hidden
              onChange={(e) => handlePdf(e.target.files?.[0])}
            />
          </div>
        </section>

        {message && <div className="message">{message}</div>}

        {(audioUrl || sentences.length > 0) && (
          <section className="workspace">
            <div className="player card">
              <div className="player-head">
                <div>
                  <span className="eyebrow">CURRENT MATERIAL</span>
                  <h2>{audioFile?.name || "尚未上传音频"}</h2>
                </div>
                <span className="pill">{sentences.length} 句</span>
              </div>

              <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={handleAudioTime}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={handleAudioEnded}
              />

              <div className="time-row">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>

              <input
                className="range"
                type="range"
                min="0"
                max={duration || 0}
                step="0.01"
                value={currentTime}
                style={{ "--progress": `${progress}%` }}
                onChange={(e) => seekTo(e.target.value)}
              />

              <div className="player-actions">
                <button className="round" onClick={togglePlay}>
                  {playing ? "Ⅱ" : "▶"}
                </button>
                <button className="secondary" onClick={replaySentence}>
                  ↻ 重听本句
                </button>
                <select
                  defaultValue="1"
                  onChange={(e) => {
                    if (audioRef.current) audioRef.current.playbackRate = Number(e.target.value);
                  }}
                >
                  <option value="0.75">0.75×</option>
                  <option value="1">1×</option>
                  <option value="1.25">1.25×</option>
                  <option value="1.5">1.5×</option>
                </select>
              </div>

              <div className="notice">
                当前逐句播放采用“按句子长度估算时间”。如果文稿以后提供时间戳，可升级为精准逐句定位。
              </div>
            </div>

            <div className="content-grid">
              <div className="transcript card">
                <div className="section-head">
                  <div className="tabs">
                    <button
                      className={mode === "精听" ? "active" : ""}
                      onClick={() => setMode("精听")}
                    >
                      精听
                    </button>
                    <button
                      className={mode === "听写" ? "active" : ""}
                      onClick={() => setMode("听写")}
                    >
                      听写
                    </button>
                    <button
                      className={mode === "文稿" ? "active" : ""}
                      onClick={() => setMode("文稿")}
                    >
                      完整文稿
                    </button>
                  </div>
                  <span>{loadingPdf ? "读取中…" : "点击单词可查词"}</span>
                </div>

                {mode === "文稿" ? (
                  <div className="full-document">
                    {documentText || "请先上传 PDF 文稿。"}
                  </div>
                ) : sentences.length ? (
                  <div className="sentence-list">
                    {sentences.map((sentence, index) => (
                      <button
                        key={index}
                        className={`sentence ${
                          index === currentSentence ? "current" : ""
                        }`}
                        onClick={() => {
                          setCurrentSentence(index);
                          setShowAnswer(mode !== "听写");
                        }}
                      >
                        <span className="sentence-number">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="sentence-text">
                          {mode === "听写" && index === currentSentence && !showAnswer
                            ? "点击「显示答案」查看原文"
                            : renderSentence(sentence)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <div>📄</div>
                    <h3>上传你的 PDF 文稿</h3>
                    <p>PDF 中的英文文字会自动提取并分句。</p>
                  </div>
                )}

                {mode === "听写" && sentences.length > 0 && (
                  <div className="dictation-panel">
                    <div>
                      <strong>第 {currentSentence + 1} 句</strong>
                      <p>先听音频，再在心里或纸上写下你听到的内容。</p>
                    </div>
                    <div className="dictation-actions">
                      <button className="secondary" onClick={replaySentence}>▶ 重听</button>
                      <button className="primary" onClick={() => setShowAnswer((v) => !v)}>
                        {showAnswer ? "隐藏答案" : "显示答案"}
                      </button>
                    </div>
                    {showAnswer && (
                      <div className="answer">{renderSentence(currentSentenceText)}</div>
                    )}
                    <div className="next-row">
                      <button className="secondary" onClick={prevSentence}>上一句</button>
                      <button className="primary" onClick={nextSentence}>下一句 →</button>
                    </div>
                  </div>
                )}
              </div>

              <aside className="sidebar">
                <div className="card vocab-card">
                  <div className="section-title">
                    <span>VOCABULARY</span>
                    <strong>生词本 {vocab.length}</strong>
                  </div>

                  {vocab.length ? (
                    <div className="vocab-list">
                      {vocab.map((item) => (
                        <div className="vocab-item" key={item.word}>
                          <div>
                            <strong>{item.word}</strong>
                            {item.phonetic && <small>{item.phonetic}</small>}
                            <p>{item.translation}</p>
                          </div>
                          <button onClick={() => removeVocab(item.word)}>✓</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-vocab">
                      点击文稿里的英文单词，就能查询并加入生词本。
                    </div>
                  )}
                </div>

                {lookup && (
                  <div className="card lookup-card">
                    <span className="eyebrow">WORD LOOKUP</span>
                    <h2>{lookup.word}</h2>
                    {lookup.phonetic && <div className="phonetic">{lookup.phonetic}</div>}

                    {lookupLoading ? (
                      <p>正在查询……</p>
                    ) : (
                      <>
                        <div className="translation">
                          {lookup.translation || "暂无中文释义"}
                        </div>
                        {lookup.definition && (
                          <div className="definition">{lookup.definition}</div>
                        )}
                        <button className="primary full" onClick={addVocab}>
                          ＋ 加入生词本
                        </button>
                      </>
                    )}
                  </div>
                )}
              </aside>
            </div>
          </section>
        )}

        <section className="steps">
          <div><b>01</b><span>上传音频</span></div>
          <div><b>02</b><span>上传 PDF</span></div>
          <div><b>03</b><span>逐句精听</span></div>
          <div><b>04</b><span>查词 & 复习</span></div>
        </section>
      </main>

      <footer>Listenly · 英语精听学习室</footer>
    </div>
  );
}
