#!/bin/sh
# 지수 계산(web/js/scores.js) 테스트. macOS 내장 JavaScriptCore로 실행한다.
set -e
cd "$(dirname "$0")/../.."
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
"$JSC" -e "var window = this;" web/vendor/suncalc.js web/js/scores.js tests/js/scores_test.js
