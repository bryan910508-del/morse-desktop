// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { Fragment, type ReactNode } from 'react'

// A translated line with links in it: the dictionary keeps the sentence whole with {0}, {1} where the links go (as
// tdesktop's lang keys keep {gpl_link}, {github_link}), so each language puts them where its own words need them.
export function linkedParts(template: string, links: readonly ReactNode[]): ReactNode[] {
  return template.split(/(\{\d\})/).filter(part => part !== '').map((part, index) => {
    const at = /^\{(\d)\}$/.exec(part)
    return at ? <Fragment key={index}>{links[Number(at[1])] ?? part}</Fragment> : part
  })
}
