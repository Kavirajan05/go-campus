from __future__ import annotations

from collections import deque
from pathlib import Path

import pandas as pd
from flask import Flask, jsonify, render_template, request, send_file

BASE_DIR = Path(__file__).resolve().parents[1]
DATASET_PATH = BASE_DIR / "data" / "dataset.csv"
MAP_PATH = BASE_DIR / "map.png"

app = Flask(__name__, template_folder="templates", static_folder="static")

state = {
    "x": None,
    "y": None,
    "room": "Unknown",
}

trail = deque(maxlen=200)


def get_bounds() -> dict[str, float]:
    default_bounds = {"min_x": 0.0, "max_x": 20.0, "min_y": 0.0, "max_y": 2.0}

    if not DATASET_PATH.exists():
        return default_bounds

    try:
        df = pd.read_csv(DATASET_PATH, header=None)
        if df.shape[1] < 2:
            return default_bounds

        x_col = df.iloc[:, 0].astype(float)
        y_col = df.iloc[:, 1].astype(float)

        min_x = float(x_col.min())
        max_x = float(x_col.max())
        min_y = float(y_col.min())
        max_y = float(y_col.max())

        if min_x == max_x:
            max_x += 1.0
        if min_y == max_y:
            max_y += 1.0

        return {
            "min_x": min_x,
            "max_x": max_x,
            "min_y": min_y,
            "max_y": max_y,
        }
    except Exception:
        return default_bounds


@app.get("/")
def index():
    return render_template("index.html", bounds=get_bounds())


@app.get("/map.png")
def map_image():
    if not MAP_PATH.exists():
        return jsonify({"error": "map.png not found"}), 404
    return send_file(MAP_PATH)


@app.get("/state")
def get_state():
    return jsonify(
        {
            "position": state,
            "trail": list(trail),
        }
    )


@app.post("/update")
def update_state():
    payload = request.get_json(silent=True) or {}

    try:
        x = float(payload.get("x"))
        y = float(payload.get("y"))
    except (TypeError, ValueError):
        return jsonify({"error": "x and y must be numeric"}), 400

    room = str(payload.get("room", "Unknown"))

    state["x"] = x
    state["y"] = y
    state["room"] = room

    trail.append({"x": x, "y": y})

    return jsonify({"ok": True, "position": state})


@app.post("/reset")
def reset_state():
    state["x"] = None
    state["y"] = None
    state["room"] = "Unknown"
    trail.clear()
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
