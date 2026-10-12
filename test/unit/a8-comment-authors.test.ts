import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChannelComments } from '../../src/main/accounts/channel-comments'
import { PublicChannelComments } from '../../src/main/accounts/channel-public-comments'
import { PeerProfiles, publicProfilePath } from '../../src/main/accounts/peer-profiles'
import { channelPostRevision } from '../../src/main/media/channel-post-media-document'
import type { FirestoreReader, ReadCredentials, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// A8 §4 (Telegram R-41): a comment shows its author as they are now, from their public profile; the name the comment
// was written with stands in while that is unknown, and a deleted account shows as one. B266/B153 §4: the picture
// follows the person's own rule, as anywhere — never the copy the comment keeps.
const credentials: ReadCredentials = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 3600000 }) }
const at = { seconds: '1790121600', nanos: 0 }
const uid = 'me', root = `${documents}/channels/ch-a`
const post: FirestoreDocument = { name: `${root}/posts/p1`, updateTime: at, fields: { channelId: { stringValue: 'ch-a' }, authorId: { stringValue: uid }, text: { stringValue: 'p1' },
  visibility: { stringValue: 'public' }, createdAt: { timestampValue: at }, likedBy: { arrayValue: { values: [] } }, likeCount: { integerValue: '0' }, commentCount: { integerValue: '3' } } } as unknown as FirestoreDocument
const comment = (id: string, author: string, name: string, extra: Record<string, unknown> = {}): FirestoreDocument => ({ name: `${root}/posts/p1/comments/${id}`, updateTime: at,
  fields: { channelId: { stringValue: 'ch-a' }, postId: { stringValue: 'p1' }, authorId: { stringValue: author }, authorName: { stringValue: name },
    authorPhotoURL: { stringValue: `gs://written/${author}.jpg` }, text: { stringValue: '댓글' }, createdAt: { timestampValue: at }, ...extra } }) as unknown as FirestoreDocument
const profile = (author: string, fields: Record<string, unknown>): FirestoreDocument => ({ name: publicProfilePath(author), fields } as unknown as FirestoreDocument)
const rows = (...docs: FirestoreDocument[]): Map<string, FirestoreDocument> => new Map(docs.map(doc => [doc.name, doc]))

function pane() {
  const targets: { paths: string[]; events: WatchEvents; stopped: boolean; query: boolean }[] = []
  const reader = {
    watch(target: { query?: unknown; documents?: { documents: string[] } }, _signal: AbortSignal, events: WatchEvents) {
      const entry = { paths: target.documents?.documents ?? [], events, stopped: false, query: Boolean(target.query) }
      targets.push(entry)
      return () => { entry.stopped = true }
    }
  } as unknown as FirestoreReader
  const photos: [string, string | null][] = []
  const comments = new ChannelComments(uid, credentials, () => ({ reader, post }), () => {})
  comments.people = (author, raw) => { photos.push([author, raw]); return null }
  comments.open({ selectionId: 's1', requestId: 'r1', channelId: 'ch-a', postId: 'p1', revision: channelPostRevision(post) })
  const list = targets.find(target => target.query)!
  return { comments, targets, list, photos, authors: () => targets.filter(target => !target.query && !target.stopped) }
}
const view = (comments: ChannelComments) => comments.snapshot!.items.map(item => [item.id, item.authorName, item.parentAuthorName])

test('the authors of the comments on screen are read from their public profiles, and only those', () => {
  const { comments, list, authors } = pane()
  list.events.snapshot(rows(comment('c1', 'a1', '옛 이름'), comment('c2', 'a2', '두번째'), comment('c3', 'a1', '옛 이름', { parentCommentId: { stringValue: 'c1' }, parentAuthorName: { stringValue: '옛 이름' } })))
  assert.deepEqual(authors().map(target => target.paths), [[publicProfilePath('a1'), publicProfilePath('a2')]], 'one target, no account document and no contact document')
  assert.deepEqual(view(comments), [['c1', '옛 이름', ''], ['c2', '두번째', ''], ['c3', '옛 이름', '옛 이름']], 'until it answers, the names they wrote with')
  comments.clear()
})

test('a renamed author shows by their name now, a missing or refused profile by the name the comment kept, a deleted account as one', () => {
  const { comments, list, authors, photos } = pane()
  list.events.snapshot(rows(comment('c1', 'a1', '옛 이름'), comment('c2', 'a2', '두번째'), comment('c3', 'a3', '세번째', { parentCommentId: { stringValue: 'c1' }, parentAuthorName: { stringValue: '옛 이름' } })))
  authors()[0]!.events.snapshot(rows(profile('a1', { displayName: { stringValue: '새 이름' }, photoURL: { stringValue: 'gs://now/a1.jpg' } }),
    profile('a2', { accountDeleted: { booleanValue: true } })))
  assert.deepEqual(view(comments), [['c1', '새 이름', ''], ['c2', '탈퇴한 계정', ''], ['c3', '세번째', '새 이름']],
    'renamed; deleted; not made yet (a3) keeps what it wrote, and a reply names its parent\'s author as they are now')
  // B153 §4: a1 keeps the default rule (mutual contacts) and is not one; a3 is unread — neither picture is drawn, nor
  // the copy each comment keeps.
  photos.length = 0; void comments.snapshot
  assert.deepEqual(photos, [['a1', null], ['a2', null], ['a3', null]])
  // A picture shown to everyone is drawn; a contact's by the contacts' own mutual rule.
  authors()[0]!.events.snapshot(rows(profile('a1', { displayName: { stringValue: '새 이름' }, photoURL: { stringValue: 'gs://now/a1.jpg' }, privacy: { mapValue: { fields: { photo: { stringValue: 'everyone' } } } } })))
  comments.authors.contactPhoto = author => author === 'a3' ? 'gs://contact/a3.jpg' : undefined
  photos.length = 0; void comments.snapshot
  assert.deepEqual(photos, [['a1', 'gs://now/a1.jpg'], ['a2', null], ['a3', 'gs://contact/a3.jpg']])
  comments.authors.contactPhoto = author => author === 'a1' ? '' : undefined
  photos.length = 0; void comments.snapshot
  assert.deepEqual(photos[0], ['a1', null], 'a contact whose rule hides it from this account: none, whatever everyone sees')
  comments.clear()
})

test('one refused author does not leave the others beside them unknown', () => {
  const { comments, list, authors } = pane()
  list.events.snapshot(rows(comment('c1', 'a1', '하나'), comment('c2', 'a2', '둘')))
  authors()[0]!.events.state('error')
  const singles = authors()
  assert.deepEqual(singles.map(target => target.paths), [[publicProfilePath('a1')], [publicProfilePath('a2')]], 'read again one by one')
  singles[0]!.events.state('error')
  singles[1]!.events.snapshot(rows(profile('a2', { displayName: { stringValue: '둘 새 이름' } })))
  assert.deepEqual(view(comments), [['c1', '하나', ''], ['c2', '둘 새 이름', '']], 'the refused one keeps the name the comment kept')
  comments.clear()
  assert.equal(authors().length, 0, 'closing the pane stops the reads')
})

test('authors are not contacts: no contact document, the picture they show to everyone, and nothing for the contact rows', () => {
  const targets: string[][] = []
  const reader = { watch: (target: { documents: { documents: string[] } }, _s: AbortSignal, events: WatchEvents) => { targets.push(target.documents.documents); events.snapshot(rows(profile('a1', { displayName: { stringValue: '민지' }, photoURL: { stringValue: 'gs://p' } }))); return () => {} } } as unknown as FirestoreReader
  const seen: string[] = []
  const authors = new PeerProfiles(uid, credentials, credentials.signal, () => {}, (person) => { seen.push(person) }, 'authors')
  authors.bind(reader, ['a1'])
  assert.deepEqual(targets, [[publicProfilePath('a1')]])
  assert.deepEqual(authors.profile('a1'), { name: '민지', photo: '', mutual: false, official: null, photoEveryone: '' }, 'B153: not mutual, default rule')
  assert.equal(authors.withdrawn('a1'), false)
  assert.deepEqual(seen, [], 'an author\'s picture is not kept as a contact\'s')
  authors.close()
})

// B266: a channel looked at before following shows its comments' authors by the same rule (one CommentAuthors).
test('a public post\'s comments show their authors as a followed channel\'s do', () => {
  const targets: { paths: string[]; events: WatchEvents; query: boolean }[] = []
  const reader = { watch(target: { query?: unknown; documents?: { documents: string[] } }, _s: AbortSignal, events: WatchEvents) {
    targets.push({ paths: target.documents?.documents ?? [], events, query: Boolean(target.query) }); return () => {} } } as unknown as FirestoreReader
  const photos: [string, string | null][] = []
  const comments = new PublicChannelComments(uid, credentials, () => ({ reader, post }), () => {})
  comments.people = (author, raw) => { photos.push([author, raw]); return null }
  comments.open({ selectionId: 's1', requestId: 'r1', channelId: 'ch-a', postId: 'p1', revision: channelPostRevision(post) })
  targets.find(target => target.query)!.events.snapshot(rows(comment('c1', 'a1', '옛 이름'), comment('c2', 'a2', '둘')))
  const authors = targets.filter(target => !target.query)
  assert.deepEqual(authors.map(target => target.paths), [[publicProfilePath('a1'), publicProfilePath('a2')]])
  authors[0]!.events.snapshot(rows(profile('a1', { displayName: { stringValue: '새 이름' }, photoURL: { stringValue: 'gs://now/a1.jpg' } }),
    profile('a2', { displayName: { stringValue: '둘' }, photoURL: { stringValue: 'gs://now/a2.jpg' }, privacy: { mapValue: { fields: { photo: { stringValue: 'everyone' } } } } })))
  photos.length = 0
  assert.deepEqual(comments.snapshot!.items.map(item => item.authorName), ['새 이름', '둘'])
  assert.deepEqual(photos, [['a1', null], ['a2', 'gs://now/a2.jpg']])
  comments.clear()
})
