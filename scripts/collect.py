"""기상청 단기예보(getVilageFcst)를 전국 시군구 대표 격자에 대해 수집해 weather_latest.json을 갱신한다.

사용법: python3 scripts/collect.py
서비스 키는 환경변수 KMA_SERVICE_KEY 또는 저장소 루트의 .env 파일(KMA_SERVICE_KEY=...)에서 읽는다.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from weather_store import KST, ROOT, VARS, WEATHER_PATH, load_grid_keys, load_records, merge_records, write_weather

API_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst"
BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23]  # 발표 시각
PUBLISH_DELAY = timedelta(minutes=15)  # 발표 후 API에 반영될 때까지 여유
PAGE_SIZE = 1000
WORKERS = 8
RETRIES = 3


def latest_base_time(now):
    """now 시점에 조회 가능한 가장 최근 발표 시각."""
    ready = now - PUBLISH_DELAY
    for day in (ready.date(), ready.date() - timedelta(days=1)):
        for hour in reversed(BASE_HOURS):
            base = datetime(day.year, day.month, day.day, hour, tzinfo=KST)
            if base <= ready:
                return base
    raise AssertionError("unreachable")


def parse_value(category, raw):
    if category == "PCP":
        # "강수없음", "1mm 미만", "1.0mm", "30.0~50.0mm", "50.0mm 이상"
        if "없음" in raw:
            return 0.0
        if "미만" in raw:
            return 0.5
        return float(raw.replace("mm", "").replace("이상", "").split("~")[0].strip())
    value = float(raw)
    return int(value) if category in ("SKY", "PTY", "POP", "REH") else value


def fetch_page(service_key, base, nx, ny, page):
    query = urllib.parse.urlencode({
        "serviceKey": service_key,
        "pageNo": page,
        "numOfRows": PAGE_SIZE,
        "dataType": "JSON",
        "base_date": base.strftime("%Y%m%d"),
        "base_time": base.strftime("%H%M"),
        "nx": nx,
        "ny": ny,
    })
    with urllib.request.urlopen(f"{API_URL}?{query}", timeout=30) as res:
        text = res.read().decode("utf-8")
    try:
        response = json.loads(text)["response"]
    except (ValueError, KeyError):
        # 키 오류 등은 dataType=JSON이어도 XML로 내려온다
        raise RuntimeError(f"JSON이 아닌 응답: {text[:200]}")
    header = response["header"]
    if header["resultCode"] != "00":
        raise RuntimeError(f"API 오류 {header['resultCode']}: {header['resultMsg']}")
    body = response["body"]
    return body["items"]["item"], body["totalCount"]


def fetch_grid(service_key, base, nx, ny):
    """한 격자의 예보를 {시각: {변수: 값}} 로 돌려준다."""
    for attempt in range(RETRIES):
        try:
            items, total = fetch_page(service_key, base, nx, ny, 1)
            for page in range(2, (total - 1) // PAGE_SIZE + 2):
                items += fetch_page(service_key, base, nx, ny, page)[0]
            break
        except (urllib.error.URLError, TimeoutError, RuntimeError):
            if attempt == RETRIES - 1:
                raise
            time.sleep(2 * (attempt + 1))
    by_hour = {}
    for item in items:
        if item["category"] not in VARS:
            continue
        hour = datetime.strptime(item["fcstDate"] + item["fcstTime"], "%Y%m%d%H%M").replace(tzinfo=KST)
        by_hour.setdefault(hour, {})[item["category"]] = parse_value(item["category"], item["fcstValue"])
    return by_hour


def read_service_key():
    key = os.environ.get("KMA_SERVICE_KEY")
    env_file = ROOT / ".env"
    if not key and env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "KMA_SERVICE_KEY":
                key = value.strip()
    return key


def main():
    service_key = read_service_key()
    if not service_key:
        sys.exit("환경변수 KMA_SERVICE_KEY 또는 .env 파일에 공공데이터포털 서비스 키를 넣어 주세요.")
    # 포털의 'Encoding' 키를 넣어도 이중 인코딩되지 않게 한다
    service_key = urllib.parse.unquote(service_key)

    now = datetime.now(KST)
    base = latest_base_time(now)
    grid_keys = load_grid_keys()
    print(f"발표 시각 {base:%Y-%m-%d %H:%M}, 격자 {len(grid_keys)}개 수집 시작")

    def work(key):
        try:
            return key, fetch_grid(service_key, base, *key), None
        except Exception as exc:  # 한 격자의 실패가 전체를 멈추지 않게 한다
            return key, None, exc

    new, failed = {}, []
    with ThreadPoolExecutor(WORKERS) as pool:
        for (nx, ny), by_hour, exc in pool.map(work, grid_keys):
            if exc is None:
                new[f"{nx},{ny}"] = by_hour
            else:
                failed.append(((nx, ny), exc))

    for key, exc in failed[:5]:
        print(f"  실패 {key}: {exc}", file=sys.stderr)
    if len(failed) > len(grid_keys) // 2:
        sys.exit(f"격자 {len(failed)}/{len(grid_keys)}개 수집 실패 — 기존 파일을 그대로 둡니다.")

    records = merge_records(load_records(WEATHER_PATH), new)
    n_hours, n_grids = write_weather(records, base, now)
    print(f"완료: 격자 {n_grids}개 x {n_hours}시간 (실패 {len(failed)}개) -> {WEATHER_PATH}")


if __name__ == "__main__":
    main()
