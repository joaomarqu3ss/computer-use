# ADR-0004: implementação híbrida em escopo único

Data: 2026-09-13
Status: aceito

## Contexto

A pergunta 4 (linguagem do módulo `tools/`) opunha TypeScript puro (iteração rápida junto às ferramentas-alvo) ao híbrido (TypeScript + sidecar nativo Swift/Rust para captura e input no macOS). O operador escolheu o híbrido, com a condição de ser uma implementação única, sem desfocar do escopo nem perder contexto da funcionalidade.

## Decisão

Implementação híbrida em escopo único: o protocolo canônico, os adaptadores e o agent loop nascem em TypeScript, e o backend macOS (captura de tela + injeção de mouse/teclado) nasce como um sidecar nativo pequeno, na mesma entrega, atrás da mesma interface do protocolo. Nada de dois projetos ou duas fases separadas; uma única funcionalidade de ponta a ponta.

## Consequências

- Assinatura e permissões (Accessibility + Screen Recording) valem para o sidecar desde o dia um, com entrada própria no TCC.
- O escopo fica travado no caminho screenshot-por-turno primeiro; streaming contínuo continua sendo otimização posterior, não parte da entrega.
- Build e distribuição carregam o custo do binário nativo desde o início (assinatura, versionamento casado com o TypeScript).
