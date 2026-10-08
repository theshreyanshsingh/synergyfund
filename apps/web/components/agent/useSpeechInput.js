"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export function useSpeechInput(onText) {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState("")
  const recognitionRef = useRef(null)
  const streamRef = useRef(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText

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
    recognition.onstart = () => setListening(true)
    recognition.onresult = (event) => {
      let finalTranscript = ""
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) finalTranscript += event.results[index][0].transcript
      }
      if (finalTranscript.trim()) onTextRef.current(finalTranscript.trim())
    }
    recognition.onerror = (event) => {
      stopMicrophone()
      setListening(false)
      if (event.error === "not-allowed" || event.error === "service-not-allowed") setError("Microphone permission is required for speech-to-text.")
      else if (event.error === "no-speech") setError("No speech was heard. Try again.")
      else if (event.error !== "aborted") setError("Speech recognition stopped. Try again.")
    }
    recognition.onend = () => {
      stopMicrophone()
      setListening(false)
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
    try {
      if (navigator.mediaDevices?.getUserMedia) streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      recognition.start()
    } catch (err) {
      stopMicrophone()
      setError(err?.name === "NotAllowedError" ? "Microphone permission is required for speech-to-text." : "Could not start the microphone.")
    }
  }, [stopMicrophone])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  return { supported, listening, error, start, stop, clearError: () => setError("") }
}
