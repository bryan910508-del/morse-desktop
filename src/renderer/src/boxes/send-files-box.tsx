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
import { photoSendHdInitial, photoSendHdRemembered, photoSendMode, photoSendSpec, reencodedPhotoType, videoSendPreset, type PhotoSendChoice } from '../../../shared/photo-quality'
import { Toggle } from '../settings/settings-box'
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
// editImage: Editor::PhotoEditor's result replaces the staged picture (a chat's send box only), and answers the address the
// edited picture is read at.
// editVideo: Editor::VideoEditor's part and quality, cut again from the picked file by the Mac helper.
// B365: `highQuality` — this sender re-encodes photos at the box's «고화질» pick (a chat's); a 1:1 inquiry's has its own size.
export interface AttachmentSender { send(caption: string, itemIds: string[], video: VideoFacts | null, options?: { hd: boolean }): Promise<void>; discard(): void; highQuality?: true; editImage?(itemId: string, bytes: Uint8Array): Promise<string>; editVideo?(itemId: string, value: VideoEditValue, overlay: Uint8Array | null): Promise<string> }

// What a box opened again after its send failed starts from: the same text, the same pictures, and why it failed.
export interface SendFilesRetry { caption: string; itemIds: string[]; error: string; hd?: boolean }

function SendFilesBox({ draft, sender, close, sent, retry }: { draft: AttachmentDraft; sender: AttachmentSender; close(): void; sent(): void; retry?: SendFilesRetry }) {
  const [items, setItems] = useState(retry ? draft.items.filter(item => retry.itemIds.includes(item.id)) : draft.items)
  const [caption, setCaption] = useState(retry?.caption ?? '')
  // B365: «고화질», from the last pick or the setting's default; settings «압축» or power saving's compression sends small.
  const choice = photoChoice()
  const [hd, setHd] = useState(retry?.hd ?? photoSendHdInitial(choice))
  const compressing = choice.photoSendQuality === 'compressed' || effectivePowerSaving('compressMediaUploads')
  const hdOffered = sender.highQuality === true && draft.kind === 'image' && items.some(item => !/\.gif$/i.test(item.name))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(retry?.error ?? '')
  // B323: a picture edited here is shown, and edited again, from the staged file that replaced it (its address after the
  // edit). The window made a blob: copy before, which the page's policy refuses to draw or read: the tile went blank and
  // a second edit failed to load.
  const [edited, setEdited] = useState<Record<string, string>>({})
  // The picked video is read once; sending waits for it, and sends without it if it cannot be read.
  const [video, setVideo] = useState<VideoFacts | null>(null)
  const reading = useRef<Promise<VideoFacts | null>>(Promise.resolve(null))
  const [videoEdit, setVideoEdit] = useState<VideoEditValue | null>(null)
  // B323-c: after an edit the video is read at the address the edit gave it (past the media cache), not from a blob:
  // copy the page refuses — which left the tile without its frame and length, and sent the video without them.
  const [editedVideo, setEditedVideo] = useState<string | null>(null)
  useEffect(() => {
    const url = draft.kind === 'video' ? editedVideo ?? draft.items[0]?.previewUrl : undefined
    if (!url) return
    let alive = true
    reading.current = readVideoFacts(url)
    void reading.current.then(facts => { if (alive) setVideo(facts) })
    return () => { alive = false }
  }, [draft, editedVideo])
  const title = draft.kind === 'file' ? tr('파일 보내기') : draft.kind === 'video' ? tr('동영상 보내기') : items.length > 1 ? tr('사진 {0}장 보내기', [items.length]) : tr('사진 보내기')
  // B295: tdesktop's box hands the send over and closes at once (SendFilesBox::send → _confirmedCallback, then closeBox,
  // send_files_box.cpp:2704-2706). Kept open while the send went on, this box could be closed by Esc or a click beside it,
  // and closing it let the selection go — before it was queued, the message was lost and nothing said so. From the press
  // the send is the account's: the box closes, the send runs as a tracked write (quitting waits for it, drafts.ts), and
  // a send refused before it is queued opens the box again as it was, with why.
  function send(): void {
    if (busy || !items.length) return
    setBusy(true)
    const text = caption, itemIds = items.map(item => item.id), facts = reading.current
    sent(); close()
    const pick = hd
    void trackWrite((async () => sender.send(text, itemIds, draft.kind === 'video' ? await facts : null, { hd: pick }))())
      .catch(reason => showAttachmentBox(draft, sender, { caption: text, itemIds, hd: pick, error: errorText(reason, tr('첨부를 보내지 못했습니다.')) }))
  }
  return <Box title={title} width={420} onClose={busy ? undefined : close} buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat" data-autofocus disabled={busy || !items.length} onClick={send}>{busy ? <Spinner size={14} /> : null}{tr('보내기')}</button>
  </>}>
    <div className={`send-files-grid${draft.kind === 'file' ? ' files' : ''}`}>
      {items.map(item => <div key={item.id} className="send-files-item">
        <Preview key={edited[item.id] ?? 'staged'} item={item} kind={draft.kind} video={video} edited={edited[item.id]} />
        {draft.kind === 'video' && sender.editVideo && item.originalUrl && <button className="send-files-edit" aria-label={tr('{0} 편집', [item.name])} disabled={busy}
          onClick={() => showVideoEditor(item.originalUrl!, videoEdit, videoSendPreset(desktop.value?.preferences.videoSendQuality ?? 'auto', effectivePowerSaving('compressMediaUploads')), async (value, overlay) => {
            const url = await sender.editVideo!(item.id, value, overlay)
            setVideoEdit(value); setVideo(null); setEditedVideo(url)
          })}><Scissors size={13} /></button>}
        {draft.kind === 'image' && sender.editImage && item.previewUrl && !/\.gif$/i.test(item.name) && <button className="send-files-edit" aria-label={tr('{0} 편집', [item.name])} disabled={busy}
          onClick={() => showPhotoEditor(edited[item.id] ?? item.previewUrl!, async bytes => {
            const url = await sender.editImage!(item.id, bytes)
            setEdited(current => ({ ...current, [item.id]: url }))
          })}><Pencil size={13} /></button>}
        {draft.kind === 'file' && <span className="send-files-name"><strong className="ellipsis">{item.name}</strong><small>{bytes(item.size)}</small></span>}
        {items.length > 1 && <button className="send-files-remove" aria-label={tr('{0} 빼기', [item.name])} disabled={busy} onClick={() => setItems(current => current.filter(value => value.id !== item.id))}><X size={14} /></button>}
      </div>)}
    </div>
    {draft.kind !== 'file' && <label className="field"><span>{tr('설명')}</span><textarea rows={2} maxLength={3000} value={caption} disabled={busy} placeholder={tr('설명 추가')} onChange={event => setCaption(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }} /></label>}
    {hdOffered && <Toggle label={tr('고화질')} detail={compressing ? tr('절전·압축 중에는 작게 보내요') : tr('긴 변 2560px까지')}
      checked={hd && !compressing} disabled={busy || compressing} onChange={setHd} />}
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

export function showAttachmentBox(draft: AttachmentDraft, sender: AttachmentSender, retry?: SendFilesRetry): void {
  // Closing the box lets the selection go only if «보내기» was not pressed: a pressed one belongs to its send.
  let delivered = false
  controller.showLayer(close => <SendFilesBox draft={draft} sender={sender} close={close} sent={() => { delivered = true }} retry={retry} />, {
    onClose: () => { if (!delivered) sender.discard() }
  })
}

export function showSendFilesBox(accountUid: string, chatId: string, draft: AttachmentDraft, reply: () => ReplyBinding | null): void {
  showAttachmentBox(draft, {
    highQuality: true,
    send: async (caption, itemIds, video, options) => {
      const choice = photoChoice(), hd = options?.hd ?? photoSendHdInitial(choice)
      await window.morse.pressAttachment(accountUid, chatId, draft.id)
      if (draft.kind === 'image') await reencodePhotos(accountUid, chatId, draft, itemIds, photoSendMode(choice, hd))
      await trackWrite(window.morse.sendAttachment(accountUid, chatId, draft.id, caption, itemIds, reply(), video))
      // B365: the pick is kept for the next box once the photos are on their way (tdesktop saves SendFilesWay on send).
      if (draft.kind === 'image') {
        const keep = photoSendHdRemembered(choice, hd)
        if (keep !== choice.photoSendHd) void window.morse.updatePreferences({ photoSendHd: keep }).catch(() => {})
      }
      // B311: a selection with a video goes one item at a time — the next opens once this one is queued.
      void window.morse.nextAttachment(accountUid, chatId).then(next => { if (next) showSendFilesBox(accountUid, chatId, next, reply) })
        .catch(reason => controller.toast(errorText(reason, tr('첨부를 준비하지 못했습니다.')), 'error'))
    },
    discard: () => { void window.morse.discardAttachment(accountUid, draft.id).catch(() => {}) },
    editImage: async (itemId, bytes) => {
      const next = await window.morse.replaceAttachmentImage(accountUid, chatId, draft.id, itemId, bytes)
      const url = next.items.find(item => item.id === itemId)?.previewUrl
      if (!url) throw new Error(tr('첨부 선택이 해제되었습니다. 파일을 다시 선택해 주세요.'))
      return url
    },
    editVideo: async (itemId, value, overlay) => {
      const next = await window.morse.editAttachmentVideo(accountUid, chatId, draft.id, itemId, { start: value.start, end: value.end, preset: value.preset, ...(overlay ? { overlay } : {}) })
      const url = next.items.find(item => item.id === itemId)?.previewUrl
      if (!url) throw new Error(tr('첨부 선택이 해제되었습니다. 파일을 다시 선택해 주세요.'))
      return url
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
function photoChoice(): PhotoSendChoice {
  const preferences = desktop.value?.preferences
  return { photoSendQuality: preferences?.photoSendQuality ?? 'auto', photoSendHd: preferences?.photoSendHd ?? null }
}
async function reencodePhotos(accountUid: string, chatId: string, draft: AttachmentDraft, itemIds: string[], mode: PhotoSendChoice['photoSendQuality']): Promise<void> {
  const spec = photoSendSpec(mode, effectivePowerSaving('compressMediaUploads'))
  for (const itemId of itemIds) {
    const item = draft.items.find(value => value.id === itemId)
    if (!item?.previewUrl) continue
    const response = await fetch(item.previewUrl, { cache: 'no-store' })
    if (!response.ok || !reencodedPhotoType(response.headers.get('Content-Type') ?? '')) continue
    const prepared = await prepareChatPhoto(new Uint8Array(await response.arrayBuffer()), spec)
    try { await window.morse.replaceAttachmentImage(accountUid, chatId, draft.id, itemId, prepared) } finally { prepared.fill(0) }
  }
}
