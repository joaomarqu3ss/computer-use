# CONTEXT.md — computer-use

Ferramenta que leva `computer use` (operar UI via screenshot + mouse/teclado) para ferramentas agênticas que ainda não têm a funcionalidade.

## Escopo

- **Alvo inicial: macOS apenas.** System calls de input e captura de tela diferem por OS; suportar um OS primeiro evita abstração prematura. Ver `docs/adr/0001-macos-only.md`.
- **Ferramentas-alvo:** Antigravity, Opencode, Kimi Code, Muse Code — todas carentes de computer use.
- **Fora de escopo:** Claude Code e Codex — já possuem computer use nativo, não são alvo.
- **Modelos-alvo:** modelos de código aberto com leitura de imagem (áudio e vídeo como extensão futura). Os formatos GA da Anthropic e da OpenAI servem como referência de protocolo, não como dependência de modelo.

## Vocabulário

- **harness**: nossa camada que executa ações e devolve screenshots (as "mãos").
- **Toolset**: a coleção versionada de ações (`computer_toolset_20260801`, `computer` da OpenAI).
- **Member**: cada ação individual do Toolset (`left_click`, `type`, `screenshot`...).
- **ToolCall**: uma invocação em runtime (o pedido com `id` + `input`). Sinônimos por provider: `computer_call` (OpenAI), `tool_use` (Anthropic).
- **ToolResult**: o retorno de um ToolCall, com screenshot novo ou `OK`/`is_error`. Sinônimos por provider: `computer_call_output` (OpenAI), `tool_result` (Anthropic).
- **agent loop**: ciclo pedir → executar → fotografar → repetir até o modelo parar de pedir ferramenta.
- **batch action**: vários ToolCalls num único turno; executar em ordem, parar no primeiro erro.

## Convenção de comunicação

- Toda vez que o operador pedir para explicar melhor, a explicação deve ser completa e expandir cada abreviação usada (sigla + significado por extenso na primeira ocorrência).

## Referências vendored

- `docs/reference/openai-computer-use.md` — guia OpenAI (Responses API, `computer` tool).
- `docs/reference/openai-computer-use-integration.md` — recipes OpenAI (ambiente, handlers, code execution).
- `docs/reference/anthropic-computer-use-tool.md` — guia Anthropic (`computer_toolset_20260801`, 17 members).
