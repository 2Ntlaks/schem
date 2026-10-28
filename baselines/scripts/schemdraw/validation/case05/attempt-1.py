# schemdraw baseline, case 5, attempt 1: ESP32 on the left driving two horizontal I2C bus lines; the two
# sensors hang below the bus; pull-ups at the bus ends; local 3V3 and ground symbols instead of rails.
from schemdraw_kit import elm, run


def draw(S, nl):
    u1 = S.ic("U1", (0, 6), {"top": [("1", "3V3")], "bot": [("2", "GND")], "right": [("3", "GPIO21"), ("4", "GPIO22")]},
              "U1\nESP32-DevKitC", size=(3.5, 3))
    sda_y, scl_y = S.anchor("U1", "3")[1], S.anchor("U1", "4")[1]
    S.power(S.anchor("U1", "1"), "3V3", lead=0.5)
    S.power(S.anchor("U1", "2"), "GND", kind="gnd")
    sensors = []
    for i, (ref, name) in enumerate((("U2", "BME280"), ("U3", "SHT31"))):
        x0 = 8 + i * 7
        S.ic(ref, (x0, 1.5), {"top": [("4", "SDA"), ("3", "SCL")], "left": [("1", "VIN")], "bot": [("2", "GND")]},
             f"{ref}\n{name}", size=(3, 2.5))
        sensors.append(ref)
        sd, sc = S.anchor(ref, "4"), S.anchor(ref, "3")
        S.wire(sd, (sd[0], sda_y))
        S.wire(sc, (sc[0], scl_y))
        vin = S.anchor(ref, "1")
        S.wire(vin, (vin[0] - 0.8, vin[1]), (vin[0] - 0.8, vin[1] + 0.6))
        S.power((vin[0] - 0.8, vin[1] + 0.6), "3V3")
        S.power(S.anchor(ref, "2"), "GND", kind="gnd")
    last_sda = S.anchor("U3", "4")[0]
    last_scl = S.anchor("U3", "3")[0]
    # SDA bus with R1 near the controller, SCL bus with R2 at its far end (no crossing with SDA)
    S.wire(S.anchor("U1", "3"), (last_sda, sda_y))
    xr2 = last_scl + 1.5
    S.wire(S.anchor("U1", "4"), (xr2, scl_y))
    r1 = S.part(elm.Resistor().at((5, sda_y)).up().label("R1\n4.7k"), "R1", {"2": "start", "1": "end"})
    S.power(r1.end, "3V3")
    r2 = S.part(elm.Resistor().at((xr2, scl_y)).up().label("R2\n4.7k"), "R2", {"2": "start", "1": "end"})
    S.power(r2.end, "3V3")
    S.label((6.5, sda_y), "SDA", loc="top")
    S.label((6.5, scl_y), "SCL", loc="bottom")


run(draw)
