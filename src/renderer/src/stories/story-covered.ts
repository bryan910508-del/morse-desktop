import { useRef } from 'react'
import { ui, useUi, type LayerEntry } from '../app/ui'
import { usePopupMenuOpen } from '../ui/popup-menu'

// B497 (tdesktop Stories::Controller::updatePlayingAllowed, media/stories/media_stories_controller.cpp:1155-1168): a story
// plays only while nothing covers it — no menu open (setMenuShown :1488-1493) and no box over the viewer
// (storiesLayerShown :342-348). When the menu or the box goes, it carries on by itself; a pause the person pressed is
// kept apart and stays. (tdesktop's third condition, the header tooltip over the privacy badge or a silent video's
// sound button, has no counterpart in these viewers.)
export function storyCovered(layers: readonly Pick<LayerEntry, 'id'>[], viewerLayer: string, menuOpen: boolean): boolean {
  if (menuOpen) return true
  const at = layers.findIndex(layer => layer.id === viewerLayer)
  return at >= 0 && at < layers.length - 1
}
// The viewer is a layer itself (showLayer); the one on top when it is first drawn is its own.
export function useStoryCovered(): boolean {
  const own = useRef<string | null>(null)
  if (own.current === null) own.current = ui().layers.at(-1)?.id ?? ''
  const viewerLayer = own.current
  const above = useUi(state => storyCovered(state.layers, viewerLayer, false))
  return storyCovered([], '', usePopupMenuOpen()) || above
}
