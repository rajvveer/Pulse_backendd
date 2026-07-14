{
  "targets": [
    {
      "target_name": "pulse_algos",
      "sources": [
        "src/addon.cc",
        "src/vibe_classifier.cc",
        "src/mood_detector.cc",
        "src/interest_profiler.cc",
        "src/feed_algo.cc",
        "src/reel_algo.cc",
        "src/comments_algo.cc",
        "src/user_algo.cc",
        "src/dna_match_algo.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "third_party"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "cflags_cc": ["-std=c++17", "-O2"],
      "cflags_cc!": ["-fno-exceptions"],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "MACOSX_DEPLOYMENT_TARGET": "10.14"
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/std:c++17"]
        }
      }
    }
  ]
}
