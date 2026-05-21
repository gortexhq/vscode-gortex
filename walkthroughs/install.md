# Install the Gortex CLI

This extension talks to the `gortex` binary on your machine — it doesn't ship
the engine itself. That keeps the extension small and lets you update Gortex on
your own cadence.

## macOS / Linux

```sh
brew install zzet/tap/gortex
```

or, if you'd rather not use Homebrew:

```sh
curl -fsSL https://get.gortex.dev | sh
```

## Windows

In PowerShell:

```powershell
irm https://get.gortex.dev/install.ps1 | iex
```

## Verify

```sh
gortex version
```

You should see something like `gortex v0.31.0` — any version `v0.28.0` or
newer is fine for this extension.

If `gortex` isn't on your `PATH`, set the **`gortex.binaryPath`** setting to
the absolute path of the binary.
