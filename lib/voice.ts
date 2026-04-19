"use client";

// Thin wrapper around the Web Speech API. Kept small on purpose — voice is an
// enhancement, not a requirement (CLAUDE.md §9).

export interface SpeakOpts {
  rate?: number;
  pitch?: number;
  voiceName?: string;
  onEnd?: () => void;
}

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speak(text: string, opts: SpeakOpts = {}) {
  if (!isSpeechSupported()) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = opts.rate ?? 1.02;
  utter.pitch = opts.pitch ?? 1.0;
  if (opts.voiceName) {
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find((v) => v.name === opts.voiceName);
    if (match) utter.voice = match;
  }
  if (opts.onEnd) utter.onend = () => opts.onEnd?.();
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking() {
  if (isSpeechSupported()) window.speechSynthesis.cancel();
}
