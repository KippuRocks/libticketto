import { LineItem } from "./product.ts";
import { Ticket } from "./tickets.ts";

export type Order = {
  lineItems: LineItem[];
  products: Ticket[];
};
