"""서비스 키 없이 화면을 개발하기 위한 가짜 예보 데이터를 만든다. (실제 날씨가 아님)

사용법: python3 scripts/make_sample.py
"""
import math
import random
from datetime import datetime, timedelta

from kma_grid import grid_to_latlon
from weather_store import KST, load_grid_keys, write_weather


def main():
    rng = random.Random(7)
    now = datetime.now(KST)
    start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    hours = [start + timedelta(hours=i) for i in range(24 * 5)]
    # 서쪽에서 동쪽으로 지나가는 구름대 두 개
    fronts = [(rng.uniform(0, 60), rng.uniform(0.08, 0.14)) for _ in range(2)]

    records = {}
    for nx, ny in load_grid_keys():
        lat, lon = grid_to_latlon(nx, ny)
        by_hour = {}
        for i, hour in enumerate(hours):
            cloud = sum(
                math.exp(-(((lon - 124.5) / speed - (i - offset)) / 14) ** 2) for offset, speed in fronts
            ) + 0.25 * math.sin(lat * 3 + i / 9) + rng.uniform(-0.08, 0.08)
            cloud = min(max(cloud, 0), 1)
            diurnal = math.cos((hour.hour - 15) / 24 * 2 * math.pi)
            tmp = 16 - (lat - 35) * 1.6 + 5 * diurnal * (1 - 0.5 * cloud) + rng.uniform(-0.5, 0.5)
            raining = cloud > 0.78
            by_hour[hour] = {
                "TMP": round(tmp, 1),
                "SKY": 1 if cloud < 0.35 else 3 if cloud < 0.65 else 4,
                "PTY": 1 if raining else 0,
                "POP": int(round(cloud * 9)) * 10 if cloud > 0.3 else 0,
                "PCP": round((cloud - 0.78) * 30, 1) if raining else 0.0,
                "REH": int(min(100, max(20, 60 - 18 * diurnal + 30 * cloud))),
                "WSD": round(max(0.2, 2.2 + 1.5 * cloud + 0.8 * diurnal + rng.uniform(-0.6, 0.6)), 1),
            }
        records[f"{nx},{ny}"] = by_hour

    base = now.replace(minute=0, second=0, microsecond=0)
    n_hours, n_grids = write_weather(records, base, now, sample=True)
    print(f"샘플 데이터: 격자 {n_grids}개 x {n_hours}시간")


if __name__ == "__main__":
    main()
