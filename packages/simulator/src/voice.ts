// Browser Web Speech API: SpeechSynthesis for output, SpeechRecognition (where the browser has it) for input.

interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

const MUTE_KEY = "aag-sim-muted";
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // storage is optional
  }
  if (value && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

export function speak(text: string, onEnd?: () => void): void {
  if (muted || !("speechSynthesis" in window) || !text) {
    onEnd?.();
    return;
  }
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    const voice = synth.getVoices().find((v) => v.lang.startsWith("en") && !v.localService) ?? synth.getVoices().find((v) => v.lang.startsWith("en"));
    if (voice) utterance.voice = voice;
    utterance.onend = () => onEnd?.();
    utterance.onerror = () => onEnd?.();
    synth.speak(utterance);
  } catch {
    onEnd?.();
  }
}

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canListen(): boolean {
  return recognitionCtor() !== null;
}

// Starts one recognition session; resolves with the transcript, or null when nothing was heard.
export function listenOnce(): Promise<string | null> {
  const Ctor = recognitionCtor();
  if (!Ctor) return Promise.resolve(null);
  return new Promise((resolve) => {
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let transcript: string | null = null;
    rec.onresult = (event) => {
      transcript = event.results[0]?.[0]?.transcript ?? null;
    };
    rec.onerror = () => resolve(transcript);
    rec.onend = () => resolve(transcript);
    try {
      rec.start();
    } catch {
      resolve(null);
    }
  });
}
