// Starter `.schem` text templates for `schem init --template <name>`.
// Every template compiles and lays out valid with zero overlaps.

export const INIT_TEMPLATE_NAMES = [
  "led",
  "divider",
  "opamp",
  "regulator",
  "i2c",
  "bjt-amp",
] as const;

export type InitTemplateName = (typeof INIT_TEMPLATE_NAMES)[number];

export const INIT_TEMPLATES: Readonly<Record<InitTemplateName, string>> = {
  led: [
    'circuit "LED indicator"',
    "part B1 battery 9V",
    "part R1 resistor 470",
    "part D1 led color=red",
    "net PWR = B1[+] R1[1]",
    "connect R1[2] D1[A]",
    "net GND = D1[K] B1[-]",
    "",
  ].join("\n"),

  divider: [
    'circuit "Voltage divider"',
    "part B1 battery 5V",
    "part R1 resistor 10k",
    "part R2 resistor 10k",
    'part J1 header "OUT" pins: 1:VOUT/passive 2:GND/ground',
    "net 5V = B1[+] R1[1]",
    "net VOUT = R1[2] R2[1] J1[1]",
    "net GND = B1[-] R2[2] J1[2]",
    "",
  ].join("\n"),

  opamp: [
    'circuit "Inverting op-amp amplifier"',
    'part J1 header "IN" pins: 1:IN/passive 2:GND/ground',
    "part R1 resistor 10k",
    "part R2 resistor 100k",
    "part U1 opamp partNumber=TL072",
    'part J2 header "OUT" pins: 1:OUT/passive 2:GND/ground',
    "net IN = J1[1] R1[1]",
    "net SUM = R1[2] R2[1] U1.IN-",
    "net OUT = U1.OUT R2[2] J2[1]",
    "net GND = J1[2] U1.IN+ J2[2]",
    "",
  ].join("\n"),

  regulator: [
    'circuit "LM7805 5V linear regulator"',
    "part B1 battery 12V",
    "part D1 diode 1N4007",
    "part C1 capacitor 330n",
    "part U1 module:lm7805",
    "part C2 capacitor 100n",
    "part R1 resistor 330",
    "part D2 led color=green",
    "connect B1.+ D1.anode",
    "connect D1.cathode C1[1] U1.IN",
    "net 5V = U1.OUT C2[1] R1[1]",
    "connect R1[2] D2.anode",
    "net GND = B1.- C1[2] U1.GND C2[2] D2.cathode",
    "hint D1 horizontal",
    "hint U1 pins-left IN pins-right OUT pins-bottom GND",
    "hint C1 decouples U1.IN",
    "hint C2 decouples U1.OUT",
    "",
  ].join("\n"),

  i2c: [
    'circuit "I2C bus with pull-up resistors"',
    "part U1 module:raspberry-pi-pico",
    "part OLED1 module:ssd1306-oled-i2c",
    "part R1 resistor 4.7k",
    "part R2 resistor 4.7k",
    "net 3V3 = U1.3V3 OLED1.VCC R1[1] R2[1]",
    "net GND = U1{GND} OLED1.GND",
    "net SDA = U1.GP4 OLED1.SDA R1[2]",
    "net SCL = U1.GP5 OLED1.SCL R2[2]",
    "",
  ].join("\n"),

  "bjt-amp": [
    'circuit "Common-emitter BJT amplifier"',
    "part V1 ac-source",
    "part C1 capacitor 10u",
    "part R1 resistor 47k",
    "part R2 resistor 10k",
    "part Q1 npn partNumber=2N3904",
    "part R3 resistor 4.7k",
    "part R4 resistor 1k",
    "part C2 capacitor 100u",
    "part C3 capacitor 10u",
    "part R5 resistor 10k",
    "connect V1[1] C1[1]",
    "connect C1[2] Q1[B] R1[2] R2[1]",
    "connect Q1[E] R4[1] C2[1]",
    "connect Q1[C] R3[2] C3[1]",
    "net OUT = C3[2] R5[1]",
    "net VCC = R1[1] R3[1]",
    "net GND = V1[2] R2[2] R4[2] C2[2] R5[2]",
    "",
  ].join("\n"),
};

/** Return the `.schem` starter source for a template name, or undefined if unknown. */
export function getInitTemplate(name: string): string | undefined {
  if (!Object.hasOwn(INIT_TEMPLATES, name)) return undefined;
  return INIT_TEMPLATES[name as InitTemplateName];
}
