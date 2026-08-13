(() => {
  "use strict";

  const SAMPLE_RATE = 24000;
  const CODEC_SAMPLES_PER_FRAME = 1920;
  const CODEC_FRAME_RATE = SAMPLE_RATE / CODEC_SAMPLES_PER_FRAME;
  const PCM_BYTES_PER_CODEC_FRAME = CODEC_SAMPLES_PER_FRAME * 2;
  const MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice";
  const INITIAL_TOKEN_LOOKAHEAD = 24;
  const TOKEN_BATCH_SIZE = 16;
  const TOKEN_BATCH_INTERVAL_MS = 25;
  const $ = (selector) => document.querySelector(selector);

  const elements = {
    backendStatus: $("#backendStatus"),
    statusText: $("#backendStatus .status-text"),
    inputText: $("#inputText"),
    charCount: $("#charCount"),
    clearButton: $("#clearButton"),
    voiceSelect: $("#voiceSelect"),
    languageSelect: $("#languageSelect"),
    instructions: $("#instructions"),
    modeButtons: [...document.querySelectorAll(".mode-button")],
    modeHint: $("#modeHint"),
    fullOptions: $("#fullOptions"),
    formatSelect: $("#formatSelect"),
    speedRange: $("#speedRange"),
    speedValue: $("#speedValue"),
    generateButton: $("#generateButton"),
    buttonLabel: $("#generateButton .button-label"),
    stopButton: $("#stopButton"),
    downloadButton: $("#downloadButton"),
    errorMessage: $("#errorMessage"),
    playerTitle: $("#playerTitle"),
    playerBadge: $("#playerBadge"),
    visualizer: $("#visualizer"),
    emptyVisualizer: $("#emptyVisualizer"),
    progressBar: $("#progressBar"),
    dualStreamCard: $("#dualStreamCard"),
    dualStreamState: $("#dualStreamState"),
    textStreamStatus: $("#textStreamStatus"),
    audioStreamStatus: $("#audioStreamStatus"),
    codecGeneratedMetric: $("#codecGeneratedMetric"),
    codecBufferMetric: $("#codecBufferMetric"),
    codecPlaybackMetric: $("#codecPlaybackMetric"),
    dualTrackViewport: $("#dualTrackViewport"),
    dualTrackSurface: $("#dualTrackSurface"),
    dualTrackItems: $("#dualTrackItems"),
    audioPlayer: $("#audioPlayer"),
    ttfbMetric: $("#ttfbMetric"),
    durationMetric: $("#durationMetric"),
    rtfMetric: $("#rtfMetric"),
    toast: $("#toast"),
  };

  const examples = {
    welcome: {
      text: "欢迎使用 Qwen3 TTS 智能语音工作台。自然、清晰、富有表现力的声音，现在就为你呈现。",
      instruction: "专业而亲切，语速适中，带有自然的微笑感",
    },
    narration: {
      text: "夜色轻轻落在城市的屋檐，远处的灯火像散落的星星。风从窗边经过，也把今天的故事，慢慢说给你听。",
      instruction: "温柔舒缓的旁白，声音细腻，节奏稍慢，句尾自然收束",
    },
    news: {
      text: "这里是今日科技简讯。新一代人工智能语音技术正在加速落地，为内容创作与智能交互带来更多可能。",
      instruction: "清晰专业的新闻播报风格，语气沉稳，咬字准确",
    },
  };

  const state = {
    mode: "stream",
    busy: false,
    backendOnline: false,
    abortController: null,
    websocket: null,
    pcmPlayer: null,
    objectUrl: null,
    toastTimer: null,
    waveMode: "idle",
    waveSamples: new Float32Array(96),
    waveEnergy: 0,
    streamTokenCount: 0,
    streamAudioBytes: 0,
    streamAudioStarted: false,
    streamGenerationComplete: false,
    streamInputFinished: false,
    streamTokenPieces: [],
    streamTokenIds: [],
    streamCodecFrames: 0,
    streamPlaybackFrame: -1,
    streamPlaybackSeconds: 0,
    streamPlaybackPhase: "PLAY",
    streamStyledPlaybackFrame: -1,
    streamTrackRenderKey: "",
    streamTrackStructureKey: "",
    streamTrackRenderedExtent: 0,
    streamTrackRenderedCodecFrames: 0,
    streamReplayActive: false,
  };

  class PCMStreamPlayer {
    constructor(sampleRate) {
      this.sampleRate = sampleRate;
      this.context = null;
      this.nextStartTime = 0;
      this.sources = new Set();
      this.leftover = null;
      this.totalScheduledSamples = 0;
      this.timelineSegments = [];
    }

    async prepare() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("当前浏览器不支持 Web Audio，请使用最新版 Chrome、Edge 或 Safari。");
      }
      this.context = new AudioContextClass({ sampleRate: this.sampleRate });
      await this.context.resume();
      this.nextStartTime = this.context.currentTime + 0.1;
      this.totalScheduledSamples = 0;
      this.timelineSegments = [];
    }

    append(bytes) {
      let data = bytes;
      if (this.leftover !== null) {
        const merged = new Uint8Array(bytes.length + 1);
        merged[0] = this.leftover;
        merged.set(bytes, 1);
        data = merged;
        this.leftover = null;
      }

      if (data.length % 2) {
        this.leftover = data[data.length - 1];
        data = data.subarray(0, data.length - 1);
      }
      if (!data.length || !this.context) return new Float32Array(0);

      const sampleCount = data.length / 2;
      const samples = new Float32Array(sampleCount);
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      for (let i = 0; i < sampleCount; i += 1) {
        samples[i] = view.getInt16(i * 2, true) / 32768;
      }

      const buffer = this.context.createBuffer(1, sampleCount, this.sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context.destination);

      const safeStart = this.context.currentTime + 0.055;
      const scheduledStart = Math.max(this.nextStartTime, safeStart);
      const audioStartSeconds = this.totalScheduledSamples / this.sampleRate;
      const durationSeconds = sampleCount / this.sampleRate;
      source.start(scheduledStart);
      this.nextStartTime = scheduledStart + durationSeconds;
      this.timelineSegments.push({
        startTime: scheduledStart,
        endTime: this.nextStartTime,
        audioStartSeconds,
        audioEndSeconds: audioStartSeconds + durationSeconds,
      });
      this.totalScheduledSamples += sampleCount;
      this.sources.add(source);
      source.onended = () => this.sources.delete(source);
      return samples;
    }

    getPlaybackState() {
      if (!this.context || !this.timelineSegments.length) {
        return { seconds: 0, active: false, buffering: true, complete: false };
      }
      const now = this.context.currentTime;
      let previous = null;
      for (const segment of this.timelineSegments) {
        if (now < segment.startTime) {
          return {
            seconds: previous ? previous.audioEndSeconds : 0,
            active: false,
            buffering: true,
            complete: false,
          };
        }
        if (now <= segment.endTime) {
          return {
            seconds: segment.audioStartSeconds + (now - segment.startTime),
            active: true,
            buffering: false,
            complete: false,
          };
        }
        previous = segment;
      }
      return {
        seconds: previous.audioEndSeconds,
        active: false,
        buffering: false,
        complete: true,
      };
    }

    stop() {
      for (const source of this.sources) {
        try { source.stop(); } catch (_) { /* source may already be stopped */ }
      }
      this.sources.clear();
      if (this.context && this.context.state !== "closed") {
        this.context.close().catch(() => {});
      }
      this.context = null;
      this.leftover = null;
      this.timelineSegments = [];
    }
  }

  function initialize() {
    bindEvents();
    updateCharCount();
    setupVisualizer();
    checkHealth();
    loadVoices();
    window.setInterval(checkHealth, 15000);
  }

  function bindEvents() {
    elements.inputText.addEventListener("input", updateCharCount);
    elements.clearButton.addEventListener("click", () => {
      elements.inputText.value = "";
      elements.inputText.focus();
      updateCharCount();
    });

    document.querySelectorAll("[data-example]").forEach((button) => {
      button.addEventListener("click", () => {
        const example = examples[button.dataset.example];
        if (!example) return;
        elements.inputText.value = example.text;
        elements.instructions.value = example.instruction;
        updateCharCount();
        showToast("示例内容已填入");
      });
    });

    elements.modeButtons.forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    });

    elements.speedRange.addEventListener("input", () => {
      elements.speedValue.textContent = `${Number(elements.speedRange.value).toFixed(1)}×`;
    });

    elements.generateButton.addEventListener("click", generateSpeech);
    elements.stopButton.addEventListener("click", () => stopGeneration(true));
    elements.backendStatus.addEventListener("click", async () => {
      await checkHealth(true);
      await loadVoices();
    });

    elements.audioPlayer.addEventListener("play", () => {
      if (state.mode === "stream" && state.streamCodecFrames > 0) state.streamReplayActive = true;
      state.waveMode = "synthetic";
      setPlayerBadge("playing", "播放中");
      syncStopButton();
    });
    elements.audioPlayer.addEventListener("pause", () => {
      if (!state.busy) {
        state.waveMode = "ready";
        setPlayerBadge("done", "已生成");
      }
      syncStopButton();
    });
    elements.audioPlayer.addEventListener("ended", () => {
      if (state.streamReplayActive && state.streamCodecFrames > 0) {
        state.streamPlaybackSeconds = state.streamCodecFrames / CODEC_FRAME_RATE;
        state.streamPlaybackFrame = state.streamCodecFrames - 1;
        updateTrackPlaybackMarker();
      }
      state.waveMode = "ready";
      setPlayerBadge("done", "播放完成");
      syncStopButton();
    });

    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (!state.busy) generateSpeech();
      }
    });

    window.addEventListener("beforeunload", () => {
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      if (state.pcmPlayer) state.pcmPlayer.stop();
      if (state.websocket) state.websocket.close();
    });
  }

  function setMode(mode) {
    if (state.busy || !["stream", "full"].includes(mode)) return;
    state.mode = mode;
    elements.modeButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === mode);
    });
    const isFull = mode === "full";
    elements.fullOptions.classList.toggle("visible", isFull);
    elements.fullOptions.setAttribute("aria-hidden", String(!isFull));
    elements.modeHint.textContent = isFull
      ? "等待完整文件生成，可选择格式与语速"
      : "模型级真实 token 输入，音频可在文本结束前返回";
  }

  function updateCharCount() {
    const length = [...elements.inputText.value].length;
    elements.charCount.textContent = `${length} / 5000`;
    elements.charCount.style.color = length > 4500 ? "#ff8b9c" : "";
  }

  async function checkHealth(notify = false) {
    setBackendState("checking", "正在连接");
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "推理服务不可用");
      state.backendOnline = true;
      setBackendState("online", "服务在线");
      if (notify) showToast("vLLM 推理服务连接正常");
    } catch (error) {
      state.backendOnline = false;
      setBackendState("offline", "服务离线");
      if (notify) showToast(error.message || "无法连接推理服务", true);
    }
    syncGenerateButton();
  }

  function setBackendState(className, text) {
    elements.backendStatus.classList.remove("checking", "online", "offline");
    elements.backendStatus.classList.add(className);
    elements.statusText.textContent = text;
  }

  async function loadVoices() {
    const previous = elements.voiceSelect.value;
    try {
      const response = await fetch("/api/voices", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "音色列表加载失败");
      const voices = data.voices || [];
      if (!voices.length) throw new Error("服务没有返回可用音色");
      elements.voiceSelect.replaceChildren();
      for (const voice of voices) {
        const option = document.createElement("option");
        option.value = voice;
        option.textContent = formatVoiceName(voice);
        elements.voiceSelect.append(option);
      }
      const preferred = previous || "vivian";
      if (voices.includes(preferred)) elements.voiceSelect.value = preferred;
    } catch (error) {
      elements.voiceSelect.innerHTML = '<option value="">音色加载失败</option>';
      showError(error.message);
    }
  }

  function formatVoiceName(voice) {
    return voice
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  async function generateSpeech() {
    if (state.busy) return;
    const text = elements.inputText.value.trim();
    const voice = elements.voiceSelect.value;
    if (!text) {
      showError("请先输入需要合成的文本。", true);
      elements.inputText.focus();
      return;
    }
    if (!voice) {
      showError("音色尚未加载，请检查服务连接。", true);
      return;
    }
    if (!state.backendOnline) {
      await checkHealth();
      if (!state.backendOnline) {
        showError("vLLM 推理服务当前不可用。", true);
        return;
      }
    }

    resetOutput();
    setBusy(true);
    if (state.mode === "stream") beginDualStream();
    elements.playerTitle.textContent = text.replace(/\s+/g, " ").slice(0, 28);
    setPlayerBadge("working", "生成中");
    state.waveMode = "synthetic";
    activateVisualizer();
    elements.progressBar.classList.add("indeterminate");

    state.abortController = new AbortController();
    const payload = {
      input: text,
      voice,
      language: elements.languageSelect.value,
      instructions: elements.instructions.value.trim(),
      stream: state.mode === "stream",
      response_format: state.mode === "stream" ? "pcm" : elements.formatSelect.value,
      speed: Number(elements.speedRange.value),
    };

    const startedAt = performance.now();
    try {
      if (state.mode === "stream") {
        state.pcmPlayer = new PCMStreamPlayer(SAMPLE_RATE);
        await state.pcmPlayer.prepare();
        await handleNativeStreamingResponse(payload, startedAt, state.abortController.signal);
      } else {
        const response = await fetch("/api/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: state.abortController.signal,
        });
        if (!response.ok) throw new Error(await readError(response));
        await handleFullResponse(response, startedAt, payload.response_format);
      }
    } catch (error) {
      if (error.name === "AbortError") {
        setDualStreamPhase("idle", "已停止");
        setPlayerBadge("idle", "已停止");
        elements.playerTitle.textContent = "生成已停止";
        state.waveMode = "idle";
      } else {
        console.error(error);
        setDualStreamPhase("error", "链路异常");
        showError(error.message || "语音生成失败，请查看服务日志。", true);
        setPlayerBadge("error", "生成失败");
        elements.playerTitle.textContent = "生成失败";
        state.waveMode = "idle";
      }
    } finally {
      elements.progressBar.classList.remove("indeterminate");
      setBusy(false);
      state.abortController = null;
      state.websocket = null;
    }
  }

  async function handleNativeStreamingResponse(payload, startedAt, signal) {
    const socketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${socketProtocol}//${window.location.host}/api/speech/stream`);
    socket.binaryType = "arraybuffer";
    state.websocket = socket;
    setDualStreamPhase("active", "连接双流");
    elements.textStreamStatus.textContent = "建立 WebSocket";
    elements.audioStreamStatus.textContent = "等待 Talker";

    const chunks = [];
    let totalBytes = 0;
    let firstChunkAt = null;
    let audioDone = false;
    let settled = false;
    let resolveFirstAudio;
    let rejectFirstAudio;
    let resolveTokenPlan;
    let rejectTokenPlan;
    let resolveFinished;
    let rejectFinished;
    const firstAudio = new Promise((resolve, reject) => {
      resolveFirstAudio = resolve;
      rejectFirstAudio = reject;
    });
    const tokenPlan = new Promise((resolve, reject) => {
      resolveTokenPlan = resolve;
      rejectTokenPlan = reject;
    });
    const finished = new Promise((resolve, reject) => {
      resolveFinished = resolve;
      rejectFinished = reject;
    });

    const fail = (error) => {
      if (settled) return;
      settled = true;
      rejectFirstAudio(error);
      rejectTokenPlan(error);
      rejectFinished(error);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    };
    const abort = () => fail(new DOMException("生成已取消", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });

    socket.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) {
        const value = new Uint8Array(event.data);
        if (!value.length) return;
        if (firstChunkAt === null) {
          firstChunkAt = performance.now();
          state.streamAudioStarted = true;
          elements.ttfbMetric.textContent = formatLatency(firstChunkAt - startedAt);
          setPlayerBadge("playing", "Token 双流播放");
          setDualStreamPhase("duplex", "双流并行");
          elements.audioStreamStatus.textContent = "首帧已到达";
          resolveFirstAudio();
        }
        chunks.push(value.slice());
        totalBytes += value.length;
        const samples = state.pcmPlayer.append(value);
        feedVisualizer(samples);
        pushAudioPacket(value.length);
        const duration = totalBytes / 2 / SAMPLE_RATE;
        elements.durationMetric.textContent = `${duration.toFixed(1)}s`;
        const elapsed = (performance.now() - startedAt) / 1000;
        elements.rtfMetric.textContent = duration > 0 ? (elapsed / duration).toFixed(2) : "—";
        return;
      }

      let message;
      try {
        message = JSON.parse(event.data);
      } catch (_) {
        fail(new Error("流式服务返回了无法解析的控制消息。"));
        return;
      }
      if (message.type === "error") {
        fail(new Error(message.message || "模型级流式生成失败。"));
      } else if (message.type === "input.plan.ready") {
        resolveTokenPlan(message);
      } else if (message.type === "audio.start") {
        elements.audioStreamStatus.textContent = "Talker 解码中";
      } else if (message.type === "audio.done") {
        audioDone = true;
        state.streamGenerationComplete = true;
        elements.dualTrackItems.querySelectorAll(".decoding").forEach((cell) => cell.classList.remove("decoding"));
        updateCodecGenerationHead();
        elements.audioStreamStatus.textContent = message.error ? "音频流异常" : "PCM 流结束";
        if (message.error) fail(new Error("模型返回的 token 音频流未正常完成。"));
      } else if (message.type === "session.done" && !settled) {
        settled = true;
        resolveFinished();
      }
    });

    socket.addEventListener("error", () => fail(new Error("无法连接模型级流式 WebSocket。")));
    socket.addEventListener("close", () => {
      if (!settled) fail(new Error("模型级流式连接意外关闭。"));
    });

    try {
      await new Promise((resolve, reject) => {
        if (socket.readyState === WebSocket.OPEN) {
          resolve();
          return;
        }
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", () => reject(new Error("WebSocket 握手失败。")), { once: true });
      });
      setDualStreamPhase("active", "链路就绪");
      elements.textStreamStatus.textContent = "准备首 token";

      socket.send(JSON.stringify({
        type: "session.config",
        model: MODEL_ID,
        voice: payload.voice,
        language: payload.language,
        instructions: payload.instructions,
        response_format: "pcm",
        stream_audio: true,
        model_streaming_input: true,
        non_streaming_mode: false,
        initial_codec_chunk_frames: 1,
      }));
      socket.send(JSON.stringify({ type: "input.plan", text: payload.input }));

      const sendText = (async () => {
        const plan = await tokenPlan;
        const tokenIds = Array.isArray(plan.token_ids) ? plan.token_ids : [];
        const tokenPieces = Array.isArray(plan.tokens) ? plan.tokens : [];
        if (!tokenIds.length || tokenPieces.length !== tokenIds.length) {
          throw new Error("服务返回的 tokenizer 计划无效。");
        }
        state.streamTokenPieces = tokenPieces.slice();
        state.streamTokenIds = tokenIds.slice();
        elements.textStreamStatus.textContent = `模型分词完成 · ${tokenIds.length} tokens`;
        renderDualTrack(true);

        const sendBatch = (start, end) => {
          if (signal.aborted) throw new DOMException("生成已取消", "AbortError");
          if (socket.readyState !== WebSocket.OPEN) throw new Error("token 输入连接已关闭。");
          socket.send(JSON.stringify({ type: "input.tokens", token_ids: tokenIds.slice(start, end) }));
          for (let index = start; index < end; index += 1) {
            pushInputToken(tokenPieces[index], index, tokenIds.length, tokenIds[index]);
          }
        };

        // Keep roughly one second of text conditioning ahead of the 12.5 fps
        // codec decoder. Later micro-batches still arrive while PCM is flowing,
        // but the Talker no longer starves between individual characters.
        // Keep at least one real content token for the live-update path. This
        // lets the scheduler coalesce the final token and text EOS into the
        // same conditioning update; appending EOS by itself after a very short
        // request has already drained can otherwise produce a long codec tail.
        const initialLimit = tokenIds.length > 1 ? tokenIds.length - 1 : tokenIds.length;
        let cursor = Math.min(INITIAL_TOKEN_LOOKAHEAD, initialLimit);
        sendBatch(0, cursor);
        elements.textStreamStatus.textContent = `前瞻 ${cursor} tokens 已送入 · 等待首帧`;
        if (cursor === tokenIds.length) {
          // A one-token utterance has no token to reserve. Close its input
          // before waiting for audio so text EOS reaches the queue while that
          // sole conditioning row is still live.
          commitTextEos();
          elements.textStreamStatus.textContent = "单 token 与 EOS 已送入";
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input.done" }));
          await firstAudio;
          setDualStreamPhase("draining", "音频收尾");
          return;
        }
        await firstAudio;
        let isFirstLiveBatch = true;
        while (cursor < tokenIds.length) {
          if (!isFirstLiveBatch) await delay(TOKEN_BATCH_INTERVAL_MS, signal);
          const nextCursor = Math.min(cursor + TOKEN_BATCH_SIZE, tokenIds.length);
          sendBatch(cursor, nextCursor);
          cursor = nextCursor;
          isFirstLiveBatch = false;
        }

        commitTextEos();
        elements.textStreamStatus.textContent = "全部 token 已送入 · EOS";
        setDualStreamPhase("draining", "音频收尾");
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input.done" }));
      })();

      await Promise.all([sendText, finished]);
    } finally {
      signal.removeEventListener("abort", abort);
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "utterance complete");
    }

    if (!audioDone || !totalBytes) throw new Error("服务没有正常返回模型级 PCM 音频。请查看 vLLM 日志。");

    const elapsed = (performance.now() - startedAt) / 1000;
    const duration = totalBytes / 2 / SAMPLE_RATE;
    const wavBlob = pcmChunksToWav(chunks, totalBytes, SAMPLE_RATE);
    setAudioOutput(wavBlob, "wav", true);
    elements.durationMetric.textContent = `${duration.toFixed(2)}s`;
    elements.rtfMetric.textContent = (elapsed / duration).toFixed(2);
    finishGeneration();
  }

  async function handleFullResponse(response, startedAt, format) {
    const headersAt = performance.now();
    elements.ttfbMetric.textContent = formatLatency(headersAt - startedAt);
    const blob = await response.blob();
    if (!blob.size) throw new Error("服务没有返回音频数据。");

    setAudioOutput(blob, format, true);
    const elapsed = (performance.now() - startedAt) / 1000;
    const duration = await readAudioDuration(state.objectUrl);
    elements.durationMetric.textContent = Number.isFinite(duration) ? `${duration.toFixed(2)}s` : "就绪";
    elements.rtfMetric.textContent = Number.isFinite(duration) && duration > 0
      ? (elapsed / duration).toFixed(2)
      : "—";
    finishGeneration();
    elements.audioPlayer.play().catch(() => {});
  }

  function finishGeneration() {
    elements.progressBar.style.width = "100%";
    if (state.mode === "stream") setDualStreamPhase("complete", "双流完成");
    setPlayerBadge("done", "生成完成");
    state.waveMode = "ready";
    showToast("语音生成完成，可以重播或下载");
  }

  function setAudioOutput(blob, extension, showPlayer) {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(blob);
    elements.audioPlayer.src = state.objectUrl;
    elements.audioPlayer.classList.toggle("visible", showPlayer);
    elements.downloadButton.href = state.objectUrl;
    elements.downloadButton.download = `qwen3-tts-${timestamp()}.${extension}`;
    elements.downloadButton.classList.remove("disabled");
    elements.downloadButton.setAttribute("aria-disabled", "false");
  }

  function stopGeneration(showMessage) {
    const wasBusy = state.busy;
    if (state.abortController) state.abortController.abort();
    if (state.websocket) {
      state.websocket.close(1000, "client stop");
      state.websocket = null;
    }
    if (state.pcmPlayer) {
      state.pcmPlayer.stop();
      state.pcmPlayer = null;
    }
    elements.audioPlayer.pause();
    elements.progressBar.classList.remove("indeterminate");
    if (wasBusy) elements.progressBar.style.width = "0";
    if (wasBusy) setDualStreamPhase("idle", "已停止");
    if (!wasBusy) {
      state.waveMode = "ready";
      setPlayerBadge("idle", "已停止");
    }
    syncStopButton();
    if (showMessage) showToast("已停止当前任务");
  }

  function resetOutput() {
    if (state.pcmPlayer) state.pcmPlayer.stop();
    state.pcmPlayer = null;
    elements.audioPlayer.pause();
    elements.audioPlayer.removeAttribute("src");
    elements.audioPlayer.load();
    elements.audioPlayer.classList.remove("visible");
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
    elements.downloadButton.removeAttribute("href");
    elements.downloadButton.classList.add("disabled");
    elements.downloadButton.setAttribute("aria-disabled", "true");
    elements.errorMessage.textContent = "";
    elements.ttfbMetric.textContent = "—";
    elements.durationMetric.textContent = "—";
    elements.rtfMetric.textContent = "—";
    elements.progressBar.style.width = "0";
    state.waveSamples.fill(0);
    state.waveEnergy = 0;
    resetDualStream();
  }

  function setBusy(busy) {
    state.busy = busy;
    elements.generateButton.classList.toggle("loading", busy);
    elements.buttonLabel.textContent = busy ? "正在生成…" : "开始生成";
    elements.modeButtons.forEach((button) => { button.disabled = busy; });
    syncStopButton();
    syncGenerateButton();
  }

  function syncStopButton() {
    const hasPlayback = Boolean(state.pcmPlayer) || !elements.audioPlayer.paused;
    elements.stopButton.disabled = !state.busy && !hasPlayback;
  }

  function syncGenerateButton() {
    elements.generateButton.disabled = state.busy || !state.backendOnline;
  }

  function setPlayerBadge(className, text) {
    elements.playerBadge.className = `player-badge ${className}`;
    elements.playerBadge.innerHTML = `<i></i>${escapeHtml(text)}`;
  }

  function resetDualStream() {
    state.streamTokenCount = 0;
    state.streamAudioBytes = 0;
    state.streamAudioStarted = false;
    state.streamGenerationComplete = false;
    state.streamInputFinished = false;
    state.streamTokenPieces = [];
    state.streamTokenIds = [];
    state.streamCodecFrames = 0;
    state.streamPlaybackFrame = -1;
    state.streamPlaybackSeconds = 0;
    state.streamPlaybackPhase = "PLAY";
    state.streamStyledPlaybackFrame = -1;
    state.streamTrackRenderKey = "";
    state.streamTrackStructureKey = "";
    state.streamTrackRenderedExtent = 0;
    state.streamTrackRenderedCodecFrames = 0;
    state.streamReplayActive = false;
    elements.codecGeneratedMetric.textContent = "AR 0 帧";
    elements.codecBufferMetric.textContent = "缓冲 0 帧";
    elements.codecPlaybackMetric.textContent = "PLAY —";
    elements.textStreamStatus.textContent = "待机";
    elements.audioStreamStatus.textContent = "待机";
    renderDualTrack();
    setDualStreamPhase("idle", "等待任务");
  }

  function beginDualStream() {
    resetDualStream();
    elements.textStreamStatus.textContent = "准备输入";
    elements.audioStreamStatus.textContent = "等待模型";
    setDualStreamPhase("active", "初始化");
  }

  function setDualStreamPhase(phase, label) {
    const card = elements.dualStreamCard;
    card.classList.remove("active", "duplex", "complete", "error");
    elements.dualStreamState.className = "dual-stream-state idle";
    if (phase === "active") {
      card.classList.add("active");
      elements.dualStreamState.className = "dual-stream-state active";
    } else if (phase === "duplex" || phase === "draining") {
      card.classList.add("active", "duplex");
      elements.dualStreamState.className = "dual-stream-state duplex";
    } else if (phase === "complete") {
      card.classList.add("complete");
      elements.dualStreamState.className = "dual-stream-state complete";
    } else if (phase === "error") {
      card.classList.add("error");
      elements.dualStreamState.className = "dual-stream-state error";
    }
    elements.dualStreamState.textContent = label;
  }

  function pushInputToken(_tokenPiece, index, _total, _tokenId = null) {
    state.streamTokenCount = index + 1;
    elements.textStreamStatus.textContent = `正在发送 #${state.streamTokenCount}`;
    if (state.streamAudioStarted) setDualStreamPhase("duplex", "双流并行");
    const tokenCell = getTextTrackCell(index);
    if (tokenCell) {
      tokenCell.classList.remove("pending");
      tokenCell.classList.add("sent");
    }
  }

  function pushAudioPacket(byteLength) {
    const previousCodecFrames = state.streamCodecFrames;
    state.streamGenerationComplete = false;
    state.streamAudioBytes += byteLength;
    state.streamCodecFrames = Math.floor(state.streamAudioBytes / PCM_BYTES_PER_CODEC_FRAME);

    elements.codecGeneratedMetric.textContent = state.streamCodecFrames > 0
      ? `AR F${state.streamCodecFrames - 1} · ${state.streamCodecFrames} 帧`
      : "AR 等待首帧";
    elements.audioStreamStatus.textContent = state.streamCodecFrames > 0
      ? `AR 增量解码至 F${state.streamCodecFrames - 1}`
      : "等待完整 Codec 帧";
    setDualStreamPhase(state.streamInputFinished ? "draining" : "duplex", state.streamInputFinished ? "音频收尾" : "双流并行");
    renderDualTrack();
    animateCodecCommit(previousCodecFrames, state.streamCodecFrames);
  }

  function commitTextEos() {
    state.streamInputFinished = true;
    renderDualTrack(true);
  }

  function updateDualTrackPlayback() {
    if (state.mode !== "stream" || state.streamCodecFrames <= 0) return;

    let playback;
    if (state.streamReplayActive) {
      const seconds = Number.isFinite(elements.audioPlayer.currentTime) ? elements.audioPlayer.currentTime : 0;
      playback = {
        seconds,
        active: !elements.audioPlayer.paused && !elements.audioPlayer.ended,
        buffering: false,
        complete: elements.audioPlayer.ended,
        replay: true,
      };
    } else if (state.pcmPlayer) {
      playback = state.pcmPlayer.getPlaybackState();
    } else {
      return;
    }

    const maxSeconds = state.streamCodecFrames / CODEC_FRAME_RATE;
    const seconds = Math.max(0, Math.min(maxSeconds, playback.seconds));
    const nextFrame = Math.min(
      state.streamCodecFrames - 1,
      Math.max(0, Math.floor(seconds * CODEC_FRAME_RATE)),
    );
    const frameChanged = nextFrame !== state.streamPlaybackFrame;
    state.streamPlaybackFrame = nextFrame;
    state.streamPlaybackSeconds = seconds;

    let phase = "PAUSE";
    if (playback.active) phase = "PLAY";
    else if (playback.buffering) phase = "BUFFER";
    else if (playback.complete) phase = "END";
    state.streamPlaybackPhase = phase;
    elements.codecPlaybackMetric.textContent = `${phase} F${nextFrame} · ${seconds.toFixed(2)}s`;
    const bufferedFrames = Math.max(0, state.streamCodecFrames - nextFrame - 1);
    elements.codecBufferMetric.textContent = `领先 ${bufferedFrames} 帧 · ${(bufferedFrames / CODEC_FRAME_RATE).toFixed(1)}s`;
    updateTrackPlaybackMarker(frameChanged);
  }

  function renderDualTrack(force = false) {
    if (!elements.dualTrackItems) return;

    const tokenCount = state.streamTokenPieces.length;
    const conditionExtent = tokenCount > 0 ? tokenCount + 1 : 1;
    const extent = Math.max(conditionExtent, state.streamCodecFrames);
    const structureKey = `${tokenCount}:${state.streamInputFinished ? 1 : 0}`;
    const renderKey = [
      tokenCount,
      state.streamTokenCount,
      state.streamInputFinished ? 1 : 0,
      state.streamCodecFrames,
      extent,
    ].join(":");
    const requiresRebuild = force
      || structureKey !== state.streamTrackStructureKey
      || extent < state.streamTrackRenderedExtent;
    if (!requiresRebuild && renderKey === state.streamTrackRenderKey) {
      updateTrackPlaybackMarker();
      return;
    }
    state.streamTrackRenderKey = renderKey;
    state.streamTrackStructureKey = structureKey;

    if (!requiresRebuild) {
      const previouslyGenerated = state.streamTrackRenderedCodecFrames;
      const existingEnd = Math.min(extent, state.streamTrackRenderedExtent);
      for (let frame = previouslyGenerated; frame < Math.min(state.streamCodecFrames, existingEnd); frame += 1) {
        const textCell = getTextTrackCell(frame);
        const codecCell = getCodecTrackCell(frame);
        if (codecCell) {
          codecCell.classList.remove("future");
          codecCell.classList.add("generated");
          codecCell.title = `等效 12.5 fps Codec 帧 F${frame}，PCM 已生成；播放区间约 ${(frame / CODEC_FRAME_RATE).toFixed(3)}–${((frame + 1) / CODEC_FRAME_RATE).toFixed(3)} 秒`;
        }
        if (textCell && state.streamInputFinished && frame > tokenCount) textCell.classList.remove("future");
      }

      if (extent > state.streamTrackRenderedExtent) {
        const pairAppend = document.createDocumentFragment();
        for (let frame = state.streamTrackRenderedExtent; frame < extent; frame += 1) {
          pairAppend.append(makeDualTokenPair(frame, tokenCount));
        }
        elements.dualTrackItems.append(pairAppend);
      }
      state.streamTrackRenderedExtent = extent;
      state.streamTrackRenderedCodecFrames = state.streamCodecFrames;
      updateTrackPlaybackMarker();
      updateCodecGenerationHead();
      return;
    }

    const pairFragment = document.createDocumentFragment();
    for (let frame = 0; frame < extent; frame += 1) {
      pairFragment.append(makeDualTokenPair(frame, tokenCount));
    }
    elements.dualTrackItems.replaceChildren(pairFragment);
    state.streamTrackRenderedExtent = extent;
    state.streamTrackRenderedCodecFrames = state.streamCodecFrames;
    updateTrackPlaybackMarker();
    updateCodecGenerationHead();
  }

  function updateTrackPlaybackMarker(frameChanged = true) {
    const currentFrame = state.streamPlaybackFrame;
    const hasCurrentFrame = currentFrame >= 0 && currentFrame < state.streamCodecFrames;
    if (!hasCurrentFrame) return;

    const exactFrame = Math.max(0, state.streamPlaybackSeconds * CODEC_FRAME_RATE);
    const frameFraction = Math.min(1, exactFrame - currentFrame);
    if (frameChanged || state.streamStyledPlaybackFrame !== currentFrame) {
      syncCodecPlaybackCells(currentFrame);
    }
    const currentCodec = getCodecTrackCell(currentFrame);
    if (currentCodec) {
      currentCodec.style.setProperty("--play-progress", `${(frameFraction * 100).toFixed(1)}%`);
      const detail = currentCodec.querySelector("small");
      if (detail) detail.textContent = `${state.streamPlaybackPhase} ${Math.round(frameFraction * 100)}%`;
    }
  }

  function updateCodecGenerationHead() {
    const lastFrame = state.streamCodecFrames - 1;
    elements.dualStreamCard.classList.toggle("generation-complete", state.streamGenerationComplete && lastFrame >= 0);
    if (lastFrame >= 0 && state.streamGenerationComplete) {
      elements.codecGeneratedMetric.textContent = `AR DONE F${lastFrame} · ${state.streamCodecFrames} 帧`;
    }
  }

  function syncCodecPlaybackCells(currentFrame) {
    const previousText = elements.dualTrackItems.querySelector(".condition-current");
    if (previousText) previousText.classList.remove("condition-current");
    const currentText = getTextTrackCell(currentFrame);
    if (currentText) currentText.classList.add("condition-current");

    const previousFrame = state.streamStyledPlaybackFrame;
    const resetCell = (frame, played) => {
      const cell = getCodecTrackCell(frame);
      if (!cell) return;
      cell.classList.remove("playing");
      cell.classList.toggle("played", played);
      cell.style.removeProperty("--play-progress");
      const detail = cell.querySelector("small");
      if (detail) detail.textContent = played ? "DONE" : "80ms";
    };

    if (previousFrame < currentFrame) {
      for (let frame = Math.max(0, previousFrame); frame < currentFrame; frame += 1) resetCell(frame, true);
    } else if (previousFrame > currentFrame) {
      for (let frame = currentFrame + 1; frame <= previousFrame; frame += 1) resetCell(frame, false);
    }
    const currentCodec = getCodecTrackCell(currentFrame);
    if (currentCodec) {
      currentCodec.classList.remove("played");
      currentCodec.classList.add("playing");
    }
    state.streamStyledPlaybackFrame = currentFrame;
  }

  function animateCodecCommit(startFrame, endFrame) {
    if (endFrame <= startFrame) return;
    elements.dualTrackItems.querySelectorAll(".decoding").forEach((cell) => cell.classList.remove("decoding"));
    const visibleStart = Math.max(startFrame, endFrame - 32);
    for (let frame = visibleStart; frame < endFrame; frame += 1) {
      const cell = getCodecTrackCell(frame);
      if (!cell) continue;
      cell.classList.remove("codec-committed");
      cell.style.setProperty("--commit-delay", `${Math.min(frame - visibleStart, 12) * 16}ms`);
      // Restart the one-shot commit animation when a new decoder chunk arrives.
      void cell.offsetWidth;
      cell.classList.add("codec-committed");
    }
    const newest = getCodecTrackCell(endFrame - 1);
    if (newest) newest.classList.add("decoding");
  }

  function getTokenPair(frame) {
    return elements.dualTrackItems && elements.dualTrackItems.children[frame]
      ? elements.dualTrackItems.children[frame]
      : null;
  }

  function getTextTrackCell(frame) {
    const pair = getTokenPair(frame);
    return pair ? pair.querySelector(".text-condition-cell") : null;
  }

  function getCodecTrackCell(frame) {
    const pair = getTokenPair(frame);
    return pair ? pair.querySelector(".codec-frame") : null;
  }

  function makeDualTokenPair(frame, tokenCount) {
    const pair = document.createElement("span");
    pair.className = "dual-token-pair";
    pair.dataset.frame = String(frame);

    const step = document.createElement("small");
    step.className = "pair-step";
    step.textContent = `STEP ${frame}`;

    const coupling = document.createElement("i");
    coupling.className = "pair-coupling";
    coupling.textContent = "·";
    coupling.setAttribute("aria-hidden", "true");

    pair.append(
      step,
      makeTextTrackCell(frame, tokenCount),
      coupling,
      makeCodecTrackCell(frame),
    );
    return pair;
  }

  function makeTextTrackCell(frame, tokenCount) {
    const isCurrent = frame === state.streamPlaybackFrame;
    if (tokenCount === 0) {
      return makeTrackCell(
        `dual-track-cell text-condition-cell condition-token pending${isCurrent ? " condition-current" : ""}`,
        "…",
        "WAIT",
        `模型步 F${frame}：等待 tokenizer 计划`,
        frame,
      );
    }

    if (frame < tokenCount) {
      const piece = state.streamTokenPieces[frame];
      const tokenId = state.streamTokenIds[frame];
      const sent = frame < state.streamTokenCount;
      return makeTrackCell(
        `dual-track-cell text-condition-cell condition-token ${sent ? "sent" : "pending"}${isCurrent ? " condition-current" : ""}`,
        `T${frame}`,
        visibleToken(piece) || "∅",
        `模型步 F${frame} 的文本条件：Token ${frame + 1}，ID ${tokenId}，内容 ${JSON.stringify(piece)}；${sent ? "已送入 Talker" : "尚未送入 Talker"}`,
        frame,
      );
    }

    if (frame === tokenCount) {
      const committed = state.streamInputFinished;
      return makeTrackCell(
        `dual-track-cell text-condition-cell condition-eos${committed ? "" : " pending"}${isCurrent ? " condition-current" : ""}`,
        "E",
        "END",
        `模型步 F${frame}：Text EOS${committed ? " 已提交" : " 尚未提交"}；它只结束文本条件轨，不代表音频立即结束`,
        frame,
      );
    }

    const applied = state.streamInputFinished && frame < state.streamCodecFrames;
    return makeTrackCell(
      `dual-track-cell text-condition-cell condition-pad${applied ? "" : " future"}${isCurrent ? " condition-current" : ""}`,
      "P",
      "PAD",
      `模型步 F${frame}：Text EOS 之后由模型内部自动使用 PAD 条件；不是浏览器发送的文本 token`,
      frame,
    );
  }

  function makeCodecTrackCell(frame) {
    const generated = frame < state.streamCodecFrames;
    const playing = frame === state.streamPlaybackFrame;
    const played = generated && state.streamPlaybackFrame >= 0 && frame < state.streamPlaybackFrame;
    return makeTrackCell(
      `dual-track-cell codec-frame ${generated ? "generated" : "future"}${played ? " played" : ""}${playing ? " playing" : ""}`,
      `F${frame}`,
      played ? "DONE" : "80ms",
      `等效 12.5 fps Codec 帧 F${frame}${generated ? "，PCM 已生成" : "，等待生成"}；播放区间约 ${(frame / CODEC_FRAME_RATE).toFixed(3)}–${((frame + 1) / CODEC_FRAME_RATE).toFixed(3)} 秒`,
      frame,
    );
  }

  function makeTrackCell(className, label, detail, title, frame) {
    const cell = document.createElement("span");
    cell.className = className;
    cell.title = title;
    cell.dataset.frame = String(frame);
    const strong = document.createElement("strong");
    strong.textContent = label;
    const small = document.createElement("small");
    small.textContent = detail;
    cell.append(strong, small);
    return cell;
  }

  function visibleToken(token) {
    if (token === " ") return "␠";
    if (token === "\n") return "↵";
    if (token === "\t") return "⇥";
    return String(token).replace(/^Ġ/, "␠").replace(/^▁/, "␠");
  }

  function showError(message, toast = false) {
    elements.errorMessage.textContent = message;
    if (toast) showToast(message, true);
  }

  function showToast(message, isError = false) {
    window.clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle("error", isError);
    elements.toast.classList.add("show");
    state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 3300);
  }

  async function readError(response) {
    try {
      const data = await response.json();
      return data.error || data.detail || `请求失败（HTTP ${response.status}）`;
    } catch (_) {
      return `请求失败（HTTP ${response.status}）`;
    }
  }

  function formatLatency(milliseconds) {
    return milliseconds < 1000 ? `${Math.round(milliseconds)}ms` : `${(milliseconds / 1000).toFixed(2)}s`;
  }

  function delay(milliseconds, signal) {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(new DOMException("生成已取消", "AbortError"));
      };
      const timer = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, milliseconds);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  function timestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[char]);
  }

  function pcmChunksToWav(chunks, totalBytes, sampleRate) {
    const dataBytes = totalBytes - (totalBytes % 2);
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataBytes, true);

    const output = new Uint8Array(buffer, 44);
    let offset = 0;
    for (const chunk of chunks) {
      const remaining = dataBytes - offset;
      if (remaining <= 0) break;
      const part = chunk.subarray(0, Math.min(chunk.length, remaining));
      output.set(part, offset);
      offset += part.length;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function writeAscii(view, offset, value) {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  }

  function readAudioDuration(url) {
    return new Promise((resolve) => {
      const audio = new Audio();
      const timer = window.setTimeout(() => resolve(Number.NaN), 5000);
      audio.addEventListener("loadedmetadata", () => {
        window.clearTimeout(timer);
        resolve(audio.duration);
      }, { once: true });
      audio.addEventListener("error", () => {
        window.clearTimeout(timer);
        resolve(Number.NaN);
      }, { once: true });
      audio.src = url;
    });
  }

  function setupVisualizer() {
    const canvas = elements.visualizer;
    if (!canvas) {
      const tick = () => {
        updateDualTrackPlayback();
        window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
      return;
    }
    const context = canvas.getContext("2d");
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    new ResizeObserver(resize).observe(canvas);

    const draw = (time) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      context.clearRect(0, 0, width, height);
      if (state.waveMode !== "idle") drawWave(context, width, height, time);
      updateDualTrackPlayback();
      window.requestAnimationFrame(draw);
    };
    window.requestAnimationFrame(draw);
  }

  function activateVisualizer() {
    if (elements.visualizer) elements.visualizer.classList.add("active");
    if (elements.emptyVisualizer) elements.emptyVisualizer.classList.add("hidden");
  }

  function feedVisualizer(samples) {
    if (!elements.visualizer || !samples.length) return;
    const target = state.waveSamples;
    const stride = Math.max(1, Math.floor(samples.length / target.length));
    let energy = 0;
    for (let i = 0; i < target.length; i += 1) {
      const start = Math.min(i * stride, samples.length - 1);
      const end = Math.min(start + stride, samples.length);
      let peak = 0;
      for (let j = start; j < end; j += 1) peak = Math.max(peak, Math.abs(samples[j]));
      target[i] = peak;
      energy += peak;
    }
    state.waveEnergy = Math.min(1, energy / target.length * 3.2);
    state.waveMode = "pcm";
  }

  function drawWave(context, width, height, time) {
    const count = 64;
    const gap = 3;
    const barWidth = Math.max(1.5, (width - gap * (count - 1)) / count);
    const center = height / 2;
    const maxHeight = height * 0.66;
    const gradient = context.createLinearGradient(0, center - maxHeight / 2, 0, center + maxHeight / 2);
    gradient.addColorStop(0, "rgba(160, 129, 255, .92)");
    gradient.addColorStop(0.52, "rgba(114, 106, 241, .62)");
    gradient.addColorStop(1, "rgba(73, 211, 204, .83)");
    context.strokeStyle = gradient;
    context.lineWidth = barWidth;
    context.lineCap = "round";

    for (let i = 0; i < count; i += 1) {
      let amplitude;
      if (state.waveMode === "pcm") {
        const index = Math.floor(i / count * state.waveSamples.length);
        amplitude = Math.min(1, state.waveSamples[index] * 2.5);
      } else {
        const phase = time * 0.003 + i * 0.42;
        const envelope = 0.35 + 0.65 * Math.sin((i / (count - 1)) * Math.PI);
        amplitude = (0.12 + Math.abs(Math.sin(phase) * Math.cos(phase * 0.37)) * 0.4) * envelope;
        if (state.waveMode === "ready") amplitude *= 0.48;
      }
      const heightValue = Math.max(3, amplitude * maxHeight);
      const x = i * (barWidth + gap) + barWidth / 2;
      context.globalAlpha = 0.44 + amplitude * 0.56;
      context.beginPath();
      context.moveTo(x, center - heightValue / 2);
      context.lineTo(x, center + heightValue / 2);
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  initialize();
})();
