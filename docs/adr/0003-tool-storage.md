# ADR-0003: armazenamento e forma das tools

Data: 2026-09-13
Status: aceito

## Contexto

Precisávamos decidir onde moram as definições do Toolset/Members e como representar ToolCalls dos dois providers (Anthropic `tool_use` + `toolset_name`, OpenAI `computer_call.actions[]`), e se o histórico de execução persiste.

## Decisão

- **Q1 — Definições fixas em código.** Toolset + Members como tipos fechados num módulo `tools/` (fonte única, compiler checa). `docs/reference/` segue como espelho de leitura. Config só para o que varia por máquina (resolução, members habilitados via `configs`).
- **Q2 — Protocolo interno único + adaptadores.** Um `ToolCall` canônico (`screenshot, click, type, key, scroll, drag, wait...`); dois adaptadores finos convertem de/para Anthropic e OpenAI. O backend macOS implementa o canônico uma vez só.
- **Q3 — Histórico só em memória, com cleaner.** Sem persistência em disco no MVP; um cleaner libera ToolCalls/ToolResults + imagens após a implementação do loop para não estourar memória no modo streaming.

## Consequências

- Nova versão upstream (ex.: sucessor de `computer_toolset_20260801`) = novo adaptador + extensão dos tipos, sem tocar o backend.
- Replay/debug de sessão fica limitado ao log da ferramenta agêntica até termos persistência opcional futura.
- O cleaner precisa de limite explícito (por turno e por sessão) antes do streaming contínuo.
