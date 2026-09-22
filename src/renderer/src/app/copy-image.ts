import { controller } from './ui'
import { errorText } from './format'
import { tr } from '../../../shared/i18n'

// Telegram's «Copy Image» (CopyImage → PhotoMedia::setToClipboard) and the viewer's «Copy frame»: the picture that is
// already shown here — an image address of this window, or the frame a video is on — is drawn once more as a PNG
// and the main process puts it on the clipboard. Nothing is fetched from the network for it.
export async function copyImage(source: string | HTMLVideoElement): Promise<void> {
  try {
    const bitmap = typeof source === 'string'
      ? await createImageBitmap(await (await fetch(source)).blob())
      : await createImageBitmap(source)
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')
      if (!context || !bitmap.width || !bitmap.height) throw new Error(tr('이미지를 복사하지 못했습니다.'))
      context.drawImage(bitmap, 0, 0)
      const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
      await window.morse.copyImage(png)
    } finally { bitmap.close() }
    controller.toast(tr('복사했습니다.'))
  } catch (reason) { controller.toast(errorText(reason, tr('이미지를 복사하지 못했습니다.')), 'error') }
}
