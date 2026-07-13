// Speech-synthesis helper with Safari workarounds:
// 1. Safari requires speak() to first be called from a real user gesture ("unlock").
// 2. cancel() immediately followed by speak() can silently drop the utterance,
//    so we speak on a short delay and call resume() (Safari sometimes starts paused).

let unlocked = false;
let audioEl = null; // reused <audio> element, unlocked during a user gesture
let currentUtterance = null; // eslint-disable-line no-unused-vars -- GC guard for Safari
// 44-byte silent WAV used to unlock audio playback inside the gesture handler.
const SILENCE = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

export function unlockTTS() {
  if (unlocked) return;
  unlocked = true;
  const synth = window.speechSynthesis;
  if (synth) {
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
    } catch { /* not supported */ }
  }
  // Unlock programmatic audio playback (Safari requires play() inside a gesture once).
  try {
    audioEl = new Audio(SILENCE);
    audioEl.play().catch(() => {});
  } catch { /* ignore */ }
}

export function ttsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// Speaks text; calls onDone exactly once when finished (or on error).
// Returns a cancel function.
export function speak(text, onDone) {
  const synth = window.speechSynthesis;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onDone();
  };
  if (!synth) { finish(); return () => {}; }

  if (synth.speaking || synth.pending) synth.cancel();

  const u = new SpeechSynthesisUtterance(text);
  currentUtterance = u; // keep referenced: Safari GCs utterances and drops onend
  u.rate = 1;
  const voices = synth.getVoices();
  const voice = voices.find(v => v.default && v.lang?.startsWith(navigator.language?.slice(0, 2) || 'en'))
    || voices.find(v => v.lang?.startsWith('en'));
  if (voice) u.voice = voice;
  u.onend = finish;
  u.onerror = finish;

  const t = setTimeout(() => {
    synth.speak(u);
    synth.resume();
  }, 80);

  return () => {
    clearTimeout(t);
    finished = true; // suppress onDone from cancel-triggered onerror/onend
    synth.cancel();
  };
}

// Preferred entry point: neural TTS from the server (Microsoft Edge voices),
// falling back to browser Web Speech if the endpoint or playback fails.
// Calls onDone exactly once; returns a cancel function.
export function speakClue(text, onDone) {
  let finished = false;
  let cancelled = false;
  let innerCancel = () => {};
  const finish = () => {
    if (finished) return;
    finished = true;
    onDone();
  };

  (async () => {
    try {
      // Abort if the server (or its upstream TTS connection) hangs — the
      // game must fall back to browser speech rather than wait forever.
      const ctrl = new AbortController();
      const abortTimer = setTimeout(() => ctrl.abort(), 6000);
      let res, blob;
      try {
        res = await fetch(`/api/tts?text=${encodeURIComponent(text)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error('tts endpoint unavailable');
        blob = await res.blob();
      } finally {
        clearTimeout(abortTimer);
      }
      if (cancelled) return;
      if (!blob || blob.size < 200) throw new Error('empty audio');
      const url = URL.createObjectURL(blob);
      const el = audioEl || (audioEl = new Audio());
      el.src = url;
      el.onended = () => { URL.revokeObjectURL(url); finish(); };
      el.onerror = () => { URL.revokeObjectURL(url); finish(); };
      innerCancel = () => {
        el.pause();
        el.removeAttribute('src');
        URL.revokeObjectURL(url);
      };
      await el.play(); // throws if autoplay is blocked -> fall through to Web Speech
    } catch {
      if (!cancelled) innerCancel = speak(text, finish);
    }
  })();

  return () => {
    cancelled = true;
    finished = true;
    innerCancel();
  };
}
