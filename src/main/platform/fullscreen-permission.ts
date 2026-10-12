// B301: a video's own full-screen button (and the viewer asking for it) goes through Chromium's «fullscreen» permission,
// which the session's handlers refused with everything that was not a microphone or camera — so the button did
// nothing. tdesktop's media viewer puts a video full screen from its controls, Ctrl+F, Ctrl/Alt+Enter or a double-click
// (OverlayWidget::playbackToggleFullScreen, media_view_overlay_widget.cpp:5995-6021). Allowed only for this app's own
// page: the main window's main frame, at the app's own address. Another origin or a subframe stays refused.
export function fullscreenAllowed(fromMainWindow: boolean, isMainFrame: boolean, requestingUrl: string, trusted: (url: string) => boolean): boolean {
  return fromMainWindow && isMainFrame && trusted(requestingUrl)
}
