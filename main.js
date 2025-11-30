const NOTES = {
  A: { freq: 440.0, audioId: "audio_A" }, // A4
  B: { freq: 493.88, audioId: "audio_B" },
  C: { freq: 523.25, audioId: "audio_C" },
  D: { freq: 587.33, audioId: "audio_D" },
  E: { freq: 659.25, audioId: "audio_E" },
  F: { freq: 698.46, audioId: "audio_F" },
  G: { freq: 783.99, audioId: "audio_G" }
};

const MAX_CENTS = 50; // range each side for display

const noteButtons = Array.from(
  document.querySelectorAll(".note-buttons button")
);
const targetNoteEl = document.getElementById("targetNote");
const currentFreqEl = document.getElementById("currentFreq");
const meterNeedleEl = document.getElementById("meterNeedle");
const centsValueEl = document.getElementById("centsValue");
const mainPanel = document.querySelector(".main-panel");

let audioContext = null;
let analyser = null;
let dataBuffer = null;
let listening = false;
let rafId = null;
let targetNote = null;

const elementSourceMap = new WeakMap();

function setTargetNote(name) {
  targetNote = NOTES[name] || null;

  noteButtons.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.note === name)
  );

  if (targetNote) {
    targetNoteEl.textContent = name;
    mainPanel.classList.remove("no-target");
  } else {
    targetNoteEl.textContent = "–";
    mainPanel.classList.add("no-target");
  }
}

function startAnalyzingFromElement(el) {
  if (!el) return;
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (!analyser) {
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;
    analyser.smoothingTimeConstant = 0.85;
    dataBuffer = new Float32Array(analyser.fftSize);
    analyser.connect(audioContext.destination);
  }

  let source = elementSourceMap.get(el);
  if (!source) {
    source = audioContext.createMediaElementSource(el);
    source.connect(analyser);
    elementSourceMap.set(el, source);
  }

  listening = true;
  mainPanel.classList.remove("no-input");
  loop();
}

function stopAnalyzing() {
  listening = false;
  mainPanel.classList.add("no-input");
  if (rafId) cancelAnimationFrame(rafId);
}

function playReference(noteName) {
  const info = NOTES[noteName];
  if (!info) return;
  const el = document.getElementById(info.audioId);
  if (!el) return;
  el.currentTime = 0;

  // Attach end handler once
  if (!el._hasEndHandler) {
    el.addEventListener("ended", () => {
      stopAnalyzing();
      currentFreqEl.textContent = "0.0 Hz";
      meterNeedleEl.classList.add("off");
      centsValueEl.textContent = "0";
    });
    el._hasEndHandler = true;
  }

  el.play().then(() => {
    startAnalyzingFromElement(el);
  }).catch(() => {});
}

function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) {
    const val = buf[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

  let r1 = 0,
    r2 = SIZE - 1,
    thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < thres) {
      r1 = i;
      break;
    }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < thres) {
      r2 = SIZE - i;
      break;
    }
  }

  buf = buf.slice(r1, r2);
  const newSize = buf.length;

  const c = new Array(newSize).fill(0);
  for (let i = 0; i < newSize; i++) {
    for (let j = 0; j < newSize - i; j++) {
      c[i] = c[i] + buf[j] * buf[j + i];
    }
  }

  let d = 0;
  while (d < newSize && c[d] > c[d + 1]) d++;
  let maxval = -1,
    maxpos = -1;
  for (let i = d; i < newSize; i++) {
    if (c[i] > maxval) {
      maxval = c[i];
      maxpos = i;
    }
  }
  if (maxpos <= 0) return -1;

  let T0 = maxpos;
  const x1 = c[T0 - 1],
    x2 = c[T0],
    x3 = c[T0 + 1];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (a) T0 = T0 - b / (2 * a);

  return sampleRate / T0;
}

function freqToCentsDiff(freq, refFreq) {
  if (!freq || freq <= 0 || !refFreq || refFreq <= 0) return null;
  return 1200 * Math.log2(freq / refFreq);
}

function loop() {
  if (!listening || !analyser) return;
  analyser.getFloatTimeDomainData(dataBuffer);
  const freq = autoCorrelate(dataBuffer, audioContext.sampleRate);

  if (freq > 0) {
    currentFreqEl.textContent = freq.toFixed(1) + " Hz";
  } else {
    currentFreqEl.textContent = "0.0 Hz";
  }

  let cents = null;
  if (targetNote && freq > 0) {
    cents = freqToCentsDiff(freq, targetNote.freq);
  }

  if (cents == null) {
    meterNeedleEl.classList.add("off");
    centsValueEl.textContent = "0";
  } else {
    meterNeedleEl.classList.remove("off");
    const clamped = Math.max(-MAX_CENTS, Math.min(MAX_CENTS, cents));
    const percent = (clamped + MAX_CENTS) / (2 * MAX_CENTS);
    const left = 4 + percent * 92; // keep inside edges
    meterNeedleEl.style.left = left + "%";
    centsValueEl.textContent = Math.round(cents);

    const absCents = Math.abs(cents);
    if (absCents < 5) {
      meterNeedleEl.style.background = "var(--accent)";
      meterNeedleEl.style.boxShadow =
        "0 0 16px rgba(245, 196, 107, 0.8)";
      centsValueEl.style.color = "var(--accent)";
    } else if (absCents < 15) {
      meterNeedleEl.style.background = "#ffd27e";
      meterNeedleEl.style.boxShadow =
        "0 0 10px rgba(255, 210, 126, 0.6)";
      centsValueEl.style.color = "#ffd27e";
    } else {
      meterNeedleEl.style.background = "var(--danger)";
      meterNeedleEl.style.boxShadow = "0 0 8px rgba(255, 107, 107, 0.7)";
      centsValueEl.style.color = "var(--danger)";
    }
  }

  rafId = requestAnimationFrame(loop);
}

// Event wiring

noteButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const note = btn.dataset.note;
    setTargetNote(note);
    playReference(note);
  });
});

// Initial state
mainPanel.classList.add("no-target", "no-input");