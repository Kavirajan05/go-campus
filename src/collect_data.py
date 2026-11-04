import asyncio
from bleak import BleakScanner
import csv


filename = "../data/dataset.csv"


BEACONS = {
    "70:4B:CA:48:5C:3E": 1,
    "1C:C3:AB:D2:46:EA": 2,
    "70:4B:CA:49:A1:5A": 3,
    "70:4B:CA:49:CD:56": 4
}

beacons = {}


def detection_callback(device, advertisement_data):
    addr = device.address.upper()

    if addr in BEACONS:
        beacon_id = BEACONS[addr]
        beacons[beacon_id] = device.rssi


async def main():
    scanner = BleakScanner(detection_callback)
    await scanner.start()

  
    X = float(input("Enter X coordinate: "))
    Y = float(input("Enter Y coordinate: "))

    print("Collecting data for 5 seconds...")

    await asyncio.sleep(5)



    values = [
        beacons.get(1, -100),
        beacons.get(2, -100),
        beacons.get(3, -100),
        beacons.get(4, -100)
    ]

    
    with open(filename, "a", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([X, Y] + values)

    print(f"✅ Saved: {[X, Y] + values}")

    await scanner.stop()


asyncio.run(main())