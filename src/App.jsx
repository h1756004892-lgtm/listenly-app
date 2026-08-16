import React, { useEffect, useRef, useState } from "react";

export default function App() {
  const audioRef = useRef(null);
  const [file, setFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState("listen");
  const [answer, setAnswer] = useState("");
  const [savedWords, setSavedWords] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("listenly-vocabulary") || "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("listenly-vocabulary", JSON.stringify(savedWords));
  }, [savedWords]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  function handleUpload(selectedFile) {
    if (!selectedFile) return;

    const valid = /\.(mp3|wav|m4a|webm)$/i.test(selectedFile.name);
    if (!valid) {
      alert("Please upload an MP3, WAV, M4A, or WebM audio file.");
      return;
    }

    if (audioUrl) URL.revokeObjectURL(audioUrl);

    setFile(selectedFile);
    setAudioUrl(URL.createObjectURL(selectedFile));
    setCurrentTime(0);
    setPlaying(false);
  }

  function togglePlay() {
    if (!audioRef.current) return;

    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  }

  function replay() {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
  }

  function changeSpeed(value) {
    const next = Number(value);
    setSpeed(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  }

  function formatTime(value) {
    const seconds = Number.isFinite(value) ? value : 0;
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function saveWord(word) {
    setSavedWords((old) => old.includes(word) ? old : [...old, word]);
  }

  function removeWord(word) {
    setSavedWords((old) => old.filter((item) => item !== word));
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="logo" href="#home">LISTENLY</a>
        <nav>
          <a href="#home">Home</a>
          <a href="#listening">Listening</a>
          <a href="#vocabulary">Vocabulary ({savedWords.length})</a>
        </nav>
      </header>

      <main>
        <section id="home" className="hero">
          <div className="eyebrow">ENGLISH LISTENING LAB</div>
          <h1>Listen.<br /><em>Write.</em> Understand.</h1>
          <p>
            Upload your English audio and turn it into a focused listening
            practice session.
          </p>

          <label className="upload-box">
            <input
              type="file"
              accept=".mp3,.wav,.m4a,.webm,audio/*"
              onChange={(event) => handleUpload(event.target.files?.[0])}
            />
            <span className="upload-icon">↑</span>
            <strong>Drop your audio here</strong>
            <small>or click to browse · MP3 · WAV · M4A</small>
          </label>
        </section>

        <section id="listening" className="section">
          <div className="section-label">LISTENING LAB</div>
          <h2>{file ? file.name : "No audio uploaded yet"}</h2>

          {file ? (
            <>
              <div className="player-card">
                <audio
                  ref={audioRef}
                  src={audioUrl}
                  onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
                  onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                />

                <div className="time-row">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>

                <input
                  className="progress"
                  type="range"
                  min="0"
                  max={duration || 0}
                  step="0.01"
                  value={currentTime}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setCurrentTime(next);
                    if (audioRef.current) audioRef.current.currentTime = next;
                  }}
                />

                <div className="controls">
                  <button className="round primary-round" onClick={togglePlay}>
                    {playing ? "Ⅱ" : "▶"}
                  </button>
                  <button className="control-button" onClick={replay}>↻ Replay</button>
                  <select value={speed} onChange={(event) => changeSpeed(event.target.value)}>
                    <option value="0.8">0.8×</option>
                    <option value="1">1×</option>
                    <option value="1.2">1.2×</option>
                    <option value="1.5">1.5×</option>
                  </select>
                </div>
              </div>

              <div className="practice-grid">
                <article className="practice-card">
                  <div className="mode-tabs">
                    <button className={mode === "listen" ? "active" : ""} onClick={() => setMode("listen")}>
                      Listening
                    </button>
                    <button className={mode === "dictation" ? "active" : ""} onClick={() => setMode("dictation")}>
                      Dictation
                    </button>
                  </div>

                  {mode === "listen" ? (
                    <div className="empty-transcript">
                      <div className="empty-icon">Aa</div>
                      <h3>Transcript ready for speech recognition</h3>
                      <p>
                        Your uploaded audio is playing from the real file above.
                        The next development step is to connect speech-to-text so
                        Listenly can generate real sentences and timestamps from it.
                      </p>
                    </div>
                  ) : (
                    <div className="dictation">
                      <h3>Write what you hear.</h3>
                      <p>Play the audio, then type the sentence you hear.</p>
                      <textarea
                        value={answer}
                        onChange={(event) => setAnswer(event.target.value)}
                        placeholder="Type what you hear..."
                      />
                      <button className="check-button" onClick={() => alert("Dictation UI is ready. Real transcript checking will be connected after speech recognition.")}>
                        Check answer
                      </button>
                    </div>
                  )}
                </article>

                <aside className="vocab-card">
                  <div className="section-label">VOCABULARY</div>
                  {["practice", "listening", "understand"].map((word) => (
                    <div className="word-row" key={word}>
                      <span>{word}</span>
                      <button onClick={() => saveWord(word)}>
                        {savedWords.includes(word) ? "✓" : "＋"}
                      </button>
                    </div>
                  ))}
                  <p>Saved words stay in this browser.</p>
                </aside>
              </div>
            </>
          ) : (
            <div className="empty-state">
              Upload an audio file above to start.
            </div>
          )}
        </section>

        <section id="vocabulary" className="section vocabulary">
          <div className="section-label">MY VOCABULARY</div>
          <h2>Words worth keeping.</h2>

          {savedWords.length === 0 ? (
            <div className="empty-state">No saved words yet.</div>
          ) : (
            <div className="saved-list">
              {savedWords.map((word) => (
                <div className="saved-word" key={word}>
                  <strong>{word}</strong>
                  <button onClick={() => removeWord(word)}>Remove</button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer>LISTENLY · Listen. Write. Understand.</footer>
    </div>
  );
}