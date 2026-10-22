# Fixture author notes

Written from `SPEC.md` (rev C, then aligned to the rev C.1 amendments) and `tests/fixtures/README.md` only. Nothing under `src/` was read.

- `verifier/`: 53 fixtures (15 valid, 38 invalid).
- `model/`: 41 fixtures (13 ok, 28 rejected; 7 of the ok ones are `circuitEquals` cases).

## How the fixtures were checked

Before writing, every verifier fixture was run through a small throwaway reference checker of my own reading of 9.7 and 9.1 rule 4. It is kept outside the repo and does not ship. The checker also asserted the geometry:

- every pin anchor lies on the matching outward edge of its own keep-out (not on a corner);
- every segment is axis-aligned and on integer coordinates;
- every expected code appears;
- every valid fixture produces no code at all.

The two deliberately broken geometries (`wire-diagonal`, `wire-off-grid`) were checked by hand. Model fixtures were checked by hand against 6.2, 6.3 and 6.9.

**Policy on several codes.** `expect.errors` lists the codes the spec definitely requires. When one fault also causes a knock-on topology difference (for example a hidden or unattached endpoint), I list only the specific code; the implementation may report `topology-mismatch` as well. I list `topology-mismatch` together with another code only when rev C.1 makes both independently certain (for example a wrongly worded port that also fails to join).

## Changes made for rev C.1

| Fixture | Before | After | Why |
|---|---|---|---|
| `ground-ports-same-text-different-domains-separate` | valid | renamed `ground-ports-same-text-different-domains-two-nets`, `port-mismatch` | 9.7 "Names and kinds": port text must equal the net name, and the nets must be named differently (AGND / DGND), so text "GND" is wrong. Topology is still right, because the domains keep the two apart. |
| `label-joins-power-port-same-text` | valid | renamed `label-on-power-net`, `port-mismatch` + `topology-mismatch` | Virtual nets now key on (symbol class, text, domain), and the symbol class must match the net kind. |
| `power-ports-different-text-not-joined` | `topology-mismatch` | + `port-mismatch` | The "+5V" text does not match net VCC. |
| `ground-ports-different-domains-one-net` | `topology-mismatch` | + `port-mismatch` | The domain marks do not match the net's domain (none). |
| `port-on-wire-interior-split` | net unnamed | net named TAP | Keeps `port-off-wire` as the only possible fault, now that a label on an unnamed net is itself invalid. |
| `group-endpoint-at-representative-pin` and other IC fixtures | | unchanged | They stay valid under the "in a net means as written" rule. Pin 9 is listed last in `pinDefs`, so definition order and code-point order both pick the wrong pin. |

New verifier fixtures for the rev C.1 rows:

- `pin-contact-abutting-parts`
- `wire-diagonal`
- `wire-off-grid`
- `nc-mark-on-connected-pin`
- `unconnected-pin-with-wire`
- `single-endpoint-net-unconnected-pin` (valid)
- `port-on-unnamed-net`
- `supply-port-text-mismatch` (the spec's own "5V net drawn with 3V3 symbols" example)
- `ground-net-drawn-with-supply-symbols`
- `ground-port-domain-mismatch`
- `ground-ports-two-domains-matching-nets` (valid)
- `wire-along-keepout-boundary` (closed boxes)
- `group-representative-skips-nc-member` (valid)
- `group-drawn-at-nc-member`

New model fixtures:

- `group-endpoint-all-members-nc` (E225)
- `set-no-connect-on-last-group-member` (E225 raised by an edit)

## Ambiguities and contradictions, and how I decided

1. **Same text, different domains (13 item 2 vs 6.3 invariant 3 vs 9.7 rev C.1).** Item 13.2 asks for "two ports with the same name in different domains". But net names must be unique (6.3 inv. 3), and rev C.1 requires port text = net name. So a *valid* drawing of two nets whose ports show the same text cannot exist. I turned the requested valid case into `ground-ports-same-text-different-domains-two-nets`. Its topology is right but it is a `port-mismatch`. I added `ground-ports-two-domains-matching-nets` as the valid two-domain case. If the owner wants the "same text" case to be valid, invariant 3 has to become "unique per (name, domain)".

2. **9.7 still contradicts itself on drawn unconnected pins.** The "Expected inventory" bullet still says "terminals in no net that are drawn must have nothing attached (**warning, not invalid**)". The rev C.1 row says the same situation is **invalid**. I followed the rev C.1 row (`unconnected-pin-with-wire` expects `unconnected-attached`). The old bullet should be updated.

3. **Hidden members of a connected group (6.2 rev C.1 vs 9.7).** By the new 6.2 definition, a member of a group that is written as a group endpoint *is* "in a net". 9.7 says "every hidden pin must be in no net". Yet 6.2 also says such a member "is simply hidden". I followed 6.2: hiding non-representative members is valid, and several valid fixtures depend on it. To stay out of the conflict, no fixture hides a group's *representative*. Where the representative is wrong, it is drawn but left unattached, so only `missing-endpoint` applies.

4. **Natural vs code-point order for the representative.** 6.2 says "lowest pin number in natural order", and rev C.1 says "lowest-numbered member". I read both as natural order (9 < 14 < 29), as in 9.6. Fixtures: `group-endpoint-at-representative-pin` and `group-endpoint-at-lexicographic-lowest-pin`.

5. **Invariant 2 on classes vs NC on a group member.** Rev C.1 says equivalence classes are used for invariants 1-2. Read literally, an NC member of a connected group then violates invariant 2. 6.3 explicitly allows exactly that. I let the specific rule win: `nc-on-group-member-while-group-connected` is ok.

6. **Which code for an NC mark on a pin that is not in `circuit.nc`?** Rev C.1 adds the row "no-connect mark on a pin with anything attached: invalid", but the README has no dedicated code. I used `nc-attached` (`nc-mark-on-connected-pin`). *Less sure.*

7. **"Lowest id" (6.3 rule 5).** Ids are strings such as `n9` and `n10`, and the spec does not say numeric or code-point. I avoided the question: `merge-unnamed-nets-lowest-id-survives` uses `n3` vs `n7`, where both orders agree. The spec should say "lowest numeric suffix" or similar.

8. **Rule order when several merge rules fail.** connect between `5V` and `+5V` breaks rule 3 and rule 4. "Rules, in this order" suggests the first failing rule decides, so `connect-named-power-nets` expects E232 (E233 may also be reported).

9. **`connect` with a group member whose group is already in a net.** Example: `U1{GND}` is in n1, then `connect U1[14] R2[1]`. This could be E222, or a join of R2[1] into n1 (classes, 6.2). It is not specified, so there is no fixture.

10. **Rule 6 when the survivor is a named signal net.** "Kind: power or ground if any merged net has it" would turn named signal net SIG into kind power when it absorbs an unnamed power net. I did not fixture this odd literal case; `merge-signal-with-power-kind-power` uses a named power survivor instead.

11. **Group and its own member in the same net** (`U1{GND}` and `U1[14]` both in n1). Invariant 1 allows it, 6.2 does not mention it. No fixture.

12. **Label in the middle of a wire.** 9.7 allows port and label anchors only "on a conductor end or pin anchor". After normalisation, a split point inside a straight run is not an end, so `port-on-wire-interior-split` expects `port-off-wire`. This is stricter than common practice (KiCad lets labels sit anywhere on a wire). *Less sure that this is intended.*

13. **Port on a bend.** A bend is the end of two maximal conductors, so by the letter of the spec a port there connects. No fixture.

14. **Default ground visible text.** 9.2 step 3 says the default ground "shows only the symbol", so there is no visible text. The render model and the name-matching rule need a text, so fixtures use `text: "GND"` with no domain. The spec should say what the render model records for a text-less symbol.

15. **Port keep-outs and label envelopes (9.1 rule 4 rev C.1).** These are forbidden geometry, but the README render format only has part keep-outs, so they cannot be tested here. The 7.1 loader check is about symbols, not render models, so it is not testable either. Every fixture pin satisfies it: anchor on the boundary, approach point strictly outside.

16. **`expect.equal` shape.** The README wording allows two readings. I used `"expect": {"ok": true, "errors": [], "equal": {"circuitB": {...}, "equal": true|false}}`, with `pinDefsB` omitted because the pin definitions are the same.

17. **Floating-point quantities (6.9).** `equals-capacitor-100n-vs-0u1` expects *equal*. Naive doubles give `100*1e-9 = 1.0000000000000001e-07` but `0.1*1e-6 = 1e-07`. The spec says "compared as numbers in base units", which I take to mean mathematically equal. The implementation needs exact decimal handling or a tolerance. *Deliberate trap.*

18. **Kind defaults by name.** "Names such as GND, VCC ..." is not an exhaustive list. Fixtures rely on defaults only for names the spec lists (GND, VCC, 3V3) and give `kind` explicitly everywhere else.

19. **Intentional format breaks.** `wire-diagonal` and `wire-off-grid` break the README's "integer, axis-aligned" render format on purpose, because rev C.1 asks for exactly those checks. They carry no keep-outs, so only `non-orthogonal` is in play.

20. **Side-entry and pass-through fixtures have no keep-outs.** Under the closed-box rule, the wrong-direction last edge would also run on the part's keep-out boundary, which would add `wire-in-keepout` and blur the case. `own-pin-reached-through-body` is the fixture that tests both faults together.

21. **Pin contact.** The spec does not say whether coincident anchors also *connect*. Only `pin-contact` is required.

## Fixtures I am less than sure about

| Fixture | Doubt |
|---|---|
| `port-on-wire-interior-split` | The strict reading of "conductor end" (item 12 above). |
| `nc-mark-on-connected-pin` | The error code choice (item 6). |
| `ground-ports-same-text-different-domains-two-nets` | Rests on resolving item 1 against the "valid" reading of 13 item 2. |
| `group-member-wired-to-foreign-net` | Assumes the comparison expands drawn members to their class (9.7 "after expanding groups to their equivalence classes"), so pin 29 on a VCC port shorts GND to VCC. |
| `group-member-written-drawn-at-member` | Assumes hidden pins 9 and 14 are fine when only U1[29] is written (item 3). |
| `equals-capacitor-100n-vs-0u1` | Right by the spec's intent, but it will fail any float `===` implementation (item 17). |
| `merge-domain-adopted-by-survivor` | Literal rule 6: the named survivor takes the other net's domain. |
| `connect-named-power-nets` | E232 rather than E233 (item 8). |
| `name-resolves-to-group-named-differently` | `U4.GND` resolving to `U4{gnd}` (pin name GND, group name gnd, as in the 7.3 example). |
