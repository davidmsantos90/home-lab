# Home Lab App Shell

This is the main App Shell launcher for the homelab.

## Launch

```bash
cd app-shell
docker compose up -d
```

## Runtime config

- `SERVICE`
- `SERVICEPORT`
- `HOME_LAB_DIR`

`HOME_LAB_DIR` points at the directory containing the hand-edited
`app-shell.config.json` file. The container mounts that file directly at
`/config/app-shell.config.json` and the generated App Shell script injects it at
runtime. That file is external to the repo and should be created by hand.

The shell is published on `0.0.0.0:${SERVICEPORT}` and serves the app at `/`.
