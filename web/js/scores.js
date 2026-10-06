/* global SunCalc */
// 출사·나들이 지수(0~100점). 화면과 무관한 순수 계산만 둔다. 가중치는 이 파일에서만 조정한다.
// 해당 시각이 모드의 대상 시간대가 아니거나 예보가 없으면 null을 돌려준다.
//
// 예보(기상청 단기예보)에 지역 메타데이터(data/region_meta.json)를 더해 판단한다:
//   bortle 광공해 등급(1~9), elev 대표 출사지 고도(m), water 큰 호수·강 인접, basin 분지 지형
const Scores = (function () {
  const HOUR_MS = 3600 * 1000;
  const KST_OFFSET_MS = 9 * HOUR_MS;
  const SKY_CLEAR = 1, SKY_PARTLY = 3; // 기상청 SKY: 1 맑음, 3 구름많음, 4 흐림 (2는 쓰지 않음)

  const MODES = [
    { id: "outing", label: "나들이", note: "낮(9~18시)만 표시 · 체감온도 18~24°, 비·바람·습도로 본 쾌적도" },
    { id: "golden", label: "일출·일몰", note: "일출·일몰 전후 1시간만 표시 · 구름이 적당히 있고 공기가 맑을 때 높음" },
    { id: "stars", label: "은하수", note: "완전히 어두운 밤만 표시 · 맑음, 광공해(도시 불빛), 달빛, 습도, 고도 반영" },
    { id: "seaOfClouds", label: "운해", note: "새벽~아침만 표시 · 호수·강·분지 지형, 높은 습도, 약한 바람, 큰 일교차일 때 높음" },
  ];

  // 메타데이터가 없는 지역은 중간값으로 본다
  const DEFAULT_META = { bortle: 5, elev: 100, water: false, basin: false };

  const OUTING_HOURS = [9, 18]; // KST, 양 끝 포함
  const GOLDEN_WINDOW_MS = 1 * HOUR_MS;
  const SEA_BEFORE_MS = 2 * HOUR_MS; // 일출 2시간 전부터
  const SEA_AFTER_MS = 2.5 * HOUR_MS; // 일출 2시간 반 뒤(대략 9시)까지
  const ASTRONOMICAL_NIGHT_DEG = -18;
  const RANGE_LOOKBACK_MS = 18 * HOUR_MS;

  const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));
  const ramp = (value, from, to) => Math.max(0, Math.min(1, (value - from) / (to - from)));
  const degrees = (radians) => (radians * 180) / Math.PI;
  const kstHour = (time) => new Date(time.getTime() + KST_OFFSET_MS).getUTCHours();

  const sunCache = new Map();
  // time이 속한 KST 날짜의 일출·일몰 시각
  function sunTimes(lat, lon, time) {
    const kstDate = new Date(time.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
    const key = `${lat},${lon},${kstDate}`;
    if (!sunCache.has(key)) {
      const noon = new Date(Date.parse(`${kstDate}T12:00:00+09:00`));
      const { sunrise, sunset } = SunCalc.getTimes(noon, lat, lon);
      sunCache.set(key, { sunrise, sunset });
    }
    return sunCache.get(key);
  }

  // 모드가 그 시각·장소에 해당하는지 (날씨와 무관).
  // 해와 관련된 모드는 고정 시각 대신 실제 해의 위치로 판단해 계절이 바뀌어도 맞게 한다.
  function applies(modeId, lat, lon, time) {
    if (modeId === "outing") {
      const h = kstHour(time);
      return h >= OUTING_HOURS[0] && h <= OUTING_HOURS[1];
    }
    if (modeId === "stars") {
      return degrees(SunCalc.getPosition(time, lat, lon).altitude) < ASTRONOMICAL_NIGHT_DEG;
    }
    const { sunrise, sunset } = sunTimes(lat, lon, time);
    if (modeId === "golden") {
      return Math.min(Math.abs(time - sunrise), Math.abs(time - sunset)) <= GOLDEN_WINDOW_MS;
    }
    if (modeId === "seaOfClouds") {
      return time - sunrise >= -SEA_BEFORE_MS && time - sunrise <= SEA_AFTER_MS;
    }
    throw new Error(`알 수 없는 모드: ${modeId}`);
  }

  // 체감온도: 호주 기상청 공식(Steadman). 습도가 높으면 덥게, 바람이 불면 춥게 느낀다.
  function apparentTemp(TMP, REH, WSD) {
    const vapor = (REH / 100) * 6.105 * Math.exp((17.27 * TMP) / (237.7 + TMP));
    return TMP + 0.33 * vapor - 0.7 * WSD - 4;
  }

  // ① 나들이: 체감온도 18~24°가 최적, 벗어날수록 점점 가파르게 감점
  function outing({ TMP, SKY, POP, REH, WSD }) {
    const feels = apparentTemp(TMP, REH, WSD);
    const off = Math.max(0, 18 - feels, feels - 24);
    let score = 100;
    score -= 3 * off + 0.15 * off * off; // 4° 벗어나면 -14, 10° 벗어나면 -45
    score -= 0.7 * POP;
    score -= 5 * Math.max(0, WSD - 3);
    score -= 0.4 * Math.max(0, 40 - REH, REH - 60);
    score -= SKY === SKY_PARTLY ? 3 : SKY === SKY_CLEAR ? 0 : 8;
    return score;
  }

  // ② 일출·일몰: 구름이 적당히 있어야 빛이 물든다. 맑으면 깨끗하지만 밋밋하고, 흐리면 해가 가린다.
  // 공기가 습하면 연무로 색이 탁해진다.
  function golden({ SKY, POP, REH, WSD }) {
    let score = SKY === SKY_PARTLY ? 95 : SKY === SKY_CLEAR ? 75 : 20;
    score -= 0.4 * POP;
    score -= 0.5 * Math.max(0, REH - 70) + 1.5 * Math.max(0, REH - 90); // 습도 90%면 -10, 100%면 -35
    score -= 3 * Math.max(0, WSD - 4);
    return score;
  }

  // ③ 은하수: 맑은 하늘이 먼저고, 그다음은 광공해. 대도시(보틀 7 이상)는 아무리 맑아도 15점 미만.
  function stars({ SKY, POP, REH }, meta, lat, lon, time) {
    let score = SKY === SKY_CLEAR ? 100 : SKY === SKY_PARTLY ? 30 : 0;
    score -= 0.3 * POP;
    if (SunCalc.getMoonPosition(time, lat, lon).altitude > 0) {
      score -= 60 * SunCalc.getMoonIllumination(time).fraction;
    }
    score -= 2 * Math.max(0, REH - 85); // 이슬·연무
    // 높을수록 대기가 투명하다: 500m부터 1.1배, 1000m 이상 1.2배 (하늘이 안 보이면 가점도 없다)
    if (meta.elev >= 500) score *= 1.1 + 0.1 * ramp(meta.elev, 500, 1000);
    // 광공해: 보틀 2 이하 1배, 4 약 0.5배, 6 약 0.18배, 7 약 0.08배
    score *= Math.pow(Math.max(0, (9 - meta.bortle) / 7), 2);
    return Math.min(score, 100);
  }

  // ④ 운해·물안개: 지형이 먼저다. 물이나 분지가 없으면 습해도 운해가 잘 생기지 않는다.
  // 습도와 바람은 필요조건이라 곱하고, 일교차와 하늘 상태는 정도를 조절한다.
  function seaOfClouds({ TMP, SKY, REH, WSD }, meta, series, hours, index) {
    let warmest = TMP; // 전날 낮부터 지금까지 가장 따뜻했던 기온
    for (let j = index - 1; j >= 0 && hours[index] - hours[j] <= RANGE_LOOKBACK_MS; j--) {
      if (series.TMP[j] != null) warmest = Math.max(warmest, series.TMP[j]);
    }
    const humid = ramp(REH, 70, 95); // 70% 이하 0, 95% 이상 1
    const calm = WSD <= 2 ? 1 : WSD <= 3 ? 0.85 : 0.85 * (1 - ramp(WSD, 3, 5)); // 5m/s 이상 0
    const cooling = 0.75 + 0.25 * ramp(warmest - TMP, 3, 10); // 일교차 10° 이상이면 최대
    const sky = SKY === SKY_CLEAR ? 1 : SKY === SKY_PARTLY ? 0.9 : 0.7; // 위가 맑아야 구름 바다가 보인다
    const terrain = meta.water && meta.basin ? 1 : meta.water || meta.basin ? 0.85 : 0.4;
    return 100 * humid * calm * cooling * sky * terrain;
  }

  // series: 격자 하나의 {TMP: [...], SKY: [...], ...}, hours: Date 배열(series와 인덱스 일치)
  // meta: 지역 메타데이터 (없으면 중간값)
  function score(modeId, { lat, lon, hours, index, series, meta = DEFAULT_META }) {
    const time = hours[index];
    if (!series || !applies(modeId, lat, lon, time)) return null;
    const now = {};
    for (const name of ["TMP", "SKY", "PTY", "POP", "REH", "WSD"]) {
      now[name] = series[name]?.[index];
      if (now[name] == null) return null;
    }
    // 비·눈이 오면 야외 촬영/나들이 모두 사실상 불가 (운해가 아니라 그냥 비)
    if (now.PTY > 0) return modeId === "outing" ? 5 : 0;
    if (modeId === "outing") return clamp(outing(now));
    if (modeId === "golden") return clamp(golden(now));
    if (modeId === "stars") return clamp(stars(now, meta, lat, lon, time));
    return clamp(seaOfClouds(now, meta, series, hours, index));
  }

  return { MODES, applies, score, sunTimes, apparentTemp };
})();
