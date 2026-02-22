/**
 * Text-to-speech using ElevenLabs API.
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

    const errorText = await res.text().catch(() => '')
    console.warn('[TTS] ElevenLabs error:', res.status, errorText)
  } catch (e) {
    console.warn('[TTS] ElevenLabs fetch failed:', e)
  }
}
