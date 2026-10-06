import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from build_region_meta import OUT_PATH, REGIONS_PATH, build  # noqa: E402


class RegionMetaTest(unittest.TestCase):
    def setUp(self):
        self.meta = build()

    def test_every_region_has_meta(self):
        regions = json.loads(REGIONS_PATH.read_text(encoding="utf-8"))
        self.assertEqual(set(self.meta), set(regions))

    def test_value_ranges(self):
        for code, m in self.meta.items():
            self.assertIn(m["bortle"], range(1, 10), code)
            self.assertTrue(0 <= m["elev"] <= 2000, code)
            self.assertIsInstance(m["water"], bool)
            self.assertIsInstance(m["basin"], bool)

    def test_big_cities_are_bright(self):
        for code in ["11010", "21010", "22010", "23010", "24010"]:  # 서울, 부산, 대구, 인천, 광주
            self.assertGreaterEqual(self.meta[code]["bortle"], 8, code)

    def test_committed_file_is_up_to_date(self):
        # 표를 고치고 python3 scripts/build_region_meta.py 를 다시 돌리지 않았으면 실패한다
        self.assertEqual(json.loads(OUT_PATH.read_text(encoding="utf-8")), self.meta)


if __name__ == "__main__":
    unittest.main()
