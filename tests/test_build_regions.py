import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from build_regions import city_name, merge_cities  # noqa: E402


def district(name, sido, lat, lon):
    return {"name": name, "sido": sido, "lat": lat, "lon": lon, "nx": int(lon), "ny": int(lat)}


class MergeCitiesTest(unittest.TestCase):
    def test_city_name(self):
        self.assertEqual(city_name("서울", "종로구"), "서울시")
        self.assertEqual(city_name("경기", "수원시 장안구"), "수원시")
        self.assertIsNone(city_name("인천", "강화군"))
        self.assertIsNone(city_name("강원", "춘천시"))

    def test_merges_districts_and_keeps_counties(self):
        regions = merge_cities({
            "22010": district("중구", "대구", 35.0, 128.0),
            "22020": district("동구", "대구", 35.1, 128.1),
            "22030": district("서구", "대구", 35.2, 128.2),
            "22310": district("달성군", "대구", 35.5, 128.4),
            "32010": district("춘천시", "강원", 37.8, 127.7),
        })
        self.assertEqual(set(regions), {"22010", "22310", "32010"})
        city = regions["22010"]
        self.assertEqual((city["name"], city["sido"]), ("대구시", "대구"))
        self.assertEqual(city["members"], ["22010", "22020", "22030"])
        # 대표점은 가운데 구(동구)의 것
        self.assertEqual((city["lat"], city["lon"]), (35.1, 128.1))
        self.assertNotIn("members", regions["22310"])


if __name__ == "__main__":
    unittest.main()
