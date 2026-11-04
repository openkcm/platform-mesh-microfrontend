[![REUSE status](https://api.reuse.software/badge/github.com/openkcm/platform-mesh-microfrontend)](https://api.reuse.software/info/github.com/openkcm/platform-mesh-microfrontend)

## About this project

OpenKCM MicroFrontend for [Platform Mesh](https://platform-mesh.io/) Dashboard. MicroFrontend facilitates Key Chain Management directly in the Platform Mesh Dashboard.

## Repository layout

| Path | Content |
|---|---|
| `ui/` | The UI: Vite, React and UI5 Web Components. The portal loads it as a Luigi micro frontend in an iframe. It reads and writes the `operations.openkcm.io` resources through the portal's GraphQL gateway. |
| `charts/platform-mesh-ui/` | Helm chart: the nginx deployment, the ingress, and the content file `pm-content.json` that the portal loads. |
| `Dockerfile.ui` | The image of the UI. It is built from the repository root. |

The UI and the chart were imported from [apeirora/showroom-msp-openkcm](https://github.com/apeirora/showroom-msp-openkcm) at release 0.17.6 (commit `0c27ba0`).

## Development

```sh
cd ui
npm ci
npm test            # unit tests
npm run build       # type-check and production build
npm run dev         # local dev server

helm lint charts/platform-mesh-ui
```

## Release

The release uses the shared workflows of `openkcm/build`. Every push to `main` keeps a release PR open. It bumps the chart version, `appVersion` and `image.tag` (the lines marked `x-release-please-version`); merging it pushes the chart `platform-mesh-ui` to `oci://ghcr.io/openkcm/charts` and creates the tag `vX.Y.Z`. The tag builds the image from `Dockerfile.ui` and pushes it to `ghcr.io/openkcm/images/platform-mesh-microfrontend:vX.Y.Z`.

## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/openkcm/platform-mesh-microfrontend/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Security / Disclosure
If you find any bug that may be a security problem, please follow our instructions at [in our security policy](https://github.com/openkcm/platform-mesh-microfrontend/security/policy) on how to report it. Please do not create GitHub issues for security-related doubts or problems.

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](https://github.com/openkcm/.github/blob/main/CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright (20xx-)20xx SAP SE or an SAP affiliate company and OpenKCM contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/openkcm/platform-mesh-microfrontend).


## Code of Conduct

To facilitate a nice environment for all, check out our [Code of Conduct](https://github.com/openkcm/.github/blob/main/CODE_OF_CONDUCT.md).

<p align="center"><img alt="Bundesministerium für Wirtschaft und Energie (BMWE)-EU funding logo" src="https://apeirora.eu/assets/img/BMWK-EU.png" width="400"/></p>
