// Bytes held in memory, served to <video> and <audio>: the media element seeks with byte ranges,
// and a QuickTime file whose index sits at the end cannot be read without them.
export function rangeResponse(bytes: Uint8Array, mime: string, request: Request): Response {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 403 })
  const size = bytes.length
  const headers: Record<string, string> = { 'Content-Type': mime, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }
  let start = 0, end = size - 1, status = 200
  const range = request.headers.get('range')
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
    if (!match[1]) { const suffix = Number(match[2]); start = Math.max(0, size - suffix); if (!Number.isSafeInteger(suffix) || suffix <= 0) start = size }
    else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`; status = 206
  }
  headers['Content-Length'] = String(end - start + 1)
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes.subarray(start, end + 1)), { status, headers })
}
