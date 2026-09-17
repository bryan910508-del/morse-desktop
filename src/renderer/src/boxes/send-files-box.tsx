import { useEffect, useRef, useState } from 'react'
import { File as FileIcon, Film, Image as ImageIcon, Pencil, Scissors, X } from 'lucide-react'
import type { AttachmentDraft, AttachmentMode, VideoFacts } from '../../../shared/uploads'
import type { ReplyBinding } from '../../../shared/reply-draft'
import { controller } from '../app/ui'
import { bytes, duration as formatDuration, errorText } from '../app/format'
import { readVideoFacts } from '../media/video-facts'
import { trackWrite } from '../app/drafts'
import { Box } from '../ui/layers'
import { Spinner } from '../ui/controls'
import { desktop } from '../app/store'
import { effectivePowerSaving } from '../app/power-saving'
import { photoSendSpec, reencodedPhotoType, videoSendPreset } from '../../../shared/photo-quality'
import { prepareChatPhoto } from '../photos/prepare-chat-photo'
import { showPhotoEditor } from '../media/photo-editor'
import { showVideoEditor, type VideoEditValue } from '../media/video-editor'
import { tr } from '../../../shared/i18n'

function Preview({ item, kind, video, edited }: { item: AttachmentDraft['items'][number]; kind: AttachmentDraft['kind']; video: VideoFacts | null; edited?: string }) {
  const [failed, setFailed] = useState(false)
  if (kind === 'image' && (edited || item.previewUrl) && !failed) return <img src={edited ?? item.previewUrl} alt={item.name} onError={() => setFailed(true)} />
  // Telegram's send box shows a video by its frame and length.
  if (kind === 'video' && video) return <>
    {video.thumb ? <img src={`data:image/jpeg;base64,${video.thumb}`} alt={item.name} /> : <span className="send-files-icon"><Film size={28} /></span>}
    <span className="send-files-duration">{formatDuration(Math.round(video.duration))}</span>
  </>
  return <span className="send-files-icon">{kind === 'file' ? <FileIcon size={28} /> : kind === 'video' ? <Film size={28} /> : <ImageIcon size={28} />}</span>
}

// What the box sends through: a chat's outbox, or an inquiry room's own send.
// editImage: Editor::PhotoEditor's result replaces the staged picture (a chat's send box only).
// editVideo: Editor::VideoEditor's part and quality, cut again from the picked file by the Mac helper.
export interface AttachmentSender { send(caption: string, itemIds: string[], video: VideoFacts | null): Promise<void>; discard(): void; editImage?(itemId: string, bytes: Uint8Array): Promise<void>; editVideo?(itemId: string, value: VideoEditValue, overlay: Uint8Array | null): Promise<void> }

function SendFilesBox({ draft, sender, close, sent }: { draft: AttachmentDraft; sender: AttachmentSender; close(): void; sent(): void }) {
  const [items, setItems] = useState(draft.items)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Pictures edited here show from their new bytes; the staged file behind previewUrl is replaced too.
  const [edited, setEdited] = useState<Record<string, string>>({})
  const editedUrls = useRef(edited); editedUrls.current = edited
  useEffect(() => () => { for (const url of Object.values(editedUrls.current)) URL.revokeObjectURL(url) }, [])
  // The picked video is read once; sending waits for it, and sends without it if it cannot be read.
  const [video, setVideo] = useState<VideoFacts | null>(null)
  const reading = useRef<Promise<VideoFacts | null>>(Promise.resolve(null))
  const [videoEdit, setVideoEdit] = useState<VideoEditValue | null>(null)
  const [videoRevision, setVideoRevision] = useState(0)
  useEffect(() => {
    const url = draft.kind === 'video' ? draft.items[0]?.previewUrl : undefined
    if (!url) return
    let alive = true
    // After an edit the same address serves new bytes, so they are read past the media cache.
    reading.current = videoRevision ? readEditedVideoFacts(url) : readVideoFacts(url)
    void reading.current.then(facts => { if (alive) setVideo(facts) })
    return () => { alive = false }
  }, [draft, videoRevision])
  const title = draft.kind === 'file' ? tr('파일 보내기') : draft.kind === 'video' ? tr('동영상 보내기') : items.length > 1 ? tr('사진 {0}장 보내기', [items.length]) : tr('사진 보내기')
  async function send(): Promise<void> {
    if (busy || !items.length) return
    setBusy(true); setError('')
    try {
      const facts = draft.kind === 'video' ? await reading.current : null
      await sender.send(caption, items.map(item => item.id), facts)
      sent(); close()
    } catch (reason) { setError(errorText(reason, tr('첨부를 보내지 못했습니다.'))) }
    finally { setBusy(false) }
  }
  return <Box title={title} width={420} onClose={busy ? undefined : close} buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat" data-autofocus disabled={busy || !items.length} onClick={() => { void send() }}>{busy ? <Spinner size={14} /> : null}{tr('보내기')}</button>
  </>}>
    <div className={`send-files-grid${draft.kind === 'file' ? ' files' : ''}`}>
      {items.map(item => <div key={item.id} className="send-files-item">
        <Preview key={edited[item.id] ?? 'staged'} item={item} kind={draft.kind} video={video} edited={edited[item.id]} />
        {draft.kind === 'video' && sender.editVideo && item.originalUrl && <button className="send-files-edit" aria-label={tr('{0} 편집', [item.name])} disabled={busy}
          onClick={() => showVideoEditor(item.originalUrl!, videoEdit, videoSendPreset(desktop.value?.preferences.videoSendQuality ?? 'auto', effectivePowerSaving('compressMediaUploads')), async (value, overlay) => {
            await sender.editVideo!(item.id, value, overlay)
            setVideoEdit(value); setVideo(null); setVideoRevision(revision => revision + 1)
          })}><Scissors size={13} /></button>}
        {draft.kind === 'image' && sender.editImage && item.previewUrl && !/\.gif$/i.test(item.name) && <button className="send-files-edit" aria-label={tr('{0} 편집', [item.name])} disabled={busy}
          onClick={() => showPhotoEditor(edited[item.id] ?? item.previewUrl!, async bytes => {
            await sender.editImage!(item.id, bytes)
            const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'image/jpeg' }))
            setEdited(current => { if (current[item.id]) URL.revokeObjectURL(current[item.id]!); return { ...current, [item.id]: url } })
          })}><Pencil size={13} /></button>}
        {draft.kind === 'file' && <span className="send-files-name"><strong className="ellipsis">{item.name}</strong><small>{bytes(item.size)}</small></span>}
        {items.length > 1 && <button className="send-files-remove" aria-label={tr('{0} 빼기', [item.name])} disabled={busy} onClick={() => setItems(current => current.filter(value => value.id !== item.id))}><X size={14} /></button>}
      </div>)}
    </div>
    {draft.kind !== 'file' && <label className="field"><span>{tr('설명')}</span><textarea rows={2} maxLength={3000} value={caption} disabled={busy} placeholder={tr('설명 추가')} onChange={event => setCaption(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} /></label>}
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

async function readEditedVideoFacts(url: string): Promise<VideoFacts | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return null
    const local = URL.createObjectURL(await response.blob())
    try { return await readVideoFacts(local) } finally { URL.revokeObjectURL(local) }
  } catch { return null }
}

export function showAttachmentBox(draft: AttachmentDraft, sender: AttachmentSender): void {
  let delivered = false
  controller.showLayer(close => <SendFilesBox draft={draft} sender={sender} close={close} sent={() => { delivered = true }} />, {
    onClose: () => { if (!delivered) sender.discard() }
  })
}

export function showSendFilesBox(accountUid: string, chatId: string, draft: AttachmentDraft, reply: () => ReplyBinding | null): void {
  showAttachmentBox(draft, {
    send: async (caption, itemIds, video) => {
      if (draft.kind === 'image') await reencodePhotos(accountUid, chatId, draft, itemIds)
      await trackWrite(window.morse.sendAttachment(accountUid, chatId, draft.id, caption, itemIds, reply(), video))
    },
    discard: () => { void window.morse.discardAttachment(accountUid, draft.id).catch(() => {}) },
    editImage: async (itemId, bytes) => { await window.morse.replaceAttachmentImage(accountUid, chatId, draft.id, itemId, bytes) },
    editVideo: async (itemId, value, overlay) => {
      await window.morse.editAttachmentVideo(accountUid, chatId, draft.id, itemId, { start: value.start, end: value.end, preset: value.preset, ...(overlay ? { overlay } : {}) })
    }
  })
}

// HistoryWidget::canSendFiles / confirmSendingFiles: a picture on the clipboard goes through the same box a picked or
// dropped one does. It has no file on disk, so its bytes travel instead of a path.
export async function pasteFiles(accountUid: string, chatId: string, files: File[], reply: () => ReplyBinding | null): Promise<void> {
  try {
    const draft = await window.morse.pasteAttachments(accountUid, chatId, files)
    showSendFilesBox(accountUid, chatId, draft, reply)
  } catch (reason) { controller.toast(errorText(reason, tr('붙여넣은 사진을 첨부하지 못했습니다.')), 'error') }
}
export async function pickFiles(accountUid: string, chatId: string, mode: AttachmentMode, reply: () => ReplyBinding | null): Promise<void> {
  try {
    const draft = await window.morse.pickAttachment(accountUid, chatId, mode)
    if (draft) showSendFilesBox(accountUid, chatId, draft, reply)
  } catch (reason) { controller.toast(errorText(reason, tr('첨부를 준비하지 못했습니다.')), 'error') }
}

// iOS PhotoSendQuality: each photo goes out as a JPEG at the chosen size (an animated GIF keeps its bytes).
async function reencodePhotos(accountUid: string, chatId: string, draft: AttachmentDraft, itemIds: string[]): Promise<void> {
  const preferences = desktop.value?.preferences
  const spec = photoSendSpec(preferences?.photoSendQuality ?? 'auto', effectivePowerSaving('compressMediaUploads'))
  for (const itemId of itemIds) {
    const item = draft.items.find(value => value.id === itemId)
    if (!item?.previewUrl) continue
    const response = await fetch(item.previewUrl, { cache: 'no-store' })
    if (!response.ok || !reencodedPhotoType(response.headers.get('Content-Type') ?? '')) continue
    const prepared = await prepareChatPhoto(new Uint8Array(await response.arrayBuffer()), spec)
    try { await window.morse.replaceAttachmentImage(accountUid, chatId, draft.id, itemId, prepared) } finally { prepared.fill(0) }
  }
}
