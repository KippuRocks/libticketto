import { AttendancePolicyType, EventStatus } from "@ticketto/types";
import { StubGenesisConfig, zero } from "../types.ts";

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
  metadata: [
    // Events
    {
      type: "event",
      id: 1,
      description: "Dua lipa viene a Colombia, no te lo pierdas",
      banner:
        "https://lumiere-a.akamaihd.net/v1/images/dua_lipa_portada_5_bf1628a4.jpeg?region=15,0,1956,1100&width=960",
    },
    {
      type: "event",
      id: 2,
      description: "Mitú Astra Tour 2023\n\nCon Charlie Florez, Varez y Puerto",
      banner:
        "https://wild-presenta.com/wp-content/uploads/2023/07/MITU-ASTRATOURTUNJA19AGOSTO.jpg",
    },
    {
      type: "event",
      id: 3,
      description:
        "Desde Bielorrusia: Dlina Volny\n\nRitüel for Two (México) - Ana Gartner (Live Set) - Surfer Rosa - Andrea Arias (a.k.a. Zige)",
      banner:
        "https://wild-presenta.com/wp-content/uploads/2023/07/Copia-de-FINAL.jpg",
    },
    {
      type: "event",
      id: 4,
      description:
        'Main (Misa de 12):\n\nPaula Garcés\n\nLaura Villalobos\n\nMartin Arc\n\nBT.MKR\n\n\nAfter (Secret Location) Showcase Pulse Rythm:\nPuerto Moiseline\n\nSpecial Guest:\nMeteo (Cadencia)\n\n\n<iframe style="width: 100%" src="https://www.youtube.com/embed/ctX9y31pW4o" title="EXCLUSIVE 113 PAULA GARCES ¡¡ para ValeraUnderMusic, un set emotivo.no complaciente y exquisito ¡¡¡" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>',
      banner: "https://wild-presenta.com/wp-content/uploads/2024/01/FLYER.jpg",
    },
    // Tickets
    {
      type: "ticket",
      id: 1,
      description: "General Entrance",
      ticketArt:
        "https://wild-presenta.com/wp-content/uploads/2023/07/MITU-ASTRATOURTUNJA19AGOSTO.jpg",
    },
    {
      type: "ticket",
      id: 2,
      description: "General Entrance",
      ticketArt:
        "https://wild-presenta.com/wp-content/uploads/2023/07/Copia-de-FINAL.jpg",
    },
    {
      type: "ticket",
      id: 3,
      description: "General Entrance",
      ticketArt:
        "https://wild-presenta.com/wp-content/uploads/2024/01/FLYER.jpg",
    },
    {
      type: "ticket",
      id: 4,
      description: "General Entrance",
      ticketArt:
        "https://wild-presenta.com/wp-content/uploads/2024/01/FLYER.jpg",
    },
  ],
  events: [
    {
      id: 1,
      organiser: "5Fh3tNPUUKtApDZ6rJ2sDgcC5Z6pVVyAzKeE1dnqowLqWEvw",
      name: "Dua Lipa en Colombia",
      capacity: 24_000n,
      dates: [
        [1710446400000n, 1710475200000n],
        [1710532800000n, 1710561600000n],
        [1710619200000n, 1710648000000n],
      ],
      class: {
        attendancePolicy: {
          type: AttendancePolicyType.Single,
        },
        ticketprice: {
          asset: {
            id: 57,
            code: "COP",
            decimals: 2,
          },
          amount: 600_000_00n,
        },
        ticketRestrictions: {
          cannotResale: false,
          cannotTransfer: false,
        },
      },
      state: EventStatus.Created,
    },
    {
      id: 2,
      organiser: "5Fh3tNPUUKtApDZ6rJ2sDgcC5Z6pVVyAzKeE1dnqowLqWEvw",
      name: "Mitú",
      capacity: 10_000n,
      dates: [[1709762400000n, 1709776800000n]],
      class: {
        attendancePolicy: {
          type: AttendancePolicyType.Single,
        },
        ticketprice: {
          asset: {
            id: 57,
            code: "COP",
            decimals: 2,
          },
          amount: 600_000_00n,
        },
        ticketRestrictions: {
          cannotResale: false,
          cannotTransfer: false,
        },
      },
      state: EventStatus.Sales,
    },
    {
      id: 3,
      organiser: "5Fh3tNPUUKtApDZ6rJ2sDgcC5Z6pVVyAzKeE1dnqowLqWEvw",
      name: "Dlina Volny",
      capacity: 15_000n,
      dates: [[1712345600000n, 1712360000000n]],
      class: {
        attendancePolicy: {
          type: AttendancePolicyType.Unlimited,
        },
        ticketprice: {
          asset: {
            id: 57,
            code: "COP",
            decimals: 2,
          },
          amount: 600_000_00n,
        },
        ticketRestrictions: {
          cannotResale: false,
          cannotTransfer: false,
        },
      },
      state: EventStatus.Ongoing,
    },
    {
      id: 4,
      organiser: "5Fh3tNPUUKtApDZ6rJ2sDgcC5Z6pVVyAzKeE1dnqowLqWEvw",
      name: "Paula Garcés - Laura Villalobos - Martin Arc - BT.MKR",
      capacity: 20000n,
      dates: [[1714937600000n, 1714952000000n]],
      class: {
        attendancePolicy: {
          type: AttendancePolicyType.Multiple,
          max: 3,
        },
        ticketprice: {
          asset: {
            id: 57,
            code: "COP",
            decimals: 2,
          },
          amount: 600_000_00n,
        },
        ticketRestrictions: {
          cannotResale: false,
          cannotTransfer: true,
        },
      },
      state: EventStatus.Finished,
    },
  ],
  tickets: [
    // Event: Dua Lipa en Colombia
    {
      eventId: 1,
      id: 1,
      owner: "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
      attendancePolicy: {
        type: AttendancePolicyType.Single,
      },
    },
    {
      eventId: 1,
      id: 2,
      owner: "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o",
      attendancePolicy: {
        type: AttendancePolicyType.Single,
      },
    },
    // Event: Mitú
    {
      eventId: 2,
      id: 1,
      owner: "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
      attendancePolicy: {
        type: AttendancePolicyType.Single,
      },
    },
    {
      eventId: 2,
      id: 2,
      owner: "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o",
      attendancePolicy: {
        type: AttendancePolicyType.Single,
      },
    },
    // Event: Dlina Volny
    {
      eventId: 3,
      id: 1,
      owner: "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
      attendancePolicy: {
        type: AttendancePolicyType.Unlimited,
      },
    },
    // Event: Paula Garcés - Laura Villalobos - Martin Arc - BT.MKR
    {
      eventId: 4,
      id: 1,
      owner: "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o",
      attendancePolicy: {
        type: AttendancePolicyType.Multiple,
        max: 2,
      },
      restrictions: {
        cannotResale: false,
        cannotTransfer: true,
      },
    },
  ],
} as StubGenesisConfig;
