"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { playAgentSound } from "../../lib/sounds"

// The box's microphone: what is said is written into the box. `starting` while the microphone opens ("Getting
// ready…"), then `listening`, with `interim` the words being heard before they are settled (onText gets each settled
// piece). stop() keeps what was heard; cancel() throws away anything still to come (the box puts back what it had).
// `sounds`: the Agent's box plays its microphone sounds as it opens and closes.
export function useSpeechInput(onText, { sounds = false } = {}) {
  const [supported, setSupported] = useState(false)
  const [starting, setStarting] = useState(false)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState("")
  const [error, setError] = useState("")
  const recognitionRef = useRef(null)
  const streamRef = useRef(null)
  const cancelled = useRef(false)
  const heard = useRef(false)
  const onTextRef = useRef(onText)
  onTextRef.current = onText
  const soundsRef = useRef(sounds)
  soundsRef.current = sounds

  const stopMicrophone = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    const Recognition = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null
    if (!Recognition) return
    setSupported(true)
    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = navigator.language || "en-US"
    recognition.onstart = () => {
      setStarting(false)
      setListening(true)
      heard.current = true
      if (soundsRef.current) playAgentSound("listen")
    }
    recognition.onresult = (event) => {
      if (cancelled.current) return
      let finalTranscript = ""
      let pending = ""
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) finalTranscript += event.results[index][0].transcript
        else pending += event.results[index][0].transcript
      }
      setInterim(pending.trim())
      if (finalTranscript.trim()) onTextRef.current(finalTranscript.trim())
    }
    recognition.onerror = (event) => {
      stopMicrophone()
      setStarting(false)
      setListening(false)
      setInterim("")
      if (event.error === "not-allowed" || event.error === "service-not-allowed") setError("Microphone permission is required for speech-to-text.")
      else if (event.error === "no-speech") setError("No speech was heard. Try again.")
      else if (event.error !== "aborted") setError("Speech recognition stopped. Try again.")
    }
    recognition.onend = () => {
      stopMicrophone()
      setStarting(false)
      setListening(false)
      setInterim("")
      if (heard.current && !cancelled.current && soundsRef.current) playAgentSound("listened")
      heard.current = false
    }
    recognitionRef.current = recognition
    return () => {
      recognition.onend = null
      recognition.abort()
      stopMicrophone()
    }
  }, [stopMicrophone])

  const start = useCallback(async () => {
    setError("")
    const recognition = recognitionRef.current
    if (!recognition) {
      setError("Speech recognition is not supported in this browser.")
      return
    }
    cancelled.current = false
    setInterim("")
    setStarting(true)
    try {
      if (navigator.mediaDevices?.getUserMedia) streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      recognition.start()
    } catch (err) {
      stopMicrophone()
      setStarting(false)
      setError(err?.name === "NotAllowedError" ? "Microphone permission is required for speech-to-text." : "Could not start the microphone.")
    }
  }, [stopMicrophone])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const cancel = useCallback(() => {
    cancelled.current = true
    setInterim("")
    recognitionRef.current?.abort()
    stopMicrophone()
    setStarting(false)
    setListening(false)
  }, [stopMicrophone])

  return { supported, starting, listening, active: starting || listening, interim, error, start, stop, cancel, clearError: () => setError("") }
}
