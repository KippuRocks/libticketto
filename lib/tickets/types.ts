import { EventDate, EventPrice } from "../events/types";

export type Ticket = {
  id: string;
  name: string;
  description: string;
  image: string | URL;
  dates: EventDate[];
  price: EventPrice;
};
