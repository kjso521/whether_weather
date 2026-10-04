// 실행: tests/js/run.sh  (macOS 내장 JavaScriptCore 사용, Node 불필요)
let failed = 0;
function check(name, condition) {
  if (!condition) failed++;
  print(`${condition ? "ok  " : "FAIL"} ${name}`);
}

const SEOUL = { lat: 37.5665, lon: 126.978 };
const at = (iso) => new Date(iso);
// 2026-10-05 서울: 일출 약 06:31, 일몰 약 18:09 (KST)
const hours = [];
for (let h = 0; h < 48; h++) hours.push(new Date(Date.parse("2026-10-05T00:00:00+09:00") + h * 3600e3));
const flat = (overrides = {}) => {
  const base = { TMP: 20, SKY: 1, PTY: 0, POP: 0, REH: 50, WSD: 1, ...overrides };
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, hours.map(() => v)]));
};
const score = (mode, index, series) => Scores.score(mode, { ...SEOUL, hours, index, series });

const sun = Scores.sunTimes(SEOUL.lat, SEOUL.lon, at("2026-10-05T12:00:00+09:00"));
check("일출이 6시대", new Date(sun.sunrise.getTime() + 9 * 3600e3).getUTCHours() === 6);
check("일몰이 18시대", new Date(sun.sunset.getTime() + 9 * 3600e3).getUTCHours() === 18);
check("자정 직후에도 같은 KST 날짜의 일출", Scores.sunTimes(SEOUL.lat, SEOUL.lon, hours[1]).sunrise.getTime() === sun.sunrise.getTime());

check("나들이: 완벽한 날은 100점", score("outing", 14, flat()) === 100);
check("나들이: 비가 오면 5점", score("outing", 14, flat({ PTY: 1, POP: 80 })) === 5);
check("나들이: 흐리고 바람 불면 감점", score("outing", 14, flat({ SKY: 4, WSD: 6 })) === 100 - 15 - 16);
check("나들이: 예보가 없으면 null", score("outing", 14, { ...flat(), TMP: hours.map(() => null) }) === null);
check("격자 데이터가 없으면 null", score("outing", 14, undefined) === null);

check("일출·일몰: 한낮은 대상 아님", score("golden", 12, flat()) === null);
check("일출·일몰: 일출 무렵 구름많음이 맑음보다 높음", score("golden", 6, flat({ SKY: 3 })) > score("golden", 6, flat({ SKY: 1 })));
check("일출·일몰: 일몰 무렵 흐림은 낮음", score("golden", 18, flat({ SKY: 4 })) === 20);
check("일출·일몰: 비가 오면 0점", score("golden", 18, flat({ PTY: 1 })) === 0);

check("은하수: 낮은 대상 아님", score("stars", 14, flat()) === null);
check("은하수: 해 진 직후(19시)는 아직 대상 아님", score("stars", 19, flat()) === null);
check("은하수: 한밤 맑음이 흐림보다 높음", score("stars", 1, flat()) > score("stars", 1, flat({ SKY: 4 })));
check("은하수: 한밤 점수는 0~100", score("stars", 1, flat()) >= 0 && score("stars", 1, flat()) <= 100);

check("운해: 한낮은 대상 아님", score("seaOfClouds", 12, flat()) === null);
const foggy = flat({ REH: 97, WSD: 0.5 });
foggy.TMP = hours.map((_, i) => (i === 6 ? 8 : 20)); // 새벽에 12도 하강
check("운해: 습하고 잔잔하고 일교차 크고 맑으면 100점", score("seaOfClouds", 6, foggy) === 100);
check("운해: 건조하고 바람 불면 낮음", score("seaOfClouds", 6, flat({ REH: 40, WSD: 5, SKY: 4 })) === 0);

check("applies: 나들이는 항상 대상", Scores.applies("outing", SEOUL.lat, SEOUL.lon, hours[3]));
if (failed) throw new Error(`${failed}개 실패`);
print("모두 통과");
