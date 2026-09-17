{
  "targets": [{
    "target_name": "morse_lzfse",
    "sources": ["binding.c", "upstream/lzfse_decode_base.c", "upstream/lzfse_fse.c", "upstream/lzvn_decode_base.c"],
    "defines": ["NAPI_VERSION=8"],
    "include_dirs": ["upstream"]
  }]
}
