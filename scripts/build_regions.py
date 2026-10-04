"""시군구 TopoJSON에서 대표점을 뽑아 기상청 격자에 매핑한 regions.json을 만든다. (구는 도시 단위로 합친다)

사용법: python3 scripts/build_regions.py
"""
import json
import re
from pathlib import Path

from kma_grid import latlon_to_grid

ROOT = Path(__file__).resolve().parent.parent
TOPO_PATH = ROOT / "web" / "data" / "sigungu.topo.json"
OUT_PATH = ROOT / "web" / "data" / "regions.json"

# 통계청 시도 코드(시군구 코드 앞 2자리)
SIDO = {
    "11": "서울", "21": "부산", "22": "대구", "23": "인천", "24": "광주",
    "25": "대전", "26": "울산", "29": "세종", "31": "경기", "32": "강원",
    "33": "충북", "34": "충남", "35": "전북", "36": "전남", "37": "경북",
    "38": "경남", "39": "제주",
}


def decode_arcs(topo):
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    return arcs


def build_ring(arc_ids, arcs):
    ring = []
    for i in arc_ids:
        pts = arcs[i] if i >= 0 else arcs[~i][::-1]
        ring.extend(pts if not ring else pts[1:])
    return ring


def polygons_of(geom, arcs):
    """각 폴리곤을 [외곽 ring, 구멍 ring, ...] 으로 돌려준다."""
    polys = [geom["arcs"]] if geom["type"] == "Polygon" else geom["arcs"]
    return [[build_ring(r, arcs) for r in poly] for poly in polys]


def ring_area_centroid(ring):
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    a *= 0.5
    if a == 0:
        return 0.0, ring[0]
    return abs(a), (cx / (6 * a), cy / (6 * a))


def crossings(poly, y):
    """위도 y의 수평선이 폴리곤 경계와 만나는 경도들(정렬됨)."""
    xs = []
    for ring in poly:
        for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
            if (y0 > y) != (y1 > y):
                xs.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
    return sorted(xs)


def representative_point(poly):
    """폴리곤 내부가 보장되는 대표점 (lon, lat). 무게중심이 밖이면 가장 긴 내부 구간의 중점."""
    _, (cx, cy) = ring_area_centroid(poly[0])
    xs = crossings(poly, cy)
    spans = list(zip(xs[0::2], xs[1::2]))
    if any(a <= cx <= b for a, b in spans):
        return cx, cy
    a, b = max(spans, key=lambda s: s[1] - s[0])
    return (a + b) / 2, cy


def display_name(name):
    # "수원시장안구" -> "수원시 장안구"
    m = re.match(r"^(.+시)(.+구)$", name)
    return f"{m.group(1)} {m.group(2)}" if m else name


def city_name(sido, name):
    """지도에서 하나로 합칠 도시 이름. 구는 너무 잘아서 고르기 어려우므로 도시 단위로 합친다.

    광역시의 구 -> "서울시", 일반 시의 구("수원시 장안구") -> "수원시", 그 밖(시·군)은 None.
    """
    if not name.endswith("구"):
        return None
    return name.split(" ")[0] if " " in name else f"{sido}시"


def merge_cities(districts):
    """구들을 도시 하나로 묶는다. 대표점은 구 대표점들의 평균에 가장 가까운 구의 것을 쓴다(도시 내부가 보장됨)."""
    regions, groups = {}, {}
    for code, d in districts.items():
        city = city_name(d["sido"], d["name"])
        if city is None:
            regions[code] = d
        else:
            groups.setdefault((d["sido"], city), []).append(code)
    for (sido, city), codes in groups.items():
        lat = sum(districts[c]["lat"] for c in codes) / len(codes)
        lon = sum(districts[c]["lon"] for c in codes) / len(codes)
        center = min(codes, key=lambda c: (districts[c]["lat"] - lat) ** 2 + (districts[c]["lon"] - lon) ** 2)
        regions[min(codes)] = {**districts[center], "name": city, "sido": sido, "members": sorted(codes)}
    return dict(sorted(regions.items()))


def main():
    topo = json.loads(TOPO_PATH.read_text(encoding="utf-8"))
    arcs = decode_arcs(topo)
    (obj,) = topo["objects"].values()
    districts = {}
    for geom in obj["geometries"]:
        props = geom["properties"]
        polys = polygons_of(geom, arcs)
        largest = max(polys, key=lambda p: ring_area_centroid(p[0])[0])
        lon, lat = representative_point(largest)
        nx, ny = latlon_to_grid(lat, lon)
        code = props["code"]
        districts[code] = {
            "name": display_name(props["name"]),
            "sido": SIDO[code[:2]],
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "nx": nx,
            "ny": ny,
        }
    regions = merge_cities(districts)
    OUT_PATH.write_text(json.dumps(regions, ensure_ascii=False, indent=1), encoding="utf-8")
    grids = {(r["nx"], r["ny"]) for r in regions.values()}
    print(f"시군구 {len(districts)}개 -> 지역 {len(regions)}개, 고유 격자 {len(grids)}개 -> {OUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
