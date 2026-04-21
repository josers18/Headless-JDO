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
    const el = audioRef.current;
    /** Detach first — revoke/pause during playback can fire `error` and must not trigger fallback TTS */
    el.onended = null;
    el.onerror = null;
    el.pause();
    el.removeAttribute("src");
    el.load();
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
  /** Bumped on stop() and each new play(); invalidates in-flight fetch / setup so Stop cannot spawn Web Speech */
  const playbackGenRef = useRef(0);

  useEffect(() => {
    setSupported(true);
    return () => {
      mountedRef.current = false;
      /** Invalidate in-flight fetch/play; ref bump is intentional (not a stale closure bug). */
      playbackGenRef.current += 1;
      cleanupAudio(audioRef, objectUrlRef);
      stopSpeaking();
    };
    // playbackGenRef only used to cancel async work on unmount — dep array stays empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(() => {
    playbackGenRef.current++;
    cleanupAudio(audioRef, objectUrlRef);
    stopSpeaking();
    setSpeaking(false);
  }, []);

  const playWeb = useCallback((text: string, reason: string, forGen: number) => {
    if (forGen !== playbackGenRef.current) return;
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
        if (forGen !== playbackGenRef.current) return;
        if (mountedRef.current) setSpeaking(false);
      },
    });
  }, []);

  const play = useCallback(
    (text: string) => {
      if (!text) return;
      playbackGenRef.current++;
      const gen = playbackGenRef.current;
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
          if (gen !== playbackGenRef.current) return;

          const tag = (res.headers.get("x-tts-result") ?? "").toLowerCase();
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);

          if (gen !== playbackGenRef.current) return;

          if (res.status === 401) {
            playWeb(
              text,
              `HTTP 401 (see X-TTS-Result / sign in, or set Heroku TTS_REQUIRE_SF_AUTH=0 for demo-only)`,
              gen
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
            if (gen !== playbackGenRef.current) return;
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
            playWeb(text, `server fallback (${extra})`, gen);
            return;
          }

          if (gen !== playbackGenRef.current) return;

          const minMp3 = 64;
          if (
            res.ok &&
            bytes.length >= minMp3 &&
            isLikelyMp3Buffer(bytes)
          ) {
            if (gen !== playbackGenRef.current) return;

            const blob = new Blob([buf], { type: "audio/mpeg" });
            const url = URL.createObjectURL(blob);
            objectUrlRef.current = url;
            const audio = new Audio(url);
            audio.setAttribute("playsinline", "true");
            audioRef.current = audio;
            audio.onended = () => {
              if (gen !== playbackGenRef.current) return;
              cleanupAudio(audioRef, objectUrlRef);
              if (mountedRef.current) setSpeaking(false);
            };
            audio.onerror = () => {
              if (gen !== playbackGenRef.current) return;
              cleanupAudio(audioRef, objectUrlRef);
              playWeb(text, "HTMLAudioElement error (codec / blob)", gen);
            };
            try {
              await audio.play();
              if (gen !== playbackGenRef.current) {
                cleanupAudio(audioRef, objectUrlRef);
              }
            } catch (e) {
              if (gen !== playbackGenRef.current) return;
              cleanupAudio(audioRef, objectUrlRef);
              playWeb(
                text,
                `audio.play() rejected — ${e instanceof Error ? e.message : String(e)}`,
                gen
              );
            }
            return;
          }

          playWeb(
            text,
            `response not MP3 (status=${res.status}, bytes=${bytes.length}, x-tts-result=${tag || "none"})`,
            gen
          );
        } catch (e) {
          if (gen !== playbackGenRef.current) return;
          playWeb(
            text,
            `fetch failed — ${e instanceof Error ? e.message : String(e)}`,
            gen
          );
        }
      })();
    },
    [playWeb]
  );

  return { supported, speaking, play, stop };
}
