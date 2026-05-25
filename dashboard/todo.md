# ANVISA Dashboard - TODO

## Schema & Backend
- [x] Schema: tabelas downloads, executions, logs, settings
- [x] Migração SQL aplicada
- [x] db.ts: helpers para downloads, executions, logs, settings
- [x] routers.ts: procedures para dashboard, downloads, controls, logs, settings, history
- [x] SSE endpoint para streaming de logs e status em tempo real
- [x] Gerenciamento de processo filho Python (spawn, pause, resume, stop)

## Frontend - Dashboard
- [x] Layout global com mesh gradient vibrante (rosa, violeta, laranja, azul)
- [x] DashboardLayout com sidebar de navegação
- [x] Cards de métricas: total, percentual, velocidade, erros, espaço B2
- [x] Gráfico de progresso geral em percentual (recharts)
- [x] Controles globais: Iniciar, Pausar, Retomar, Parar

## Frontend - Lista de Downloads
- [x] Lista em tempo real com status individual
- [x] Status: aguardando, baixando, enviando para B2, concluído, erro
- [x] Barra de progresso por arquivo
- [x] Botão "Tentar Novamente" para itens com erro
- [x] Exibição do motivo do erro

## Frontend - Logs
- [x] Painel de logs ao vivo
- [x] Filtro por nível: INFO, WARNING, ERROR
- [x] Auto-scroll para último log

## Frontend - Configurações
- [x] Campo MAX_FILES
- [x] Campo workers paralelos
- [x] Campo cron expression
- [x] Salvamento persistente

## Frontend - Histórico
- [x] Lista de execuções anteriores
- [x] Data, total baixados, erros, link manifesto JSON

## Qualidade
- [x] Testes vitest para procedures principais
- [x] Checkpoint final
