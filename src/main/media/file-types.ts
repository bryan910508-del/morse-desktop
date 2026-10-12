// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.3.0),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.

// Core::DetectNameType and Core::IsIpRevealingPath (core/mime_type.cpp:257-355), with LauncherWouldWarn
// (data/data_document_resolver.cpp:185-198): before a received file is handed to the system, a program, a kind tdesktop
// does not know, and a kind that fetches from the network as it opens are asked about. Its theme files are not
// Morse's, so they are a kind it does not know.
const split = (list: string): ReadonlySet<string> => new Set(list.trim().split(/\s+/))
const benign = split(`
afdesign ai avif bmp dng gif heic icns ico jfif jpeg jpg jpg-large jxl nef png png-large psd qoi raw sketch svg tga tif tiff webp
3g2 3gp 3gpp aep avi flv h264 m4s m4v mkv mov mp4 mpeg mpg ogv srt tgs tgv vob webm wmv
aac ac3 aif amr caf cda cue flac m4a m4b mid midi mp3 ogg opus wav wma
pdf doc docx ppt pptx pps ppsx xls xlsx txt rtf odt ods odp csv text log tl tex xspf xml djvu diag ps ost kml pub epub mobi cbr
cbz fb2 prc ris pem p7b m3u m3u8 wpd wpl htm html xhtml key
7z arj bz2 gz rar tar xz z zip zst
c cc cpp cxx h m mm swift cs ts class java css ninja cmake patch diff plist gyp gitignore strings asoundrc torrent csr json xaml
md keylayout sql sln xib mk dmg img iso vcd pdb eot ics ips ipa core mem pcap ovpn part pcapng dmp pkpass dat zxp crash file bak
gbr plain dlc fon fnt otf ttc ttf gpx db rss cur`)
const programs: Readonly<Record<'win32' | 'darwin' | 'other', ReadonlySet<string>>> = {
  win32: split(`
ad ade adp ahk app application appref-ms asp aspx asx bas bat bin cab cdxml cer cfg cgi chi chm cmd cnt com conf cpl crt csh der
diagcab dll drv eml exe fon fxp gadget grp hlp hpj hta htt inf ini ins inx isp isu its jar jnlp job js jse jsp key ksh lexe
library-ms lnk local lua mad maf mag mam manifest maq mar mas mat mau mav maw mcf mda mdb mde mdt mdw mdz mht mhtml mjs mmc mof msc
msg msh msh1 msh2 msh1xml msh2xml mshxml msi msp mst ops osd paf pcd phar php php3 php4 php5 php7 phps php-s pht phtml pif pl plg
pm pod prf prg ps1 ps2 ps1xml ps2xml psc1 psc2 psd1 psm1 pssc pst py py3 pyc pyd pyi pyo pyw pyzw pyz rb reg rgs scf scr sct
search-ms settingcontent-ms sh shb shs slk sys swf t tmp u3p url vb vbe vbp vbs vbscript vdx vsmacros vsd vsdm vsdx vss vssm vssx
vst vstm vstx vsw vsx vtx website wlua ws wsc wsf wsh xbap xll xlsb xlsm xnk xs`),
  darwin: split('applescript action app bin command csh osx workflow terminal url caction mpkg pkg scpt scptd xhtm xhtml webarchive'),
  other: split('bin csh deb desktop ksh out pet pkg pup rpm run sh shar slp zsh'),
}
const revealing: Readonly<Record<'win32' | 'darwin' | 'other', ReadonlySet<string>>> = {
  win32: split('htm html svg m4v m3u m3u8 xhtml xml kml kmz xspf wpl'),
  darwin: split(`htm html svg m4v m3u m3u8 xhtml xml kml kmz xspf docx dotx docm dotm xlsx xltx xlsm xltm xlsb pptx ppsx potx pptm
ppsm potm`),
  other: split('htm html svg m4v m3u m3u8 xhtml xml kml kmz xspf'),
}

export type FileWarning = 'program' | 'address' | 'unknown'
export function fileWarning(extension: string, platform: string = process.platform): FileWarning | null {
  const name = extension.toLowerCase(), system = platform === 'win32' || platform === 'darwin' ? platform : 'other'
  if (programs[system].has(name)) return 'program'
  if (revealing[system].has(name)) return 'address'
  return benign.has(name) ? null : 'unknown'
}
