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

### Outras ferramentas (Opencode, Kimi Code, Muse Code...)

1. Faça o build acima (`dist/` + binário do sidecar).
2. Registre o envelope universal no formato de cliente MCP da ferramenta (campo de `command` + `args`).
3. Garanta permissões do macOS para o processo que hospeda o servidor (cada binário vira uma entrada própria no TCC — Transparência, Consentimento e Controle, que significa o banco de permissões do macOS).
4. Peça ao modelo uma ação de leitura (ex.: `screenshot`) e confira a imagem devolvida.

## A ferramenta `computer_action`

Entrada: `{ "member": "<ação>", "input": { ... } }`. Os 17 members: `screenshot`, `zoom`, `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click`, `left_click_drag`, `mouse_move`, `left_mouse_down`, `left_mouse_up`, `cursor_position`, `scroll`, `type`, `key`, `hold_key`, `wait`.

Saída: texto (`OK`), imagem (`screenshot`/`zoom` em base64 — codificação de binário em texto) ou erro (`is_error`, que significa indicador de erro). Via MCP cada chamada = uma ação; sequência, foto por turno e verificação vivem no `AgentLoop` nas integrações diretas.

## Mapa do repo

- `src/mcp-server.ts` — plugue MCP (`computer_action`).
- `src/tools/` — protocolo canônico (`types.ts`), adaptadores Anthropic/OpenAI, ponte do sidecar (`backend.ts`).
- `src/agent/` — loop, histórico com cleaner (rotina de limpeza) e limites.
- `src/sidecar/` — Swift (captura + input nativo).
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
