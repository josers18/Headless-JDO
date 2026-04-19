"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Thin wrapper around the browser's SpeechRecognition API. We feed the
 * live transcript into AskBar so the banker can dictate mid-meeting.
 *
 * The web API is still prefixed in Safari + some Chromium variants; we
 * pick whichever symbol is available and gracefully return `supported:
 * false` everywhere else (mobile Firefox, older Linux builds, etc.).
 *
 * Guarantees:
 *  - `transcript` is the cumulative text for the current session.
 *  - `interim` is the in-progress partial (what the user is still saying).
 *  - `start()` clears both and begins a fresh session.
 *  - `stop()` ends the session and surfaces the final transcript.
 */
export interface SpeechInput {
  supported: boolean;
  listening: boolean;
  transcript: string;
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
}

type SRCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((ev: {
        results: ArrayLike<{
          0: { transcript: string };
          isFinal: boolean;
        }>;
        resultIndex: number;
      }) => void)
    | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function pickCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRCtor;
    webkitSpeechRecognition?: SRCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechInput(lang = "en-US"): SpeechInput {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");

  useEffect(() => {
    setSupported(pickCtor() !== null);
    return () => recRef.current?.abort?.();
  }, []);

  const start = useCallback(() => {
    const Ctor = pickCtor();
    if (!Ctor) return;
    setTranscript("");
    setInterim("");
    setError(null);
    finalRef.current = "";
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let interimChunk = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (!r) continue;
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interimChunk += r[0].transcript;
      }
      setTranscript(finalRef.current.trim());
      setInterim(interimChunk.trim());
    };
    rec.onerror = (ev) => {
      setError(ev.error ?? "speech error");
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [lang]);

  const stop = useCallback(() => {
    recRef.current?.stop?.();
    setListening(false);
  }, []);

  return { supported, listening, transcript, interim, error, start, stop };
}
