// B340 (user decision 10-13 «권장대로»): a chat's row says only where a message of mine stands while it has not gone — on
// its way (the clock) or failed (the «!») — just left of the date (B338's group). The sent check and the read circle
// B291 drew there are gone from the row: on the list they read like the official mark beside the name (the same accent,
// a filled shape). Telegram draws them (tdesktop Dialogs::Ui::RowPainter sendStateIcon, dialogs_layout.cpp:837-855);
// this is Morse's own choice. The bubbles in a room keep both. A draft stands in for the line, and a secret chat shows
// nothing.
export type RowSendState = 'none' | 'sending' | 'failed'
export interface RowSendFacts {
  secret: boolean
  draft: boolean
  sending?: boolean
  failed?: boolean
}
export function rowSendState(row: RowSendFacts): RowSendState {
  if (row.secret || row.draft) return 'none'
  if (row.sending) return 'sending'
  if (row.failed) return 'failed'
  return 'none'
}
