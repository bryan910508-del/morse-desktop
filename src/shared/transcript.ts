// MorseVoiceTranscriptService: a voice message's words, or why there are none.
export type TranscriptResult = { status: 'ok'; text: string } | { status: 'denied' | 'failed' | 'unavailable' }
