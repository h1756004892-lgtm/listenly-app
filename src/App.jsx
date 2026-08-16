import React, { useEffect, useMemo, useRef, useState } from "react";

const DICT_API = "https://api.dictionaryapi.dev/api/v2/entries/en/";

function splitTranscript(text) {
  const cleaned = text.replace(/\r/g, "").trim();
  if (!cleaned) return [];
  // 支持 [00:00] sentence / [00:00-00:05] sentence 这类带时间标记的文稿
  const lines = cleaned.split("\n").map(s => s.trim()).filter(Boolean);
  const timestamped = lines.map((line) => {
    const m = line.match(/^\[(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?\]\s*(.*)$/);
    if (!m) return null;
    const start = Number(m[1]) * 60 + Number(m[2]);
    const end = m[3] ? Number(m[3]) * 60 + Number(m[4]) : null;
    return { text: m[5], start, end };
  });
  if (timestamped.every(Boolean)) return timestamped;

  return cleaned
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?。！？])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(text => ({ text, start: null, end: null }));
}

function formatTime(sec) {
  if (!Number.isFinite(sec)) return "00:00";
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function normalize(s) {
  return s.toLowerCase().replace(/[“”"'.,!?;:()[\]{}]/g, "").replace(/\s+/g, " ").trim();
}

function tokenize(text) {
  return text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];
}

export default function App() {
  const audioRef = useRef(null);
  const fileAudioRef = useRef(null);
  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [transcriptFile, setTranscriptFile] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [sentences, setSentences] = useState([]);
  const [current, setCurrent] = useState(0);
  const [mode, setMode] = useState("listen");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [hideText, setHideText] = useState(false);
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState(false);
  const [savedWords, setSavedWords] = useState(() => {
    try { return JSON.parse(localStorage.getItem("listenly-vocab") || "[]"); } catch { return []; }
  });
  const [lookup, setLookup] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [page, setPage] = useState("home");
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioTime, setAudioTime] = useState(0);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    localStorage.setItem("listenly-vocab", JSON.stringify(savedWords));
  }, [savedWords]);

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setAudioTime(audio.currentTime);
    const onMeta = () => setAudioDuration(audio.duration || 0);
    const onEnd = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnd);
    };
  }, [audioUrl]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const sentence = sentences[current] || null;

  const estimatedRange = useMemo(() => {
    if (!sentence || !audioDuration) return null;
    if (sentence.start != null) {
      const end = sentence.end != null ? sentence.end : Math.min(audioDuration, sentence.start + 8);
      return { start: sentence.start, end };
    }
    const totalChars = sentences.reduce((a, s) => a + s.text.length, 0) || 1;
    const before = sentences.slice(0, current).reduce((a, s) => a + s.text.length, 0);
    const start = audioDuration * before / totalChars;
    const end = audioDuration * (before + sentence.text.length) / totalChars;
    return { start, end };
  }, [sentence, sentences, current, audioDuration]);

  const chooseAudio = (file) => {
    if (!file) return;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(file);
    setAudioFile(file);
    setAudioUrl(url);
    setNotice("音频已载入");
  };

  const chooseTranscript = async (file) => {
    if (!file) return;
    const text = await file.text();
    const list = splitTranscript(text);
    setTranscriptFile(file);
    setTranscript(text);
    setSentences(list);
    setCurrent(0);
    setNotice(`已载入 ${list.length} 句文稿`);
    setPage("practice");
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setNotice("请先选择音频文件");
    }
  };

  const playSentence = async (index = current) => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) {
      setNotice("请先上传音频");
      return;
    }
    const s = sentences[index];
    if (!s) return;
    setCurrent(index);
    const range = (() => {
      if (s.start != null) return { start: s.start, end: s.end ?? Math.min(audioDuration, s.start + 8) };
      const total = sentences.reduce((a, x) => a + x.text.length, 0) || 1;
      const before = sentences.slice(0, index).reduce((a, x) => a + x.text.length, 0);
      return { start: audioDuration * before / total, end: audioDuration * (before + s.text.length) / total };
    })();
    audio.currentTime = Math.max(0, range.start);
    audio.playbackRate = speed;
    await audio.play();
    setPlaying(true);
    const stopAt = () => {
      if (audio.currentTime >= range.end - 0.05) {
        audio.pause();
        setPlaying(false);
        audio.removeEventListener("timeupdate", stopAt);
      }
    };
    audio.addEventListener("timeupdate", stopAt);
  };

  const checkAnswer = () => setChecked(true);

  const addWord = (word, meaning = "") => {
    const clean = word.toLowerCase();
    if (!clean) return;
    setSavedWords(prev => prev.some(x => x.word === clean) ? prev : [{ word: clean, meaning, addedAt: Date.now() }, ...prev]);
  };

  const lookupWord = async (word) => {
    const clean = word.toLowerCase();
    if (!clean) return;
    setLookupLoading(true);
    setLookup({ word: clean, meaning: "查询中……", phonetic: "", examples: [] });
    try {
      const res = await fetch(`${DICT_API}${encodeURIComponent(clean)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const entry = data[0];
      const meanings = entry?.meanings || [];
      const defs = meanings.flatMap(m => (m.definitions || []).slice(0, 2).map(d => ({
        partOfSpeech: m.partOfSpeech,
        definition: d.definition,
        example: d.example || ""
      }))).slice(0, 5);
      setLookup({ word: clean, phonetic: entry?.phonetic || entry?.phonetics?.find(p => p.text)?.text || "", meaning: defs[0]?.definition || "暂无释义", definitions: defs });
    } catch {
      setLookup({ word: clean, meaning: "暂时查不到释义。你可以先收藏，稍后再查。", phonetic: "", definitions: [] });
    } finally {
      setLookupLoading(false);
    }
  };

  const compare = checked && sentence ? normalize(answer) === normalize(sentence.text) : null;

  const renderClickableText = (text) => {
    return tokenize(text).map((word, i) => (
      <button key={`${word}-${i}`} className="word" onClick={() => lookupWord(word)} title="点击查词">
        {word}
      </button>
    ));
  };

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setPage("home")}>LISTENLY<span>听着</span></button>
        <nav>
          <button className={page === "home" ? "active" : ""} onClick={() => setPage("home")}>首页</button>
          <button className={page === "practice" ? "active" : ""} onClick={() => setPage("practice")}>精听</button>
          <button className={page === "dictation" ? "active" : ""} onClick={() => setPage("dictation")}>听写</button>
          <button className={page === "vocab" ? "active" : ""} onClick={() => setPage("vocab")}>生词本</button>
        </nav>
      </header>

      {notice && <div className="notice" onClick={() => setNotice("")}>{notice}</div>}

      <main>
        {page === "home" && (
          <section className="hero">
            <div className="eyebrow">ENGLISH LISTENING LAB</div>
            <h1>听懂每一句，<br/><em>真正学会英语。</em></h1>
            <p className="lead">上传音频和文稿，进入逐句精听、听写与生词学习。</p>

            <div className="upload-grid">
              <label className="upload-card">
                <input type="file" accept="audio/*,.mp3,.wav,.m4a" onChange={e => chooseAudio(e.target.files?.[0])}/>
                <span className="upload-icon">♪</span>
                <strong>上传音频</strong>
                <small>{audioFile ? audioFile.name : "MP3 / WAV / M4A"}</small>
              </label>
              <label className="upload-card">
                <input type="file" accept=".txt,.md,.text" onChange={e => chooseTranscript(e.target.files?.[0])}/>
                <span className="upload-icon">Aa</span>
                <strong>上传文稿</strong>
                <small>{transcriptFile ? transcriptFile.name : "TXT 文稿，支持逐句或时间戳"}</small>
              </label>
            </div>

            <div className="tip">
              <b>使用方式</b>
              <span>先上传音频，再上传对应文稿 → 进入「精听」逐句练习 → 点击单词查中文释义 → 切换「听写」检验听力。</span>
            </div>
          </section>
        )}

        {(page === "practice" || page === "dictation") && (
          <section className="practice">
            <div className="page-title">
              <div>
                <div className="eyebrow">LISTENING PRACTICE</div>
                <h2>{page === "practice" ? "精听练习" : "听写训练"}</h2>
              </div>
              <div className="file-status">
                {audioFile ? `音频：${audioFile.name}` : "未上传音频"}<br/>
                {transcriptFile ? `文稿：${transcriptFile.name}` : "未上传文稿"}
              </div>
            </div>

            <div className="player-card">
              <audio ref={audioRef} src={audioUrl} onLoadedMetadata={e => setAudioDuration(e.currentTarget.duration)} />
              <div className="time-row"><span>{formatTime(audioTime)}</span><span>{formatTime(audioDuration)}</span></div>
              <input className="seek" type="range" min="0" max={audioDuration || 0} step="0.1" value={audioTime} onChange={e => { if (audioRef.current) audioRef.current.currentTime = Number(e.target.value); }} />
              <div className="player-controls">
                <button className="circle" onClick={togglePlay}>{playing ? "Ⅱ" : "▶"}</button>
                <button onClick={() => playSentence(current)}>↻ 重播本句</button>
                <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
                  <option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option>
                </select>
              </div>
            </div>

            <div className="workspace">
              <div className="sentence-panel">
                <div className="tabs">
                  <button className={page === "practice" ? "selected" : ""} onClick={() => setPage("practice")}>精听</button>
                  <button className={page === "dictation" ? "selected" : ""} onClick={() => setPage("dictation")}>听写</button>
                </div>

                {sentences.length === 0 ? (
                  <div className="empty">请先回到首页上传 TXT 文稿。</div>
                ) : page === "practice" ? (
                  <>
                    <div className="sentence-index">第 {current + 1} / {sentences.length} 句</div>
                    <div className={`sentence ${hideText ? "hidden" : ""}`}>
                      {hideText ? "••• 点击“显示原文”查看句子 •••" : renderClickableText(sentence.text)}
                    </div>
                    <div className="sentence-actions">
                      <button onClick={() => playSentence(current)}>▶ 播放本句</button>
                      <button onClick={() => { setCurrent(Math.max(0, current - 1)); setChecked(false); }}>← 上一句</button>
                      <button onClick={() => { setCurrent(Math.min(sentences.length - 1, current + 1)); setChecked(false); }}>下一句 →</button>
                      <button className="ghost" onClick={() => setHideText(v => !v)}>{hideText ? "显示原文" : "隐藏原文"}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="sentence-index">听写第 {current + 1} / {sentences.length} 句</div>
                    <p className="hint">先播放本句，不看原文，把你听到的内容输入下面。</p>
                    <button className="big-play" onClick={() => playSentence(current)}>▶ 播放本句</button>
                    <textarea value={answer} onChange={e => { setAnswer(e.target.value); setChecked(false); }} placeholder="输入你听到的英文……" />
                    <div className="sentence-actions">
                      <button onClick={checkAnswer}>检查答案</button>
                      <button onClick={() => { setCurrent(Math.min(sentences.length - 1, current + 1)); setAnswer(""); setChecked(false); }}>下一句 →</button>
                    </div>
                    {checked && (
                      <div className={`result ${compare ? "good" : "bad"}`}>
                        <strong>{compare ? "✓ 完全正确" : "需要再听一遍"}</strong>
                        {!compare && <p>参考答案：{sentence.text}</p>}
                      </div>
                    )}
                  </>
                )}
              </div>

              <aside className="word-panel">
                <div className="eyebrow">VOCABULARY</div>
                {lookup ? (
                  <div className="lookup">
                    <div className="lookup-word">{lookup.word}</div>
                    <div className="phonetic">{lookup.phonetic}</div>
                    {lookup.definitions?.map((d, i) => <div className="definition" key={i}><b>{d.partOfSpeech}</b><span>{d.definition}</span>{d.example && <small>{d.example}</small>}</div>)}
                    <button className="save-word" onClick={() => addWord(lookup.word, lookup.meaning)}>＋ 加入生词本</button>
                  </div>
                ) : (
                  <div className="word-empty">点击句子里的英文单词即可查询中文释义。</div>
                )}
              </aside>
            </div>
          </section>
        )}

        {page === "vocab" && (
          <section className="vocab-page">
            <div className="eyebrow">MY VOCABULARY</div>
            <h2>生词本</h2>
            <p>收藏的单词会保存在当前浏览器中。</p>
            {savedWords.length === 0 ? <div className="empty">还没有收藏单词。去「精听」里点击单词吧。</div> :
              <div className="vocab-list">{savedWords.map(item => (
                <div className="vocab-item" key={item.word}>
                  <div><strong>{item.word}</strong><span>{item.meaning}</span></div>
                  <button onClick={() => lookupWord(item.word)}>查词</button>
                  <button className="remove" onClick={() => setSavedWords(v => v.filter(x => x.word !== item.word))}>删除</button>
                </div>
              ))}</div>}
          </section>
        )}
      </main>

      <footer>Listenly · 听着 · 浏览器本地学习工具</footer>
    </div>
  );
}
