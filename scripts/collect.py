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

API_PATH = "apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst"
# GitHub 서버(미국)에서는 https 접속이 가끔 막혀 응답이 없다. 그럴 때 http로도 시도해 본다.
# http는 서비스 키가 암호화되지 않고 오가지만, 무료 조회용 키라 감수한다.
SCHEMES = ["https", "http"]
api_url = f"https://{API_PATH}"  # probe()가 응답하는 쪽으로 정한다
BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23]  # 발표 시각
PUBLISH_DELAY = timedelta(minutes=15)  # 발표 후 API에 반영될 때까지 여유
PAGE_SIZE = 1000
WORKERS = 8
RETRIES = 3
TIMEOUT = 15  # 초. 기상청 서버가 응답하지 않을 때 오래 붙잡혀 있지 않게 짧게 둔다
PROBE_ROUNDS = 3  # 본 수집 전 격자 하나로 서버 상태를 확인하는 횟수
PROBE_WAIT = 60  # 확인 실패 시 다음 확인까지 기다리는 시간(초)


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
    with urllib.request.urlopen(f"{api_url}?{query}", timeout=TIMEOUT) as res:
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


def previous_base_time(path=WEATHER_PATH):
    """직전에 배포된 파일의 발표 시각. 없거나 샘플이면 None."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return None if data.get("sample") else datetime.fromisoformat(data["baseTime"])
    except (OSError, ValueError, KeyError):
        return None


def set_output(name, value):
    """GitHub Actions 단계 출력값을 남긴다 (로컬 실행에서는 무시)."""
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"{name}={value}\n")


def probe(service_key, base, key):
    """격자 하나로 서버가 응답하는지 확인하고, 응답하는 쪽(https/http)을 이후 수집에 쓴다.
    둘 다 안 되면 잠시 기다렸다 다시 시도한다."""
    global api_url
    for round_ in range(PROBE_ROUNDS):
        for scheme in SCHEMES:
            api_url = f"{scheme}://{API_PATH}"
            try:
                by_hour = fetch_grid(service_key, base, *key)
                print(f"  {scheme}로 연결됨")
                return by_hour
            except Exception as exc:
                print(f"  서버 확인 실패 ({round_ + 1}/{PROBE_ROUNDS}, {scheme}): {exc}", file=sys.stderr)
        if round_ < PROBE_ROUNDS - 1:
            time.sleep(PROBE_WAIT)
    sys.exit("기상청 API가 응답하지 않습니다 — 기존 파일을 그대로 두고 다음 실행 때 다시 시도합니다.")


def main():
    service_key = read_service_key()
    if not service_key:
        sys.exit("환경변수 KMA_SERVICE_KEY 또는 .env 파일에 공공데이터포털 서비스 키를 넣어 주세요.")
    # 포털의 'Encoding' 키를 넣어도 이중 인코딩되지 않게 한다
    service_key = urllib.parse.unquote(service_key)

    now = datetime.now(KST)
    base = latest_base_time(now)
    prev = previous_base_time()
    if prev is not None and prev >= base:
        print(f"발표 시각 {base:%Y-%m-%d %H:%M} 예보는 이미 받아 두었습니다 — 건너뜁니다.")
        set_output("updated", "false")
        return
    grid_keys = load_grid_keys()
    print(f"발표 시각 {base:%Y-%m-%d %H:%M}, 격자 {len(grid_keys)}개 수집 시작")
    first = probe(service_key, base, grid_keys[0])

    def work(key):
        try:
            return key, fetch_grid(service_key, base, *key), None
        except Exception as exc:  # 한 격자의 실패가 전체를 멈추지 않게 한다
            return key, None, exc

    new, failed = {"%d,%d" % grid_keys[0]: first}, []
    with ThreadPoolExecutor(WORKERS) as pool:
        for (nx, ny), by_hour, exc in pool.map(work, grid_keys[1:]):
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
    set_output("updated", "true")
    print(f"완료: 격자 {n_grids}개 x {n_hours}시간 (실패 {len(failed)}개) -> {WEATHER_PATH}")


if __name__ == "__main__":
    main()
