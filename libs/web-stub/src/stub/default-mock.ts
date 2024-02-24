import { StubGenesisConfig } from "../types.js";

export default {
  events: [
    {
      id: 1,
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
      id: 2,
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
      id: 3,
      owner: "5Fh3tNPUUKtApDZ6rJ2sDgcC5Z6pVVyAzKeE1dnqowLqWEvw",
      name: "Paula Garcés - Laura Villalobos - Martin Arc - BT.MKR",
      description:
        'Main (Misa de 12):\nPaula Garcés\nLaura Villalobos\nMartin Arc\nBT.MKR\n\nAfter (Secret Location) Showcase Pulse Rythm:\nPuerto Moiseline\n\nSpecial Guest:\nMeteo (Cadencia)\n\n\n<iframe width="640" height="450" src="https://www.youtube.com/embed/ctX9y31pW4o" title="EXCLUSIVE 113 PAULA GARCES ¡¡ para ValeraUnderMusic, un set emotivo.no complaciente y exquisito ¡¡¡" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>',
      banner: "https://wild-presenta.com/wp-content/uploads/2024/01/FLYER.jpg",
      capacity: 20000,
      dates: [[1714937600000, 1714952000000]],
      date: [1714937600000, 1714952000000],
    },
  ],
  tickets: [
    // Event: Mitú
    {
      id: 1,
      issuer: 1,
      owner: "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
      name: "Mitú",
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
      name: "Mitú",
      description: "General Entrance",
      ticketArt:
        "https://wild-presenta.com/wp-content/uploads/2023/07/MITU-ASTRATOURTUNJA19AGOSTO.jpg",
      attendances: [],
      forSale: false,
      attedancePolicy: {
        type: "Single",
      },
    },
    // Event: Dlina Volny
    {
      id: 1,
      issuer: 2,
      owner: "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
      name: "Dlina Volny",
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
      name: "Dlina Volny",
      ticketArt:
        "https://wild-presenta.com/wp-content/uploads/2023/07/Copia-de-FINAL.jpg",
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
      issuer: 3,
      owner: "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
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
} as StubGenesisConfig;
