"""weather_latest.json 읽기/병합/쓰기.

파일 형식:
{
  "baseTime": 예보 발표 시각, "generatedAt": 생성 시각, "sample": 샘플 여부,
  "hours": ["2026-10-05T06:00+09:00", ...],          # 공통 시간축(예보가 있는 시각만, 먼 미래는 3시간 간격)
  "grids": {"60,127": {"TMP": [...], "SKY": [...], ...}}  # hours와 인덱스가 일치, 없으면 null
}
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
REGIONS_PATH = ROOT / "web" / "data" / "regions.json"
WEATHER_PATH = ROOT / "web" / "data" / "weather_latest.json"

# TMP 기온(℃), SKY 하늘상태(1 맑음, 3 구름많음, 4 흐림), PTY 강수형태(0 없음, 1 비, 2 비/눈, 3 눈, 4 소나기),
# POP 강수확률(%), PCP 1시간 강수량(mm), REH 습도(%), WSD 풍속(m/s)
VARS = ["TMP", "SKY", "PTY", "POP", "PCP", "REH", "WSD"]

KEEP_PAST_DAYS = 1  # 오늘 기준 며칠 전 0시부터 보관할지


def load_grid_keys():
    regions = json.loads(REGIONS_PATH.read_text(encoding="utf-8"))
    return sorted({(r["nx"], r["ny"]) for r in regions.values()})


def load_records(path):
    """기존 파일을 {격자키: {시각(datetime): {변수: 값}}} 로 읽는다. 없거나 깨졌거나 샘플이면 빈 dict."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if data.get("sample"):
            return {}
        hours = [datetime.fromisoformat(h) for h in data["hours"]]
        records = {}
        for key, series in data["grids"].items():
            by_hour = {}
            for var, values in series.items():
                for hour, value in zip(hours, values):
                    if value is not None:
                        by_hour.setdefault(hour, {})[var] = value
            records[key] = by_hour
        return records
    except (OSError, ValueError, KeyError):
        return {}


def merge_records(prev, new):
    """새 예보가 같은 시각의 이전 값을 덮어쓴다. 수집에 실패한 격자는 이전 값이 그대로 남는다."""
    merged = {key: dict(by_hour) for key, by_hour in prev.items()}
    for key, by_hour in new.items():
        target = merged.setdefault(key, {})
        for hour, values in by_hour.items():
            target[hour] = {**target.get(hour, {}), **values}
    return merged


def write_weather(records, base_time, now, path=WEATHER_PATH, sample=False):
    start = (now - timedelta(days=KEEP_PAST_DAYS)).replace(hour=0, minute=0, second=0, microsecond=0)
    hours = sorted({h for by_hour in records.values() for h in by_hour if h >= start})
    if not hours:
        raise RuntimeError("저장할 예보 데이터가 없습니다.")
    grids = {
        key: {var: [by_hour.get(h, {}).get(var) for h in hours] for var in VARS}
        for key, by_hour in sorted(records.items())
    }
    out = {
        "baseTime": base_time.isoformat(timespec="minutes"),
        "generatedAt": now.isoformat(timespec="minutes"),
        "sample": sample,
        "hours": [h.isoformat(timespec="minutes") for h in hours],
        "grids": grids,
    }
    Path(path).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(hours), len(grids)
