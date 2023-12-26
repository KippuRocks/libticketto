import type { LineItem } from "./product.d.ts";

export type Ticket = {
  id: string;
  eventId: string;
  name: string;
  description: string;
  image: string | URL;
  lineItems: Record<string, LineItem>;
  attendances: EpochTimeStamp[];
};
