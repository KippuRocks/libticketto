import { LineItem } from "./product.js";
import { Ticket } from "./tickets.js";

export type Order = {
  lineItems: LineItem[];
  products: Ticket[];
};
