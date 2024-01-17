# Ticketto Protocol

The protocol defines two _"pallets"_: `events`, and `tickets`.

An event is a collection of non-fungible items, typically owned by an account representing the event organiser. A ticket is an instance of an item in the event collection.

## Events Pallet

### Overview

Handles the creation and management of events. It implies allowing the following operations:

- Create an event, owned by the account that created it.
- Set relevant properties of an event:
  - Define and change the dates of an event.
  - Increase the capacity of an event.
- Set event metadata (i.e. description, promotional images, etc.).
- Define a ticket class.

### Terminology

- Event 

### 