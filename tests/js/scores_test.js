// 실행: tests/js/run.sh  (macOS JavaScriptCore 또는 Node)
let failed = 0;
function check(name, condition) {
  if (!condition) failed++;
  print(`${condition ? "ok  " : "FAIL"} ${name}`);
}

const SEOUL = { lat: 37.5665, lon: 126.978 };
const at = (iso) => new Date(iso);
// 2026-10-05 서울: 일출 약 06:31, 일몰 약 18:09 (KST). 이날 밤 달은 하현 무렵이라 자정 전에는 아직 뜨지 않는다.
const hours = [];
for (let h = 0; h < 48; h++) hours.push(new Date(Date.parse("2026-10-05T00:00:00+09:00") + h * 3600e3));
const flat = (overrides = {}) => {
  const base = { TMP: 20, SKY: 1, PTY: 0, POP: 0, REH: 50, WSD: 1, ...overrides };
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, hours.map(() => v)]));
};
// 지역 메타데이터 예: 시골 산간(보틀 2, 고도 1000m, 호수+분지), 대도시(보틀 9), 평범한 평지(보틀 5, 물·분지 없음)
const DARK = { bortle: 2, elev: 1000, water: true, basin: true };
const CITY = { bortle: 9, elev: 50, water: false, basin: false };
const PLAIN = { bortle: 5, elev: 100, water: false, basin: false };
const score = (mode, index, series, meta) => Scores.score(mode, { ...SEOUL, hours, index, series, meta });

const sun = Scores.sunTimes(SEOUL.lat, SEOUL.lon, at("2026-10-05T12:00:00+09:00"));
check("일출이 6시대", new Date(sun.sunrise.getTime() + 9 * 3600e3).getUTCHours() === 6);
check("일몰이 18시대", new Date(sun.sunset.getTime() + 9 * 3600e3).getUTCHours() === 18);
check("자정 직후에도 같은 KST 날짜의 일출", Scores.sunTimes(SEOUL.lat, SEOUL.lon, hours[1]).sunrise.getTime() === sun.sunrise.getTime());

// ---- 나들이 ----
check("나들이: 9~18시만 대상", score("outing", 8, flat()) === null && score("outing", 9, flat()) !== null && score("outing", 19, flat()) === null);
check("나들이: 체감 18~24°, 습도 50%, 바람 약함, 맑음이면 100점", score("outing", 14, flat()) === 100);
check("나들이: 비가 오면 10점 이하", score("outing", 14, flat({ PTY: 1, POP: 80 })) <= 10);
check("나들이: 강수확률 60%면 크게 감점", score("outing", 14, flat({ POP: 60 })) <= 60);
check("나들이: 폭염(34°, 습도 70%)은 낮음", score("outing", 14, flat({ TMP: 34, REH: 70 })) < 40);
check("나들이: 추위(2°, 바람 5m/s)는 낮음", score("outing", 14, flat({ TMP: 2, WSD: 5 })) < 40);
check("나들이: 습도 85%는 50%보다 낮음", score("outing", 14, flat({ REH: 85 })) < score("outing", 14, flat()));
check("나들이: 예보가 없으면 null", score("outing", 14, { ...flat(), TMP: hours.map(() => null) }) === null);
check("격자 데이터가 없으면 null", score("outing", 14, undefined) === null);
check("체감온도: 바람이 불면 더 춥다", Scores.apparentTemp(5, 50, 6) < Scores.apparentTemp(5, 50, 0));

// ---- 일출·일몰 ----
check("일출·일몰: 한낮은 대상 아님", score("golden", 12, flat()) === null);
check("일출·일몰: 구름많음 95, 맑음 75, 흐림 20", score("golden", 6, flat({ SKY: 3 })) === 95 && score("golden", 6, flat()) === 75 && score("golden", 18, flat({ SKY: 4 })) === 20);
check("일출·일몰: 습도 95%면 연무로 감점", score("golden", 18, flat({ SKY: 3, REH: 95 })) < 80);
check("일출·일몰: 비가 오면 0점", score("golden", 18, flat({ PTY: 1 })) === 0);

// ---- 은하수 ---- (22시: 완전히 어둡고 달이 아직 안 뜬 시각)
check("은하수: 낮은 대상 아님", score("stars", 14, flat(), DARK) === null);
check("은하수: 해 진 직후(19시)는 아직 대상 아님", score("stars", 19, flat(), DARK) === null);
check("은하수: 어두운 산간 맑은 밤은 100점", score("stars", 22, flat(), DARK) === 100);
check("은하수: 대도시는 맑아도 15점 미만", score("stars", 22, flat(), CITY) < 15);
check("은하수: 보틀 7도 15점 미만", score("stars", 22, flat(), { ...PLAIN, bortle: 7, elev: 1000 }) < 15);
check("은하수: 보틀이 낮을수록 높다", score("stars", 22, flat(), { ...PLAIN, bortle: 3 }) > score("stars", 22, flat(), PLAIN));
check("은하수: 고도 800m가 100m보다 높다", score("stars", 22, flat(), { ...PLAIN, elev: 800 }) > score("stars", 22, flat(), PLAIN));
check("은하수: 구름많음이면 급감", score("stars", 22, flat({ SKY: 3 }), DARK) <= 50);
check("은하수: 흐리면 0점", score("stars", 22, flat({ SKY: 4 }), DARK) === 0);
check("은하수: 습도 95%면 감점", score("stars", 22, flat({ REH: 95 }), { ...DARK, elev: 100 }) < score("stars", 22, flat(), { ...DARK, elev: 100 }));

// ---- 운해 ----
const foggy = flat({ REH: 97, WSD: 0.5 });
foggy.TMP = hours.map((_, i) => (i === 6 ? 8 : 20)); // 새벽에 12도 하강
check("운해: 한낮은 대상 아님", score("seaOfClouds", 12, flat(), DARK) === null);
check("운해: 9시 무렵까지 대상", score("seaOfClouds", 8, foggy, DARK) !== null);
check("운해: 호수+분지, 습하고 잔잔하고 일교차 크고 맑으면 100점", score("seaOfClouds", 6, foggy, DARK) === 100);
check("운해: 물·분지가 없으면 같은 날씨라도 절반 이하", score("seaOfClouds", 6, foggy, PLAIN) <= 50);
check("운해: 습도 70% 이하면 0점", score("seaOfClouds", 6, flat({ REH: 70, WSD: 0.5 }), DARK) === 0);
check("운해: 바람 5m/s 이상이면 0점", score("seaOfClouds", 6, flat({ REH: 97, WSD: 5 }), DARK) === 0);
check("운해: 바람 4m/s면 2m/s보다 낮음", score("seaOfClouds", 6, flat({ REH: 97, WSD: 4 }), DARK) < score("seaOfClouds", 6, flat({ REH: 97, WSD: 2 }), DARK));
check("운해: 비가 오면 0점", score("seaOfClouds", 6, flat({ REH: 99, PTY: 1 }), DARK) === 0);

check("메타데이터가 없어도 계산된다", score("stars", 22, flat()) != null);
if (failed) throw new Error(`${failed}개 실패`);
print("모두 통과");
