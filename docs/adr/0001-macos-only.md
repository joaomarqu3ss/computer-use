# ADR-0001: macOS-only no início

Data: 2026-09-13
Status: aceito

## Contexto

Captura de tela, injeção de mouse/teclado e permissões são system calls diferentes por OS (macOS: CGEvent, `screencapture`, permissões de Acessibilidade + Screen Recording; Linux: X11/Xvfb; Windows: Win32 SendInput). Abstrair os três de saída atrasa o MVP.

## Decisão

Escopo inicial = **macOS apenas**. O harness implementa captura + input via APIs macOS. Coordenadas em pixels do screenshot, com cuidado para Retina (remapear pontos lógicos ↔ pixels físicos).

## Consequências

- Backend Linux/Windows ficam para ADRs futuras.
- O protocolo (`screenshot, click, type, key, scroll, drag, wait`) já nasce OS-agnóstico para permitir os backends depois.
- Testes e sample app rodam em Mac.
