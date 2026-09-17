import { object, draftText } from './validation'
import { backgroundPhotoId } from './chat-background'
import { tr } from './i18n'
export interface StoryReplyTextTarget { id: string }
export interface StoryReplyTextRecord extends StoryReplyTextTarget { text: string | null; revision: string | null }
export interface StoryReplyTextWrite extends StoryReplyTextTarget { text: string; expected: string; revision: string }
export function storyReplyTextTarget(raw: unknown): StoryReplyTextTarget { const v = object(raw); if (Object.keys(v).some(k => k !== 'id')) throw new Error(tr('현재 스토리 답장 초안을 선택해 주세요.')); return { id: backgroundPhotoId(v.id) } }
export function storyReplyTextWrite(raw: unknown): StoryReplyTextWrite { const v = object(raw); if (Object.keys(v).some(k => !['id','text','expected','revision'].includes(k))) throw new Error(tr('현재 답장 본문 저장 버전을 확인해 주세요.')); const expected = backgroundPhotoId(v.expected), revision = backgroundPhotoId(v.revision); if (expected === revision) throw new Error(tr('새 저장 버전이 필요합니다.')); return { id: backgroundPhotoId(v.id), text: draftText(v.text), expected, revision } }
