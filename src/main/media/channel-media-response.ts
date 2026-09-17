// Serve the already verified local payload. Remote range requests are not used.
// Every pull checks ownership; aborting an individual seek does not close the selection.
export function channelMediaResponse(bytes: Buffer, mime: string, request: Request, validate: () => void): Response {
  validate()
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
  const size = bytes.length, headers: Record<string, string> = {
    'Content-Type': mime, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox"
  }
  let start = 0, end = size - 1, status = 200
  const range = request.method === 'GET' && !request.headers.has('if-range') ? request.headers.get('range') : null
  if (range !== null) {
    const invalid = () => new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
    if (range.length > 128) return invalid()
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match || (!match[1] && !match[2])) return invalid()
    if (!match[1]) {
      const suffix = Number(match[2])
      if (!Number.isSafeInteger(suffix) || suffix <= 0) return invalid()
      start = Math.max(0, size - suffix)
    } else {
      start = Number(match[1])
      const requestedEnd = match[2] ? Number(match[2]) : end
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || requestedEnd < start) return invalid()
      end = Math.min(requestedEnd, end)
    }
    if (start >= size || start > end) return invalid()
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  }
  headers['Content-Length'] = String(end - start + 1)
  if (request.method === 'HEAD') return new Response(null, { headers })
  let offset = start
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      try {
        request.signal.throwIfAborted(); validate()
        const next = Math.min(offset + 256 * 1024, end + 1)
        controller.enqueue(new Uint8Array(bytes.subarray(offset, next))); offset = next
        if (offset > end) controller.close()
      } catch (error) { controller.error(error) }
    }
  })
  return new Response(body, { status, headers })
}
