// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.3.0, 42f8a36d),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
//
// Album mosaic: Ui::LayoutMediaGroup (ui/grouped_layout.cpp), line for line — every photo in the width of the group, by
// its own shape. tdesktop lays an album out at historyGroupWidthMax (maxMediaSize 430) with historyGroupWidthMin
// (minPhotoSize 100) and historyGroupSkip 4 (ui/chat/chat.style:168-169, :506-508), then scales the whole of it to the
// width it is drawn in (GroupedMedia::countCurrentSize, history_view_media_grouped.cpp:227-233).
export const groupWidthMax = 430
export const groupWidthMin = 100
export const groupSkip = 4

export interface GroupSize { width: number; height: number }
export interface GroupSides { top: boolean; right: boolean; bottom: boolean; left: boolean }
export interface GroupRect { x: number; y: number; width: number; height: number; sides: GroupSides }

const round = (value: number): number => Math.round(value)
const sides = (top: boolean, right: boolean, bottom: boolean, left: boolean): GroupSides => ({ top, right, bottom, left })

// LayoutMediaGroup (:569-575) → Layouter::layout (:123-146).
export function layoutMediaGroup(sizes: readonly GroupSize[], maxWidth = groupWidthMax, minWidth = groupWidthMin, spacing = groupSkip): GroupRect[] {
  const count = sizes.length
  if (!count) return []
  // CountRatios (:105-112), CountProportions (:114-121).
  const ratios = sizes.map(size => size.width / size.height)
  const proportions = ratios.map(ratio => ratio > 1.2 ? 'w' : ratio < 0.8 ? 'n' : 'q').join('')
  // «All apps currently use square max size first» (:96-98); the average starts from 1, as ranges::accumulate(_ratios, 1.).
  const maxHeight = maxWidth
  const averageRatio = ratios.reduce((sum, ratio) => sum + ratio, 1) / count
  const maxSizeRatio = maxWidth / maxHeight
  if (count === 1) {
    // layoutOne (:181-193).
    const width = maxWidth, height = Math.trunc((sizes[0]!.height * width) / sizes[0]!.width)
    return [{ x: 0, y: 0, width, height, sides: sides(true, true, true, true) }]
  }
  if (count >= 5 || ratios.some(ratio => ratio > 2)) return complexLayout(ratios, averageRatio, maxWidth, minWidth, spacing)
  if (count === 2) {
    // layoutTwo (:148-159).
    if (proportions === 'ww' && averageRatio > 1.4 * maxSizeRatio && ratios[1]! - ratios[0]! < 0.2) {
      // layoutTwoTopBottom (:195-216).
      const width = maxWidth, height = round(Math.min(width / ratios[0]!, Math.min(width / ratios[1]!, (maxHeight - spacing) / 2)))
      return [{ x: 0, y: 0, width, height, sides: sides(true, true, false, true) },
        { x: 0, y: height + spacing, width, height, sides: sides(false, true, true, true) }]
    }
    if (proportions === 'ww' || proportions === 'qq') {
      // layoutTwoLeftRightEqual (:218-236).
      const width = Math.trunc((maxWidth - spacing) / 2)
      const height = round(Math.min(width / ratios[0]!, Math.min(width / ratios[1]!, maxHeight)))
      return [{ x: 0, y: 0, width, height, sides: sides(true, false, true, true) },
        { x: width + spacing, y: 0, width, height, sides: sides(true, true, true, false) }]
    }
    // layoutTwoLeftRight (:238-266).
    const minimalWidth = round(minWidth * 1.5)
    const secondWidth = Math.min(round(Math.max(0.4 * (maxWidth - spacing), (maxWidth - spacing) / ratios[0]! / (1 / ratios[0]! + 1 / ratios[1]!))), maxWidth - spacing - minimalWidth)
    const firstWidth = maxWidth - secondWidth - spacing
    const height = Math.min(maxHeight, round(Math.min(firstWidth / ratios[0]!, secondWidth / ratios[1]!)))
    return [{ x: 0, y: 0, width: firstWidth, height, sides: sides(true, false, true, true) },
      { x: firstWidth + spacing, y: 0, width: secondWidth, height, sides: sides(true, true, true, false) }]
  }
  if (count === 3) {
    if (proportions[0] === 'n') {
      // layoutThreeLeftAndOther (:268-303).
      const firstHeight = maxHeight
      const thirdHeight = round(Math.min((maxHeight - spacing) / 2, ratios[1]! * (maxWidth - spacing) / (ratios[2]! + ratios[1]!)))
      const secondHeight = firstHeight - thirdHeight - spacing
      const rightWidth = Math.max(minWidth, round(Math.min((maxWidth - spacing) / 2, Math.min(thirdHeight * ratios[2]!, secondHeight * ratios[1]!))))
      const leftWidth = Math.min(round(firstHeight * ratios[0]!), maxWidth - spacing - rightWidth)
      return [{ x: 0, y: 0, width: leftWidth, height: firstHeight, sides: sides(true, false, true, true) },
        { x: leftWidth + spacing, y: 0, width: rightWidth, height: secondHeight, sides: sides(true, true, false, false) },
        { x: leftWidth + spacing, y: secondHeight + spacing, width: rightWidth, height: thirdHeight, sides: sides(false, true, true, false) }]
    }
    // layoutThreeTopAndOther (:305-334).
    const firstWidth = maxWidth
    const firstHeight = round(Math.min(firstWidth / ratios[0]!, (maxHeight - spacing) * 0.66))
    const secondWidth = Math.trunc((maxWidth - spacing) / 2)
    const secondHeight = Math.min(maxHeight - firstHeight - spacing, round(Math.min(secondWidth / ratios[1]!, secondWidth / ratios[2]!)))
    const thirdWidth = firstWidth - secondWidth - spacing
    return [{ x: 0, y: 0, width: firstWidth, height: firstHeight, sides: sides(true, true, false, true) },
      { x: 0, y: firstHeight + spacing, width: secondWidth, height: secondHeight, sides: sides(false, false, true, true) },
      { x: secondWidth + spacing, y: firstHeight + spacing, width: thirdWidth, height: secondHeight, sides: sides(false, true, true, false) }]
  }
  if (proportions[0] === 'w') {
    // layoutFourTopAndOther (:336-379).
    const w = maxWidth
    const h0 = round(Math.min(w / ratios[0]!, (maxHeight - spacing) * 0.66))
    const h = round((maxWidth - 2 * spacing) / (ratios[1]! + ratios[2]! + ratios[3]!))
    const w0 = Math.max(minWidth, round(Math.min((maxWidth - 2 * spacing) * 0.4, h * ratios[1]!)))
    const w2 = round(Math.max(Math.max(minWidth, (maxWidth - 2 * spacing) * 0.33), h * ratios[3]!))
    const w1 = w - w0 - w2 - 2 * spacing
    const h1 = Math.min(maxHeight - h0 - spacing, h)
    return [{ x: 0, y: 0, width: w, height: h0, sides: sides(true, true, false, true) },
      { x: 0, y: h0 + spacing, width: w0, height: h1, sides: sides(false, false, true, true) },
      { x: w0 + spacing, y: h0 + spacing, width: w1, height: h1, sides: sides(false, false, true, false) },
      { x: w0 + spacing + w1 + spacing, y: h0 + spacing, width: w2, height: h1, sides: sides(false, true, true, false) }]
  }
  // layoutFourLeftAndOther (:381-418).
  const h = maxHeight
  const w0 = round(Math.min(h * ratios[0]!, (maxWidth - spacing) * 0.6))
  const w = round((maxHeight - 2 * spacing) / (1 / ratios[1]! + 1 / ratios[2]! + 1 / ratios[3]!))
  const h0 = round(w / ratios[1]!), h1 = round(w / ratios[2]!), h2 = h - h0 - h1 - 2 * spacing
  const w1 = Math.max(minWidth, Math.min(maxWidth - w0 - spacing, w))
  return [{ x: 0, y: 0, width: w0, height: h, sides: sides(true, false, true, true) },
    { x: w0 + spacing, y: 0, width: w1, height: h0, sides: sides(true, true, false, false) },
    { x: w0 + spacing, y: h0 + spacing, width: w1, height: h1, sides: sides(false, true, false, false) },
    { x: w0 + spacing, y: h0 + h1 + 2 * spacing, width: w1, height: h2, sides: sides(false, true, true, false) }]
}

// ComplexLayouter (:420-565): five or more, or a very wide one — rows of one to three (four when tall), the attempt whose
// height comes nearest maxWidth * 4/3 wins, a row under minWidth high or a row longer than the next costing 1.5 times.
function complexLayout(source: readonly number[], averageRatio: number, maxWidth: number, minWidth: number, spacing: number): GroupRect[] {
  // CropRatios (:436-449).
  const ratios = source.map(ratio => averageRatio > 1.1 ? Math.min(2.75, Math.max(1, ratio)) : Math.min(1, Math.max(0.6667, ratio)))
  const count = ratios.length, maxHeight = Math.trunc(maxWidth * 4 / 3)
  const attempts: { counts: number[]; heights: number[] }[] = []
  const multiHeight = (offset: number, length: number): number => (maxWidth - (length - 1) * spacing) / ratios.slice(offset, offset + length).reduce((sum, ratio) => sum + ratio, 0)
  const push = (counts: number[]): void => {
    let offset = 0
    attempts.push({ counts, heights: counts.map(length => { const height = multiHeight(offset, length); offset += length; return height }) })
  }
  for (let first = 1; first !== count; first++) {
    const second = count - first
    if (first > 3 || second > 3) continue
    push([first, second])
  }
  for (let first = 1; first !== count - 1; first++) {
    for (let second = 1; second !== count - first; second++) {
      const third = count - first - second
      if (first > 3 || second > (averageRatio < 0.85 ? 4 : 3) || third > 3) continue
      push([first, second, third])
    }
  }
  for (let first = 1; first !== count - 1; first++) {
    for (let second = 1; second !== count - first; second++) {
      for (let third = 1; third !== count - first - second; third++) {
        const fourth = count - first - second - third
        if (first > 3 || second > 3 || third > 3 || fourth > 3) continue
        push([first, second, third, fourth])
      }
    }
  }
  let best = attempts[0]!, bestDiff = Infinity
  for (const attempt of attempts) {
    const lines = attempt.counts.length
    const total = attempt.heights.reduce((sum, height) => sum + height, 0) + spacing * (lines - 1)
    const bad1 = Math.min(...attempt.heights) < minWidth ? 1.5 : 1
    let bad2 = 1
    for (let line = 1; line !== lines; line++) if (attempt.counts[line - 1]! > attempt.counts[line]!) { bad2 = 1.5; break }
    const diff = Math.abs(total - maxHeight) * bad1 * bad2
    if (diff < bestDiff) { best = attempt; bestDiff = diff }
  }
  const result: GroupRect[] = []
  let index = 0, y = 0
  best.counts.forEach((columns, row) => {
    const lineHeight = best.heights[row]!, height = round(lineHeight)
    let x = 0
    for (let column = 0; column !== columns; column++) {
      const width = column === columns - 1 ? maxWidth - x : round(ratios[index]! * lineHeight)
      result.push({ x, y, width, height, sides: sides(row === 0, column === columns - 1, row === best.counts.length - 1, column === 0) })
      x += width + spacing
      index++
    }
    y += height + spacing
  })
  return result
}
