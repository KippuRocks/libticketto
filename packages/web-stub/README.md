# Libticketto: Stub Web

This library implements [The Ticketto Protocol][gh:ticketto], based on an in-memory (design goal, use
dedicated storage, like the [IndexedDB][mdn:indexedDB] API).

## Usage

First, make sure your client supports [IndexedDB][mdn:indexedDB].

Then, before starting the application (at the entrypoint), import `reflect-metadata`:

```ts
import 'reflect-metadata';
```

### Setting up the `WebStub` consumer

1. Define the configuration. Consider that your stub `AccountProvider` must return the actual `AccountId` associated to the
   account logged-in on your application. Also, the signer must receive a `Uint8Array`, and return a `Promise<Uint8Array>`
   that contains the signed transaction. For local testing purposes, we can use this demo:

```ts
// src/config.ts
import { ClientConfig } from '@ticketto/protocol';

export const defaultConfig: ClientConfig<Uint8Array> = {
  accountProvider: {
    getAccountId: () => "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
    sign: (payload: Uint8Array) => Promise.resolve(payload),
  },
};
```

2. Initialize the ticketto client, passing the `TickettoWebStubConsumer` as well as the config.

```ts
// src/index.ts
import { TickettoClientBuilder } from '@ticketto/protocol';
import { TickettoWebStubConsumer } from '@ticketto/web-stub';
import { defaultConfig } from './config.ts'

const client = await new TickettoClientBuilder()
  .withConsumer(TickettoWebStubConsumer)
  .withConfig(defaultConfig)
  .build();
```

3. Enjoy!

```ts

// Example of the client validating and submitting the contents of an attendance QR (let's call it `input`).

/** A base-64 encoded input representing the call */
const input: string = await readQrCode();
await client.attendances.calls.submit(input);
```

[gh:ticketto]: https://github.com/kippurocks/ticketto/blob/main/PROTOCOL.md
[mdn:indexedDB]: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
