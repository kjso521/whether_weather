import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from kma_grid import grid_to_latlon, latlon_to_grid  # noqa: E402


class KmaGridTest(unittest.TestCase):
    def test_known_points(self):
        # 기상청 단기예보 격자 좌표표(행정구역별 위경도·격자)의 값
        self.assertEqual(latlon_to_grid(37.5799, 126.9894), (60, 127))  # 서울 종로구
        self.assertEqual(latlon_to_grid(35.1011, 129.0248), (97, 74))  # 부산 중구
        self.assertEqual(latlon_to_grid(33.5009, 126.5466), (53, 38))  # 제주시

    def test_round_trip(self):
        for nx, ny in [(60, 127), (98, 76), (52, 38), (73, 134)]:
            lat, lon = grid_to_latlon(nx, ny)
            self.assertEqual(latlon_to_grid(lat, lon), (nx, ny))


if __name__ == "__main__":
    unittest.main()
