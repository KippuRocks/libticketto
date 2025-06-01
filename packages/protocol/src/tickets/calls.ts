import type { AccountId, EventId, TicketId } from "@ticketto/types";

/**
 * A list of possible transactions to interact with tickets.
 */
export interface TicketsCalls {
  /**
   * Executes a permissionless issuance for a new ticket for attending an event.
   * @param issuer The {@link AccountId} associated to the event that issues the ticket.
   * @returns The {@link TicketId} of the newly created ticket
   * @throws When the amount of issued ticket exceeds the event capacity.
   */
  issue(issuer: EventId): Promise<TicketId>;

  /**
   * Updates the information of an event call to mark an attendance to an event with a valid ticket.
   *
   * @param input A signed call to mark the attendance.
   * @returns A confirmation that the attendance was marked successfully.
   * @throws An error in case the attendance is not valid.
   */
  submitAttendanceCall(input: Uint8Array): Promise<void>;

  /**
   * Creates a deferred transfer of the ticket to a different holder. This creates a pending
   * transfer state, where the beneficiary can accept the transfer, or either the initial owner or
   * the beneficiary of the ticket can cancel the transfer.
   *
   * This intermediate state is closed once one of the two aforementioned actions is executed.
   *
   * @param issuer The {@link EventId} of the event that issued the ticket to be transferred
   * @param id The {@link TicketId} of the ticket to be transferred
   * @param beneficiary The {@link AccountId} that will receive the ticket
   * @throws An error if the signer of the command is not the owner of the ticket, or if
   * there's a restriction to transfer tickets.
   */
  initiatePendingTransfer(
    eventId: EventId,
    id: TicketId,
    beneficiary: AccountId
  ): Promise<void>;

  /**
   * Accepts the transfer of a ticket.
   * @param issuer The {@link EventId} of the event that issued the ticket to be transferred
   * @param id The {@link TicketId} of the ticket to be transferred
   * @throws An error if the signer of the command is not the beneficiary of the ticket.
   */
  acceptPendingTransfer(eventId: EventId, id: TicketId): Promise<void>;

  /**
   * Accepts the transfer of a ticket.
   * @param issuer The {@link EventId} of the event that issued the ticket to be transferred
   * @param id The {@link TicketId} of the ticket to be transferred
   * @throws An error if the signer of the command is not the initial owner or the beneficiary of
   * the transfer.
   */
  cancelPendingTransfer(eventId: EventId, id: TicketId): Promise<void>;

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
