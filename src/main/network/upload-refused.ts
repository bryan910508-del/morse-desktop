// A Storage upload that will not succeed by trying again: the account may not write there (401/403), or what is
// stored under the name is not this file. Any other failure of an upload — the connection, a timeout, a server
// error, a session that expired — leaves it to be resumed, since the object's name is fixed by its message or post.
export class UploadRefused extends Error {}
