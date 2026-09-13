# ADR-0002: permissões macOS (Accessibility + Screen Recording)

Data: 2026-09-13
Status: aceito

## Contexto

Teste com Codex Computer Use no macOS 26.6.2 mostrou o fluxo real (ver `screenshots/accessibility.png` e `screenshots/screen_system_audio_recording.png`): sem as permissões, nada funciona. Com elas ligadas, o Codex passa a "streamar" a tela em runtime — captura contínua, não só um screenshot por turno.

No screenshot, `Terminal` já está liberado em Accessibility; as entradas `Codex Computer Use` e `ChatGPT` aparecem desligadas.

## Decisão

Nosso harness macOS exige as mesmas duas portas do TCC:

- **Accessibility** (`Allow the applications below to control your computer`) — para injetar mouse/teclado via CGEvent. Sem isso, `click/type/key/drag/scroll` são silenciosamente ignorados.
- **Screen & System Audio Recording** (`Allow ... to record the content of your screen`) — para captura. Áudio do sistema é opcional para o MVP; só tela importa. `System Audio Recording Only` fica desligado.

## Consequências

- Onboarding precisa checar e guiar: `AXIsProcessTrusted()`, `CGPreflightScreenCaptureAccess()` / `CGRequestScreenCaptureAccess()`, e deep-link para `System Settings > Privacy & Security`. Sem isso o agent loop falha sem erro claro.
- Cada binário assinado vira uma entrada no TCC (por isso `Codex Computer Use` aparece separado do `Terminal`). Nosso binário vai aparecer com o próprio nome — documentar.
- MVP começa com screenshot-por-turno (`screencapture` / ScreenCaptureKit one-shot); streaming contínuo (SCStream, como o Codex faz) vira otimização de latência depois.
- `screenshots/*.png` ficam como referência visual do onboarding.
