"""Run: uv run gis/test_calibrate.py"""
from calibrate import distance, interpolate, metrics, smooth

assert abs(distance((0, 0), (0, 1)) - 111194.93) < 1
assert interpolate([0, 10, 20], [0, 2, 0], 5) == 1
assert interpolate([0, 10, 20], [0, 2, 0], 20) == 0
xs = [0, 5, 10, 15, 20]
heights = [100, 100.5, 101, 101.5, 102]
result = metrics(xs, heights, 10)
assert result["gain_m"] == 2 and result["loss_m"] == 0
assert result["max_uphill_grade_pct"] == 10
assert smooth(xs, heights, 0) == heights
assert metrics(xs, [100] * 5, 10)["gain_m"] == 0
print("Calibration checks passed")
