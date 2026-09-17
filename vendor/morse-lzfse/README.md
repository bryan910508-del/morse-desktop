# Morse LZFSE decoder binding

Original Node-API adapter: `binding.c`. Decoder sources in `upstream/` are unmodified files from https://github.com/lzfse/lzfse at commit `e634ca58b4821d9f3d560cdc6df5dec02ffc93fd` (BSD-3-Clause, Apple copyright). `upstream/LICENSE` is included in the application notices.

The decoder accepts a bounded input and exact expected output length. It requires successful end-of-stream, full input consumption and exact output size. Merely filling the output buffer is not success. The addon is built for the current host, packaged unpacked, and invoked in a worker only when a received file carries the existing Morse `TALKY_LZF1` header. Builds do not execute the addon or decoder.
