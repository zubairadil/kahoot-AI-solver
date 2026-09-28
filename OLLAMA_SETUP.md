# Ollama Setup for the Chrome Extension

The extension communicates with the local Ollama server on port `11434`.

If you see an error similar to:

> bind: Only one usage of each socket address...

Ollama is probably already running in the background and using port `11434`.

## 1. Stop the active Ollama instance

Quit Ollama from the Windows system tray.

Alternatively, open Command Prompt and run:

```cmd
taskkill /f /im ollama.exe
```

## 2. Start Ollama with CORS enabled

In Windows Command Prompt, run:

```cmd
set OLLAMA_ORIGINS=* && ollama serve
```

Do not put quotes around `*` in Windows Command Prompt.

Use:

```cmd
set OLLAMA_ORIGINS=*
```

not:

```cmd
set OLLAMA_ORIGINS="*"
```

## 3. Set OLLAMA_ORIGINS permanently (optional)

1. Press `Win + R`.
2. Enter `sysdm.cpl` and press Enter.
3. Open **Advanced** → **Environment Variables**.
4. Under **User variables**, create:
   - Variable name: `OLLAMA_ORIGINS`
   - Variable value: `*`
5. Click **OK**.
6. Restart Windows, or quit Ollama from the system tray and open it again.
