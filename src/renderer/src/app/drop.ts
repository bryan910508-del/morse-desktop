export function hasFiles(data: DataTransfer | null): boolean {
  return Boolean(data && (Array.from(data.types).includes('Files') || Array.from(data.items).some(item => item.kind === 'file') || data.files.length))
}

// Chromium would otherwise navigate to a file dropped outside a drop target.
export function preventFileDropNavigation(): void {
  window.addEventListener('dragover', event => {
    if (!hasFiles(event.dataTransfer)) return
    if (!event.defaultPrevented && event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    event.preventDefault()
  })
  window.addEventListener('drop', event => { if (hasFiles(event.dataTransfer)) event.preventDefault() })
}
