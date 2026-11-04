import asyncio
from bleak import BleakScanner
import joblib
import pandas as pd
import requests


model = joblib.load("../model/model.pkl")


BEACONS = {
    "70:4B:CA:48:5C:3E": 1,
    "1C:C3:AB:D2:46:EA": 2,
    "70:4B:CA:49:A1:5A": 3,
    "70:4B:CA:49:0D:56": 4
}

beacons = {}
smoothed_values = None
smoothed_position = None


LOOP_INTERVAL_SEC = 0.55
EWMA_ALPHA = 0.42
POSITION_EWMA_ALPHA = 0.45
MIN_MOVE_METERS = 0.22


def detection_callback(device, advertisement_data):
    addr = device.address.upper()

    if addr in BEACONS:
        beacon_id = BEACONS[addr]
        beacons[beacon_id] = device.rssi



def get_room_name(x, y):
    locations = {
        (0,0): "AIDS Lab 1",
        (6,0): "HOD Room",
        (10,0): "Ladies Toilet",
        (12.5,0): "Steps",
        (16.5,0): "Gents Toilet",
        (7,2): "AIDS Lab 3",
        (14.5,2): "Cyber HOD",
        (20,2): "Cyber Security Lab"
    }

    closest = min(locations.keys(),
                  key=lambda k: ((k[0]-x)**2 + (k[1]-y)**2))

    return locations[closest]


async def main():
    scanner = BleakScanner(detection_callback)
    await scanner.start()
    session = requests.Session()

    print("🚀 Tracking started...")

    while True:
        
        values = [
            beacons.get(1, -100),
            beacons.get(2, -100),
            beacons.get(3, -100),
            beacons.get(4, -100)
        ]

        
        if all(v == -100 for v in values):
            print("❌ No beacons detected")
            await asyncio.sleep(LOOP_INTERVAL_SEC)
            continue

        global smoothed_values
        if smoothed_values is None:
            smoothed_values = [float(v) for v in values]
        else:
            smoothed_values = [
                (EWMA_ALPHA * float(v)) + ((1 - EWMA_ALPHA) * prev)
                for v, prev in zip(values, smoothed_values)
            ]

        avg_values = [int(round(v)) for v in smoothed_values]

        df = pd.DataFrame([avg_values], columns=["B1","B2","B3","B4"])

        
        position = model.predict(df)[0]

        x = float(position[0])
        y = float(position[1])

        
        global smoothed_position
        if smoothed_position is None:
            smoothed_position = [x, y]
        else:
            smoothed_position[0] = (
                POSITION_EWMA_ALPHA * x
                + (1 - POSITION_EWMA_ALPHA) * smoothed_position[0]
            )
            smoothed_position[1] = (
                POSITION_EWMA_ALPHA * y
                + (1 - POSITION_EWMA_ALPHA) * smoothed_position[1]
            )

        smoothed_x, smoothed_y = smoothed_position

        
        if hasattr(main, "last_sent"):
            last_x, last_y = main.last_sent
            moved = ((smoothed_x - last_x) ** 2 + (smoothed_y - last_y) ** 2) ** 0.5
            if moved < MIN_MOVE_METERS:
                smoothed_x, smoothed_y = last_x, last_y
        main.last_sent = (smoothed_x, smoothed_y)

        room = get_room_name(smoothed_x, smoothed_y)

        print("RSSI (raw):", values)
        print("RSSI (avg):", avg_values)
        print(f"📍 Position: ({smoothed_x:.2f}, {smoothed_y:.2f}) → {room}")

        
        try:
            session.post(
                "http://localhost:5000/update",
                json={"x": smoothed_x, "y": smoothed_y, "room": room},
                timeout=0.2,
            )
        except requests.RequestException:
            pass

        await asyncio.sleep(LOOP_INTERVAL_SEC)


asyncio.run(main())