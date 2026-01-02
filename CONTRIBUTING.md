# Contributing to Pulumix

Thanks for helping make Pulumix better. This guide covers how to set up the
repo, propose changes, and submit pull requests.

## Code of Conduct

By participating, you agree to follow the project's Code of Conduct. Please
report unacceptable behavior to the maintainers.

## Getting Started

```bash
git clone https://github.com/yourorg/pulumix.git
cd pulumix

mise trust
mise install
mise run setup
```

## Development Workflow

- Create a new branch from `main` for each change.
- Keep changes focused and scoped to a single purpose.
- Add or update tests when behavior changes.
- Update documentation when you add or change user-facing behavior.

Useful commands:

```bash
mise run build
mise run test
mise run lint
```

## Pull Requests

Please include:

- A clear description of the problem and solution.
- Links to related issues or discussions when applicable.
- Screenshots or logs if the change affects UI or CLI output.

## Release Notes

For user-visible changes, add an entry to the relevant package changelog in
`packages/*/CHANGELOG.md`.
