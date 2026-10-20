# Vendored dependency provenance

## The Midgard package graph

The `@al-ft/*` packages are not published to a registry, so the backend
installs tarballs packed from one Midgard commit. Every package self-reports
version `0.1.0` and carries no `gitHead`, so this record and
`vendor/midgard/manifest.json` are what identify the code.

| | |
|---|---|
| Commit | `f4cf28ca100e99f5bc07c7b1ed6e9b936062a44d` |
| Deployment profile | `preprod-testing`, compiled into core (`SELECTED_DEPLOYMENT_PROFILE`) |
| Consensus profile digest | `1cef7f991e87ff6220159def5be8deb3ba5be512ad5944586b65f0ed180b196c` |
| Built with | Node 22.22.2, pnpm 11.18.0, `pnpm install --frozen-lockfile` |
| Lucid | `@lucid-evolution/lucid` 0.8.0, utils 0.2.0, plutus 0.2.0, core-types 0.5.0 |
| Command | `scripts/vendor-midgard.sh f4cf28ca100e99f5bc07c7b1ed6e9b936062a44d preprod-testing` |

### Why this commit

It is the **tested compatibility revision**, not the proven source revision of
the running node. On 2026-10-19, scratch builds were tested read-only against
the live Preprod deployment (manifest `c3d841f2e75d61e90a394f36789ea79d67bfac7801aed325ca552dfb5b8fbfbb`):

- Built at this commit, core's `verifyDeploymentManifestIdentity` accepts the
  live manifest. Its codec decodes the live transaction, recomputes its stored
  ID, and decodes the live out-ref, output and withdrawal.
- Built at `b9511834c`, the verifier rejects the same manifest:
  "consensusProfile must exactly match canonical V1". The one difference is
  `limits.maxCekBuiltinTag`, 86 in the deployment and 100 from Midgard
  `31e5caf43`. The codec results are the same as at this commit.
- The node image carries no revision label. Its `/protocol-info` reports a
  consensus profile equal to this commit's, which identifies the profile, not
  the commit the binary was built from.

Each check used the one sample the deployment held. No deposit body, forced
transaction or script-bearing transaction was available.

### Files

| File | sha256 |
|---|---|
| `midgard/al-ft-l1-node-transport-0.1.0.tgz` | `13c36bd10769c7c70962ddf3f2e4a1e62d64207eb95850ef6fcf106cad1f0b45` |
| `midgard/al-ft-lucid-midgard-0.1.0.tgz` | `ee74cdbcaa0ff3d0a832d27687d5880cd6c4c7de5af95aedf56ff5b75674ab0b` |
| `midgard/al-ft-midgard-core-0.1.0.tgz` | `2e7410c00029bda04c00080841f722996672644b0b96d67cf5655fe5f5c517e9` |
| `midgard/al-ft-midgard-fault-proofs-0.1.0.tgz` | `3c702726f2337e2ba42293f2fc653a4418f2eb37124693f6b4bcac2a42d1997e` |
| `midgard/al-ft-midgard-l1-follower-0.1.0.tgz` | `c0c478afd17c6d5ab4c22d30c8169d7d0a0203714933c33afbe44e456c3006ff` |
| `midgard/al-ft-midgard-sdk-0.1.0.tgz` | `aff103696ffdb2365dacc48a6e491bcc72df8200495fb22ab4c4a9adfc3f05b1` |
| `midgard/al-ft-midgard-validation-0.1.0.tgz` | `32c8580f39a3d0375266d7375853ada3669de47af5adffa09de88643149352c4` |
| `midgard/midgard-watcher-0.1.0.tgz` | `41c894455e2a3c3f5ff852d57c86901b0363d2678b54852b92d9915cf9dd8cb5` |
| `midgard/mpf-1.3.1-midgard.1.tgz` | `dfb0cba54a26e14b4ec134eb8f1b8cfd331663568f574d8ce93821b03e855ff8` |
| `midgard/patches/@lucid-evolution__utils@0.2.0.patch` | `73149416d552756c6593e20a600a2778a3148fe76a4607c07c0fa25561cf7dfa` |

The MPF tarball and the Lucid utils patch are copied from Midgard's own
workspace at the same commit, as are the overrides in `pnpm-workspace.yaml`
(UPLC 2 under Lucid utils 0.2.0, the libsodium pin). `pnpm verify:vendor`
checks every checksum above against the files and this record.

The backend depends directly on core and the SDK. The other packages are
vendored at the same commit and resolve through the overrides when a later
change depends on them.

Midgard is Apache-2.0. Its root `LICENSE` and `NOTICE` cover the packages
above, which carry no license file of their own, so `midgard/LICENSE` and
`midgard/NOTICE` are copied from the same commit. The MPF tarball carries its
own license (MPL-2.0).

### Rebuilding

The committed tarballs are the artifacts: they are pinned by the checksums
above, not by the claim that a rebuild reproduces them. A rebuild of this
commit gives byte-identical tarballs for core, the transport, validation and
lucid-midgard. For the SDK, fault-proofs, the L1 follower and the watcher it
does not: the import order of one bundled module differs, and so does the key
order of the `devDependencies` that `pnpm pack` rewrites. Import order can
change the order in which modules run, so a rebuilt tarball is not assumed to
behave like the committed one.

The script removes each package's `dist/.contrib-build-v1.json` before packing.
It is Midgard's local build receipt: the absolute build directory and a random
run ID. No packaged code reads it.

### Node 24

The transport and the watcher declare `engines` `>=22.16.0 <23`. The backend
runs Node 24. Imports succeeding does not show the packages work there, so
Node 24 support stays unproven until a decode and a libp2p fetch have run under
Node 24.
