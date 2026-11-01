/* ============================================================================
   뽀모도로 타이머 스크립트
   ----------------------------------------------------------------------------
   구조
     1. CONFIG      : 시간, 소리, 세그먼트 타이머 등 기본 설정값
     2. DOM 요소    : 화면에서 자주 쓰는 요소를 미리 찾아둠
     3. 상태(state) : 타이머 상태 / 세그먼트 상태 / 사용자 설정
     4. 오디오      : 시작음 / 완료음 / 초과 경고음 (Web Audio API 사용)
     5. 화면 그리기 : 뽀모도로 시간, 링, 버튼, 점(dot) 표시
     6. 타이머 동작 : 시작 / 일시정지 / 초기화 / 모드 변경 / 완료
     7. 세그먼트    : 10초~5분 보조 타이머 (집중 중에만 감소)
     8. 음악 플레이어: MP3 선택, 재생, 재생 위치, 볼륨
     9. 목표        : 왼쪽 사이드바 목표 추가 / 완료(트럼펫)
     10. 이벤트 연결 : 버튼 클릭, 키보드 단축키
   ============================================================================ */

/* ----------------------------------------------------------------------------
   1. 기본 설정
   ----------------------------------------------------------------------------
   ★ 원하는 값을 여기서 바로 바꾸면 됩니다.
   - durations      : 각 모드의 길이 (밀리초 기준, 1분 = 60 * 1000)
   - longBreakEvery : 집중 몇 회마다 긴 휴식을 줄지
   - startSound     : 타이머를 시작할 때 나는 소리 (volume 0~1)
   - completeSound  : 타이머가 끝났을 때 나는 소리
   - segmentWarning : 세그먼트 타이머 시간이 초과됐을 때 나는 경고음
   - segment        : 세그먼트 타이머의 처음 선택 시간(초)
   - volume         : 음악 볼륨 슬라이더의 처음 값
   ※ 음악 볼륨 슬라이더는 MP3 소리에만 적용됩니다. 알림음은 위 volume 값으로
     조절하세요.
   -------------------------------------------------------------------------- */
const CONFIG = {
  durations: {
    focus: 25 * 60 * 1000, // 집중 25분
    short: 5 * 60 * 1000, // 짧은 휴식 5분
    long: 15 * 60 * 1000, // 긴 휴식 15분
  },
  longBreakEvery: 4, // 집중 4회마다 긴 휴식

  startSound: {
    enabled: true,
    volume: 0.12,
  },

  completeSound: {
    enabled: true,
    volume: 0.22,
  },

  trumpet: {
    enabled: true, // 목표를 완료했을 때 나는 트럼펫 소리
    volume: 0.12,
  },

  segmentWarning: {
    enabled: true,
    volume: 0.25, // 사이렌 볼륨 (0 ~ 1)
    lowHz: 480, // 사이렌의 낮은 음
    highHz: 1000, // 사이렌의 높은 음
    speedHz: 1, // 1초에 몇 번 오르내릴지 (클수록 빠름)
  },

  segment: {
    defaultSeconds: 10, // 처음 선택되는 세그먼트 (10초)
  },

  volume: {
    defaultPercent: 70, // 음악 볼륨 슬라이더의 처음 값 (%)
  },
};

// 각 모드에서 타이머 아래에 표시할 문구
const LABELS = {
  focus: "집중 시간",
  short: "짧은 휴식",
  long: "긴 휴식",
};

// 원 둘레: 2πr. 진행 링의 길이 계산에 사용
const CIRCUMFERENCE = 2 * Math.PI * 108; // 뽀모도로 링 (r = 108)
const SEGMENT_CIRCUMFERENCE = 2 * Math.PI * 70; // 세그먼트 링 (r = 70)

/* ----------------------------------------------------------------------------
   2. DOM 요소
   -------------------------------------------------------------------------- */
const els = {
  body: document.body,
  timer: document.querySelector(".timer"),
  time: document.getElementById("time"),
  label: document.getElementById("label"),
  startPause: document.getElementById("startPause"),
  reset: document.getElementById("reset"),
  progress: document.querySelector(".ring__progress"),
  modes: document.querySelectorAll(".mode"),
  dots: document.getElementById("dots"),
  count: document.getElementById("count"),

  // 사이드바 - 세그먼트 타이머
  segmentCard: document.getElementById("segmentCard"),
  segmentToggle: document.getElementById("segmentToggle"),
  segmentTimer: document.getElementById("segmentTimer"),
  segmentTime: document.getElementById("segmentTime"),
  segmentLabel: document.getElementById("segmentLabel"),
  segmentProgress: document.querySelector(".segment-ring__progress"),
  segmentButtons: document.querySelectorAll(".segment"),

  // 왼쪽 사이드바 - 목표
  goalAdd: document.getElementById("goalAdd"),
  goalForm: document.getElementById("goalForm"),
  goalInput: document.getElementById("goalInput"),
  goalCancel: document.getElementById("goalCancel"),
  goalList: document.getElementById("goals"),

  // 사이드바 - 음악 플레이어
  volume: document.getElementById("volume"),
  volumeValue: document.getElementById("volumeValue"),
  fileInput: document.getElementById("fileInput"),
  fileButton: document.getElementById("fileButton"),
  fileName: document.getElementById("fileName"),
  seek: document.getElementById("seek"),
  currentTime: document.getElementById("currentTime"),
  duration: document.getElementById("duration"),
  playPause: document.getElementById("playPause"),
  loop: document.getElementById("loop"),
  audio: document.getElementById("audio"),
};

/* ----------------------------------------------------------------------------
   3. 상태
   ----------------------------------------------------------------------------
   remaining : 남은 시간(ms)
   endAt     : 실행 중일 때 "언제 끝나는지"를 절대 시각으로 저장
               (탭이 백그라운드로 가서 타이머가 느려져도 정확하게 유지됨)
   -------------------------------------------------------------------------- */
const state = {
  mode: "focus",
  total: CONFIG.durations.focus,
  remaining: CONFIG.durations.focus,
  running: false,
  endAt: 0,
  completed: 0, // 완료한 집중 횟수
  intervalId: null,
};

// 세그먼트 타이머 상태
// elapsed : 선택한 시간이 지난 만큼(ms). duration 을 넘으면 초과 상태.
// lastAt  : 마지막으로 시간을 계산한 시각 (멈췄다 이어질 때 오차 방지)
const segment = {
  duration: CONFIG.segment.defaultSeconds * 1000,
  elapsed: 0,
  lastAt: 0,
};

// 사용자가 사이드바에서 바꾸는 설정
const settings = {
  musicVolume: CONFIG.volume.defaultPercent / 100, // 0 ~ 1
  segmentEnabled: true, // 세그먼트 타이머 켜기/끄기
};

/* ----------------------------------------------------------------------------
   4. 오디오
   ----------------------------------------------------------------------------
   브라우저 정책상 소리는 "사용자 클릭/키 입력" 이후에만 재생할 수 있습니다.
   그래서 AudioContext 는 start() 같은 사용자 동작 시점에 처음 만듭니다.
   -------------------------------------------------------------------------- */
let audioCtx = null;

// AudioContext 를 준비하고, 잠들어 있으면 깨웁니다.
function getAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null; // 오디오를 지원하지 않는 브라우저

  if (!audioCtx) audioCtx = new AudioCtx();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// 짧은 "삐-" 소리 하나를 재생하는 도우미 함수
function playTone(frequency, offset, duration, volume) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const start = ctx.currentTime + offset;
  const osc = ctx.createOscillator(); // 소리 파형
  const gain = ctx.createGain(); // 이 소리만의 볼륨

  osc.type = "sine";
  osc.frequency.value = frequency;

  // 0 에서 바로 시작하면 "딱" 소리가 나므로 아주 작은 값에서 시작합니다.
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

// ▶ 시작할 때: 낮은 음에서 높은 음으로 살짝 올라가는 소리
function playStartSound() {
  if (!CONFIG.startSound.enabled) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const start = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(520, start);
  osc.frequency.exponentialRampToValueAtTime(880, start + 0.12);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(CONFIG.startSound.volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);

  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 0.18);
}

// ⏰ 끝났을 때: 세 번 울리는 알림음
function playCompleteSound() {
  if (!CONFIG.completeSound.enabled) return;

  const volume = CONFIG.completeSound.volume;
  playTone(784, 0, 0.18, volume); // 첫 음
  playTone(784, 0.22, 0.18, volume); // 두 번째 음
  playTone(1046, 0.44, 0.3, volume); // 마지막은 더 높게
}

// 🎺 트럼펫 소리 한 음
// 톱니파(sawtooth) 두 개를 살짝 어긋나게 겹치고, 필터로 밝기를 조절해
// 금관악기처럼 "빠앙-" 하는 소리를 만듭니다.
function playBrassNote(frequency, offset, duration, volume) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const start = ctx.currentTime + offset;
  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = "sawtooth";
  osc.frequency.value = frequency;

  osc2.type = "sawtooth";
  osc2.frequency.value = frequency * 1.006; // 아주 살짝 어긋나게 해서 두께감을 줌

  // 시작할 때 밝게 열렸다가 서서히 가라앉는 필터
  filter.type = "lowpass";
  filter.Q.value = 1;
  filter.frequency.setValueAtTime(900, start);
  filter.frequency.linearRampToValueAtTime(3400, start + 0.05);
  filter.frequency.linearRampToValueAtTime(1800, start + duration);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.03);
  gain.gain.setValueAtTime(volume * 0.85, start + duration * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(start);
  osc2.start(start);
  osc.stop(start + duration + 0.05);
  osc2.stop(start + duration + 0.05);
}

// 🎺 목표를 완료했을 때: 도-미-솔-도 팡파레
function playTrumpetSound() {
  if (!CONFIG.trumpet.enabled) return;

  const volume = CONFIG.trumpet.volume;
  playBrassNote(523.25, 0, 0.14, volume); // 도(C5)
  playBrassNote(659.25, 0.14, 0.14, volume); // 미(E5)
  playBrassNote(783.99, 0.28, 0.14, volume); // 솔(G5)
  playBrassNote(1046.5, 0.44, 0.5, volume); // 높은 도(C6)를 길게
}

// ⚠️ 세그먼트 시간 초과 시: 사이렌 소리
// startSiren() 으로 켜고, resetSegment()/stopSiren() 으로 끌 때까지 계속 울립니다.
let siren = null; // { gain }

function startSiren() {
  if (!CONFIG.segmentWarning.enabled) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  // 사이렌 노드는 한 번만 만들어 두고, 볼륨만 올리고 내려서 켜고 끕니다.
  if (!siren) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = (CONFIG.segmentWarning.lowHz + CONFIG.segmentWarning.highHz) / 2;

    // LFO(저주파 발진기)로 주파수를 위아래로 흔들어 "위이잉~" 사이렌을 만듭니다.
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = CONFIG.segmentWarning.speedHz;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = (CONFIG.segmentWarning.highHz - CONFIG.segmentWarning.lowHz) / 2;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001; // 처음에는 무음

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.connect(gain).connect(ctx.destination);

    osc.start();
    lfo.start();
    siren = { gain };
  }

  const now = ctx.currentTime;
  siren.gain.gain.cancelScheduledValues(now);
  siren.gain.gain.setValueAtTime(0.0001, now);
  siren.gain.gain.exponentialRampToValueAtTime(CONFIG.segmentWarning.volume, now + 0.3);
}

// 사이렌 끄기 (짧게 페이드아웃)
function stopSiren() {
  if (!siren || !audioCtx) return;

  const now = audioCtx.currentTime;
  const gain = siren.gain.gain;

  if (typeof gain.cancelAndHoldAtTime === "function") {
    gain.cancelAndHoldAtTime(now); // 지금 볼륨에서 바로 이어서 줄이기
  } else {
    gain.cancelScheduledValues(now);
  }
  gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
}

/* ----------------------------------------------------------------------------
   5. 화면 그리기 (뽀모도로)
   -------------------------------------------------------------------------- */
// 1500000(ms) → "25:00"  (타이머용, 올림)
function formatTime(ms) {
  const totalSeconds = Math.ceil(ms / 1000); // 올림: 24:59.4 → 25:00 처럼 보이도록
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// 65.8(초) → "01:05"  (세그먼트/음악 플레이어용, 내림)
function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

// 상태를 화면에 반영합니다. (tick 이 0.2초마다 호출)
function render() {
  const text = formatTime(state.remaining);

  els.time.textContent = text;
  els.label.textContent = LABELS[state.mode];

  // 휴식 중이면 CSS 색상(민트)을 쓰도록 body 에 표시
  els.body.dataset.phase = state.mode === "focus" ? "timer" : "break";
  els.timer.classList.toggle("is-running", state.running);

  // 남은 비율만큼 링을 그립니다. (1 → 꽉 참, 0 → 다 사라짐)
  const progress = state.total === 0 ? 0 : state.remaining / state.total;
  els.progress.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - progress));

  // 버튼 글자: 실행 중 / 멈춤 / 아직 시작 안 함
  const untouched = state.remaining === state.total;
  els.startPause.textContent = state.running ? "일시정지" : untouched ? "시작" : "계속";

  // 현재 모드 버튼 강조
  els.modes.forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "true" : "false");
  });

  // 브라우저 탭 제목에도 남은 시간 표시
  document.title = state.running ? `${text} · ${LABELS[state.mode]}` : "뽀모도로 타이머";

  renderSessions();
}

// 하단 점(dot)을 CONFIG.longBreakEvery 개수만큼 미리 만들어 둡니다.
const dots = Array.from({ length: CONFIG.longBreakEvery }, () => {
  const dot = document.createElement("span");
  dot.className = "dot";
  els.dots.append(dot);
  return dot;
});

// 완료한 집중 횟수를 점과 숫자로 표시
function renderSessions() {
  const cycle = CONFIG.longBreakEvery;
  // 4의 배수일 때는 4개 모두 채워서 "한 사이클 완료"를 보여줍니다.
  const filled = state.completed % cycle === 0 && state.completed > 0 ? cycle : state.completed % cycle;

  dots.forEach((dot, index) => {
    dot.classList.toggle("is-filled", index < filled);
  });
  els.count.textContent = String(state.completed);
}

/* ----------------------------------------------------------------------------
   6. 타이머 동작 (뽀모도로)
   -------------------------------------------------------------------------- */
function stopTicking() {
  if (state.intervalId !== null) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
}

// 0.2초마다 남은 시간을 다시 계산 (setInterval 값이 밀려도 endAt 기준이라 정확함)
function tick() {
  const now = Date.now();

  updateSegment(now); // 집중 중이면 세그먼트 시간도 함께 흐릅니다.

  state.remaining = Math.max(0, state.endAt - now);
  if (state.remaining === 0) {
    complete(); // 0이 되면 완료 처리
    return;
  }

  render();
}

function start() {
  if (state.running || state.remaining === 0) return;

  // 사용자 동작 중이므로 여기서 오디오를 준비하고 시작음을 냅니다.
  playStartSound();

  state.running = true;
  state.endAt = Date.now() + state.remaining;
  segment.lastAt = Date.now(); // 세그먼트가 이 순간부터 흐르도록
  stopTicking();
  state.intervalId = setInterval(tick, 200);

  render();
}

function pause() {
  if (!state.running) return;

  updateSegment(Date.now()); // 멈추기 직전까지 세그먼트 시간 반영
  state.remaining = Math.max(0, state.endAt - Date.now());
  state.running = false;
  stopTicking();
  render();
}

// 시작/일시정지 버튼 하나로 토글
function toggle() {
  if (state.running) {
    pause();
  } else {
    start();
  }
}

// 모드를 바꾸면 항상 그 모드의 처음 시간으로 되돌리고 멈춥니다.
function setMode(mode) {
  updateSegment(Date.now()); // 모드가 바뀌기 전까지의 시간 반영

  state.mode = mode;
  state.total = CONFIG.durations[mode];
  state.remaining = state.total;
  state.running = false;
  segment.lastAt = Date.now();
  stopTicking();
  render();
}

// 시간이 다 되었을 때
function complete() {
  state.running = false;
  stopTicking();

  playCompleteSound(); // 알림음은 여기서 먼저 냅니다.

  if (state.mode === "focus") {
    state.completed += 1;
    // 집중을 마쳤으니 긴 휴식 또는 짧은 휴식으로 이동
    const nextMode = state.completed % CONFIG.longBreakEvery === 0 ? "long" : "short";
    setMode(nextMode);
  } else {
    // 휴식을 마쳤으면 다시 집중으로
    setMode("focus");
  }
}

function reset() {
  setMode(state.mode);
}

/* ----------------------------------------------------------------------------
   7. 세그먼트 타이머
   ----------------------------------------------------------------------------
   - 뽀모도로와 별개로 움직이는 작은 타이머입니다.
   - 뽀모도로가 "집중 모드 + 실행 중"일 때만 시간이 줄어듭니다.
     (일시정지하거나 휴식 모드이면 그 자리에 멈춰 있습니다.)
   - 선택한 시간을 넘기면 경고음이 한 번 울리고, 초과 시간을 +00:03 처럼 표시.
   - Space 키를 누르면 지금 선택한 시간으로 초기화됩니다.
   -------------------------------------------------------------------------- */

// 세그먼트 시간을 진행시킵니다. tick() 에서 호출됩니다.
function updateSegment(now) {
  const active = settings.segmentEnabled && state.running && state.mode === "focus";

  // 집중 중이 아니거나 스위치가 꺼져 있으면 흐르지 않고, 기준 시각만 맞춰 둡니다.
  if (!active) {
    segment.lastAt = now;
    return;
  }

  const delta = Math.max(0, now - segment.lastAt);
  segment.lastAt = now;
  if (delta === 0) return;

  const before = segment.elapsed;
  segment.elapsed += delta;

  // 딱 넘어가는 순간 사이렌을 켭니다. 이후 Space 로 초기화할 때까지 계속 울립니다.
  if (before < segment.duration && segment.elapsed >= segment.duration) {
    startSiren();
  }

  renderSegment();
}

// 세그먼트의 숫자, 라벨, 링을 갱신
function renderSegment() {
  const remaining = segment.duration - segment.elapsed;
  const over = remaining <= 0;

  if (over) {
    // 초과 상태: "+00:03" 처럼 초과한 시간을 보여줌
    els.segmentTime.textContent = `+${formatClock((segment.elapsed - segment.duration) / 1000)}`;
    els.segmentLabel.textContent = "초과 시간";
  } else {
    els.segmentTime.textContent = formatClock(remaining / 1000);
    els.segmentLabel.textContent = "남은 시간";
  }

  els.segmentTimer.classList.toggle("is-over", over);

  // 남은 비율만큼 링이 줄어듭니다. (초과 상태면 링은 빈 상태)
  const ratio = over ? 0 : remaining / segment.duration;
  els.segmentProgress.style.strokeDashoffset = String(
    SEGMENT_CIRCUMFERENCE * (1 - ratio)
  );
}

// 지금 선택된 시간으로 되돌리기 (Space 키) + 사이렌 끄기
function resetSegment() {
  segment.elapsed = 0;
  segment.lastAt = Date.now();
  stopSiren();
  renderSegment();
}

// 시간 선택 토글 (10초 / 30초 / 1분 / 3분 / 5분)
function selectSegment(button) {
  segment.duration = Number(button.dataset.seconds) * 1000;

  els.segmentButtons.forEach((item) => {
    const active = item === button;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-pressed", active ? "true" : "false");
  });

  resetSegment(); // 시간을 바꾸면 처음부터 다시 시작
}

els.segmentButtons.forEach((button) => {
  button.setAttribute("aria-pressed", button.classList.contains("is-active") ? "true" : "false");
  button.addEventListener("click", () => selectSegment(button));
});

// 세그먼트 타이머 켜기/끄기
els.segmentToggle.addEventListener("change", () => {
  settings.segmentEnabled = els.segmentToggle.checked;

  // 꺼짐 상태를 화면에 표시하고, 버튼도 사용할 수 없게 함
  els.segmentCard.classList.toggle("is-off", !settings.segmentEnabled);
  els.segmentButtons.forEach((button) => {
    button.disabled = !settings.segmentEnabled;
  });

  // 켜든 끄든 현재 시간으로 초기화 (사이렌도 여기서 꺼짐)
  resetSegment();
});

/* ----------------------------------------------------------------------------
   8. 음악 플레이어
   -------------------------------------------------------------------------- */

// 8-1. 음악 볼륨 슬라이더 ------------------------------------------------------
function applyVolume() {
  const percent = Number(els.volume.value);

  settings.musicVolume = percent / 100;
  els.volumeValue.textContent = `${Math.round(percent)}%`;
  els.audio.volume = settings.musicVolume;
}

els.volume.addEventListener("input", applyVolume);

// 8-2. 파일 선택 + 재생 -------------------------------------------------------
let objectUrl = null; // 이전에 선택한 파일 주소 (새 파일을 고르면 해제)
let isSeeking = false; // 사용자가 재생 위치를 드래그하는 중인지

// "MP3 선택" 버튼 → 숨겨둔 파일 선택창 열기
els.fileButton.addEventListener("click", () => els.fileInput.click());

// 파일을 선택했을 때
els.fileInput.addEventListener("change", () => {
  const file = els.fileInput.files && els.fileInput.files[0];
  if (!file) return;

  // 이전 파일의 임시 주소는 메모리에서 해제
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);

  els.audio.pause();
  els.audio.src = objectUrl;
  els.audio.load();

  els.fileName.textContent = file.name;
  els.fileName.title = file.name;
  els.playPause.disabled = false;
  els.playPause.textContent = "재생";
  els.currentTime.textContent = "00:00";
  els.seek.max = "0";
  els.seek.value = "0";
  els.duration.textContent = "00:00";

  // 파일을 고른 직후 바로 재생 시도 (브라우저가 막으면 버튼으로 재생)
  els.audio.play().catch(() => {
    /* 자동 재생이 막히면 조용히 무시 */
  });
});

// 재생 / 일시정지
els.playPause.addEventListener("click", () => {
  if (els.audio.paused) {
    els.audio.play().catch(() => {});
  } else {
    els.audio.pause();
  }
});

// 재생 상태가 바뀌면 버튼 글자도 바꿈
els.audio.addEventListener("play", () => {
  els.playPause.textContent = "일시정지";
});
els.audio.addEventListener("pause", () => {
  els.playPause.textContent = "재생";
});

// 파일 길이를 알게 되면 슬라이더 최대값과 총 시간 표시
els.audio.addEventListener("loadedmetadata", () => {
  const duration = els.audio.duration;
  els.duration.textContent = formatClock(duration);
  els.seek.max = Number.isFinite(duration) ? String(duration) : "0";
});

// 재생 중에는 현재 시간과 슬라이더 위치를 계속 갱신
els.audio.addEventListener("timeupdate", () => {
  els.currentTime.textContent = formatClock(els.audio.currentTime);
  if (!isSeeking) els.seek.value = String(els.audio.currentTime);
});

// 슬라이더를 움직여 재생 위치 이동
els.seek.addEventListener("input", () => {
  isSeeking = true;
  const target = Number(els.seek.value);
  if (Number.isFinite(target)) els.audio.currentTime = target;
  els.currentTime.textContent = formatClock(target);
});
els.seek.addEventListener("change", () => {
  isSeeking = false;
});

// 반복 재생 켜기/끄기
els.loop.addEventListener("change", () => {
  els.audio.loop = els.loop.checked;
});

// 반복이 꺼진 상태로 끝나면 처음 위치로
els.audio.addEventListener("ended", () => {
  els.playPause.textContent = "재생";
  els.seek.value = "0";
  els.currentTime.textContent = "00:00";
});

/* ----------------------------------------------------------------------------
   9. 목표 (왼쪽 사이드바)
   ----------------------------------------------------------------------------
   - "목표 만들기"를 누르면 입력 패널이 열립니다.
   - 목표는 만든 순서대로 목록에 쌓이고, 여러 개를 만들 수 있습니다.
   - 저장하지 않으므로 새로고침하면 모두 사라집니다.
   - 목표를 누르면 목록에서 사라지면서 트럼펫 소리가 납니다.
   -------------------------------------------------------------------------- */

// 입력 패널 열기
function openGoalForm() {
  els.goalAdd.hidden = true;
  els.goalForm.hidden = false;
  els.goalInput.value = "";
  els.goalInput.focus();
}

// 입력 패널 닫기
function closeGoalForm() {
  els.goalForm.hidden = true;
  els.goalAdd.hidden = false;
  els.goalInput.value = "";
  els.goalAdd.focus();
}

// 목표 하나 추가. 추가에 성공하면 true 를 돌려줍니다.
function addGoal(text) {
  const trimmed = text.trim();
  if (!trimmed) return false; // 빈 값은 무시

  const item = document.createElement("li");
  item.className = "goal-item";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "goal";
  button.textContent = trimmed;
  button.title = "누르면 완료";
  button.setAttribute("aria-label", `${trimmed} 완료하기`);
  button.addEventListener("click", () => completeGoal(item, button));

  item.append(button);
  els.goalList.append(item); // 항상 맨 아래에 추가 → 만든 순서대로 정렬

  // 바로 클래스를 붙이면 애니메이션이 생략되므로 다음 프레임에 붙입니다.
  requestAnimationFrame(() => item.classList.add("is-visible"));
  return true;
}

// 목표 완료: 목록에서 사라지고 트럼펫 소리 재생
function completeGoal(item, button) {
  button.disabled = true;
  item.classList.remove("is-visible");
  item.classList.add("is-removing");
  playTrumpetSound();

  // 사라지는 애니메이션이 끝난 뒤 DOM 에서 제거
  window.setTimeout(() => item.remove(), 200);
}

els.goalAdd.addEventListener("click", openGoalForm);
els.goalCancel.addEventListener("click", closeGoalForm);

// Enter 키 또는 "추가" 버튼
els.goalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (addGoal(els.goalInput.value)) closeGoalForm();
});

// Esc 키로 입력 패널 닫기
els.goalInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeGoalForm();
  }
});

/* ----------------------------------------------------------------------------
   10. 이벤트 연결 (타이머)
   -------------------------------------------------------------------------- */
els.startPause.addEventListener("click", toggle);
els.reset.addEventListener("click", reset);

els.modes.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

// 키보드 단축키
//   Space : 세그먼트 타이머 초기화
//   R     : 뽀모도로 초기화
// (뽀모도로 시작/일시정지는 화면의 버튼으로 합니다.)
document.addEventListener("keydown", (event) => {
  // 입력 중(슬라이더, 파일 선택 등)에는 단축키를 무시
  if (event.target.matches("input, textarea")) return;

  if (event.code === "Space" || event.key === " " || event.key === "Spacebar") {
    event.preventDefault(); // 스페이스로 페이지가 스크롤되는 것 방지
    resetSegment();
  } else if (event.key.toLowerCase() === "r") {
    reset();
  }
});

// 탭이 다시 보일 때 시간을 즉시 갱신 (백그라운드에서 멈춘 화면 보정)
document.addEventListener("visibilitychange", () => {
  if (state.running) tick();
});

/* ----------------------------------------------------------------------------
   첫 화면 준비
   -------------------------------------------------------------------------- */
els.volume.value = String(CONFIG.volume.defaultPercent);
els.audio.volume = settings.musicVolume;
applyVolume();
renderSegment();
render();
