# Ticketto types

A collection of some types the ticketto protocol uses.

## Usage

This library describes the different types used across the _Ticketto_ protocol specification. We divided this library into several modules:

- [**Account**](./account.ts): Contains the definitions of accounts; accounts identify the actors across the protocol: holders, issuers, and escrow either publicly, privately on applications (like Kippu), or anonymously.
- [**Events**](./events.ts): Contains the definition of an event and information that helps to understand how to issue tickets.
- [**Issuer**](./issuer.ts): Contains definitions about accounts that can create new ticket instances based on an existing event.
- [**Orders**](./orders.ts): Contains definitions about a sale/resale order.
- [**Primitives**](./primitives.ts): Contains standard primitive definitions of data used on other modules.
- [**Products**](./products.ts): Contain generic definitions of products to allow wrapping tickets into commerce APIs.
- [**Storage**](./storage.ts): 
- [**Tickets**](./tickets.ts): 

## Development

Install via NPM package
Our NPM package including all supported languages can be installed with NPM or Yarn:

```sh
npm install @ticketto/types
# or
yarn add @ticketto/types
```

Alternatively, you can build the NPM package from source.

### Build from Source

The [current source code](https://github.com/kippurocks/ticketto) is always available on GitHub.

```sh
npm -w 
```

See our building documentation for more information.



## License

Ticketto is released under the BSD License. See our LICENSE file for details.

