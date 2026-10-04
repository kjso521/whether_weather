"""위경도 <-> 기상청 단기예보 격자(nx, ny) 변환 (Lambert Conformal Conic, 5km 격자)."""
import math

RE = 6371.00877  # 지구 반경(km)
GRID = 5.0  # 격자 간격(km)
SLAT1 = 30.0  # 표준 위도 1
SLAT2 = 60.0  # 표준 위도 2
OLON = 126.0  # 기준점 경도
OLAT = 38.0  # 기준점 위도
XO = 43  # 기준점 X좌표
YO = 136  # 기준점 Y좌표

_DEGRAD = math.pi / 180.0
_re = RE / GRID
_slat1 = SLAT1 * _DEGRAD
_slat2 = SLAT2 * _DEGRAD
_olon = OLON * _DEGRAD
_olat = OLAT * _DEGRAD

_sn = math.log(math.cos(_slat1) / math.cos(_slat2)) / math.log(
    math.tan(math.pi * 0.25 + _slat2 * 0.5) / math.tan(math.pi * 0.25 + _slat1 * 0.5)
)
_sf = math.tan(math.pi * 0.25 + _slat1 * 0.5) ** _sn * math.cos(_slat1) / _sn
_ro = _re * _sf / math.tan(math.pi * 0.25 + _olat * 0.5) ** _sn


def latlon_to_grid(lat: float, lon: float) -> tuple[int, int]:
    ra = _re * _sf / math.tan(math.pi * 0.25 + lat * _DEGRAD * 0.5) ** _sn
    theta = lon * _DEGRAD - _olon
    if theta > math.pi:
        theta -= 2.0 * math.pi
    if theta < -math.pi:
        theta += 2.0 * math.pi
    theta *= _sn
    nx = int(math.floor(ra * math.sin(theta) + XO + 0.5))
    ny = int(math.floor(_ro - ra * math.cos(theta) + YO + 0.5))
    return nx, ny


def grid_to_latlon(nx: int, ny: int) -> tuple[float, float]:
    xn = nx - XO
    yn = _ro - ny + YO
    ra = math.sqrt(xn * xn + yn * yn)
    if _sn < 0.0:
        ra = -ra
    alat = 2.0 * math.atan((_re * _sf / ra) ** (1.0 / _sn)) - math.pi * 0.5
    theta = 0.0 if abs(xn) <= 0.0 else math.atan2(xn, yn)
    alon = theta / _sn + _olon
    return alat / _DEGRAD, alon / _DEGRAD
