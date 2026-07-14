// addon.cc — N-API entry point. Each algorithm is exposed as a function that
// takes ONE JSON string argument and returns a JSON string. The JS wrappers
// own all DB I/O; this layer is pure compute.
#include <napi.h>
#include <string>
#include "common.hpp"

namespace {

// Generic adapter: (string) -> string, with a guard so a malformed input or an
// internal error surfaces as a thrown JS error rather than crashing the process.
using Fn = std::string (*)(const std::string&);

Napi::Value Wrap(const Napi::CallbackInfo& info, Fn fn, const char* name) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, std::string(name) + ": expected a JSON string argument")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string input = info[0].As<Napi::String>().Utf8Value();
  std::string output;
  try {
    output = fn(input);
  } catch (const std::exception& e) {
    Napi::Error::New(env, std::string(name) + " failed: " + e.what())
        .ThrowAsJavaScriptException();
    return env.Null();
  } catch (...) {
    Napi::Error::New(env, std::string(name) + " failed: unknown error")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::String::New(env, output);
}

Napi::Value VibeClassify(const Napi::CallbackInfo& i) { return Wrap(i, pulse::run_vibe_classify, "vibeClassify"); }
Napi::Value MoodDetect(const Napi::CallbackInfo& i)  { return Wrap(i, pulse::run_mood_detect, "moodDetect"); }
Napi::Value InterestScore(const Napi::CallbackInfo& i){ return Wrap(i, pulse::run_interest_score, "interestScore"); }
Napi::Value FeedRank(const Napi::CallbackInfo& i)    { return Wrap(i, pulse::run_feed_rank, "feedRank"); }
Napi::Value ReelRank(const Napi::CallbackInfo& i)    { return Wrap(i, pulse::run_reel_rank, "reelRank"); }
Napi::Value CommentsRank(const Napi::CallbackInfo& i){ return Wrap(i, pulse::run_comments_rank, "commentsRank"); }
Napi::Value UserRank(const Napi::CallbackInfo& i)    { return Wrap(i, pulse::run_user_rank, "userRank"); }
Napi::Value DnaMatch(const Napi::CallbackInfo& i)    { return Wrap(i, pulse::run_dna_match, "dnaMatch"); }

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("vibeClassify", Napi::Function::New(env, VibeClassify));
  exports.Set("moodDetect", Napi::Function::New(env, MoodDetect));
  exports.Set("interestScore", Napi::Function::New(env, InterestScore));
  exports.Set("feedRank", Napi::Function::New(env, FeedRank));
  exports.Set("reelRank", Napi::Function::New(env, ReelRank));
  exports.Set("commentsRank", Napi::Function::New(env, CommentsRank));
  exports.Set("userRank", Napi::Function::New(env, UserRank));
  exports.Set("dnaMatch", Napi::Function::New(env, DnaMatch));
  return exports;
}

} // namespace

NODE_API_MODULE(pulse_algos, Init)
