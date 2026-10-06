#!/bin/sh
# 지수 계산(web/js/scores.js) 테스트. macOS 내장 JavaScriptCore가 있으면 그것으로, 없으면 Node로 실행한다.
set -e
cd "$(dirname "$0")/../.."
FILES="web/vendor/suncalc.js web/js/scores.js tests/js/scores_test.js"
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
if [ -x "$JSC" ]; then
  "$JSC" -e "var window = this;" $FILES
else
  node -e '
    const fs = require("fs"), vm = require("vm");
    globalThis.window = globalThis;
    globalThis.print = console.log;
    delete globalThis.module; delete globalThis.exports; // suncalc.js가 Node 모듈 대신 전역(window)에 붙도록
    for (const f of process.argv.slice(1)) vm.runInThisContext(fs.readFileSync(f, "utf8"), { filename: f });
  ' $FILES
fi
