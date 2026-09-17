// Compile Google's pinned Firestore v1 definitions into a portable descriptor.
// This is a build step only: no client, credentials or network calls are created.
const { writeFileSync } = require('node:fs')
const { resolve, isAbsolute } = require('node:path')
const { getProtoPath, loadSync } = require('google-proto-files')
const root = loadSync([])
// Firestore uses repository-root imports even for sibling service definitions.
// google-proto-files' default resolver only redirects the common proto folders.
root.resolvePath = (_origin, target) => isAbsolute(target) ? target : resolve(getProtoPath('..'), target)
root.loadSync(getProtoPath('firestore', 'v1', 'firestore.proto')).resolveAll()
writeFileSync(resolve(__dirname, '../resources/firestore-v1.json'), JSON.stringify(root.toJSON()))
