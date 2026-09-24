// A note iOS wrote into the memo room itself. Before the notes lived in users/{uid}/spaceNotes, a note
// was a plain message of chats/memo_{uid} whose text is this prefix and a JSON object
// (MorseAccountModels.swift encodeMemoNoteWire / decodeMemoNoteWire). Neither server strips the prefix —
// only `__TALKY_AUTODEL__:` and `__deleted__:` are — so the message is still there, and
// MorseNotesMigration copies such notes into spaceNotes without removing them, once per device. For an
// account whose migration ran nowhere, this message is the only copy of the note, so it is shown as the
// note it is rather than hidden.
export const memoNoteWirePrefix = '__TALKY_MEMO__:'
export interface MemoNote { title: string; body: string }

// Both `t` and `b` must be strings, as decodeMemoNoteWire requires; anything else is someone's own text.
export function decodeMemoNote(raw: string): MemoNote | null {
  if (!raw.startsWith(memoNoteWirePrefix)) return null
  let value: unknown
  try { value = JSON.parse(raw.slice(memoNoteWirePrefix.length)) } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.t !== 'string' || typeof record.b !== 'string') return null
  return { title: record.t, body: record.b }
}
// The chat list's line for one (memoChatListPreview): the note's title behind a picture, or the picture alone.
export function memoNoteListLine(raw: string): string | null {
  const note = decodeMemoNote(raw)
  if (!note) return null
  const title = note.title.trim()
  return title ? `📝 ${title}` : '📝'
}
