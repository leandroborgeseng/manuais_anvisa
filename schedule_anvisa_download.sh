#!/bin/bash

# Script para agendar o download automático de manuais da ANVISA
# Executa anualmente ou em intervalos configuráveis

# Configurações
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOWNLOAD_DIR="${SCRIPT_DIR}/anvisa_manuais"
LOG_DIR="${SCRIPT_DIR}/logs"
PYTHON_SCRIPT="${SCRIPT_DIR}/anvisa_downloader_selenium.py"
LOG_FILE="${LOG_DIR}/anvisa_download_$(date +%Y%m%d_%H%M%S).log"

# Criar diretórios se não existirem
mkdir -p "${DOWNLOAD_DIR}" "${LOG_DIR}"

# Função para executar o download
run_download() {
    echo "========================================" | tee -a "${LOG_FILE}"
    echo "Iniciando download de manuais da ANVISA" | tee -a "${LOG_FILE}"
    echo "Data: $(date)" | tee -a "${LOG_FILE}"
    echo "========================================" | tee -a "${LOG_FILE}"
    
    # Verificar se Python está disponível
    if ! command -v python3 &> /dev/null; then
        echo "Erro: Python3 não encontrado" | tee -a "${LOG_FILE}"
        exit 1
    fi
    
    # Executar o script de download
    python3 "${PYTHON_SCRIPT}" \
        --output-dir "${DOWNLOAD_DIR}" \
        --search-term "a" \
        2>&1 | tee -a "${LOG_FILE}"
    
    RESULT=$?
    
    echo "" | tee -a "${LOG_FILE}"
    if [ $RESULT -eq 0 ]; then
        echo "Download concluído com sucesso" | tee -a "${LOG_FILE}"
    else
        echo "Erro durante o download (código: $RESULT)" | tee -a "${LOG_FILE}"
    fi
    
    echo "Data de conclusão: $(date)" | tee -a "${LOG_FILE}"
    echo "========================================" | tee -a "${LOG_FILE}"
}

# Função para configurar cron job
setup_cron() {
    local cron_schedule="$1"
    local cron_command="cd ${SCRIPT_DIR} && bash ${SCRIPT_DIR}/schedule_anvisa_download.sh run"
    
    # Verificar se job já existe
    if crontab -l 2>/dev/null | grep -q "schedule_anvisa_download.sh"; then
        echo "Cron job já existe. Removendo versão anterior..."
        crontab -l | grep -v "schedule_anvisa_download.sh" | crontab -
    fi
    
    # Adicionar novo job
    (crontab -l 2>/dev/null; echo "${cron_schedule} ${cron_command}") | crontab -
    
    echo "Cron job configurado com sucesso!"
    echo "Agendamento: ${cron_schedule}"
    echo "Comando: ${cron_command}"
}

# Função para remover cron job
remove_cron() {
    if crontab -l 2>/dev/null | grep -q "schedule_anvisa_download.sh"; then
        crontab -l | grep -v "schedule_anvisa_download.sh" | crontab -
        echo "Cron job removido com sucesso"
    else
        echo "Nenhum cron job encontrado"
    fi
}

# Função para mostrar status
show_status() {
    echo "Status do agendamento de downloads da ANVISA"
    echo "=============================================="
    echo ""
    echo "Diretório de downloads: ${DOWNLOAD_DIR}"
    echo "Diretório de logs: ${LOG_DIR}"
    echo ""
    
    if [ -d "${DOWNLOAD_DIR}" ]; then
        echo "Estatísticas:"
        echo "  Total de diretórios: $(find ${DOWNLOAD_DIR} -maxdepth 1 -type d | wc -l)"
        echo "  Total de arquivos: $(find ${DOWNLOAD_DIR} -type f | wc -l)"
        echo "  Tamanho total: $(du -sh ${DOWNLOAD_DIR} 2>/dev/null | cut -f1)"
    fi
    
    echo ""
    echo "Cron jobs ativos:"
    if crontab -l 2>/dev/null | grep -q "schedule_anvisa_download.sh"; then
        crontab -l | grep "schedule_anvisa_download.sh"
    else
        echo "  Nenhum cron job configurado"
    fi
    
    echo ""
    echo "Últimos logs:"
    ls -lt "${LOG_DIR}"/*.log 2>/dev/null | head -5 | awk '{print "  " $NF}'
}

# Função para mostrar ajuda
show_help() {
    cat << EOF
Script de agendamento para download de manuais da ANVISA

Uso: $0 [comando] [opções]

Comandos:
  run                    Executar download imediatamente
  setup-cron SCHEDULE    Configurar execução automática via cron
                        Exemplos de SCHEDULE:
                          "0 0 1 * *"     - Todo dia 1º do mês às 00:00
                          "0 2 * * 0"     - Todo domingo às 02:00
                          "0 0 * * *"     - Diariamente às 00:00
  remove-cron           Remover agendamento automático
  status                Mostrar status dos downloads
  help                  Mostrar esta mensagem

Exemplos:
  # Executar download agora
  $0 run

  # Agendar para executar todo dia 1º do mês às 2 da manhã
  $0 setup-cron "0 2 1 * *"

  # Agendar para executar toda segunda-feira às 3 da manhã
  $0 setup-cron "0 3 * * 1"

  # Remover agendamento
  $0 remove-cron

  # Ver status
  $0 status

EOF
}

# Processar argumentos
case "${1:-help}" in
    run)
        run_download
        ;;
    setup-cron)
        if [ -z "$2" ]; then
            echo "Erro: Agendamento não fornecido"
            echo "Uso: $0 setup-cron 'SCHEDULE'"
            echo "Exemplo: $0 setup-cron '0 2 1 * *'"
            exit 1
        fi
        setup_cron "$2"
        ;;
    remove-cron)
        remove_cron
        ;;
    status)
        show_status
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo "Comando desconhecido: $1"
        show_help
        exit 1
        ;;
esac
