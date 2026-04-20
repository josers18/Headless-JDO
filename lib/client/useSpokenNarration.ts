"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { isSpeechSupported, speak, stopSpeaking } from "@/lib/voice";

export interface SpokenNarration {
  /** True after mount — narration may use server TTS and/or Web Speech. */
  supported: boolean;
  speaking: boolean;
  play: (text: string) => void;
  stop: () => void;
}

function cleanupAudio(
  audioRef: MutableRefObject<HTMLAudioElement | null>,
  urlRef: MutableRefObject<string | null>
) {
  const url = urlRef.current;
  urlRef.current = null;
  if (audioRef.current) {
    audioRef.current.pause();
    audioRef.current.src = "";
    audioRef.current = null;
  }
  if (url) URL.revokeObjectURL(url);
}

/**
 * Narration for Morning Brief + Portfolio Pulse: tries POST /api/tts
 * (ElevenLabs MP3, Redis-cached server-side) first; falls back to Web Speech.
 */
export function useSpokenNarration(): SpokenNarration {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const mountedRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setSupported(true);
    return () => {
      mountedRef.current = false;
      cleanupAudio(audioRef, objectUrlRef);
      stopSpeaking();
    };
  }, []);

  const stop = useCallback(() => {
    cleanupAudio(audioRef, objectUrlRef);
    stopSpeaking();
    setSpeaking(false);
  }, []);

  const playWeb = useCallback((text: string) => {
    if (!isSpeechSupported()) {
      if (mountedRef.current) setSpeaking(false);
      return;
    }
    speak(text, {
      rate: 0.98,
      onEnd: () => {
        if (mountedRef.current) setSpeaking(false);
      },
    });
  }, []);

  const play = useCallback(
    (text: string) => {
      if (!text) return;
      cleanupAudio(audioRef, objectUrlRef);
      stopSpeaking();
      setSpeaking(true);
      void (async () => {
        try {
          const res = await fetch("/api/tts", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          const ct = res.headers.get("content-type") ?? "";
          if (res.ok && ct.includes("audio/mpeg")) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            objectUrlRef.current = url;
            const audio = new Audio(url);
            audioRef.current = audio;
            audio.onended = () => {
              cleanupAudio(audioRef, objectUrlRef);
              if (mountedRef.current) setSpeaking(false);
            };
            audio.onerror = () => {
              cleanupAudio(audioRef, objectUrlRef);
              playWeb(text);
            };
            try {
              await audio.play();
            } catch {
              cleanupAudio(audioRef, objectUrlRef);
              playWeb(text);
            }
            return;
          }
          if (res.ok && ct.includes("application/json")) {
            const data = (await res.json()) as { mode?: string };
            if (data.mode === "fallback") {
              playWeb(text);
              return;
            }
          }
          playWeb(text);
        } catch {
          playWeb(text);
        }
      })();
    },
    [playWeb]
  );

  return { supported, speaking, play, stop };
}
