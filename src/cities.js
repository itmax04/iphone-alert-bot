// Города и приоритеты из таблицы «iPhone_Города_из_Ростока.xlsx» (17.10.2026).
// minutes — оценка поездки из Ростока региональным транспортом в одну сторону.
export const CITIES = [
  {
    "name": "Rostock",
    "priority": "high",
    "minutes": "0–40",
    "route": "S-Bahn / трамвай",
    "note": "Перед выездом проверить оба направления.",
    "slug": "rostock",
    "loc": "l137"
  },
  {
    "name": "Schwerin",
    "priority": "high",
    "minutes": "55–75",
    "route": "RE1",
    "note": "Перед выездом проверить оба направления.",
    "slug": "schwerin",
    "loc": "l264"
  },
  {
    "name": "Hamburg",
    "priority": "high",
    "minutes": "150–180",
    "route": "RE1",
    "note": "Перед выездом проверить оба направления.",
    "slug": "hamburg",
    "loc": "l9409"
  },
  {
    "name": "Berlin",
    "priority": "high",
    "minutes": "160–190",
    "route": "RE5; сейчас возможен SEV",
    "note": "Ремонт / SEV на берлинском направлении. Не ехать без проверки рейса.",
    "slug": "berlin",
    "loc": "l3331"
  },
  {
    "name": "Stralsund",
    "priority": "high",
    "minutes": "58–75",
    "route": "RE9",
    "note": "31.10–05.11 SEV на части RE9; перепроверить дорогу.",
    "slug": "stralsund",
    "loc": "l124"
  },
  {
    "name": "Greifswald",
    "priority": "high",
    "minutes": "95–120",
    "route": "RE9 → RE3/RE30",
    "note": "31.10–05.11 SEV на части RE9; перепроверить дорогу.",
    "slug": "greifswald",
    "loc": "l233"
  },
  {
    "name": "Güstrow",
    "priority": "high",
    "minutes": "30–50",
    "route": "S2 / RE",
    "note": "Перед выездом проверить оба направления.",
    "slug": "guestrow",
    "loc": "l102"
  },
  {
    "name": "Wismar",
    "priority": "high",
    "minutes": "70–90",
    "route": "RB11",
    "note": "Перед выездом проверить оба направления.",
    "slug": "wismar",
    "loc": "l217"
  },
  {
    "name": "Bad Doberan",
    "priority": "medium",
    "minutes": "20–35",
    "route": "RB11",
    "note": "Перед выездом проверить оба направления.",
    "slug": "bad-doberan",
    "loc": "l13033"
  },
  {
    "name": "Ribnitz-Damgarten",
    "priority": "medium",
    "minutes": "25–40",
    "route": "RE9",
    "note": "Перед выездом проверить оба направления.",
    "slug": "ribnitz-damgarten",
    "loc": "l79"
  },
  {
    "name": "Lübeck",
    "priority": "medium",
    "minutes": "110–140",
    "route": "RE1 → RE4, Bad Kleinen",
    "note": "Западные стыковки / SEV: время может заметно превышать обычное.",
    "slug": "luebeck",
    "loc": "l409"
  },
  {
    "name": "Neubrandenburg",
    "priority": "medium",
    "minutes": "107–135",
    "route": "через Güstrow, RE4",
    "note": "Перед выездом проверить оба направления.",
    "slug": "neubrandenburg",
    "loc": "l249"
  },
  {
    "name": "Waren (Müritz)",
    "priority": "medium",
    "minutes": "65–90",
    "route": "RE5 / RE50",
    "note": "Перед выездом проверить оба направления.",
    "slug": "waren-%28mueritz%29",
    "loc": "l69"
  },
  {
    "name": "Neustrelitz",
    "priority": "medium",
    "minutes": "95–120",
    "route": "RE5 / RE50",
    "note": "Ремонт / SEV на берлинском направлении. Не ехать без проверки рейса.",
    "slug": "neustrelitz",
    "loc": "l62"
  },
  {
    "name": "Oranienburg",
    "priority": "medium",
    "minutes": "130–160",
    "route": "RE5",
    "note": "Ремонт / SEV на берлинском направлении. Не ехать без проверки рейса.",
    "slug": "oranienburg",
    "loc": "l7813"
  },
  {
    "name": "Bützow",
    "priority": "medium",
    "minutes": "20–35",
    "route": "RE1",
    "note": "Перед выездом проверить оба направления.",
    "slug": "buetzow",
    "loc": "l16558"
  },
  {
    "name": "Schwaan",
    "priority": "medium",
    "minutes": "15–25",
    "route": "S2",
    "note": "Перед выездом проверить оба направления.",
    "slug": "schwaan",
    "loc": "l16600"
  },
  {
    "name": "Tessin",
    "priority": "medium",
    "minutes": "35–50",
    "route": "RB11",
    "note": "Перед выездом проверить оба направления.",
    "slug": "tessin",
    "loc": "l16602"
  },
  {
    "name": "Laage",
    "priority": "medium",
    "minutes": "25–40",
    "route": "S3 / RE50",
    "note": "Перед выездом проверить оба направления.",
    "slug": "laage",
    "loc": "l16568"
  },
  {
    "name": "Teterow",
    "priority": "medium",
    "minutes": "60–85",
    "route": "через Güstrow, RE4",
    "note": "Перед выездом проверить оба направления.",
    "slug": "teterow",
    "loc": "l9806"
  },
  {
    "name": "Grevesmühlen",
    "priority": "medium",
    "minutes": "75–105",
    "route": "через Bad Kleinen, RE4",
    "note": "Западные стыковки / SEV: время может заметно превышать обычное.",
    "slug": "grevesmuehlen",
    "loc": "l9726"
  },
  {
    "name": "Ludwigslust",
    "priority": "medium",
    "minutes": "95–120",
    "route": "через Schwerin",
    "note": "Перед выездом проверить оба направления.",
    "slug": "ludwigslust",
    "loc": "l16621"
  },
  {
    "name": "Bergen auf Rügen",
    "priority": "medium",
    "minutes": "90–115",
    "route": "RE9",
    "note": "31.10–05.11 SEV на части RE9; перепроверить дорогу.",
    "slug": "bergen-auf-ruegen",
    "loc": "l18643"
  }
];
