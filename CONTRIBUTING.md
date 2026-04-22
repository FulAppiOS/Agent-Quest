# Contributing to Agent Quest

Thanks for your interest — issues and pull requests are very welcome.

## Ways to help

- **Bug reports** — open an issue with steps to reproduce, your OS, and your Bun version (`bun --version`).
- **Feature ideas** — open an issue and describe the use case; small proposals are easier to merge than big ones.
- **Pull requests** — fixes, new building sprites, extra hero classes, map editor improvements, platform polish.
- **Art & themes** — compatible pixel-art tilesets / sprite packs (CC0 or similarly permissive) are especially welcome.

## Development setup

```bash
git clone https://github.com/FulAppiOS/agent-quest.git
cd agent-quest
bun install
bun start
```

Open <http://localhost:4445>. See the [README](README.md) for the full architecture overview and env vars.

## Before opening a PR

- Keep TypeScript strict — no `any`.
- Code and identifiers in English.
- Commit messages follow conventional style: `feat:`, `fix:`, `refactor:`, `docs:`, etc.
- Run `cd server && bun test` if you touched server code.
- If you change UI, include a screenshot or short clip in the PR description.

## Licensing

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE) that covers the project.
