"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { isLikelyMp3Buffer } from "@/lib/tts/mp3Guards";
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

  const playWeb = useCallback((text: string, reason: string) => {
    if (reason) {
      // why: operators need a single grep-friendly line when ElevenLabs path fails in prod.
      // eslint-disable-next-line no-console
      console.info(`[Horizon TTS] Web Speech fallback — ${reason}`);
    }
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
          const tag = (res.headers.get("x-tts-result") ?? "").toLowerCase();
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);

          if (res.status === 401) {
            playWeb(
              text,
              `HTTP 401 (see X-TTS-Result / sign in, or set Heroku TTS_REQUIRE_SF_AUTH=0 for demo-only)`
            );
            return;
          }

          if (
            res.ok &&
            (tag.startsWith("fallback") ||
              (bytes.length >= 4 &&
                bytes[0] === 0x7b &&
                (() => {
                  try {
                    const data = JSON.parse(
                      new TextDecoder().decode(bytes)
                    ) as { mode?: string };
                    return data.mode === "fallback";
                  } catch {
                    return false;
                  }
                })()))
          ) {
            let extra = tag || "json body";
            if (bytes.length >= 4 && bytes[0] === 0x7b) {
              try {
                const data = JSON.parse(
                  new TextDecoder().decode(bytes)
                ) as { detail?: string; reason?: string };
                if (data.detail) extra = `${extra} — ${data.detail}`;
                else if (data.reason) extra = `${extra} (${data.reason})`;
              } catch {
                /* ignore */
              }
            }
            playWeb(text, `server fallback (${extra})`);
            return;
          }

          const minMp3 = 64;
          if (
            res.ok &&
            bytes.length >= minMp3 &&
            isLikelyMp3Buffer(bytes)
          ) {
            const blob = new Blob([buf], { type: "audio/mpeg" });
            const url = URL.createObjectURL(blob);
            objectUrlRef.current = url;
            const audio = new Audio(url);
            audio.setAttribute("playsinline", "true");
            audioRef.current = audio;
            audio.onended = () => {
              cleanupAudio(audioRef, objectUrlRef);
              if (mountedRef.current) setSpeaking(false);
            };
            audio.onerror = () => {
              cleanupAudio(audioRef, objectUrlRef);
              playWeb(text, "HTMLAudioElement error (codec / blob)");
            };
            try {
              await audio.play();
            } catch (e) {
              cleanupAudio(audioRef, objectUrlRef);
              playWeb(
                text,
                `audio.play() rejected — ${e instanceof Error ? e.message : String(e)}`
              );
            }
            return;
          }

          playWeb(
            text,
            `response not MP3 (status=${res.status}, bytes=${bytes.length}, x-tts-result=${tag || "none"})`
          );
        } catch (e) {
          playWeb(
            text,
            `fetch failed — ${e instanceof Error ? e.message : String(e)}`
          );
        }
      })();
    },
    [playWeb]
  );

  return { supported, speaking, play, stop };
}
