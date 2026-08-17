# Home Lab App Shell

This is the main App Shell launcher for the homelab.

## Launch

```bash
cd app-shell
docker compose up -d
```

## Runtime config

- `HOME_LAB_DIR`
- `APP_SHELL_PORT`

`HOME_LAB_DIR` points at the directory containing the hand-edited
[app-shell.config.json](/Users/davsantos/github/misc/home-lab/app-shell/app-shell.config.json)
file. The container mounts that file directly and serves it through the App Shell
runtime.

The shell serves the app at `/` and the configuration view at `/apps`.
