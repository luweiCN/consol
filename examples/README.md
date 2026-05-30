# examples

End-to-end fixtures and demo projects will live here.

The first example should be a minimal Foundry Counter project used to validate:

- `consol detect`
- `consol build`
- `consol inspect Counter`
- `consol chain start`
- `consol deploy Counter`
- `consol call Counter number`
- `consol send Counter setNumber 42`
- `consol state Counter`

The second example should be a standalone `Counter.sol` file used to validate single-file mode:

- `consol detect ./Counter.sol`
- `consol build ./Counter.sol`
- `consol inspect ./Counter.sol:Counter`
- `consol deploy ./Counter.sol:Counter`
- `consol call ./Counter.sol:Counter number`

The single-file example must verify that ConSol uses a scratch Foundry project and does not write `.consol/` beside the source file by default.
