import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check, File as FileIcon, Film, Image as ImageIcon, Pencil, Scissors } from 'lucide-react'
import { overviewChosen, overviewTitle, sendGroups, type AttachmentDraft, type AttachmentMode, type VideoFacts } from '../../../shared/uploads'
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
import { showPhotoEditor, type PhotoEdit } from '../media/photo-editor'
import { showVideoEditor, type VideoEditValue } from '../media/video-editor'
import { tr } from '../../../shared/i18n'

function Preview({ item, url, video }: { item: AttachmentDraft['items'][number]; url?: string; video: VideoFacts | null }) {
  const [failed, setFailed] = useState(false)
  if (item.kind === 'image' && url && !failed) return <img src={url} alt={item.name} onError={() => setFailed(true)} />
  // Telegram's send box shows a video by its frame and length.
  if (item.kind === 'video' && video) return <>
    {video.thumb ? <img src={`data:image/jpeg;base64,${video.thumb}`} alt={item.name} /> : <span className="send-files-icon"><Film size={28} /></span>}
    <span className="send-files-duration">{formatDuration(Math.round(video.duration))}</span>
  </>
  return <span className="send-files-icon">{item.kind === 'file' ? <FileIcon size={28} /> : item.kind === 'video' ? <Film size={28} /> : <ImageIcon size={28} />}</span>
}

// What the box sends through: a chat's outbox, or an inquiry room's own send.
// send: one message — a mixed selection (B518) calls it once for each of its messages, in order, `first` for the first.
// editImage: Editor::PhotoEditor's result replaces the staged picture (a chat's send box only), and answers the address the
// edited picture is read at; restoreImage puts the picture as picked back («원래대로»).
// editVideo: Editor::VideoEditor's part and quality, cut again from the picked file by the Mac helper.
// B365: `highQuality` — this sender re-encodes photos at the box's «고화질» pick (a chat's); a 1:1 inquiry's has its own size.
export interface AttachmentSender { send(caption: string, itemIds: string[], video: VideoFacts | null, options?: { hd: boolean; first?: boolean }): Promise<void>; discard(): void; highQuality?: true;
  editImage?(itemId: string, bytes: Uint8Array): Promise<string>; restoreImage?(itemId: string): Promise<string>; editVideo?(itemId: string, value: VideoEditValue, overlay: Uint8Array | null): Promise<string> }

// B518: what the box's edits were — kept for a box opened again, so each item opens again with its own.
interface SendFilesEdits { urls: Record<string, string>; photos: Record<string, PhotoEdit>; videos: Record<string, VideoEditValue> }
// What a box opened again after its send failed starts from: the same text, the items not yet sent, and why it failed.
export interface SendFilesRetry { caption: string; itemIds: string[]; error: string; hd?: boolean; edits?: SendFilesEdits }

function SendFilesBox({ draft, sender, close, sent, retry }: { draft: AttachmentDraft; sender: AttachmentSender; close(): void; sent(): void; retry?: SendFilesRetry }) {
  const items = retry ? draft.items.filter(item => retry.itemIds.includes(item.id)) : draft.items
  // B518 (iOS MediaPreviewView, Telegram's picker grid): with more than one item, each tile is opened for editing by a
  // click, and the round mark at its top right chooses whether it goes; a single item keeps its edit button.
  const grid = items.length > 1
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(items.map(item => item.id)))
  const going = items.filter(item => chosen.has(item.id))
  const [caption, setCaption] = useState(retry?.caption ?? '')
  // B365: «고화질», from the last pick or the setting's default; settings «압축» or power saving's compression sends small.
  const choice = photoChoice()
  const [hd, setHd] = useState(retry?.hd ?? photoSendHdInitial(choice))
  const compressing = choice.photoSendQuality === 'compressed' || effectivePowerSaving('compressMediaUploads')
  const hdOffered = sender.highQuality === true && going.some(item => item.kind === 'image' && !/\.gif$/i.test(item.name))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(retry?.error ?? '')
  // B323: a picture edited here is shown from the staged file that replaced it (its address after the edit) — the page's
  // policy refuses blob: copies. B518: each edit is kept as what it was, and the editor opens it again over the item as
  // picked (originalUrl), as tdesktop's does with an item's modifications.
  const [urls, setUrls] = useState<Record<string, string>>(retry?.edits?.urls ?? {})
  const [photoEdits, setPhotoEdits] = useState<Record<string, PhotoEdit>>(retry?.edits?.photos ?? {})
  const [videoEdits, setVideoEdits] = useState<Record<string, VideoEditValue>>(retry?.edits?.videos ?? {})
  // Each video is read once at each address it has; sending waits for it, and sends without it if it cannot be read.
  // B323-c: after an edit the video is read at the address the edit gave it, past the media cache.
  const [facts, setFacts] = useState<Record<string, VideoFacts | null>>({})
  const reading = useRef<Record<string, { url: string; facts: Promise<VideoFacts | null> }>>({})
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  useEffect(() => {
    for (const item of draft.items) {
      const url = item.kind === 'video' ? urls[item.id] ?? item.previewUrl : undefined
      if (!url || reading.current[item.id]?.url === url) continue
      const read = readVideoFacts(url)
      reading.current[item.id] = { url, facts: read }
      setFacts(current => ({ ...current, [item.id]: null }))
      void read.then(value => { if (mounted.current && reading.current[item.id]?.url === url) setFacts(current => ({ ...current, [item.id]: value })) })
    }
  }, [draft, urls])
  const title = draft.kind === 'file' ? tr('파일 보내기') : grid ? overviewTitle(items) : items[0]?.kind === 'video' ? tr('동영상 보내기') : tr('사진 보내기')

  const photoEditable = (item: AttachmentDraft['items'][number]): boolean => item.kind === 'image' && Boolean(sender.editImage) && Boolean(item.originalUrl ?? item.previewUrl) && !/\.gif$/i.test(item.name)
  // Windows has no video helper (index.ts sets the compressor on a Mac only): a video there has no original to cut from.
  const videoEditable = (item: AttachmentDraft['items'][number]): boolean => item.kind === 'video' && Boolean(sender.editVideo) && Boolean(item.originalUrl)
  function edit(item: AttachmentDraft['items'][number]): void {
    if (busy) return
    if (photoEditable(item)) {
      showPhotoEditor(item.originalUrl ?? urls[item.id] ?? item.previewUrl!, photoEdits[item.id] ?? null, async result => {
        const url = result ? await sender.editImage!(item.id, result.bytes) : sender.restoreImage ? await sender.restoreImage(item.id) : null
        if (url) setUrls(current => ({ ...current, [item.id]: url }))
        setPhotoEdits(current => { const next = { ...current }; if (result) next[item.id] = result.edit; else delete next[item.id]; return next })
      })
    } else if (videoEditable(item)) {
      showVideoEditor(item.originalUrl!, videoEdits[item.id] ?? null, videoSendPreset(desktop.value?.preferences.videoSendQuality ?? 'auto', effectivePowerSaving('compressMediaUploads')), async (value, overlay) => {
        const url = await sender.editVideo!(item.id, value, overlay)
        setVideoEdits(current => ({ ...current, [item.id]: value })); setUrls(current => ({ ...current, [item.id]: url }))
      }, { quality: !grid })
    }
  }
  const editedItem = (item: AttachmentDraft['items'][number]): boolean => item.kind === 'image' ? Boolean(photoEdits[item.id]) : videoEdits[item.id]?.edited === true
  function toggle(itemId: string): void {
    setChosen(current => { const next = new Set(current); if (next.has(itemId)) next.delete(itemId); else next.add(itemId); return next })
  }

  // B295: tdesktop's box hands the send over and closes at once (SendFilesBox::send → _confirmedCallback, then closeBox,
  // send_files_box.cpp:2704-2706). From the press the send is the account's: the box closes, the send runs as a tracked
  // write (quitting waits for it, drafts.ts), and a send refused before it is queued opens the box again as it was, with why.
  // B518: a mixed selection goes as several messages in its order (sendGroups) — photos that follow one another as one
  // album, each video on its own — the words with the first. One that is refused stops the rest: the box opens again with
  // the items not yet sent, and the words only if the first did not go.
  function send(): void {
    if (busy || !going.length) return
    setBusy(true)
    const text = caption, pick = hd, groups = draft.kind === 'media' ? sendGroups(going) : [going.map(item => item.id)]
    const edits: SendFilesEdits = { urls, photos: photoEdits, videos: videoEdits }
    sent(); close()
    let at = 0
    void trackWrite((async () => {
      for (; at < groups.length; at++) {
        const group = groups[at]!, first = draft.items.find(item => item.id === group[0])
        const video = first?.kind === 'video' ? await (reading.current[first.id]?.facts ?? Promise.resolve(null)) : null
        await sender.send(at === 0 ? text : '', group, video, { hd: pick, first: at === 0 })
      }
    })()).catch(reason => showAttachmentBox(draft, sender, { caption: at === 0 ? text : '', itemIds: groups.slice(at).flat(), hd: pick, edits,
      error: errorText(reason, tr('첨부를 보내지 못했습니다.')) }))
  }
  return <Box title={title} width={420} onClose={busy ? undefined : close} buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat" data-autofocus disabled={busy || !going.length} onClick={send}>{busy ? <Spinner size={14} /> : null}{tr('보내기')}</button>
  </>}>
    <div className={`send-files-grid${draft.kind === 'file' ? ' files' : ''}`}>
      {items.map(item => {
        const editable = photoEditable(item) || videoEditable(item), on = chosen.has(item.id)
        return <div key={item.id} className={`send-files-item${grid && editable ? ' editable' : ''}${grid && !on ? ' left-out' : ''}`}
          {...(grid && editable ? { role: 'button', tabIndex: 0, 'aria-label': tr('{0} 편집', [item.name]),
            onClick: () => edit(item), onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); edit(item) } } } : {})}>
          <Preview key={urls[item.id] ?? 'staged'} item={item} url={urls[item.id] ?? item.previewUrl} video={facts[item.id] ?? null} />
          {grid ? <>
            <button type="button" className={`send-files-check${on ? ' on' : ''}`} role="checkbox" aria-checked={on} aria-label={tr('{0} 선택', [item.name])} disabled={busy}
              onClick={event => { event.stopPropagation(); toggle(item.id) }} onKeyDown={event => event.stopPropagation()}>{on && <Check size={14} />}</button>
            {editedItem(item) && <span className="send-files-edited" title={tr('편집함')} aria-label={tr('편집함')}><Pencil size={11} /></span>}
          </> : editable && <button className="send-files-edit" aria-label={tr('{0} 편집', [item.name])} disabled={busy} onClick={() => edit(item)}>
            {item.kind === 'video' ? <Scissors size={13} /> : <Pencil size={13} />}</button>}
          {draft.kind === 'file' && <span className="send-files-name"><strong className="ellipsis">{item.name}</strong><small>{bytes(item.size)}</small></span>}
        </div>
      })}
    </div>
    {grid && draft.kind !== 'file' && <p className="send-files-chosen">{overviewChosen(items, going.length)}</p>}
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
      const choice = photoChoice(), hd = options?.hd ?? photoSendHdInitial(choice), first = options?.first !== false
      // B518: the press is the first message's; the rest of a mixed selection stays the send's (outbox.enqueueAttachment).
      if (first) await window.morse.pressAttachment(accountUid, chatId, draft.id)
      const photos = itemIds.filter(itemId => draft.items.find(item => item.id === itemId)?.kind === 'image')
      if (photos.length) await reencodePhotos(accountUid, chatId, draft, photos, photoSendMode(choice, hd))
      // The reply goes with the first message only.
      await trackWrite(window.morse.sendAttachment(accountUid, chatId, draft.id, caption, itemIds, first ? reply() : null, video))
      // B365: the pick is kept for the next box once the photos are on their way (tdesktop saves SendFilesWay on send).
      if (photos.length) {
        const keep = photoSendHdRemembered(choice, hd)
        if (keep !== choice.photoSendHd) void window.morse.updatePreferences({ photoSendHd: keep }).catch(() => {})
      }
    },
    discard: () => { void window.morse.discardAttachment(accountUid, draft.id).catch(() => {}) },
    editImage: async (itemId, bytes) => addressOf(await window.morse.replaceAttachmentImage(accountUid, chatId, draft.id, itemId, bytes), itemId),
    restoreImage: async itemId => addressOf(await window.morse.restoreAttachmentImage(accountUid, chatId, draft.id, itemId), itemId),
    editVideo: async (itemId, value, overlay) =>
      addressOf(await window.morse.editAttachmentVideo(accountUid, chatId, draft.id, itemId, { start: value.start, end: value.end, preset: value.preset, ...(overlay ? { overlay } : {}) }), itemId)
  })
}
function addressOf(next: AttachmentDraft, itemId: string): string {
  const url = next.items.find(item => item.id === itemId)?.previewUrl
  if (!url) throw new Error(tr('첨부 선택이 해제되었습니다. 파일을 다시 선택해 주세요.'))
  return url
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
