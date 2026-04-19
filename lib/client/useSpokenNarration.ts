"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isSpeechSupported, speak, stopSpeaking } from "@/lib/voice";

/**
 * Client hook for narrating text with the Web Speech API. Exposes a tiny
 * play/pause surface the UI can wire to a single button.
 *
 * Why it lives here (not inline): MorningBrief and PortfolioPulse both
 * narrate streamed LLM output; keeping the "supported" probe + state
 * machine in one place avoids two sets of subtly different edge cases
 * (unmount mid-utterance, rapid re-clicks, Safari queueing quirks).
 */
export interface SpokenNarration {
  supported: boolean;
  speaking: boolean;
  play: (text: string) => void;
  stop: () => void;
}

export function useSpokenNarration(): SpokenNarration {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    setSupported(isSpeechSupported());
    return () => {
      mountedRef.current = false;
      stopSpeaking();
    };
  }, []);

  const play = useCallback((text: string) => {
    if (!text || !isSpeechSupported()) return;
    setSpeaking(true);
    speak(text, {
      rate: 1.04,
      onEnd: () => {
        if (mountedRef.current) setSpeaking(false);
      },
    });
  }, []);

  const stop = useCallback(() => {
    stopSpeaking();
    setSpeaking(false);
  }, []);

  return { supported, speaking, play, stop };
}
