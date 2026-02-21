import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest } from 'next/server'

const ASSETS_DIR = path.resolve(process.cwd(), 'assets')

function buildHeaders(contentLength: number) {
  return {
    'Content-Type': 'video/mp4',
    'Content-Length': String(contentLength),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=0, must-revalidate',
  }
}

function parseRangeHeader(range: string, totalSize: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!match) return null

  const startStr = match[1]
  const endStr = match[2]
  let start = 0
  let end = totalSize - 1

  if (startStr === '' && endStr === '') return null

  if (startStr === '') {
    const suffixLength = Number(endStr)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    start = Math.max(totalSize - suffixLength, 0)
  } else {
    start = Number(startStr)
    if (!Number.isFinite(start) || start < 0) return null
    if (endStr !== '') {
      end = Number(endStr)
      if (!Number.isFinite(end) || end < start) return null
    }
  }

  end = Math.min(end, totalSize - 1)
  if (start >= totalSize || start > end) return null
  return { start, end }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  const { name } = await context.params
  const safeName = path.basename(name)

  if (safeName !== name || !safeName.toLowerCase().endsWith('.mp4')) {
    return new Response('Not found', { status: 404 })
  }

  const filePath = path.resolve(ASSETS_DIR, safeName)
  if (!filePath.startsWith(`${ASSETS_DIR}${path.sep}`)) {
    return new Response('Not found', { status: 404 })
  }

  let fileSize = 0
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return new Response('Not found', { status: 404 })
    fileSize = info.size
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const range = request.headers.get('range')
  if (range) {
    const parsedRange = parseRangeHeader(range, fileSize)
    if (!parsedRange) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${fileSize}` },
      })
    }

    const fullBuffer = await readFile(filePath)
    const chunk = fullBuffer.subarray(parsedRange.start, parsedRange.end + 1)

    return new Response(chunk, {
      status: 206,
      headers: {
        ...buildHeaders(chunk.length),
        'Content-Range': `bytes ${parsedRange.start}-${parsedRange.end}/${fileSize}`,
      },
    })
  }

  const fullBuffer = await readFile(filePath)
  return new Response(fullBuffer, {
    status: 200,
    headers: buildHeaders(fullBuffer.length),
  })
}
