import type { AccountId, EventId, Ticket, TicketId } from "@ticketto/types";

/**
 * A list of possible transactions to interact with tickets.
 */
export interface TicketsCalls {
  /**
   * Issues a new ticket for attending an event.
   * @param issuer The {@link AccountId} associated to the event that issues the ticket.
   * @param ticket The details of the ticket to be created
   * @param forSale Whether to mark the ticket as for sale (so it can be immediately bought)
   * @param beneficiary An optional {@link AccountId} for who is going to receive the ticket
   * @returns The {@link TicketId} of the newly created ticket
   * @throws When the signer of the request is not the owner, or the items issuer in the protocol.
   */
  issue(
    issuer: EventId,
    ticket: Omit<Ticket, "issuer" | "id">,
    forSale?: boolean,
    beneficiary?: AccountId
  ): Promise<TicketId>;

  /**
   * Transfers the ticket to a different holder.
   * @param issuer The {@link EventId} of the event that issued the ticket to be transferred
   * @param id The {@link TicketId} of the ticket to be transferred
   * @param beneficiary The {@link AccountId} that will receive the ticket
   * @throws An error if the signer of the command is not the owner of the ticket, or if
   * there's a restriction to transfer tickets.
   */
  transfer(
    issuer: EventId,
    id: TicketId,
    beneficiary: AccountId
  ): Promise<void>;

  /**
   * Sets the ticket as for sale (if possible).
   * @param issuer The {@link EventId} of the event that issued the ticket to be transferred
   * @param id The {@link TicketId} of the ticket to be transferred
   * @param receiver The {@link AccountId} that will receive the ticket
   * @throws An error if the signer of the command is not the owner of the ticket, or if
   * there's a restriction to resell tickets.
   */
  sell(issuer: EventId, id: TicketId, receiver: AccountId): Promise<void>;

  /**
   * Cancels the sale of the ticket.
   * @param issuer The {@link EventId} of the event that issued the ticket to be transferred
   * @param id The {@link TicketId} of the ticket to be transferred
   * @throws An error if the signer of the command is not the owner of the ticket.
   */
  withdrawSell(issuer: EventId, id: TicketId): Promise<void>;

  /**
   * Buys a ticket that is set for sale.
   * @param issuer The {@link EventId} of the event that issued the ticket to be bought
   * @param id The {@link TicketId} of the ticket to be bought
   * @throws An error if the signer of the command doesn't have enough funds to buy
   * it.
   */
  buy(issuer: EventId, id: TicketId): Promise<void>;
}
