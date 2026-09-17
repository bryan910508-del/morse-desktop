#include <node_api.h>
#include <stdlib.h>
#include <string.h>
#include "lzfse_internal.h"

/* Runs only in the short-lived decoding worker, never on the UI thread.
 * Both buffers are borrowed for this synchronous call and never retained. */
static napi_value decode_into(napi_env env, napi_callback_info info) {
  size_t argc = 3, input_size = 0, output_size = 0;
  napi_value argv[3];
  uint8_t *input = NULL, *output = NULL;
  uint32_t expected = 0;
  bool input_is_buffer = false, output_is_buffer = false;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 3 ||
      napi_is_buffer(env, argv[0], &input_is_buffer) != napi_ok || !input_is_buffer ||
      napi_get_buffer_info(env, argv[0], (void **)&input, &input_size) != napi_ok ||
      napi_get_value_uint32(env, argv[1], &expected) != napi_ok ||
      napi_is_buffer(env, argv[2], &output_is_buffer) != napi_ok || !output_is_buffer ||
      napi_get_buffer_info(env, argv[2], (void **)&output, &output_size) != napi_ok ||
      !expected || expected >= 200000000 || !input_size || input_size >= 52428800 || output_size != expected) {
    napi_throw_error(env, NULL, "Invalid LZFSE input bounds"); return NULL;
  }
  lzfse_decoder_state *state = calloc(1, sizeof(*state));
  if (!state) { napi_throw_error(env, NULL, "LZFSE allocation failed"); return NULL; }
  state->src_begin = state->src = input; state->src_end = input + input_size;
  state->dst_begin = state->dst = output; state->dst_end = output + expected;
  int status = lzfse_decode(state);
  int valid = status == LZFSE_STATUS_OK && state->end_of_stream &&
    state->src == state->src_end && state->dst == state->dst_end;
  free(state);
  if (!valid) {
    memset(output, 0, expected);
    napi_throw_error(env, NULL, "Incomplete or invalid LZFSE stream"); return NULL;
  }
  return argv[2];
}
static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  if (napi_create_function(env, "decodeInto", NAPI_AUTO_LENGTH, decode_into, NULL, &fn) != napi_ok ||
      napi_set_named_property(env, exports, "decodeInto", fn) != napi_ok) return NULL;
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
