# Computer Use

Harness de `computer use` (operar a interface via screenshot + mouse/teclado) para ferramentas agênticas que ainda não têm a funcionalidade. Escopo inicial: **macOS apenas**.

Ferramentas-alvo: Antigravity, Opencode, Kimi Code, Muse Code. Fora de escopo: Claude Code e Codex (já têm computer use nativo). Vocabulário do projeto em [`CONTEXT.md`](./CONTEXT.md); decisões em [`docs/adr/`](./docs/adr/).

## Como funciona

```
[Modelo] --API--> [Ferramenta agêntica] --MCP/stdin--> [mcp-server] --> [MacSidecar] --> [macOS]
  cérebro              casa              plugue            mãos de TS     mãos nativas
```

- O modelo só decide vendo screenshots; nunca toca o sistema operacional.
- `src/mcp-server.ts` expõe a ferramenta `computer_action` via MCP (Model Context Protocol, que significa Protocolo de Contexto de Modelo) e delega cada chamada ao backend.
- `src/tools/backend.ts` repassa o ToolCall (chamada de ferramenta) em JSON (notação de objetos JavaScript, que significa JavaScript Object Notation) ao binário `MacSidecar`.
- `src/sidecar/` (Swift) captura a tela e injeta mouse/teclado via CGEvent (evento de input do sistema), com remapeamento Retina (tela de alta densidade).
- `src/agent/` tem o agent loop (ciclo pedir, executar, fotografar e repetir) canônico para integrações diretas (sem MCP).

## Pré-requisitos

- macOS com Swift (`swift --version`) e Node 20+.
- Permissões em Configurações do Sistema > Privacidade e Segurança (ver prints em [`screenshots/`](./screenshots/)):
  - **Accessibility** (Acessibilidade) — injetar mouse/teclado.
  - **Screen Recording** (Gravação de Tela) — capturar (só tela; áudio opcional).
- Login na ferramenta-alvo (ex.: `agy` autenticado; sem login o modelo nunca é chamado).

## Build

```bash
npm install
npx tsc                                   # TypeScript -> dist/
swift build -c release --package-path src/sidecar   # sidecar -> src/sidecar/.build/release/MacSidecar
```

Verificação:

```bash
npm test && npm run typecheck && npm run lint   # 29 testes + tipos + estilo
(cd src/sidecar && swift test)                  # 3 testes do sidecar
./src/sidecar/.build/release/MacSidecar check-permissions  # true/false + guia
```

Sem permissão, tudo falha fechado (falha fechada, que significa falhar sem executar nada) com a guia — nunca clique fantasma.

## Instalação como plugin MCP (qualquer ferramenta)

O servidor fala MCP via stdio (entrada/saída padrão, que significa comunicação por texto), então qualquer cliente MCP que rode servidores locais serve. O envelope universal:

```json
{
  "command": "node",
  "args": ["<caminho-do-repo>/dist/src/mcp-server.js"]
}
```

### Antigravity (`agy`) — integração pronta

1. Copie `.agents/plugins/computer-use/` para `.agents/plugins/computer-use/` no escopo onde o `agy` lê plugins (repo ou `~/.config`, conforme seu setup).
2. Ajuste `mcp_config.json` para o caminho real do `dist` **nesta máquina** (o commitado tem path absoluto de exemplo — não funciona em outra máquina sem editar):

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "node",
      "args": ["/seu/caminho/computer-use/dist/src/mcp-server.js"]
    }
  }
}
```

3. `agy` autenticado + permissões do macOS concedidas.
4. Confirme que a ferramenta `computer_action` aparece listada para o modelo.

### Opencode — segunda integração (issue #9)

1. Faça o build acima (`dist/` + binário do sidecar).
2. Copie `opencode.jsonc.example` para o escopo que o opencode lê — global (`~/.config/opencode/opencode.jsonc`, chave `mcp`) ou projeto (`opencode.jsonc` na raiz) — e troque `<caminho-do-repo>` pelo clone local:
```jsonc
{
  "mcp": {
    "computer-use": {
      "type": "local",
      "command": ["node", "<caminho-do-repo>/dist/src/mcp-server.js"],
      "enabled": true
    }
  }
}
```
(Na v2 o mesmo servidor vive em `mcp.servers` com `disabled` no lugar de `enabled`.)
3. `opencode mcp list` deve mostrar `computer-use connected`.
4. Garanta permissões do macOS para o processo que hospeda o servidor (cada binário vira uma entrada própria no TCC — Transparência, Consentimento e Controle, que significa o banco de permissões do macOS).
5. Peça ao modelo uma ação de leitura (ex.: `screenshot`) e confira a imagem devolvida.

Prova (2026-09-17, nesta máquina): `opencode run -m opencode/deepseek-v4-flash-vision-exp` (DeepSeek open-weights com leitura de imagem, via OpenCode Zen) executou `screenshot` + `cursor_position` via MCP sem intervenção — ambas as chamadas com sucesso, imagem recebida e coordenadas devolvidas. Clicar/digitar usam o mesmo encanamento ToolCall→backend→sidecar já coberto (`#4`, `#5`, `#7`); ações consequenciais exigem confirmação humana e ficaram fora da prova autônoma. Limitações registradas: precisão de clique e latência fim a fim do modelo não medidas aqui (one-shot local ~176ms, JPEG ~950KB em base64); roundtrip do modelo na casa de dezenas de segundos.

### Hermes Agent — terceira integração (issue #13)

1. Faça o build acima (`dist/` + binário do sidecar).
2. Registre o servidor via CLI (troque `<caminho-do-repo>` pelo clone local) ou adicione o trecho de `hermes-mcp.example.yaml` sob `mcp_servers:` em `~/.hermes/config.yaml`:
```bash
hermes mcp add computer-use --command node --args <caminho-do-repo>/dist/src/mcp-server.js
```
3. `hermes mcp list` deve mostrar `computer-use` habilitado; `hermes mcp test computer-use` deve conectar e descobrir `computer_action`.
4. Garanta permissões do macOS para o processo que hospeda o servidor (cada binário vira uma entrada própria no TCC — Transparência, Consentimento e Controle, que significa o banco de permissões do macOS).
5. Peça ao modelo uma ação de leitura (ex.: `screenshot`) e confira a imagem devolvida.

Prova (2026-09-18, nesta máquina, Hermes Agent v0.21.3 com `hermes mcp list` vazio antes do registro): `hermes -z` com o modelo default local `deepseek-v4-flash` via provider `deepseek` (leitura de imagem nativa confirmada, sem precisar de variante vision) executou `screenshot` + `cursor_position` via MCP (`mcp__computer_use__computer_action`) sem intervenção — ambas as chamadas com sucesso, imagem recebida e coordenadas devolvidas (`[1034, 452]`); numa segunda chamada o modelo descreveu corretamente a tela (Terminal com a sessão OpenCode). Clicar/digitar usam o mesmo encanamento ToolCall→backend→sidecar já coberto (`#4`, `#5`, `#7`); ações consequenciais exigem confirmação humana e ficaram fora da prova autônoma. Limitações registradas: precisão de clique e latência fim a fim do modelo não medidas aqui (conexão MCP ~332ms no `mcp test`, JPEG ~558–686KB em 2940x1912 no cache do Hermes). Nota: o Hermes não está na lista de ferramentas-alvo do CONTEXT.md — vale como prova avulsa de genericidade do plugue.

### Outras ferramentas (Kimi Code, Muse Code...)

1. Faça o build acima (`dist/` + binário do sidecar).
2. Registre o envelope universal no formato de cliente MCP da ferramenta (campo de `command` + `args`).
3. Garanta permissões do macOS para o processo que hospeda o servidor (cada binário vira uma entrada própria no TCC — Transparência, Consentimento e Controle, que significa o banco de permissões do macOS).
4. Peça ao modelo uma ação de leitura (ex.: `screenshot`) e confira a imagem devolvida.

## A ferramenta `computer_action`

Entrada: `{ "member": "<ação>", "input": { ... } }`. Os 17 members: `screenshot`, `zoom`, `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click`, `left_click_drag`, `mouse_move`, `left_mouse_down`, `left_mouse_up`, `cursor_position`, `scroll`, `type`, `key`, `hold_key`, `wait`.

Saída: texto (`OK`), imagem (`screenshot`/`zoom` em base64 — codificação de binário em texto — JPEG com `imageFormat: "jpeg"`) ou erro (`is_error`, que significa indicador de erro). Via MCP cada chamada = uma ação; sequência, foto por turno e verificação vivem no `AgentLoop` nas integrações diretas. Durante `run()` o loop mantém uma sessão overlay (stream ScreenCaptureKit + halo de clique, ver ADR-0005); `COMPUTER_USE_NO_OVERLAY=1` força headless (sem interface, que significa sem janela) e `COMPUTER_USE_LEGACY_CAPTURE=1` volta à captura legada.

## Mapa do repo

- `src/mcp-server.ts` — plugue MCP (`computer_action`).
- `src/tools/` — protocolo canônico (`types.ts`), adaptadores Anthropic/OpenAI, ponte do sidecar (`backend.ts` com sessão daemon), overlay (`overlay.ts`), conteúdo MCP (`mcp-content.ts`).
- `src/agent/` — loop, histórico com cleaner (rotina de limpeza) e limites.
- `src/sidecar/` — Swift (captura ScreenCaptureKit + JPEG, input nativo, modo `daemon` com overlay fantasma).
- `tests/` — espelha `src/`.
- `docs/reference/` — docs vendored (cópias locais) da OpenAI e Anthropic.
- `docs/adr/` — decisões (macOS-first, permissões, protocolo, híbrido).

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Modelo nunca chamado / timeout no setup | Ferramenta deslogada (ex.: `agy` sem login) |
| `Missing accessibility/screen recording permissions` | Ligar os dois toggles para o processo host |
| `computer_action` não aparece | `mcp_config.json` com path errado ou `dist/` não compilado |
| Screenshot vazio/corrompido em ações grandes | Buffer do spawn (ver `maxBuffer` em `backend.ts`) |
