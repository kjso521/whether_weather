import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from collect import latest_base_time, parse_value  # noqa: E402
from weather_store import KST, load_records, merge_records, write_weather  # noqa: E402


def kst(*args):
    return datetime(*args, tzinfo=KST)


class BaseTimeTest(unittest.TestCase):
    def test_waits_for_publish_delay(self):
        self.assertEqual(latest_base_time(kst(2026, 10, 5, 5, 10)), kst(2026, 10, 5, 2))
        self.assertEqual(latest_base_time(kst(2026, 10, 5, 5, 15)), kst(2026, 10, 5, 5))

    def test_falls_back_to_previous_day(self):
        self.assertEqual(latest_base_time(kst(2026, 10, 5, 1, 0)), kst(2026, 10, 4, 23))


class ParseValueTest(unittest.TestCase):
    def test_pcp(self):
        self.assertEqual(parse_value("PCP", "강수없음"), 0.0)
        self.assertEqual(parse_value("PCP", "1mm 미만"), 0.5)
        self.assertEqual(parse_value("PCP", "1.0mm"), 1.0)
        self.assertEqual(parse_value("PCP", "30.0~50.0mm"), 30.0)
        self.assertEqual(parse_value("PCP", "50.0mm 이상"), 50.0)

    def test_numeric(self):
        self.assertEqual(parse_value("SKY", "3"), 3)
        self.assertEqual(parse_value("TMP", "-1.5"), -1.5)


class StoreTest(unittest.TestCase):
    def test_merge_keeps_yesterday_and_drops_older(self):
        now = kst(2026, 10, 5, 9, 0)
        old = {"60,127": {
            kst(2026, 10, 3, 12): {"TMP": 1.0},   # 이틀 전 -> 버려짐
            kst(2026, 10, 4, 12): {"TMP": 2.0},   # 어제 -> 유지
            kst(2026, 10, 5, 12): {"TMP": 3.0},   # 새 예보로 덮어씀
        }}
        new = {"60,127": {kst(2026, 10, 5, 12): {"TMP": 9.0}}}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "w.json"
            write_weather(merge_records(old, new), kst(2026, 10, 5, 8), now, path=path)
            back = load_records(path)["60,127"]
        self.assertNotIn(kst(2026, 10, 3, 12), back)
        self.assertEqual(back[kst(2026, 10, 4, 12)]["TMP"], 2.0)
        self.assertEqual(back[kst(2026, 10, 5, 12)]["TMP"], 9.0)
        self.assertEqual(max(back) - min(back), timedelta(hours=24))

    def test_sample_file_is_not_merged(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "w.json"
            write_weather({"60,127": {kst(2026, 10, 5, 12): {"TMP": 1.0}}}, kst(2026, 10, 5, 8), kst(2026, 10, 5, 9),
                          path=path, sample=True)
            self.assertEqual(load_records(path), {})

    def test_missing_file(self):
        self.assertEqual(load_records("/nonexistent/w.json"), {})


if __name__ == "__main__":
    unittest.main()
