// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.3.1),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { useSyncExternalStore } from 'react'

// B401, Webrtc::RecordAvailability: what this computer can record — nothing without a microphone, a voice message with
// one, a video message too when there is also a camera. tdesktop keeps it per chat window and reads it again when the
// devices change; here it is one value for the app, from the kinds of devices the system lists (no permission is asked
// and no id or name is read), kept up to date by `devicechange`.
export type RecordAvailability = 'none' | 'audio' | 'videoAndAudio'
export type RecordMode = 'voice' | 'video'

export function recordAvailabilityOf(devices: readonly { kind: string }[]): RecordAvailability {
  if (!devices.some(device => device.kind === 'audioinput')) return 'none'
  return devices.some(device => device.kind === 'videoinput') ? 'videoAndAudio' : 'audio'
}
// HistoryWidget::computeSendButtonType (history_widget.cpp:6110-6125): the button is the round video one only while the
// kept choice is video and both devices are there; otherwise it records voice.
export function recordModeFor(recordVideoMessages: boolean, availability: RecordAvailability): RecordMode {
  return recordVideoMessages && availability === 'videoAndAudio' ? 'video' : 'voice'
}
// HistoryWidget::showRecordButton (:6869-6872): with nothing to record from, the send button stays in its place.
export function showsRecordButton(availability: RecordAvailability): boolean {
  return availability !== 'none'
}
// recordingTipRequests (:1406-1422): a click always turns the kept choice over, then the toast says what the button is
// now — video, voice when a camera could have made it video, or how to record when it cannot.
export function recordTipAfterSwitch(recordVideoMessages: boolean, availability: RecordAvailability): 'video' | 'voice' | 'hold' {
  if (recordModeFor(recordVideoMessages, availability) === 'video') return 'video'
  return availability === 'videoAndAudio' ? 'voice' : 'hold'
}

// One reading for every compose area. Until the first listing answers, a microphone is assumed, so the button does not
// blink out and back on a computer that has one.
interface MediaDevicesLike {
  enumerateDevices(): Promise<readonly { kind: string }[]>
  addEventListener(type: 'devicechange', listener: () => void): void
}
let current: RecordAvailability = 'audio'
let started = false
let reading = 0
const listeners = new Set<() => void>()
function set(next: RecordAvailability): void {
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}
export async function readRecordAvailability(devices: MediaDevicesLike | undefined): Promise<void> {
  const serial = ++reading
  let next: RecordAvailability
  // A listing that fails tells nothing: the last reading stays (pressing record then says what is wrong, captureProblem).
  try { next = devices ? recordAvailabilityOf(await devices.enumerateDevices()) : 'none' } catch { return }
  // A slower, older listing never overwrites a newer one.
  if (serial === reading) set(next)
}
export function watchRecordAvailability(devices: MediaDevicesLike | undefined): void {
  if (started) return
  started = true
  void readRecordAvailability(devices)
  devices?.addEventListener('devicechange', () => { void readRecordAvailability(devices) })
}
function subscribe(listener: () => void): () => void {
  watchRecordAvailability(typeof navigator === 'undefined' ? undefined : navigator.mediaDevices)
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function recordAvailabilityNow(): RecordAvailability { return current }
export function useRecordAvailability(): RecordAvailability {
  return useSyncExternalStore(subscribe, () => current)
}
