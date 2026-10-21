import { PhononTTS } from './vendor/phonon-tts/index.js';
import { extractText, splitPlain } from './extract.js';

const $ = (id) => document.getElementById(id);
const PAUSE_BETWEEN = 0.4; // seconds of silence between paragraphs
const LEAD = 20; // generate at most this many seconds ahead of playback

let tts = null;
let loading = null; // Promise<PhononTTS> while the model loads
let docName = 'document';
let paragraphs = [];
let run = null; // the current Listen or Save job
let wavUrl = null;
// Generated audio per paragraph, as 16-bit PCM, so Save reuses what Listen already made.
const audioCache = new Map();
const cacheKey = (voice, text) => `${voice}\u0000${text}`;

// ---------- model ----------

// Phonon 31M (English, Apache 2.0), pinned to the commit phonon-tts 0.4.0 ships as its default.
const MODEL_BASE = 'https://huggingface.co/gradium/phonon-31m-en/resolve/8c64b55ec301728e2d1695bfea87a08a267d0c2d/';
// The voice catalog (from Gradium's demo Space): voice files live in gradium/phonon-voices.
const catalog = await (await fetch('./voices.json')).json();

function modelSpec() {
  const voices = { default: MODEL_BASE + 'default-voice.safetensors' };
  for (const v of catalog.voices) voices[v.name] = catalog.base + v.file;
  return {
    config: MODEL_BASE + 'config.json',
    tokenizer: MODEL_BASE + 'tokenizer.json',
    weights: { q8: MODEL_BASE + 'model.q8.gguf' },
    voices,
    defaultVoice: 'default',
  };
}

function setStatus(text) {
  $('status').textContent = text;
}

function setProgress(fraction) {
  const bar = $('progress');
  bar.hidden = fraction == null;
  if (fraction == null) return;
  if (Number.isNaN(fraction)) bar.removeAttribute('value');
  else bar.value = fraction;
}

function loadModel() {
  const device = $('device').value;
  tts?.dispose();
  tts = null;
  $('voice').disabled = true;
  updateButtons();
  setStatus('Loading the voice model…');
  setProgress(NaN);
  const promise = PhononTTS.load({
    lang: 'en',
    model: modelSpec(),
    device,
    onProgress({ file, loaded, total, cached }) {
      if (file !== 'weights' || cached || !total) return;
      setProgress(loaded / total);
      setStatus(`Downloading the voice model (once): ${Math.round(loaded / 1e6)} of ${Math.round(total / 1e6)} MB`);
    },
  }).then((engine) => {
    if (loading !== promise) {
      engine.dispose(); // the device changed while this was loading
      return loading;
    }
    tts = engine;
    fillVoices(engine);
    setProgress(null);
    const where = engine.device === 'webgpu' ? 'the GPU' : `the CPU, ${engine.threads} thread${engine.threads > 1 ? 's' : ''}`;
    setStatus(`Voice model ready, running on ${where}.`);
    updateButtons();
    return engine;
  });
  promise.catch((error) => {
    if (loading !== promise) return;
    console.error(error);
    setProgress(null);
    if (device !== 'cpu') {
      $('device').value = 'cpu';
      setStatus(`The GPU could not start (${error.message}). Switching to the CPU…`);
      loading = loadModel();
    } else {
      setStatus(`Could not load the voice model: ${error.message}`);
    }
  });
  loading = promise;
  return promise;
}

function fillVoices(engine) {
  const select = $('voice');
  const previous = select.value;
  const groups = Object.entries(catalog.locales).map(([locale, label]) => {
    const group = Object.assign(document.createElement('optgroup'), { label });
    for (const v of catalog.voices.filter((v) => v.locale === locale && engine.voices.includes(v.name))) {
      const option = new Option(v.gender ? `${v.name} (${v.gender})` : v.name, v.name);
      option.title = v.description ?? '';
      group.append(option);
    }
    return group;
  });
  select.replaceChildren(new Option('Default', 'default'), ...groups.filter((g) => g.children.length));
  select.value = engine.voices.includes(previous) ? previous : engine.voices.includes('default') ? 'default' : engine.voices[0];
  select.disabled = false;
}

if (navigator.gpu) {
  $('device').append(new Option('GPU (WebGPU)', 'webgpu'));
} else {
  $('device').disabled = true;
  $('device').title = 'This browser has no WebGPU';
}
$('device').addEventListener('change', () => {
  stop();
  loading = loadModel();
});

// ---------- opening documents ----------

async function openFile(file) {
  if (!file) return;
  stop();
  docName = file.name.replace(/\.[^.]+$/, '') || 'document';
  setStatus(`Reading ${file.name}…`);
  try {
    const result = await extractText(file);
    setParagraphs(result.paragraphs);
    const words = countWords(paragraphs);
    const parts = [`<b>${escapeHtml(file.name)}</b>`];
    if (result.pages) parts.push(`${result.pages} page${result.pages > 1 ? 's' : ''}`);
    parts.push(`${words.toLocaleString()} words`, `about ${formatDuration((words / 160) * 60)} of audio`);
    $('doc-info').innerHTML = parts.join(' · ');
    $('doc-info').hidden = false;
    setStatus(result.warning ?? (tts ? '' : $('status').textContent));
  } catch (error) {
    console.error(error);
    setStatus(error.message);
  }
}

function setParagraphs(list) {
  paragraphs = list;
  $('editor').value = list.join('\n\n');
  renderReader();
  $('tabs').hidden = !list.length;
  showTab('read');
  updateButtons();
}

function renderReader() {
  const reader = $('reader');
  if (!paragraphs.length) {
    reader.innerHTML = '<p class="empty">No readable text found.</p>';
    return;
  }
  const hint = Object.assign(document.createElement('div'), {
    className: 'hint',
    textContent: 'Click any paragraph to start reading from there.',
  });
  reader.replaceChildren(hint, ...paragraphs.map((text, i) => {
    const p = document.createElement('p');
    p.textContent = text;
    p.dataset.index = i;
    return p;
  }));
}

$('file').addEventListener('change', (e) => openFile(e.target.files[0]));
for (const button of document.querySelectorAll('[data-sample]')) {
  button.addEventListener('click', async () => {
    const url = button.dataset.sample;
    const blob = await (await fetch(url)).blob();
    openFile(new File([blob], url.split('/').pop(), { type: blob.type }));
  });
}
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  openFile(e.dataTransfer.files[0]);
});

function showTab(which) {
  const editing = which === 'edit';
  if (!editing && !$('editor').hidden) {
    // Leaving the editor: take its text as the document.
    const edited = splitPlain($('editor').value);
    if (edited.join('\n\n') !== paragraphs.join('\n\n')) {
      stop();
      paragraphs = edited;
      renderReader();
      updateButtons();
    }
  }
  if (editing) stop();
  $('editor').hidden = !editing;
  $('reader').hidden = editing;
  $('tab-read').setAttribute('aria-pressed', String(!editing));
  $('tab-edit').setAttribute('aria-pressed', String(editing));
}
$('tab-read').addEventListener('click', () => showTab('read'));
$('tab-edit').addEventListener('click', () => showTab('edit'));

// ---------- listening ----------

$('play').addEventListener('click', () => {
  if (run?.kind === 'listen') {
    if (run.ctx.state === 'running') {
      run.ctx.suspend();
      $('play').textContent = 'Resume';
    } else {
      run.ctx.resume();
      $('play').textContent = 'Pause';
    }
    return;
  }
  listen(0);
});

$('reader').addEventListener('click', (e) => {
  const p = e.target.closest('p[data-index]');
  if (p && paragraphs.length && !run?.kind?.startsWith('save')) listen(Number(p.dataset.index));
});

async function listen(from) {
  stop();
  // The AudioContext is made inside the click: browsers only let a user gesture start audio.
  const ctx = new AudioContext({ sampleRate: 24000 });
  const job = { kind: 'listen', ctx, controller: new AbortController(), starts: [], from };
  run = job;
  updateButtons();
  $('play').textContent = 'Pause';
  markPlayed(from);

  try {
    const engine = tts ?? (await loading);
    if (run !== job) return;
    const voice = $('voice').value;
    setStatus('Generating speech…');
    let at = ctx.currentTime + 0.15;
    requestAnimationFrame(() => follow(job));

    for (let i = from; i < paragraphs.length && run === job; i++) {
      // Stay a little ahead of playback instead of generating the whole document up front.
      while (run === job && at - ctx.currentTime > LEAD) await sleep(250);
      if (run !== job) break;

      job.starts.push({ index: i, time: at });
      const text = paragraphs[i];
      const cached = audioCache.get(cacheKey(voice, text));
      if (cached) {
        at = schedule(ctx, int16ToFloat(cached), at);
      } else {
        const chunks = [];
        const speech = engine.stream(text, { voice, signal: job.controller.signal });
        for await (const pcm of speech) {
          chunks.push(pcm);
          at = schedule(ctx, pcm, at);
        }
        const stats = await speech.done;
        if (stats.cancelled || run !== job) break;
        audioCache.set(cacheKey(voice, text), floatToInt16(chunks));
      }
      at += PAUSE_BETWEEN;
      if (run === job) setStatus(`Generated ${i + 1} of ${paragraphs.length} paragraphs.`);
    }

    if (run !== job) return;
    job.endTime = at;
    setStatus('All paragraphs generated. Use Save audio for a file.');
    while (run === job && ctx.currentTime < at) await sleep(250);
    if (run === job) {
      setStatus('Finished.');
      stop();
    }
  } catch (error) {
    if (error.name === 'AbortError' || run !== job) return;
    console.error(error);
    setStatus(`Something went wrong: ${error.message}`);
    stop();
  }
}

function schedule(ctx, pcm, at) {
  if (ctx.state === 'closed') return at;
  const buffer = ctx.createBuffer(1, pcm.length, 24000);
  buffer.copyToChannel(pcm, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  const start = Math.max(at, ctx.currentTime);
  source.start(start);
  return start + buffer.duration;
}

// Highlight the paragraph being spoken and keep it in view.
function follow(job) {
  if (run !== job) return;
  const now = job.ctx.currentTime;
  let current = null;
  for (const s of job.starts) if (s.time <= now) current = s.index;
  if (current !== null && current !== job.shown) {
    job.shown = current;
    markPlayed(current);
    const el = $('reader').querySelector(`p[data-index="${current}"]`);
    el?.classList.add('speaking');
    const box = el?.getBoundingClientRect();
    if (box && (box.top < 90 || box.bottom > innerHeight)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  requestAnimationFrame(() => follow(job));
}

function markPlayed(current) {
  for (const p of $('reader').querySelectorAll('p[data-index]')) {
    const i = Number(p.dataset.index);
    p.classList.toggle('played', i < current);
    p.classList.remove('speaking');
  }
}

// ---------- saving ----------

$('export').addEventListener('click', () => saveAudio());

async function saveAudio() {
  stop();
  const job = { kind: 'save', controller: new AbortController() };
  run = job;
  updateButtons();
  $('download').hidden = true;
  setProgress(0);
  try {
    const engine = tts ?? (await loading);
    const voice = $('voice').value;
    const pieces = [];
    const started = performance.now();
    let generatedSamples = 0;
    for (let i = 0; i < paragraphs.length; i++) {
      if (run !== job) return;
      const key = cacheKey(voice, paragraphs[i]);
      let pcm = audioCache.get(key);
      if (!pcm) {
        const audio = await engine.synth(paragraphs[i], { voice, signal: job.controller.signal });
        if (run !== job) return;
        pcm = floatToInt16([audio]);
        audioCache.set(key, pcm);
        generatedSamples += pcm.length;
      }
      pieces.push(pcm, silence(PAUSE_BETWEEN));
      setProgress((i + 1) / paragraphs.length);
      const elapsed = (performance.now() - started) / 1000;
      const speed = generatedSamples ? ` · ${(generatedSamples / 24000 / elapsed).toFixed(1)}× real time` : '';
      setStatus(`Making audio: ${i + 1} of ${paragraphs.length} paragraphs${speed}`);
    }
    const wav = wavBlob(pieces, 24000);
    if (wavUrl) URL.revokeObjectURL(wavUrl);
    wavUrl = URL.createObjectURL(wav);
    const link = $('download');
    link.href = wavUrl;
    link.download = `${docName}.wav`;
    link.textContent = `Download ${docName}.wav (${(wav.size / 1e6).toFixed(1)} MB)`;
    link.hidden = false;
    const seconds = pieces.reduce((n, p) => n + p.length, 0) / 24000;
    setStatus(`Done: ${formatDuration(seconds)} of audio.`);
    link.click();
  } catch (error) {
    if (error.name === 'AbortError' || run !== job) return;
    console.error(error);
    setStatus(`Something went wrong: ${error.message}`);
  } finally {
    if (run === job) {
      run = null;
      setProgress(null);
      updateButtons();
    }
  }
}

// ---------- shared ----------

$('stop').addEventListener('click', () => {
  const was = run?.kind;
  stop();
  if (was) setStatus('Stopped.');
});

function stop() {
  const job = run;
  if (!job) return;
  run = null;
  job.controller.abort();
  job.ctx?.close();
  for (const p of $('reader').querySelectorAll('p.speaking')) p.classList.remove('speaking');
  setProgress(null);
  $('play').textContent = 'Listen';
  updateButtons();
}

function updateButtons() {
  const ready = paragraphs.length > 0 && (tts || loading);
  $('play').disabled = !ready || run?.kind === 'save';
  $('export').disabled = !ready || !!run;
  $('stop').disabled = !run;
  $('voice').disabled = !tts || !!run;
}

function floatToInt16(chunks) {
  const out = new Int16Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]));
      out[o++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }
  return out;
}

function int16ToFloat(pcm) {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
  return out;
}

const silence = (seconds) => new Int16Array(Math.round(seconds * 24000));

// A 16-bit mono WAV built from parts, so a long document never needs one giant buffer.
function wavBlob(parts, sampleRate) {
  const dataBytes = parts.reduce((n, p) => n + p.byteLength, 0);
  const header = new DataView(new ArrayBuffer(44));
  const text = (offset, s) => [...s].forEach((c, i) => header.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  header.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, 1, true); // mono
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, 'data');
  header.setUint32(40, dataBytes, true);
  return new Blob([header, ...parts], { type: 'audio/wav' });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const countWords = (list) => list.reduce((n, p) => n + p.split(/\s+/).filter(Boolean).length, 0);
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function formatDuration(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 1) return `${Math.max(1, Math.round(seconds))} s`;
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

loading = loadModel();
