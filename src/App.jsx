import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import "./style.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

/* =========================================================
   Supabase
========================================================= */

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL;

const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY;

const SUPABASE_LEGACY_ANON_KEY =
  import.meta.env.VITE_SUPABASE_LEGACY_ANON_KEY || "";

const AUDIO_BUCKET = "listenly-audio";
const PDF_BUCKET = "listenly-pdf";

const DICT_API =
  "https://api.dictionaryapi.dev/api/v2/entries/en/";

const TRANSLATE_API =
  "https://api.mymemory.translated.net/get";

/* =========================================================
   Supabase REST
========================================================= */

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "Supabase 环境变量没有配置。"
    );
  }

  const headers = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  /*
   * 重要：
   * sb_publishable_... 不是 JWT，
   * 不要：
   *
   * Authorization: Bearer sb_publishable_...
   *
   * 如果存在 Legacy anon JWT，
   * 数据库请求也可以使用它作为 Authorization。
   */

  if (SUPABASE_LEGACY_ANON_KEY) {
    headers.Authorization =
      `Bearer ${SUPABASE_LEGACY_ANON_KEY}`;
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers,
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error_description ||
        data?.error ||
        text ||
        "Supabase 请求失败"
    );
  }

  return data;
}

/* =========================================================
   Storage
========================================================= */

function cleanFileName(name) {
  return String(name || "")
    .replace(/[^\w.\-()\u4e00-\u9fa5 ]+/g, "_")
    .replace(/\s+/g, "_");
}

function storagePath(materialId, fileName) {
  return `${materialId}/${cleanFileName(fileName)}`;
}

function publicStorageUrl(bucket, path) {
  const encodedPath = path
    .split("/")
    .map((item) => encodeURIComponent(item))
    .join("/");

  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodedPath}`;
}

async function uploadStorageFile(
  bucket,
  path,
  file
) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "Supabase 环境变量没有配置。"
    );
  }

  const encodedPath = path
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const headers = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    "Content-Type":
      file.type || "application/octet-stream",
    "x-upsert": "false",
  };

  /*
   * Storage 上传如果需要 JWT，
   * 使用 Legacy anon JWT。
   *
   * 注意：
   * 绝对不能把 sb_publishable_...
   * 放到 Authorization。
   */

  if (SUPABASE_LEGACY_ANON_KEY) {
    headers.Authorization =
      `Bearer ${SUPABASE_LEGACY_ANON_KEY}`;
  }

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodedPath}`,
    {
      method: "POST",
      headers,
      body: file,
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        text ||
        `Storage 上传失败：${bucket}`
    );
  }

  return true;
}

/* =========================================================
   Text
========================================================= */

function splitSentences(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .split(
      /(?<=[.!?。！？])\s+|\n+/
    )
    .map((item) => item.trim())
    .filter(
      (item) => item.length > 1
    );
}

function buildAutomaticTimeline(
  sentenceList,
  audioDuration
) {
  if (
    !Array.isArray(sentenceList) ||
    sentenceList.length === 0 ||
    !Number.isFinite(audioDuration) ||
    audioDuration <= 0
  ) {
    return sentenceList || [];
  }

  const weights = sentenceList.map((sentence) => {
    const text = String(sentence?.text || "");
    const words =
      text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];

    // 用单词数作为主要权重，字符数作为兜底。
    return Math.max(
      words.length || text.length / 5 || 1,
      1
    );
  });

  const totalWeight = weights.reduce(
    (sum, value) => sum + value,
    0
  );

  if (!totalWeight) {
    return sentenceList;
  }

  let cursor = 0;

  return sentenceList.map((sentence, index) => {
    const start = cursor;

    const duration =
      index === sentenceList.length - 1
        ? audioDuration - start
        : audioDuration *
          (weights[index] / totalWeight);

    const end =
      index === sentenceList.length - 1
        ? audioDuration
        : Math.min(
            audioDuration,
            start + duration
          );

    cursor = end;

    return {
      ...sentence,
      index,
      start_time: Number(start.toFixed(2)),
      end_time: Number(end.toFixed(2)),
      auto_timed: true,
    };
  });
}

function hasValidTimeline(sentenceList) {
  return (
    Array.isArray(sentenceList) &&
    sentenceList.length > 0 &&
    sentenceList.every((sentence) => {
      const start = Number(sentence?.start_time);
      const end = Number(sentence?.end_time);

      return (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start
      );
    })
  );
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[“”"'\`]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanWord(word) {
  return String(word || "")
    .toLowerCase()
    .replace(
      /^[^a-z'-]+|[^a-z'-]+$/gi,
      ""
    );
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return "00:00";
  }

  const total = Math.max(
    0,
    Math.floor(seconds)
  );

  const minutes = Math.floor(total / 60);

  const secondsPart =
    total % 60;

  return `${String(minutes).padStart(
    2,
    "0"
  )}:${String(secondsPart).padStart(
    2,
    "0"
  )}`;
}

/* =========================================================
   PDF
========================================================= */

async function extractPdfText(file) {
  const buffer =
    await file.arrayBuffer();

  const pdf =
    await pdfjsLib.getDocument({
      data: buffer,
    }).promise;

  const pages = [];

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber++
  ) {
    const page =
      await pdf.getPage(pageNumber);

    const content =
      await page.getTextContent();

    const text =
      content.items
        .map(
          (item) => item.str || ""
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

    pages.push(text);
  }

  return pages.join("\n");
}

function cleanPdfTranscript(fullText) {
  let text = String(fullText || "")
    .replace(/\r/g, "")
    .replace(
      /Page\s+\d+\s+of\s+\d+/gi,
      ""
    )
    .replace(
      /The Listening Room ©British Broadcasting Corporation \d+/gi,
      ""
    )
    .replace(
      /bbclearningenglish\.com/gi,
      ""
    )
    .trim();

  const lower =
    text.toLowerCase();

  const positions = [
    lower.lastIndexOf(
      "\ntranscript"
    ),
    lower.lastIndexOf(
      " transcript "
    ),
    lower.lastIndexOf(
      "transcript:"
    ),
  ].filter(
    (item) => item >= 0
  );

  if (positions.length) {
    const index =
      Math.max(...positions);

    text = text
      .slice(index)
      .replace(
        /^transcript\s*:?\s*/i,
        ""
      )
      .trim();
  }

  const looksLikeQuestions =
    /\bquestions?\b/i.test(
      text
    ) &&
    /\banswers?\b/i.test(
      text
    );

  if (
    looksLikeQuestions &&
    !/transcript/i.test(
      fullText
    )
  ) {
    return {
      text: "",
      warning:
        "这个 PDF 没有检测到真正的 Transcript，因此没有把题目内容冒充成听力文稿。",
    };
  }

  return {
    text,
    warning: "",
  };
}

/* =========================================================
   App
========================================================= */

export default function App() {
  const audioRef =
    useRef(null);

  const audioInputRef =
    useRef(null);

  const pdfInputRef =
    useRef(null);

  const replayEndRef =
    useRef(null);

  const [page, setPage] =
    useState("library");

  const [materials, setMaterials] =
    useState([]);

  const [activeMaterial, setActiveMaterial] =
    useState(null);

  const [materialName, setMaterialName] =
    useState("");

  const [audioFile, setAudioFile] =
    useState(null);

  const [audioUrl, setAudioUrl] =
    useState("");

  const [pdfFile, setPdfFile] =
    useState(null);

  const [pdfText, setPdfText] =
    useState("");

  const [sentences, setSentences] =
    useState([]);

  const [currentSentence, setCurrentSentence] =
    useState(0);

  const [playing, setPlaying] =
    useState(false);

  const [currentTime, setCurrentTime] =
    useState(0);

  const [duration, setDuration] =
    useState(0);

  const [speed, setSpeed] =
    useState(1);

  const [dictation, setDictation] =
    useState("");

  const [dictationChecked, setDictationChecked] =
    useState(false);

  const [lookup, setLookup] =
    useState(null);

  const [lookupLoading, setLookupLoading] =
    useState(false);

  const [vocabulary, setVocabulary] =
    useState([]);

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  const [pdfWarning, setPdfWarning] =
    useState("");

  const currentSentenceData =
    sentences[currentSentence] ||
    null;

  const currentSentenceText =
    currentSentenceData?.text ||
    "";

  const currentStart =
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
      : null;

  /* =====================================================
     Initial
  ===================================================== */

  useEffect(() => {
    loadMaterials();
    loadVocabulary();
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate =
        speed;
    }
  }, [speed]);

  useEffect(() => {
    if (
      duration > 0 &&
      sentences.length > 0 &&
      !hasValidTimeline(sentences)
    ) {
      const timeline = buildAutomaticTimeline(
        sentences,
        duration
      );

      setSentences(timeline);
    }
  }, [duration, sentences.length]);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(
          audioUrl
        );
      }
    };
  }, [audioUrl]);

  /* =====================================================
     Toast
  ===================================================== */

  function notify(text) {
    setMessage(text);

    window.setTimeout(() => {
      setMessage("");
    }, 3000);
  }

  /* =====================================================
     Database
  ===================================================== */

  async function loadMaterials() {
    try {
      const data =
        await supabaseRequest(
          "materials?select=*&order=created_at.desc"
        );

      setMaterials(
        Array.isArray(data)
          ? data
          : []
      );
    } catch (err) {
      console.error(
        "loadMaterials:",
        err
      );
    }
  }

  async function loadVocabulary() {
    try {
      const data =
        await supabaseRequest(
          "vocabulary?select=*&order=created_at.desc"
        );

      setVocabulary(
        Array.isArray(data)
          ? data
          : []
      );
    } catch (err) {
      console.error(
        "loadVocabulary:",
        err
      );
    }
  }

  /* =====================================================
     Audio
  ===================================================== */

  function selectAudio(file) {
    if (!file) return;

    setError("");

    if (!file.type.startsWith("audio/")) {
      setError(
        "请选择 MP3、WAV、M4A 等音频文件。"
      );
      return;
    }

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }

    const url = URL.createObjectURL(file);

    setAudioFile(file);
    setAudioUrl(url);
    setCurrentTime(0);
    setDuration(0);
    replayEndRef.current = null;

    const metadataAudio = new Audio();
    metadataAudio.preload = "metadata";
    metadataAudio.src = url;

    metadataAudio.onloadedmetadata = () => {
      const audioDuration = Number(
        metadataAudio.duration
      );

      if (
        !Number.isFinite(audioDuration) ||
        audioDuration <= 0
      ) {
        notify("音频已加载，但无法读取时长");
        return;
      }

      setDuration(audioDuration);

      if (sentences.length > 0 && !hasValidTimeline(sentences)) {
        const timeline = buildAutomaticTimeline(
          sentences,
          audioDuration
        );

        setSentences(timeline);
        notify(
          `音频已加载，已自动生成 ${timeline.length} 句时间轴`
        );
      } else {
        notify("音频已加载");
      }
    };

    metadataAudio.onerror = () => {
      notify("无法读取音频时长，请检查音频文件");
    };
  }

  /* =====================================================
     PDF
  ===================================================== */

  async function selectPdf(file) {
    if (!file) return;

    setLoading(true);
    setError("");
    setPdfWarning("");

    try {
      const rawText = await extractPdfText(file);

      const result = cleanPdfTranscript(rawText);

      const list = splitSentences(result.text);

      const baseSentences = list.map(
        (text, index) => ({
          index,
          text,
          start_time: null,
          end_time: null,
          asr_text: "",
          auto_timed: false,
        })
      );

      const nextSentences =
        duration > 0
          ? buildAutomaticTimeline(
              baseSentences,
              duration
            )
          : baseSentences;

      setPdfFile(file);
      setPdfText(result.text);
      setSentences(nextSentences);
      setCurrentSentence(0);

      if (result.warning) {
        setPdfWarning(result.warning);
      }

      notify(
        result.text
          ? duration > 0
            ? `PDF 已读取，共 ${list.length} 句，已自动生成时间轴`
            : `PDF 已读取，共 ${list.length} 句；上传音频后会自动生成时间轴`
          : "PDF 已读取，但没有找到真正的 Transcript"
      );
    } catch (err) {
      console.error("selectPdf:", err);
      setError(
        "PDF 读取失败，请确认 PDF 是正常文件。"
      );
    } finally {
      setLoading(false);
    }
  }

  /* =====================================================
     Create Material
  ===================================================== */

  async function createMaterial() {
    setError("");

    if (!SUPABASE_URL) {
      setError(
        "VITE_SUPABASE_URL 没有配置。"
      );
      return;
    }

    if (!SUPABASE_PUBLISHABLE_KEY) {
      setError(
        "VITE_SUPABASE_ANON_KEY 没有配置。"
      );
      return;
    }

    if (
      !SUPABASE_LEGACY_ANON_KEY
    ) {
      setError(
        "缺少 VITE_SUPABASE_LEGACY_ANON_KEY。请在 Supabase 的 Legacy API Keys 中复制 anon JWT。"
      );
      return;
    }

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

    setLoading(true);

    try {
      const materialId =
        crypto.randomUUID();

      const audioPath =
        storagePath(
          materialId,
          audioFile.name
        );

      const pdfPath =
        storagePath(
          materialId,
          pdfFile.name
        );

      /* 上传音频 */

      await uploadStorageFile(
        AUDIO_BUCKET,
        audioPath,
        audioFile
      );

      /* 上传 PDF */

      await uploadStorageFile(
        PDF_BUCKET,
        pdfPath,
        pdfFile
      );

      /* 保存数据库 */

      const data =
        await supabaseRequest(
          "materials",
          {
            method: "POST",
            headers: {
              Prefer:
                "return=representation",
            },
            body: JSON.stringify({
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
            }),
          }
        );

      const material =
        Array.isArray(data)
          ? data[0]
          : data;

      if (!material) {
        throw new Error(
          "材料数据库记录没有创建成功。"
        );
      }

      setMaterials(
        (items) => [
          material,
          ...items,
        ]
      );

      setActiveMaterial(
        material
      );

      const savedAudioUrl =
        publicStorageUrl(
          AUDIO_BUCKET,
          audioPath
        );

      if (audioUrl) {
        URL.revokeObjectURL(
          audioUrl
        );
      }

      setAudioUrl(
        savedAudioUrl
      );

      setAudioFile(null);
      setPdfFile(null);

      setPage("practice");

      notify(
        "学习材料已保存"
      );
    } catch (err) {
      console.error(
        "createMaterial:",
        err
      );

      setError(
        err?.message ||
          "材料保存失败，请检查 Supabase Policies。"
      );
    } finally {
      setLoading(false);
    }
  }

  /* =====================================================
     Open Material
  ===================================================== */

  async function openMaterial(
    material
  ) {
    try {
      setError("");

      setActiveMaterial(
        material
      );

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
        material.transcript ||
          ""
      );

      setMaterialName(
        material.name ||
          ""
      );

      setCurrentSentence(
        Number(
          material.current_segment
        ) || 0
      );

      if (audioUrl) {
        URL.revokeObjectURL(
          audioUrl
        );
      }

      const audioPath =
        storagePath(
          material.id,
          material.audio_filename
        );

      const savedAudioUrl =
        publicStorageUrl(
          AUDIO_BUCKET,
          audioPath
        );

      setAudioUrl(
        savedAudioUrl
      );

      setPage("practice");

      notify(
        `已打开：${material.name}`
      );
    } catch (err) {
      console.error(err);

      setError(
        "打开材料失败。"
      );
    }
  }

  /* =====================================================
     Audio Controls
  ===================================================== */

  function togglePlay() {
    const audio = audioRef.current;

    if (!audio) {
      notify("请先上传或打开音频");
      return;
    }

    if (audio.paused) {
      replayEndRef.current = null;

      audio.play().catch((err) => {
        console.error(err);
        notify(
          "播放失败，请检查音频文件或 Storage 权限"
        );
      });
    } else {
      audio.pause();
    }
  }

  async function replayCurrentSentence() {
    const audio = audioRef.current;
    const sentence = sentences[currentSentence];

    if (!audio || !sentence) {
      notify("请先加载音频和文字稿");
      return;
    }

    const start = Number(sentence.start_time);
    const end = Number(sentence.end_time);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      notify("当前句还没有可用的自动时间轴");
      return;
    }

    try {
      audio.pause();
      audio.currentTime = start;
      setCurrentTime(start);
      replayEndRef.current = end;
      await audio.play();
      setPlaying(true);
    } catch (err) {
      console.error("replayCurrentSentence:", err);
      replayEndRef.current = null;
      notify("本句播放失败");
    }
  }

  function handleTimeUpdate(event) {
    const audio = event.currentTarget;
    const time = audio.currentTime;

    setCurrentTime(time);

    if (sentences.length > 0) {
      const index = sentences.findIndex((sentence) => {
        const start = Number(sentence.start_time);
        const end = Number(sentence.end_time);

        return (
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          time >= start &&
          time < end
        );
      });

      if (index >= 0 && index !== currentSentence) {
        setCurrentSentence(index);
      }
    }

    if (
      replayEndRef.current !== null &&
      !audio.paused &&
      time >= replayEndRef.current
    ) {
      audio.pause();
      audio.currentTime = replayEndRef.current;
      setCurrentTime(replayEndRef.current);
      replayEndRef.current = null;
    }
  }

  async function jumpToSentence(index, autoPlay = true) {
    if (
      index < 0 ||
      index >= sentences.length
    ) {
      return;
    }

    const sentence = sentences[index];

    setCurrentSentence(index);
    setDictation("");
    setDictationChecked(false);
    setLookup(null);
    replayEndRef.current = null;

    const start = Number(sentence?.start_time);

    if (
      audioRef.current &&
      Number.isFinite(start)
    ) {
      audioRef.current.currentTime = start;
      setCurrentTime(start);

      if (autoPlay) {
        try {
          await audioRef.current.play();
          setPlaying(true);
        } catch (err) {
          console.error("jumpToSentence:", err);
          notify("本句播放失败");
        }
      }
    }
  }

  function goPreviousSentence() {
    if (!sentences.length) return;

    const nextIndex = Math.max(
      0,
      currentSentence - 1
    );

    jumpToSentence(nextIndex, true);
  }

  function goNextSentence() {
    if (!sentences.length) return;

    const nextIndex = Math.min(
      sentences.length - 1,
      currentSentence + 1
    );

    jumpToSentence(nextIndex, true);
  }

  function selectSentence(index) {
    jumpToSentence(index, true);
  }

  /* =====================================================
     Sentence Timing
  ===================================================== */

  async function saveSentenceSegments(
    nextSentences
  ) {
    if (!activeMaterial) {
      return;
    }

    try {
      await supabaseRequest(
        `materials?id=eq.${activeMaterial.id}`,
        {
          method: "PATCH",
          headers: {
            Prefer:
              "return=representation",
          },
          body: JSON.stringify({
            segments:
              nextSentences,
            current_segment:
              currentSentence,
          }),
        }
      );

      const nextMaterial =
        {
          ...activeMaterial,
          segments:
            nextSentences,
          current_segment:
            currentSentence,
        };

      setActiveMaterial(
        nextMaterial
      );

      setMaterials(
        (items) =>
          items.map(
            (item) =>
              item.id ===
              activeMaterial.id
                ? nextMaterial
                : item
          )
      );

      notify(
        "时间轴已保存"
      );
    } catch (err) {
      console.error(err);

      notify(
        "时间轴保存失败"
      );
    }
  }


  /* =====================================================
     Word Lookup
  ===================================================== */

  async function lookupWord(
    rawWord
  ) {
    const word =
      cleanWord(rawWord);

    if (
      !word ||
      word.length < 2
    ) {
      return;
    }

    setLookupLoading(true);

    setLookup({
      word,
      phonetic: "",
      partOfSpeech: "",
      definition: "",
      chineseMeaning: "",
      example:
        currentSentenceText,
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

      const entry =
        data?.[0];

      const phonetic =
        entry?.phonetic ||
        entry?.phonetics?.find(
          (item) =>
            item.text
        )?.text ||
        "";

      const meaning =
        entry?.meanings?.find(
          (item) =>
            item.definitions
              ?.length
        );

      const definition =
        meaning
          ?.definitions?.[0]
          ?.definition ||
        "";

      const partOfSpeech =
        meaning
          ?.partOfSpeech ||
        "";

      let chineseMeaning =
        "";

      if (definition) {
        try {
          const params =
            new URLSearchParams(
              {
                q: definition,
                langpair:
                  "en|zh-CN",
              }
            );

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
                ?.translatedText ||
              "";
          }
        } catch (err) {
          console.error(
            err
          );
        }
      }

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
      console.error(
        err
      );

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
      setLookupLoading(
        false
      );
    }
  }

  /* =====================================================
     Vocabulary
  ===================================================== */

  async function saveVocabulary() {
    if (!lookup?.word) {
      return;
    }

    const exists =
      vocabulary.some(
        (item) =>
          item.word ===
          lookup.word
      );

    if (exists) {
      notify(
        "这个单词已经在生词本里"
      );
      return;
    }

    try {
      const data =
        await supabaseRequest(
          "vocabulary",
          {
            method: "POST",
            headers: {
              Prefer:
                "return=representation",
            },
            body: JSON.stringify({
              word:
                lookup.word,
              phonetic:
                lookup.phonetic ||
                "",
              part_of_speech:
                lookup.partOfSpeech ||
                "",
              definition:
                lookup.definition ||
                "",
              chinese_meaning:
                lookup.chineseMeaning ||
                "",
              example_sentence:
                lookup.example ||
                "",
              material_id:
                activeMaterial?.id ||
                null,
            }),
          }
        );

      const item =
        Array.isArray(data)
          ? data[0]
          : data;

      setVocabulary(
        (items) => [
          item,
          ...items,
        ]
      );

      notify(
        `${lookup.word} 已加入生词本`
      );
    } catch (err) {
      console.error(
        err
      );

      notify(
        "加入生词本失败"
      );
    }
  }

  async function deleteVocabulary(
    id
  ) {
    try {
      await supabaseRequest(
        `vocabulary?id=eq.${id}`,
        {
          method: "DELETE",
        }
      );

      setVocabulary(
        (items) =>
          items.filter(
            (item) =>
              item.id !== id
          )
      );
    } catch (err) {
      console.error(
        err
      );

      notify(
        "删除失败"
      );
    }
  }

  /* =====================================================
     Render Words
  ===================================================== */

  function renderWords(text) {
    return String(text || "")
      .split(/(\s+)/)
      .map(
        (part, index) => {
          if (
            /^\s+$/.test(part)
          ) {
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
              onClick={(
                event
              ) => {
                event.stopPropagation();

                lookupWord(
                  word
                );
              }}
            >
              {part}
            </button>
          );
        }
      );
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

  /* =====================================================
     UI
  ===================================================== */

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
            setPage(
              "library"
            )
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
              page ===
              "library"
                ? "active"
                : ""
            }
            onClick={() =>
              setPage(
                "library"
              )
            }
          >
            我的听力
          </button>

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

          <button
            className={
              page ===
              "vocabulary"
                ? "active"
                : ""
            }
            onClick={() =>
              setPage(
                "vocabulary"
              )
            }
          >
            生词本
          </button>
        </nav>
      </header>

      <main className="container">

        {/* =================================================
            Library
        ================================================= */}

        {page ===
          "library" && (
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
                value={
                  materialName
                }
                onChange={(
                  event
                ) =>
                  setMaterialName(
                    event.target
                      .value
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
                    自动读取 Transcript
                  </small>
                </button>
              </div>

              <input
                ref={
                  audioInputRef
                }
                type="file"
                accept="audio/*"
                hidden
                onChange={(
                  event
                ) =>
                  selectAudio(
                    event.target
                      .files?.[0]
                  )
                }
              />

              <input
                ref={
                  pdfInputRef
                }
                type="file"
                accept=".pdf,application/pdf"
                hidden
                onChange={(
                  event
                ) =>
                  selectPdf(
                    event.target
                      .files?.[0]
                  )
                }
              />

              {pdfWarning && (
                <div className="error">
                  {pdfWarning}
                </div>
              )}

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
                disabled={
                  loading
                }
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
                  {
                    materials.length
                  }{" "}
                  个材料
                </span>
              </div>

              {materials.length ===
              0 ? (
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
                    (
                      material
                    ) => (
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

        {/* =================================================
            Practice / Dictation
        ================================================= */}

        {(page ===
          "practice" ||
          page ===
            "dictation") && (
          <>
            <section className="workspace-head">
              <button
                className="back"
                onClick={() =>
                  setPage(
                    "library"
                  )
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
                preload="metadata"
                onLoadedMetadata={(
                  event
                ) =>
                  setDuration(
                    event
                      .currentTarget
                      .duration ||
                      0
                  )
                }
                onTimeUpdate={
                  handleTimeUpdate
                }
                onPlay={() =>
                  setPlaying(
                    true
                  )
                }
                onPause={() =>
                  setPlaying(
                    false
                  )
                }
                onEnded={() =>
                  setPlaying(
                    false
                  )
                }
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
                  {
                    sentences.length
                  }{" "}
                  句
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
                  duration ||
                  0
                }
                value={
                  currentTime
                }
                step="0.01"
                style={{
                  "--progress": `${progress}%`,
                }}
                onChange={(
                  event
                ) => {
                  if (
                    audioRef.current
                  ) {
                    audioRef.current.currentTime =
                      Number(
                        event
                          .target
                          .value
                      );
                  }
                }}
              />

              <div className="player-controls">
                <button
                  type="button"
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
                  type="button"
                  className="secondary"
                  onClick={
                    replayCurrentSentence
                  }
                >
                  ↻ 重播本句
                </button>

                <button
                  type="button"
                  className="secondary"
                  onClick={
                    goPreviousSentence
                  }
                >
                  ← 上一句
                </button>

                <button
                  type="button"
                  className="secondary"
                  onClick={
                    goNextSentence
                  }
                >
                  下一句 →
                </button>

                <select
                  value={speed}
                  onChange={(
                    event
                  ) =>
                    setSpeed(
                      Number(
                        event
                          .target
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
                当前句：
                <strong>
                  {sentences.length
                    ? currentSentence + 1
                    : 0}
                </strong>

                {currentStart !== null && currentEnd !== null ? (
                  <>
                    {" "}
                    自动时间轴：{formatTime(currentStart)}
                    {" – "}
                    {formatTime(currentEnd)}
                  </>
                ) : (
                  <>
                    {" "}
                    等待音频时长后自动生成
                  </>
                )}
              </div>

              <p
                style={{
                  marginTop: "12px",
                  opacity: 0.65,
                  fontSize: "13px",
                }}
              >
                时间轴会根据音频时长和文字稿句子长度自动生成，不需要手动标记开始和结束。
              </p>
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
                    没有检测到真正的
                    Transcript。
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
                          onClick={() =>
                            selectSentence(
                              index
                            )
                          }
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

                          {Number.isFinite(
                            Number(
                              item.start_time
                            )
                          ) &&
                          Number.isFinite(
                            Number(
                              item.end_time
                            )
                          ) && (
                            <small
                              style={{
                                opacity:
                                  0.55,
                              }}
                            >
                              {formatTime(
                                Number(
                                  item.start_time
                                )
                              )}
                            </small>
                          )}
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
                        先播放当前句，然后输入你听到的英文。
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
                        onClick={
                          checkDictation
                        }
                      >
                        检查答案
                      </button>

                      {dictationChecked && (
                        <div className="result">
                          <strong>
                            {dictationScore
                              ? "✓ 完全正确"
                              : "再听一次"}
                          </strong>

                          {!dictationScore && (
                            <p>
                              正确答案：
                              {" "}
                              {
                                currentSentenceText
                              }
                            </p>
                          )}
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
                      {
                        lookup.word
                      }
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
                    .slice(
                      0,
                      5
                    )
                    .map(
                      (
                        item
                      ) => (
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
                      )
                    )}
                </section>
              </aside>
            </div>
          </>
        )}

        {/* =================================================
            Vocabulary
        ================================================= */}

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
                所有收藏的单词都会保存到云端。
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
                      key={
                        item.id
                      }
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
