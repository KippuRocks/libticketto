---
"@ticketto/profile-v0": minor
---

Plan §5.7 rulings (T-003-04): domain-separated signing payloads — `Profile.encodeCommand` and `Profile.encodePass` now return `"ticketto/v0/command" ‖ command bytes` and `"ticketto/v0/pass" ‖ pass bytes` (`commandSigningPayload`, `passSigningPayload`); a `pass-webauthn` registration's challenge must be `BLAKE2b-256("ticketto/v0/registration" ‖ account)` (`registrationChallenge`); assertions must carry the user-present flag. Adds the canonical signed input framing: `encodeSignedCommand`/`decodeSignedCommand` and `encodeSignedAccessPass`/`decodeSignedAccessPass`. Regenerates `vectors/v0.json`.
