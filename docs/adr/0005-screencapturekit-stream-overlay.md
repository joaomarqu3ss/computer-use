# ADR-0005: captura contínua via ScreenCaptureKit + overlay fantasma

Data: 2026-09-16
Status: aceito

## Contexto

O grill da feature de transparência (cursor fantasma + halo + indicador de operação, referência Codex/Claude Code) mostrou dois fatos: o modelo atual de captura por foto única (`CGDisplayCreateImage` por `ToolCall`) é lento para o agent loop e não acende o indicador de sistema da menu bar; e o operador definiu Codex como referência idêntica, com macOS 27.0 como alvo único, sem necessidade de compat com versões antigas.

_Contradiz ADR-0004 na parte em que streaming contínuo era "otimização posterior": passa a ser o caminho oficial da v1, não otimização futura._

## Decisão

1. Captura oficial passa a ser stream contínuo ScreenCaptureKit (`SCStream`) vivo durante todo `AgentLoop.run()`, display principal apenas, frames em JPEG rápido (full), crop de `zoom`/`region` em CPU no Swift.
2. Indicador de operação é o ícone nativo do sistema aceso pelo stream. Sem pill própria na v1.
3. Cursor real continua movido via `CGEvent`; overlay desenha só halo seguidor + pulse de clique (anel 28px→44px/300ms, cores por botão), 100% click-through, excluído da captura via `SCStreamFilter`.
4. `MacSidecar` ganha modo daemon via stdin (`stream-start/frame`, `overlay-show/event/hide`); `executeBatch` vira async. Um único binário no TCC.
5. Sem supressão de input físico na v1 (último a mexer vence, documentado). Sem botão Stop na v1; abortar = Ctrl-C no terminal.
6. Caminho `CGDisplayCreateImage` fica como fallback escondido (`COMPUTER_USE_LEGACY_CAPTURE=1`), remoção prevista na v2.

## Adendo de implementação (2026-09-16, issue #11)

- Screenshots consomem o stream via `snap-frame`: o daemon escreve o JPEG do buffer num frame file (`COMPUTER_USE_FRAME_DIR`, nonce por chamada) e o TS lê por polling síncrono — sem RPC sobre stdout (sockets do Node 24 não expõem fd síncrono). Zoom passa `region` no snap; sem frame válido, fallback para one-shot.
- Ordem no `start`: `overlay-show` antes de `stream-start`, para o filtro de exclusão (por window number) pegar a janela — verificado (`excludedWindows: 1`).
- Robustez: one-shot SCK tem timeout de 3s com fallback legado; `stream-start` timeout de 15s; `stream-frame` aguarda o primeiro frame até 5s. Observado SCK instável sob churn rápido de streams (stalls); mitigações acima garantem progresso sempre.
- `run()` instala cleanup de SIGINT/SIGTERM (para + re-raise) e `stop()` tem graça de 200ms antes do kill, para não orfanar overlay/stream no Ctrl-C.
- `COMPUTER_USE_NO_OVERLAY=1` força headless; `sink` injetável no `AgentLoop` para testes.

## Consequências

- Build exige ScreenCaptureKit (macOS 13+, alvo real 27.0); teste de aceite inclui latência JPEG e prova de não-vazamento do overlay no frame devolvido ao modelo.
- Q16 (hit-test da pill) e estados thinking/acting visuais morrem com a pill; distinção vive só em log.
- Issue futura separada: cursor desacoplado estilo Codex (real parado), supressão de input, multi-display, PNG opcional, pausa/retomar.
