# Changing the search order at run time: `config.*`

Use these when the **user** asks you to change how searches are routed: put a source first or last, switch one off, trust one source less, change the backends a platform tries, or add a command-line tool as a source. Do not use them on your own initiative to "improve" results.

The user's configuration (the profile) is the baseline. `config.*` writes a separate **overlay** on top of it. It applies at once to the next call, the user sees every change in the settings card ("Agent changes", with your reason and the time) and can adopt it into their configuration or revoke it. You cannot touch keys, paths, budgets or switches this way, and nothing you write deletes a baseline entry.

## The order of work

1. `config.inspect`: what is in force, which entries come from the overlay, the `revision`, the recent audit trail, and settings waiting for a plugin restart (`待重启`).
2. Make one change with a real `reason` (3-300 characters, what the user asked and why). Pass `expectedRevision` from the inspect so a change made meanwhile (by the user in the card) is not overwritten.
3. Tell the user what changed and that they can revoke it in the settings card.

```json call
{"action":"config.inspect","args":{}}
```

```json call
{"action":"config.set_order","args":{"engines":["bing","ddg","exa"],"reason":"The user asked to try bing before ddg for Chinese queries","expectedRevision":0}}
```

## The actions

- `config.set_order {engines?, priority?, disabled?, platform?, backends?}`: each list **replaces** the list in force (give the whole list). `platform` and `backends` go together: the whole backend chain of that platform. A custom CLI is written `custom-cli:<id>`. To stop using a source put it in `disabled`.
- `config.set_confidence {id, value}`: 0..1, slightly lowers a source's weight when results are fused (1 = no change). Omit `value` to drop the overlay's entry.
- `config.upsert_cli {id, spec}`: add or replace a custom CLI source. **It always asks the user first** (it lets the plugin run a local program; the prompt shows the command and argument templates). With no one to ask (a headless run) it is refused: tell the user instead. The spec must pass the same read-only checks as in the card (no login or write commands, no cookie or credential flags, no secrets). Try the spec's command yourself first only if the user asked you to; `sources.deps` shows whether the tool is installed.
- `config.remove_cli {id}`: only a CLI the overlay added, and not while the overlay still names it in an order list. A CLI from the configuration is switched off with `config.set_order {disabled:[...,"custom-cli:<id>"]}`.
- `config.reset {scope, id?}`: `all`, `order` (engines, priority, disabled), `confidence`, `cli`, `platform`; `id` narrows the last three to one entry. `reset all` also repairs an overlay file that could not be read.
- `config.export`: the settings in force as YAML. Show it to the user if they want to keep the change in their configuration.

## Errors

- `INVALID_ARGS`: the message names the id or value the validators refused. Nothing was written.
- `ACTION_FAILED` with "revision N, not M": someone changed the overlay since you read it. `config.inspect` again and decide again.
- `CAPABILITY_UNAVAILABLE`: the overlay file is unreadable or no longer agrees with the configuration and is being ignored as a whole (the configuration applies as written). Ask the user, or `config.reset {scope:"all"}` if they agree.
- `POLICY_DENIED`: the browser plugin's `automationMode` is read-only, or the user refused. Do not retry; ask the user.
- Settings marked `待重启` in `config.inspect` / `sources.status` (`toolSurface`, `dbPath`, `registerProvider`, `providerId`, `timeoutMs`, `memoryCacheEntries`, `verbose`, `playwright.snapshotDir`) only take effect after the plugin restarts; tell the user, you cannot change them anyway.
