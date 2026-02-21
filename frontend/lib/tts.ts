/**
 * Text-to-speech using ElevenLabs API.
 * Falls back to browser SpeechSynthesis if API key is not configured.
 */
export async function speakText(text: string): Promise<void> {
  if (typeof window === 'undefined' || !text?.trim()) return

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim() }),
    })

    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
      return
    }

    // 503 = API key not configured; fall through to fallback
    if (res.status !== 503) {
      console.warn('[TTS] ElevenLabs error:', res.status)
    }
  } catch (e) {
    console.warn('[TTS] ElevenLabs fetch failed:', e)
  }

  // Fallback: browser SpeechSynthesis
  if (window.speechSynthesis) {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.1
    utterance.pitch = 0.9
    const voices = window.speechSynthesis.getVoices()
    const preferred =
      voices.find((v) => v.lang.startsWith('en') && /male|daniel|james|google uk/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith('en'))
    if (preferred) utterance.voice = preferred
    window.speechSynthesis.speak(utterance)
  }
}
