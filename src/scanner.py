import asyncio
from bleak import BleakScanner

TARGET_UUID = "12345678-1234-1234-1234-1234567890ab"

beacons = {}

def detection_callback(device, advertisement_data):
    if device.name and "ESP32" in device.name:
        beacons[device.address] = device.rssi

async def main():
    scanner = BleakScanner(detection_callback)
    await scanner.start()

    while True:
        print(beacons)
        await asyncio.sleep(1)

asyncio.run(main())