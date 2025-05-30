import { StubGenesisConfig } from "../types.ts";

const zero = {
  free: 0,
  reserved: 0,
  frozen: 0,
};

export default {
  accounts: [
    {
      id: "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
      identity: {
        display: "alice",
        firstName: "Alice",
        lastName: "Anon",
        phone: "1.4168900514",
        email: "alice@example.com",
        additional: [],
      },
      balance: zero,
      assets: {},
    },
    {
      id: "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o",
      identity: {
        display: "bob",
        firstName: "Bob",
        lastName: "Bear",
        phone: "1.4158900514",
        email: "bob@example.com",
        additional: [],
      },
      balance: zero,
      assets: {},
    },
  ],
  events: [
    {
      id: 1,
      owner: "5Fh3tNPUUKtApDZ6rJ2sDgcC5Z6pVVyAzKeE1dnqowLqWEvw",
      name: "Dua Lipa en Colombia",
      description: "Dua lipa viene a Colombia, no te lo pierdas",
      banner:
        "https://lumiere-a.akamaihd.net/v1/images/dua_lipa_portada_5_bf1628a4.jpeg?region=15,0,1956,1100&width=960",
      dates: [
        [1710446400000, 1710475200000],
        [1710532800000, 1710561600000],
        [1710619200000, 1710648000000],
      ],
      date: [1710446400000, 1710475200000],
      capacity: 24000,
    },
    {
      id: 2,
      owner: "5Fh3tNPUUKtApDZ6rJ2sDgcC5Z6pVVyAzKeE1dnqowLqWEvw",
      name: "Mitú",
      description: "Mitú Astra Tour 2023\n\nCon Charlie Florez, Varez y Puerto",
      banner:
        "https://wild-presenta.com/wp-content/uploads/2023/07/MITU-ASTRATOURTUNJA19AGOSTO.jpg",
      capacity: 10_000,
      dates: [[1709762400000, 1709776800000]],
      date: [1709762400000, 1709776800000],
    },
    {
      id: 3,
      owner: "5Fh3tNPUUKtApDZ6rJ2sDgcC5Z6pVVyAzKeE1dnqowLqWEvw",
      name: "Dlina Volny",
      description:
        "Desde Bielorrusia: Dlina Volny\n\nRitüel for Two (México) - Ana Gartner (Live Set) - Surfer Rosa - Andrea Arias (a.k.a. Zige)",
      banner:
        "https://wild-presenta.com/wp-content/uploads/2023/07/Copia-de-FINAL.jpg",
      capacity: 15_000,
      dates: [[1712345600000, 1712360000000]],
      date: [1712345600000, 1712360000000],
    },
    {
      id: 4,
      owner: "5Fh3tNPUUKtApDZ6rJ2sDgcC5Z6pVVyAzKeE1dnqowLqWEvw",
      name: "Paula Garcés - Laura Villalobos - Martin Arc - BT.MKR",
      description:
        'Main (Misa de 12):\n\nPaula Garcés\n\nLaura Villalobos\n\nMartin Arc\n\nBT.MKR\n\n\nAfter (Secret Location) Showcase Pulse Rythm:\nPuerto Moiseline\n\nSpecial Guest:\nMeteo (Cadencia)\n\n\n<iframe style="width: 100%" src="https://www.youtube.com/embed/ctX9y31pW4o" title="EXCLUSIVE 113 PAULA GARCES ¡¡ para ValeraUnderMusic, un set emotivo.no complaciente y exquisito ¡¡¡" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>',
      banner: "https://wild-presenta.com/wp-content/uploads/2024/01/FLYER.jpg",
      capacity: 20000,
      dates: [[1714937600000, 1714952000000]],
      date: [1714937600000, 1714952000000],
    },
  ],
  tickets: [
    // Event: Dua Lipa en Colombia
    {
      id: 1,
      issuer: 1,
      owner: "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
      name: "Dua Lipa en Colombia",
      description: "General Entrance",
      ticketArt:
        "https://wild-presenta.com/wp-content/uploads/2023/07/MITU-ASTRATOURTUNJA19AGOSTO.jpg",
      attendances: [],
      forSale: false,
      attedancePolicy: {
        type: "Single",
      },
    },
    {
      id: 2,
      issuer: 1,
      owner: "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o",
      name: "Dua Lipa en Colombia",
      description: "General Entrance",
      ticketArt:
        "https://wild-presenta.com/wp-content/uploads/2023/07/MITU-ASTRATOURTUNJA19AGOSTO.jpg",
      attendances: [],
      forSale: false,
      attedancePolicy: {
        type: "Single",
      },
    },
    // Event: Mitú
    {
      id: 1,
      issuer: 2,
      owner: "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
      name: "Mitú",
      ticketArt:
        "https://wild-presenta.com/wp-content/uploads/2023/07/Copia-de-FINAL.jpg",
      description: "General Entrance",
      attendances: [],
      forSale: false,
      attedancePolicy: {
        type: "Single",
      },
    },
    {
      id: 2,
      issuer: 2,
      owner: "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o",
      name: "Mitú",
      ticketArt:
        "https://wild-presenta.com/wp-content/uploads/2023/07/Copia-de-FINAL.jpg",
      description: "General Entrance",
      attendances: [],
      forSale: false,
      attedancePolicy: {
        type: "Single",
      },
    },
    // Event: Dlina Volny
    {
      id: 1,
      issuer: 3,
      owner: "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
      name: "Dlina Volny",
      ticketArt:
        "https://wild-presenta.com/wp-content/uploads/2024/01/FLYER.jpg",
      description: "General Entrance",
      attendances: [],
      forSale: false,
      attedancePolicy: {
        type: "Single",
      },
    },
    // Event: Paula Garcés - Laura Villalobos - Martin Arc - BT.MKR
    {
      id: 1,
      issuer: 4,
      owner: "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o",
      name: "Paula Garcés - Laura Villalobos - Martin Arc - BT.MKR",
      ticketArt:
        "https://wild-presenta.com/wp-content/uploads/2024/01/FLYER.jpg",
      description: "General Entrance",
      attendances: [],
      forSale: false,
      attedancePolicy: {
        type: "Single",
      },
    },
  ],
  attendances: [],
} as StubGenesisConfig;
