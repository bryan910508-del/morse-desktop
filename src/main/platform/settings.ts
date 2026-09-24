import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { Rectangle } from 'electron'
import { defaultPreferences, type Preferences } from '../../shared/model'
import { object, preferencePatch } from '../../shared/validation'
import { backgroundImageInfo, maxBackgroundPhotoBytes } from '../../shared/background-photo-bytes'
import { tr } from '../../shared/i18n'

export interface SavedWindow extends Rectangle { maximized?: boolean }
interface Settings { version: 1; preferences: Preferences; window?: SavedWindow; backgroundPhoto?: { id: string; data: string } }

// One writer serializes preference and geometry changes. No account secrets live here.
export class SettingsStore {
  private value: Settings = { version: 1, preferences: { ...defaultPreferences } }
  private tail: Promise<unknown> = Promise.resolve()
  private readonly path: string
  constructor(private readonly directory: string) { this.path = join(directory, 'preferences.json') }

  async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    try {
      const raw = object(JSON.parse(await readFile(this.path, 'utf8')))
      if (raw.version !== 1) throw new Error(tr('지원하지 않는 설정 파일입니다.'))
      // A file written by another version may hold a setting this one no longer has (and the next one may add some):
      // what is not known is left behind, as every value that is known is still checked. Refusing the whole file would
      // keep the app from opening at all.
      const stored = raw.preferences === undefined ? {} : object(raw.preferences)
      const preferences = { ...defaultPreferences, ...preferencePatch(Object.fromEntries(Object.entries(stored).filter(([key]) => key in defaultPreferences))) }
      const window = raw.window ? object(raw.window) : undefined
      if (window && !['x', 'y', 'width', 'height'].every(key => typeof window[key] === 'number' && Number.isFinite(window[key]))) {
        throw new Error(tr('저장된 창 위치를 읽을 수 없습니다.'))
      }
      if (window && window.maximized !== undefined && typeof window.maximized !== 'boolean') throw new Error(tr('저장된 창 상태를 읽을 수 없습니다.'))
      let backgroundPhoto: Settings['backgroundPhoto']
      if (preferences.chatBackground.preset === 'photo') {
        const photo = object(raw.backgroundPhoto)
        if (photo.id !== preferences.chatBackground.photoId || typeof photo.data !== 'string' || photo.data.length > Math.ceil(maxBackgroundPhotoBytes / 3) * 4) throw new Error(tr('저장된 배경 사진을 읽을 수 없습니다.'))
        const bytes = Buffer.from(photo.data, 'base64')
        try {
          if (bytes.toString('base64') !== photo.data) throw new Error(tr('잘못된 배경 사진입니다.'))
          backgroundImageInfo(bytes, true)
          backgroundPhoto = { id: photo.id as string, data: photo.data }
        } finally { bytes.fill(0) }
      }
      this.value = { version: 1, preferences, window: window as SavedWindow | undefined, backgroundPhoto }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(tr('설정 파일을 읽을 수 없습니다. 원본 파일은 보존됩니다.'))
    }
  }
  get preferences(): Preferences { return { ...this.value.preferences, chatBackground: { ...this.value.preferences.chatBackground } } }
  get window(): SavedWindow | undefined { return this.value.window ? { ...this.value.window } : undefined }

  photo(id: string): Uint8Array | null {
    return this.value.backgroundPhoto?.id === id && this.value.preferences.chatBackground.preset === 'photo' && this.value.preferences.chatBackground.photoId === id
      ? new Uint8Array(Buffer.from(this.value.backgroundPhoto.data, 'base64')) : null
  }
  update(patch: Partial<Preferences>, photo?: Uint8Array, validate: () => void = () => {}): Promise<void> {
    return this.commit(current => {
      validate()
      let backgroundPhoto = current.backgroundPhoto
      if (patch.chatBackground) {
        if (patch.chatBackground.preset === 'photo') {
          if (photo) {
            backgroundImageInfo(photo, true)
            backgroundPhoto = { id: patch.chatBackground.photoId, data: Buffer.from(photo).toString('base64') }
          } else if (backgroundPhoto?.id !== patch.chatBackground.photoId) throw new Error(tr('사진을 다시 선택해 주세요.'))
        } else backgroundPhoto = undefined
      }
      return { ...current, backgroundPhoto, preferences: { ...current.preferences, ...patch } }
    })
  }
  saveWindow(window: SavedWindow): Promise<void> {
    return this.commit(current => ({ ...current, window }))
  }
  private commit(transform: (current: Settings) => Settings): Promise<void> {
    const job = this.tail.then(async () => {
      const next = transform(this.value)
      const temporary = `${this.path}.pending`
      const file = await open(temporary, 'w', 0o600)
      try { await file.writeFile(JSON.stringify(next)); await file.sync() }
      finally { await file.close() }
      await rename(temporary, this.path)
      this.value = next
    })
    this.tail = job.catch(() => {})
    return job
  }
  async flush(): Promise<void> { await this.tail }
}
