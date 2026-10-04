/* global SunCalc */
// 출사·나들이 지수(0~100점). 화면과 무관한 순수 계산만 둔다. 가중치는 이 파일에서만 조정한다.
// 해당 시각이 모드의 대상 시간대가 아니거나 예보가 없으면 null을 돌려준다.
const Scores = (function () {
  const HOUR_MS = 3600 * 1000;
  const KST_OFFSET_MS = 9 * HOUR_MS;
  const SKY_CLEAR = 1, SKY_PARTLY = 3, SKY_CLOUDY = 4;

  const MODES = [
    { id: "outing", label: "나들이", note: "비·기온·바람·구름으로 본 야외 활동 쾌적도" },
    { id: "golden", label: "일출·일몰", note: "일출·일몰 전후 1시간만 표시 · 구름이 조금 있을 때 노을 점수가 높음" },
    { id: "stars", label: "은하수", note: "완전히 어두운 밤(천문박명 이후)만 표시 · 달빛 반영, 광공해는 미반영" },
    { id: "seaOfClouds", label: "운해", note: "일출 2시간 전 ~ 1시간 반 뒤만 표시 · 지형을 모르는 '가능성' 수준" },
  ];

  const GOLDEN_WINDOW_MS = 1 * HOUR_MS;
  const SEA_BEFORE_MS = 2 * HOUR_MS;
  const SEA_AFTER_MS = 1.5 * HOUR_MS;
  const ASTRONOMICAL_NIGHT_DEG = -18;
  const RANGE_LOOKBACK_MS = 18 * HOUR_MS;

  const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));
  const ramp = (value, from, to) => Math.max(0, Math.min(1, (value - from) / (to - from)));
  const degrees = (radians) => (radians * 180) / Math.PI;

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

  // 모드가 그 시각·장소에 해당하는지 (날씨와 무관)
  function applies(modeId, lat, lon, time) {
    if (modeId === "outing") return true;
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

  function outing({ TMP, SKY, POP, REH, WSD }) {
    let score = 100;
    score -= 0.6 * POP;
    score -= 2 * Math.max(0, Math.abs(TMP - 20) - 2);
    score -= 4 * Math.max(0, WSD - 2);
    score -= 0.3 * Math.max(0, REH - 80);
    score -= SKY === SKY_CLOUDY ? 15 : SKY === SKY_PARTLY ? 5 : 0;
    return score;
  }

  function golden({ SKY, POP, REH }) {
    // 구름이 조금 있어야 빛이 물든다. 맑으면 깨끗하지만 밋밋하고, 흐리면 해가 가린다.
    let score = SKY === SKY_PARTLY ? 100 : SKY === SKY_CLEAR ? 75 : 20;
    score -= 0.5 * POP;
    score -= 0.5 * Math.max(0, REH - 85);
    return score;
  }

  function stars({ SKY, REH }, lat, lon, time) {
    let score = SKY === SKY_CLEAR ? 100 : SKY === SKY_PARTLY ? 40 : 5;
    if (SunCalc.getMoonPosition(time, lat, lon).altitude > 0) {
      score -= 60 * SunCalc.getMoonIllumination(time).fraction;
    }
    score -= 0.75 * Math.max(0, REH - 80);
    return score;
  }

  function seaOfClouds({ TMP, SKY, REH, WSD }, series, hours, index) {
    // 습한 공기 + 약한 바람 + 밤사이 큰 기온 하강 + 위쪽 하늘은 맑음
    let warmest = TMP;
    for (let j = index - 1; j >= 0 && hours[index] - hours[j] <= RANGE_LOOKBACK_MS; j--) {
      if (series.TMP[j] != null) warmest = Math.max(warmest, series.TMP[j]);
    }
    return (
      40 * ramp(REH, 70, 95) +
      20 * (1 - ramp(WSD, 1.5, 4)) +
      15 * ramp(warmest - TMP, 3, 10) +
      (SKY === SKY_CLEAR ? 25 : SKY === SKY_PARTLY ? 12 : 0)
    );
  }

  // series: 격자 하나의 {TMP: [...], SKY: [...], ...}, hours: Date 배열(series와 인덱스 일치)
  function score(modeId, { lat, lon, hours, index, series }) {
    const time = hours[index];
    if (!series || !applies(modeId, lat, lon, time)) return null;
    const now = {};
    for (const name of ["TMP", "SKY", "PTY", "POP", "REH", "WSD"]) {
      now[name] = series[name]?.[index];
      if (now[name] == null) return null;
    }
    // 비·눈이 오면 야외 촬영/나들이 모두 사실상 불가
    if (now.PTY > 0) return modeId === "outing" ? 5 : 0;
    if (modeId === "outing") return clamp(outing(now));
    if (modeId === "golden") return clamp(golden(now));
    if (modeId === "stars") return clamp(stars(now, lat, lon, time));
    return clamp(seaOfClouds(now, series, hours, index));
  }

  return { MODES, applies, score, sunTimes };
})();
