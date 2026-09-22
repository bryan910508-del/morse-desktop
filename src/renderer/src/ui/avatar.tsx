import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren, type Ref } from 'react'
import type { GroupPhotoImage } from '../../../shared/group-photo'
import { maxDialogAvatars } from '../../../shared/dialog-avatars'
import { initials } from '../app/format'
import { tr } from '../../../shared/i18n'

export type AvatarKind = 'secret' | 'saved' | 'deleted' | 'channel'

// PeerData::paintUserpic draws the empty userpic until the picture is loaded, never an empty circle. A picture the window
// already holds under the same address is drawn in the same frame; a changed picture replaces the one on screen when ready.
export function Avatar({ name, url, size = 46, kind, ref, onOpen }: { name: string; url?: string | null; size?: number; kind?: AvatarKind; ref?: Ref<HTMLSpanElement>
  // Ui::UserpicButton Role::OpenPhoto: pressing the picture opens it. A peer with no picture has nothing to open,
  // and keeps the plain circle and its cursor (UserpicButton::updateCursor).
  onOpen?: () => void }) {
  const [failed, setFailed] = useState<string | null>(null)
  const [drawn, setDrawn] = useState(false)
  const image = useRef<HTMLImageElement>(null)
  const show = Boolean(url) && failed !== url
  useLayoutEffect(() => {
    if (!show) { setDrawn(false); return }
    const node = image.current
    if (node?.complete && node.naturalWidth > 0) setDrawn(true)
  }, [show, url])
  const picture = <span ref={ref} className={`avatar${kind ? ` ${kind}` : ''}`} style={{ width: size, height: size, fontSize: Math.round(size * .38) }} aria-hidden="true">
    {!(show && drawn) && <span className="avatar-initials">{initials(name)}</span>}
    {show && <img ref={image} src={url!} alt="" draggable={false} decoding="async" className={drawn ? undefined : 'pending'}
      onLoad={() => setDrawn(true)} onError={() => { setFailed(url!); setDrawn(false) }} />}
  </span>
  if (!onOpen || !show) return picture
  return <button type="button" className="avatar-open" aria-label={tr('프로필 사진 보기')} onClick={onOpen}>{picture}</button>
}

type Observe = (element: HTMLElement, id: string, changed: (visible: boolean) => void, priority: boolean) => () => void
export type PhotoSurface = 'dialogs' | 'contacts' | 'channels'
const Scopes = createContext<Partial<Record<PhotoSurface, Observe>>>({})
const Nearest = createContext<PhotoSurface | null>(null)

// Main downloads photos only for rows on screen (at most maxDialogAvatars per surface).
// Every mounted scope of one surface contributes to a single list, so a box or a story row
// does not replace the rows of the window behind it. A refused list is sent again later.
interface Member { ids(): string[] }
interface Registry { members: Set<Member>; timer: ReturnType<typeof setTimeout> | null; last: string; send(ids: string[]): Promise<void> }
const registries = new Map<string, Registry>()
function registry(accountUid: string, surface: PhotoSurface): Registry {
  const key = `${accountUid}:${surface}`
  let value = registries.get(key)
  if (!value) {
    value = { members: new Set(), timer: null, last: '', send: ids => surface === 'channels' ? window.morse.setVisibleChannelPhotos(accountUid, ids)
      : surface === 'contacts' ? window.morse.setVisibleContactPhotos(accountUid, ids) : window.morse.setVisibleDialogPhotos(accountUid, ids) }
    registries.set(key, value)
  }
  return value
}
function schedule(accountUid: string, surface: PhotoSurface, delay = 40): void {
  const value = registry(accountUid, surface)
  if (value.timer !== null) return
  value.timer = setTimeout(() => {
    value.timer = null
    const ids = [...new Set([...value.members].flatMap(member => member.ids()))].slice(0, maxDialogAvatars)
    const key = JSON.stringify(ids)
    if (key === value.last) return
    value.last = key
    void value.send(ids).catch(() => {
      if (value.last !== key) return
      value.last = ''
      schedule(accountUid, surface, 3000)
    })
  }, delay)
}

export function AvatarScope({ accountUid, enabled, surface, children }: PropsWithChildren<{ accountUid: string | null; enabled: boolean; surface: PhotoSurface }>) {
  const [pageVisible, setPageVisible] = useState(!document.hidden)
  useEffect(() => {
    const changed = (): void => setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  const available = enabled && pageVisible
  const scope = useMemo(() => {
    const elements = new Map<HTMLElement, { id: string; visible: boolean; changed: (visible: boolean) => void; priority: boolean }>()
    let observer: IntersectionObserver | null = null, disposed = false
    const member: Member = { ids: () => disposed || !available ? []
      : [...elements.values()].filter(item => item.visible).sort((a, b) => Number(b.priority) - Number(a.priority)).map(item => item.id) }
    const changed = (): void => { if (!disposed && accountUid) schedule(accountUid, surface) }
    const observe: Observe = (element, id, onChange, priority) => {
      if (!available || !accountUid || disposed) return () => {}
      observer ??= new IntersectionObserver(changes => {
        for (const change of changes) {
          const item = elements.get(change.target as HTMLElement)
          if (item) { item.visible = change.isIntersecting && change.intersectionRatio > 0; item.changed(item.visible) }
        }
        changed()
      })
      elements.set(element, { id, visible: false, changed: onChange, priority }); observer.observe(element)
      return () => { observer?.unobserve(element); elements.delete(element); changed() }
    }
    return { member, observe, dispose: (): void => { disposed = true; observer?.disconnect(); elements.clear() } }
  }, [accountUid, available, surface])
  useEffect(() => {
    if (!accountUid) return
    registry(accountUid, surface).members.add(scope.member)
    return () => { scope.dispose(); registry(accountUid, surface).members.delete(scope.member); schedule(accountUid, surface) }
  }, [scope, accountUid, surface])
  const parent = useContext(Scopes)
  const value = useMemo(() => ({ ...parent, [surface]: scope.observe }), [parent, scope, surface])
  return <Scopes.Provider value={value}><Nearest.Provider value={surface}>{children}</Nearest.Provider></Scopes.Provider>
}

export function PeerAvatar({ id, name, image, size = 46, kind, priority = false, surface }: { id: string; name: string; image?: GroupPhotoImage | null; size?: number; kind?: AvatarKind; priority?: boolean; surface?: PhotoSurface }) {
  const element = useRef<HTMLSpanElement>(null), scopes = useContext(Scopes), nearest = useContext(Nearest)
  const observe = scopes[surface ?? nearest ?? 'dialogs'] ?? null
  const eligible = Boolean(image)
  useEffect(() => {
    const node = element.current
    if (!node || !eligible || !observe) return
    return observe(node, id, () => {}, priority)
  }, [observe, id, eligible, priority])
  return <Avatar ref={element} name={name} url={image?.status === 'ready' ? image.url : null} size={size} kind={kind} />
}
